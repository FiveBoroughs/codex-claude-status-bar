import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, rm, readFile, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCodexCredentialReader} from '../platforms/node/omp-auth.js';

const run = promisify(execFile);
const secret = 'codex-access-secret';
const quote = value => `'${String(value).replaceAll("'", "''")}'`;

async function fixture(t, rows = []) {
    const directory = await mkdtemp(join(tmpdir(), 'codex-auth-'));
    t.after(() => rm(directory, {recursive: true, force: true}));
    const dbPath = join(directory, "agent ' spaced.db");
    const sql = 'CREATE TABLE auth_credentials (id INTEGER PRIMARY KEY, provider TEXT, credential_type TEXT, data TEXT, disabled_cause TEXT);'
        + rows.map(([id, provider, type, data, disabled]) =>
            `INSERT INTO auth_credentials VALUES (${id},${quote(provider)},${quote(type)},${quote(data)},${disabled === null ? 'NULL' : quote(disabled)});`).join('');
    await run('sqlite3', [dbPath, sql]);
    return {dbPath, directory};
}

test('OMP Codex reader selects earliest enabled Codex OAuth row, ignoring Muse, API-key and disabled credentials', async t => {
    const {dbPath} = await fixture(t, [
        [1, 'openai-codex', 'oauth', JSON.stringify({access: 'disabled-secret', accountId: 'disabled-account'}), 'revoked'],
        [2, 'openai-codex', 'api_key', JSON.stringify({access: 'api-key-secret', accountId: 'api-key-account'}), null],
        [3, 'muse-code', 'oauth', JSON.stringify({access: 'muse-secret'}), null],
        [5, 'openai-codex', 'oauth', JSON.stringify({access: secret, accountId: 'codex-account', refresh: 'refresh-secret', expires: 0}), null],
        [8, 'openai-codex', 'oauth', JSON.stringify({access: 'later-secret', accountId: 'later-account'}), null],
    ]);
    const before = await readFile(dbPath);
    assert.deepEqual(await createCodexCredentialReader({dbPath})(),
        {accessToken: secret, accountId: 'codex-account'});
    assert.deepEqual(await readFile(dbPath), before);
});

test('OMP Codex reader returns null accountId when absent', async t => {
    const {dbPath} = await fixture(t, [
        [1, 'openai-codex', 'oauth', JSON.stringify({access: secret}), null],
    ]);
    assert.deepEqual(await createCodexCredentialReader({dbPath})(),
        {accessToken: secret, accountId: null});
});

test('OMP Codex reader returns null when no enabled Codex OAuth credential exists', async t => {
    const {dbPath} = await fixture(t, [
        [1, 'openai-codex', 'oauth', '{}', 'disabled'],
        [2, 'openai-codex', 'api_key', '{}', null],
        [3, 'muse-code', 'oauth', JSON.stringify({access: 'muse-secret'}), null],
    ]);
    assert.equal(await createCodexCredentialReader({dbPath})(), null);
});

test('OMP Codex reader does not create missing databases and errors disclose no input', async t => {
    const {directory} = await fixture(t);
    const dbPath = join(directory, `${secret}.db`);
    await assert.rejects(createCodexCredentialReader({dbPath})(), error => {
        assert.equal(error.message, 'Unable to read Codex OAuth credential from OMP');
        assert.equal(String(error).includes(secret), false);
        return true;
    });
    await assert.rejects(stat(dbPath), {code: 'ENOENT'});
});

test('OMP Codex reader safely rejects malformed stored credentials and rereads live configured path', async t => {
    const malformed = await fixture(t, [[1, 'openai-codex', 'oauth', 'malformed-secret', null]]);
    const missingAccess = await fixture(t, [[1, 'openai-codex', 'oauth', JSON.stringify({accountId: 'codex-account', refresh: 'refresh-secret'}), null]]);
    const valid = await fixture(t, [[1, 'openai-codex', 'oauth', JSON.stringify({access: secret, accountId: 'codex-account'}), null]]);
    let path = malformed.dbPath;
    const read = createCodexCredentialReader({getDbPath: () => path});
    await assert.rejects(read(), error => {
        assert.equal(error.message, 'Unable to read Codex OAuth credential from OMP');
        assert.equal(String(error).includes('malformed-secret'), false);
        return true;
    });
    path = missingAccess.dbPath;
    await assert.rejects(read(), {message: 'Unable to read Codex OAuth credential from OMP'});
    path = valid.dbPath;
    assert.deepEqual(await read(), {accessToken: secret, accountId: 'codex-account'});
});
