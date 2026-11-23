import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

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
                path = `${GLib.get_home_dir()}${path.slice(1)}`;
            path = GLib.canonicalize_filename(path, GLib.get_current_dir());
            const process = Gio.Subprocess.new(['sqlite3', '-readonly', '-json', path, queryFor(provider)],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            const stdout = await new Promise((resolve, reject) => {
                process.communicate_utf8_async(null, null, (source, result) => {
                    try {
                        const [, output] = source.communicate_utf8_finish(result);
                        if (!source.get_successful())
                            throw new Error();
                        resolve(output);
                    } catch {
                        reject(new Error('Unable to query OMP credentials'));
                    }
                });
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
