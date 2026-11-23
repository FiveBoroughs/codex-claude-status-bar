import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, rm, readFile, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMuseCredentialReader} from '../platforms/node/omp-auth.js';
import {createMuseProvider as portable} from '../core/providers/muse.js';
import {createMuseProvider as gnome} from '../src/lib/providers/muse.js';
import {readMuseUsage} from '../core/normalize.js';
import {normalizeMuseUsage} from '../src/lib/core/normalize.js';

const run = promisify(execFile);
const secret = 'account-secret-not-a-jwt';
const encoded = JSON.stringify({apiKey: 'payg-secret', oauthAccessToken: secret});
const response = payload => ({ok: true, status: 200, json: async () => payload});
const quote = value => `'${String(value).replaceAll("'", "''")}'`;

async function fixture(t, rows = []) {
    const directory = await mkdtemp(join(tmpdir(), 'muse-auth-'));
    t.after(() => rm(directory, {recursive: true, force: true}));
    const dbPath = join(directory, "agent ' spaced.db");
    const sql = 'CREATE TABLE auth_credentials (id INTEGER PRIMARY KEY, provider TEXT, credential_type TEXT, data TEXT, disabled_cause TEXT);'
        + rows.map(([id, provider, type, data, disabled]) =>
            `INSERT INTO auth_credentials VALUES (${id},${quote(provider)},${quote(type)},${quote(data)},${disabled === null ? 'NULL' : quote(disabled)});`).join('');
    await run('sqlite3', [dbPath, sql]);
    return {dbPath, directory};
}

for (const [runtime, create] of [['portable', portable], ['GNOME', gnome]]) {
    test(`${runtime} Muse authenticates quota using account OAuth without JWT assumptions`, async () => {
        let requests = 0;
        let reads = 0;
        const provider = create({readMuseCredential: async () => { reads++; return encoded; }, fetch: async (url, options) => {
            requests++;
            assert.equal(url, 'https://api.meta.ai/muse-code/key');
            assert.equal(options.method, 'POST');
            assert.equal(options.body, '{}');
            assert.deepEqual(options.headers, {Authorization: `Bearer ${secret}`, Accept: 'application/json',
                'Content-Type': 'application/json', 'x-api-version': '1.0.0'});
            return response({is_subs_active: true, api_key: 'never-return', email: 'private',
                subs_usage: {window: {used_percent: 10, window_duration_mins: 30}}});
        }});
        for (let i = 0; i < 2; i++) {
            const result = await provider.getUsage();
            assert.equal(result.ok, true);
            assert.equal(result.data.sessionRemainingPct, 90);
            assert.equal(result.data.weeklyRemainingPct, null);
            assert.equal(result.data.sessionShortLabel, '30m');
            assert.equal(JSON.stringify(result).includes('never-return'), false);
            assert.equal(JSON.stringify(result).includes('private'), false);
        }
        assert.equal(requests, 2);
        assert.equal(reads, 2);
    });

    test(`${runtime} Muse handles missing, malformed and PAYG-only credentials safely`, async () => {
        for (const [credential, code] of [[null, 'missing_creds'], ['bad-json-secret', 'parse_error'],
            [JSON.stringify({apiKey: 'secret'}), 'parse_error'], [JSON.stringify({oauthAccessToken: ''}), 'parse_error']]) {
            const result = await create({readMuseCredential: async () => credential,
                fetch: async () => { throw new Error('should not request'); }}).getUsage();
            assert.equal(result.error.code, code);
            assert.equal(JSON.stringify(result).includes('secret'), false);
        }
        assert.equal((await create({}).getUsage()).error.code, 'missing_creds');
        const result = await create({readMuseCredential: async () => { throw new Error(secret); }}).getUsage();
        assert.equal(result.error.code, 'missing_creds');
        assert.equal(JSON.stringify(result).includes(secret), false);
    });

    test(`${runtime} Muse maps quota failures and accepts either usable window`, async () => {
        const check = async fetch => create({readMuseCredential: async () => encoded, fetch}).getUsage();
        for (const [status, code] of [[401, 'auth_expired'], [403, 'auth_expired'], [404, 'schema_changed'],
            [429, 'rate_limited'], [500, 'network_error']])
            assert.equal((await check(async () => ({ok: false, status}))).error.code, code);
        assert.equal((await check(async () => response({is_subs_active: false, subs_usage: {weekly: {used_percent: 0}}}))).error.code, 'auth_expired');
        for (const payload of [{}, {api_key: 'payg', balance: 200}, {subs_usage: {window: {used_percent: '0'}}}])
            assert.equal((await check(async () => response(payload))).error.code, 'schema_changed');
        const weekly = await check(async () => response({subs_usage: {weekly: {used_percent: 15}}}));
        assert.equal(weekly.ok, true);
        assert.equal(weekly.data.sessionRemainingPct, null);
        assert.equal(weekly.data.weeklyRemainingPct, 85);
        assert.equal((await check(async () => ({ok: true, json: async () => { throw new Error(secret); }}))).error.code, 'schema_changed');
        const network = await check(async () => { throw new Error(secret); });
        assert.equal(network.error.code, 'network_error');
        assert.equal(JSON.stringify(network).includes(secret), false);
    });
}

