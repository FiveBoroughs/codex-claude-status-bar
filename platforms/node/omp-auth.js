import {execFile} from 'node:child_process';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {promisify} from 'node:util';

const run = promisify(execFile);

// Provider names are fixed literals chosen by the exported factories below,
// never caller input, so interpolating them into the query is safe.
const queryFor = provider => `SELECT data FROM auth_credentials WHERE provider='${provider}' AND credential_type='oauth' AND disabled_cause IS NULL ORDER BY id ASC LIMIT 1;`;

function createOmpCredentialReader(options, provider, errorMessage, extract) {
    return async function readOmpCredential() {
        try {
            let path = options.getDbPath ? options.getDbPath() : options.dbPath;
            path ||= '~/.omp/agent/agent.db';
            if (typeof path !== 'string')
                throw new Error();
            if (path.startsWith('~/'))
                path = `${homedir()}${path.slice(1)}`;
            const {stdout} = await run('sqlite3', ['-readonly', '-json', resolve(path), queryFor(provider)], {
                encoding: 'utf8', maxBuffer: 1024 * 1024,
            });
            const rows = stdout.trim() ? JSON.parse(stdout) : [];
            if (!Array.isArray(rows) || rows.length > 1)
                throw new Error();
            if (!rows.length)
                return null;
            return extract(JSON.parse(rows[0].data));
        } catch {
            throw new Error(errorMessage);
        }
    };
}

function accessOf(credential) {
    if (typeof credential?.access !== 'string' || !credential.access)
        throw new Error();
    return credential.access;
}

export function createMuseCredentialReader(options = {}) {
    return createOmpCredentialReader(options, 'muse-code',
        'Unable to read Muse Code OAuth credential from OMP', accessOf);
}

export function createCodexCredentialReader(options = {}) {
    return createOmpCredentialReader(options, 'openai-codex',
        'Unable to read Codex OAuth credential from OMP', credential => ({
            accessToken: accessOf(credential),
            accountId: typeof credential.accountId === 'string' && credential.accountId
                ? credential.accountId
                : null,
        }));
}
