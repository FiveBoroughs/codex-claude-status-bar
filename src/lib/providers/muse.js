import {normalizeMuseUsage} from '../core/normalize.js';

function failed(code, message) {
    return {ok: false, error: {code, message}};
}

function failureForStatus(status) {
    if (status === 401 || status === 403)
        return 'auth_expired';
    if (status === 404)
        return 'schema_changed';
    if (status === 429)
        return 'rate_limited';
    return 'network_error';
}

export function createMuseProvider({fetch: fetchImpl, readMuseCredential} = {}) {
    return {
        name: 'muse',
        async getUsage() {
            let encoded;
            try {
                encoded = typeof readMuseCredential === 'function' ? await readMuseCredential() : null;
            } catch {
                return failed('missing_creds', 'Unable to read Muse Code credentials');
            }
            if (!encoded)
                return failed('missing_creds', 'No enabled Muse Code OAuth credential');
            let token;
            try {
                token = JSON.parse(encoded)?.oauthAccessToken;
                if (typeof token !== 'string' || !token.trim())
                    throw new Error();
            } catch {
                return failed('parse_error', 'Invalid Muse Code account credential');
            }
            if (typeof fetchImpl !== 'function')
                return failed('network_error', 'Fetch implementation is unavailable');
            try {
                const response = await fetchImpl('https://api.meta.ai/muse-code/key', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        Accept: 'application/json',
                        'Content-Type': 'application/json',
                        'x-api-version': '1.0.0',
                    },
                    body: '{}',
                });
                if (!response.ok)
                    return failed(failureForStatus(response.status), `Muse Code quota request failed with status ${response.status}`);
                let payload;
                try {
                    payload = await response.json();
                } catch {
                    return failed('schema_changed', 'Muse Code returned invalid JSON');
                }
                if (payload?.is_subs_active === false)
                    return failed('auth_expired', 'Muse Code subscription is inactive');
                // An active idle subscription can omit all quota, weekly
                // included: report it unavailable, never invent a reading.
                if (payload?.is_subs_active === true && payload.subs_usage == null)
                    return failed('quota_unavailable', 'Meta omitted quota for the active Muse Code subscription');
                const reading = normalizeMuseUsage(payload);
                if (!reading.present.session && !reading.present.weekly)
                    return failed('schema_changed', 'Muse Code reported no usable subscription quota windows');
                return {ok: true, data: reading.data};
            } catch {
                return failed('network_error', 'Muse Code quota request failed');
            }
        },
    };
}
