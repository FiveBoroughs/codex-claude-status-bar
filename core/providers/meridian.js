// Meridian is a self-hosted proxy in front of a Claude subscription. It holds
// the OAuth credential itself and serves the account's usage over plain HTTP,
// so unlike the other providers there is no credential file to read and no
// token to refresh: one unauthenticated GET, then the same validation Claude
// gets.

import {readMeridianUsage} from '../normalize.js';
import {failed, failureForStatus, readJson, usable} from '../result.js';

export const MERIDIAN_DEFAULT_URL = 'http://127.0.0.1:3456/';

const QUOTA_PATH = '/v1/usage/quota';

// Tolerates the base URL with or without a trailing slash, and keeps any path
// prefix a reverse proxy may have put Meridian under.
export function meridianQuotaUrl(baseUrl) {
    return `${String(baseUrl).replace(/\/+$/, '')}${QUOTA_PATH}`;
}

// Meridian mirrors Claude's two headline windows, so the rule is Claude's: none
// means the payload moved (or Meridian has no reading yet), one is partial.
function inspect(present) {
    if (!present.session && !present.weekly)
        return {code: 'schema_changed', message: 'Meridian reported no usage windows'};

    if (!present.session || !present.weekly) {
        return {
            code: 'partial_data',
            message: 'Meridian reported only one usage window',
            keepData: true,
        };
    }

    return null;
}

export function createMeridianProvider(options = {}) {
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const quotaUrl = meridianQuotaUrl(options.baseUrl || MERIDIAN_DEFAULT_URL);

    return {
        name: 'meridian',

        async getUsage() {
            if (typeof fetchImpl !== 'function')
                return failed('network_error', 'No fetch implementation is available');

            try {
                const response = await fetchImpl(quotaUrl, {method: 'GET'});

                if (!response.ok) {
                    return failed(
                        failureForStatus(response.status),
                        `Meridian usage request failed with status ${response.status}`,
                    );
                }

                const payload = await readJson(response);
                if (!payload)
                    return failed('schema_changed', 'Meridian returned invalid JSON');

                const reading = readMeridianUsage(payload);
                const complaint = inspect(reading.present);

                if (complaint)
                    return failed(complaint.code, complaint.message, complaint.keepData ? reading.data : null);

                return usable(reading.data);
            } catch {
                return failed('network_error', `Network request failed while calling Meridian at ${quotaUrl}`);
            }
        },
    };
}
