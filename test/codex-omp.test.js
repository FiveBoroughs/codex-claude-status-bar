import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCodexProvider as portable} from '../core/providers/codex.js';
import {createCodexProvider as gnome} from '../src/lib/providers/codex.js';

const usage = {rate_limit: {
    primary_window: {used_percent: 12, limit_window_seconds: 18000},
    secondary_window: {used_percent: 61, limit_window_seconds: 604800},
}};

for (const [runtime, create] of [['portable', portable], ['GNOME', gnome]]) {
    test(`${runtime} Codex uses live OMP credentials instead of stale CLI credentials`, async () => {
        let accessToken = 'omp-first';
        const provider = create({
            readCodexCredential: async () => ({accessToken, accountId: 'omp-account'}),
            readTextFile: async () => JSON.stringify({tokens: {
                access_token: 'expired-cli', refresh_token: 'reused-cli', account_id: 'old-account',
            }}),
            fetch: async (url, options) => {
                assert.equal(url, 'https://chatgpt.com/backend-api/wham/usage');
                assert.equal(options.headers.authorization, `Bearer ${accessToken}`);
                assert.equal(options.headers['ChatGPT-Account-Id'], 'omp-account');
                return {ok: true, status: 200, json: async () => usage};
            },
        });
        for (const token of ['omp-first', 'omp-rotated']) {
            accessToken = token;
            const result = await provider.getUsage();
            assert.equal(result.ok, true, JSON.stringify(result.error));
            assert.equal(result.data.sessionRemainingPct, 88);
            assert.equal(result.data.weeklyRemainingPct, 39);
            assert.equal(JSON.stringify(result).includes(token), false);
            assert.equal(JSON.stringify(result).includes('omp-account'), false);
        }
    });

    for (const [label, readCodexCredential] of [
        ['absent', async () => null],
        ['throwing', async () => { throw new Error('OMP database unavailable'); }],
    ]) {
        test(`${runtime} Codex falls back to CLI credentials and refresh when OMP is ${label}`, async () => {
            let refreshCalls = 0;
            const provider = create({
                readCodexCredential,
                readTextFile: async () => JSON.stringify({tokens: {
                    access_token: 'expired-cli', refresh_token: 'cli-refresh', account_id: 'cli-account',
                }}),
                fetch: async (url, options) => {
                    if (url === 'https://auth.openai.com/oauth/token') {
                        refreshCalls++;
                        return {ok: true, status: 200, json: async () => ({access_token: 'refreshed-cli'})};
                    }
                    assert.equal(url, 'https://chatgpt.com/backend-api/wham/usage');
                    assert.equal(options.headers['ChatGPT-Account-Id'], 'cli-account');
                    if (options.headers.authorization !== 'Bearer refreshed-cli')
                        return {ok: false, status: 401, json: async () => ({})};
                    return {ok: true, status: 200, json: async () => usage};
                },
            });
            const result = await provider.getUsage();
            assert.equal(result.ok, true, JSON.stringify(result.error));
            assert.equal(result.data.sessionRemainingPct, 88);
            assert.equal(refreshCalls, 1);
        });
    }

    test(`${runtime} Codex reports a rejected OMP token without refreshing or switching to CLI credentials`, async () => {
        let refreshCalls = 0;
        const usageAuthorizations = [];
        const provider = create({
            readCodexCredential: async () => ({accessToken: 'omp-rejected', accountId: 'omp-account'}),
            readTextFile: async () => JSON.stringify({tokens: {
                access_token: 'valid-cli', refresh_token: 'cli-refresh', account_id: 'cli-account',
            }}),
            fetch: async (url, options) => {
                if (url === 'https://auth.openai.com/oauth/token') {
                    refreshCalls++;
                    return {ok: true, status: 200, json: async () => ({access_token: 'refreshed-cli'})};
                }
                assert.equal(url, 'https://chatgpt.com/backend-api/wham/usage');
                usageAuthorizations.push(options.headers.authorization);
                if (options.headers.authorization === 'Bearer valid-cli')
                    return {ok: true, status: 200, json: async () => usage};
                return {ok: false, status: 401, json: async () => ({})};
            },
        });
        const result = await provider.getUsage();
        assert.equal(result.ok, false);
        assert.equal(result.error.code, 'auth_expired');
        assert.equal(refreshCalls, 0);
        assert.deepEqual(usageAuthorizations, ['Bearer omp-rejected']);
        assert.equal(JSON.stringify(result).includes('omp-rejected'), false);
    });
}
