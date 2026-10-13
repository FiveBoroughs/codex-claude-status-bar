import {test} from 'node:test';
import assert from 'node:assert/strict';

import {createCodexProvider, codexProviderConfig} from '../src/lib/providers/codex.js';

const FormParser = globalThis.URLSearchParams;

for (const initialAccessToken of ['expired-token', null]) {
    test(`GNOME refresh recovers ${initialAccessToken ? 'rejected' : 'missing'} access tokens without browser globals`, async () => {
        const refreshToken = 'refresh token+&=é';
        const requests = [];
        const provider = createCodexProvider({
            readTextFile: async () => JSON.stringify({tokens: {
                access_token: initialAccessToken,
                refresh_token: refreshToken,
            }}),
            fetch: async (url, options) => {
                if (url === codexProviderConfig.REFRESH_ENDPOINT) {
                    requests.push('refresh');
                    const form = new FormParser(options.body);
                    const accepted = form.get('grant_type') === 'refresh_token'
                        && form.get('client_id') === codexProviderConfig.CODEX_CLIENT_ID
                        && form.get('refresh_token') === refreshToken;
                    return {ok: accepted, status: accepted ? 200 : 400,
                        json: async () => ({access_token: 'renewed-token'})};
                }

                assert.equal(url, codexProviderConfig.USAGE_ENDPOINT);
                requests.push('quota');
                if (options.headers.authorization !== 'Bearer renewed-token')
                    return {ok: false, status: 401};

                return {ok: true, status: 200, json: async () => ({rate_limit: {
                    primary_window: {used_percent: 20, limit_window_seconds: 604800, reset_at: 1800000000},
                }})};
            },
        });

        // GJS supplies neither URLSearchParams nor the browser fetch API.
        const original = globalThis.URLSearchParams;
        let result;
        try {
            globalThis.URLSearchParams = undefined;
            result = await provider.getUsage();
        } finally {
            globalThis.URLSearchParams = original;
        }

        assert.equal(result.ok, true, JSON.stringify(result.error));
        assert.equal(result.data.weeklyRemainingPct, 80);
        assert.deepEqual(requests, initialAccessToken
            ? ['quota', 'refresh', 'quota']
            : ['refresh', 'quota']);
    });
}
