import {normalizeMeridianUsage} from '../core/normalize.js';

// Meridian is a self-hosted proxy in front of a Claude subscription. It holds
// the OAuth credential itself and serves usage over plain HTTP, so there is no
// credential file and no token refresh: one unauthenticated GET.
export const MERIDIAN_DEFAULT_URL = 'http://127.0.0.1:3456/';
const QUOTA_PATH = '/v1/usage/quota';

function ok(data) {
    return {ok: true, data};
}

function fail(code, message, data = null) {
    const result = {
        ok: false,
        error: {
            code,
            message,
        },
    };

    if (data)
        result.data = data;

    return result;
}

function mapHttpStatusToErrorCode(status) {
    if (status === 401 || status === 403)
        return 'auth_expired';

    if (status === 404)
        return 'schema_changed';

    if (status === 429)
        return 'rate_limited';

    return 'network_error';
}

// Tolerates the base URL with or without a trailing slash, and keeps any path
// prefix a reverse proxy may have put Meridian under.
export function meridianQuotaUrl(baseUrl) {
    return `${String(baseUrl).replace(/\/+$/, '')}${QUOTA_PATH}`;
}

// `getBaseUrl` is read on every poll, so changing the setting takes effect on
// the next refresh without re-enabling the extension.
export function createMeridianProvider(options = {}) {
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const getBaseUrl = options.getBaseUrl ?? (() => MERIDIAN_DEFAULT_URL);

    return {
        async getUsage() {
            if (typeof fetchImpl !== 'function')
                return fail('network_error', 'Fetch implementation is unavailable');

            const quotaUrl = meridianQuotaUrl(getBaseUrl() || MERIDIAN_DEFAULT_URL);

            try {
                const response = await fetchImpl(quotaUrl, {method: 'GET'});
                if (!response.ok)
                    return fail(mapHttpStatusToErrorCode(response.status), `Meridian usage request failed with status ${response.status}`);

                let payload;
                try {
                    payload = await response.json();
                } catch {
                    return fail('schema_changed', 'Meridian returned invalid JSON');
                }

                const normalized = normalizeMeridianUsage(payload);
                if (!normalized.hasSessionUsage && !normalized.hasWeeklyUsage)
                    return fail('schema_changed', 'Meridian reported no usage windows');

                if (!normalized.hasSessionUsage || !normalized.hasWeeklyUsage)
                    return fail('partial_data', 'Meridian reported only one usage window', normalized.data);

                return ok(normalized.data);
            } catch {
                return fail('network_error', `Network request failed while calling Meridian at ${quotaUrl}`);
            }
        },
    };
}