test('portable and GNOME Muse normalizers share window and unknown duration semantics', () => {
    for (const payload of [null, {}, {subs_usage: {window: {used_percent: 0}}},
        {subs_usage: {weekly: {used_percent: 25, resets_at: 1800000000}}},
        {subs_usage: {window: {used_percent: -1, window_duration_mins: 180, resets_at: 'invalid'}}}])
        assert.deepEqual(normalizeMuseUsage(payload), readMuseUsage(payload));
});

test('OMP reader selects earliest enabled Muse OAuth row, ignoring disabled and PAYG credentials', async t => {
    const {dbPath} = await fixture(t, [
        [1, 'muse-code', 'oauth', JSON.stringify({access: 'disabled-secret'}), 'revoked'],
        [2, 'muse-code', 'api_key', JSON.stringify({access: 'payg-secret'}), null],
        [3, 'meta', 'oauth', JSON.stringify({access: 'meta-secret'}), null],
        [5, 'muse-code', 'oauth', JSON.stringify({access: encoded, expires: 0, refresh: 'unused'}), null],
        [8, 'muse-code', 'oauth', JSON.stringify({access: 'later-secret'}), null],
    ]);
    const before = await readFile(dbPath);
    assert.equal(await createMuseCredentialReader({dbPath})(), encoded);
    assert.deepEqual(await readFile(dbPath), before);
});

test('OMP reader excludes disabled-only and PAYG-only credentials', async t => {
    const {dbPath} = await fixture(t, [
        [1, 'muse-code', 'oauth', '{}', 'disabled'], [2, 'muse-code', 'api_key', '{}', null],
    ]);
    assert.equal(await createMuseCredentialReader({dbPath})(), null);
});

test('OMP reader does not create missing databases and errors disclose no input', async t => {
    const {directory} = await fixture(t);
    const dbPath = join(directory, `${secret}.db`);
    await assert.rejects(createMuseCredentialReader({dbPath})(), error => {
        assert.equal(error.message, 'Unable to read Muse Code OAuth credential from OMP');
        assert.equal(String(error).includes(secret), false);
        return true;
    });
    await assert.rejects(stat(dbPath), {code: 'ENOENT'});
});

test('OMP reader safely rejects malformed stored credentials and rereads live configured path', async t => {
    const first = await fixture(t, [[1, 'muse-code', 'oauth', 'malformed-secret', null]]);
    const second = await fixture(t, [[1, 'muse-code', 'oauth', JSON.stringify({access: encoded}), null]]);
    let path = first.dbPath;
    const read = createMuseCredentialReader({getDbPath: () => path});
    await assert.rejects(read(), {message: 'Unable to read Muse Code OAuth credential from OMP'});
    path = second.dbPath;
    assert.equal(await read(), encoded);
});
