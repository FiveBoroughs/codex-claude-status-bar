import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMuseProvider as portable} from '../core/providers/muse.js';
import {createMuseProvider as gnome} from '../src/lib/providers/muse.js';
import {createProviderSlot} from '../core/provider-slot.js';
import {createProviderState, applyProviderResult, snapshotProviderState} from '../src/lib/core/state.js';

const credential = JSON.stringify({oauthAccessToken: 'same-account-token', apiKey: 'private-key'});
const withUsage = used => ({is_subs_active: true, subs_usage: {
    window: {used_percent: used, window_duration_mins: 300},
    weekly: {used_percent: used + 20},
}});
const gnomeSlot = () => {
    const state = createProviderState('muse');
    return {
        apply: (result, id, at) => applyProviderResult(state, result, id, at),
        snapshot: () => snapshotProviderState(state),
    };
};

for (const [runtime, create, newSlot] of [
    ['portable', portable, () => createProviderSlot('muse')],
    ['GNOME', gnome, gnomeSlot],
]) {
    test(`${runtime} Muse distinguishes idle quota omission and recovers without credential changes`, async () => {
        for (const idle of [{is_subs_active: true}, {is_subs_active: true, subs_usage: null}]) {
            const payloads = [withUsage(10), idle, withUsage(15)];
            const provider = create({
                readMuseCredential: async () => credential,
                fetch: async () => ({ok: true, status: 200, json: async () => payloads.shift()}),
            });
            const slot = newSlot();
            const apply = async id => {
                const result = await provider.getUsage();
                slot.apply(result, id, `2026-10-16T0${id}:00:00.000Z`);
                return slot.snapshot();
            };

            const active = await apply(1);
            assert.equal(active.code, 'OK');
            assert.equal(active.data.weeklyRemainingPct, 70);

            const unavailable = await apply(2);
            assert.equal(unavailable.code, 'QUOTA_UNAVAILABLE');
            assert.equal(unavailable.error.providerCode, 'quota_unavailable');
            // Neither stale usage nor an invented full allowance may survive an idle response.
            assert.equal(unavailable.data, null);
            assert.equal(JSON.stringify(unavailable).includes('same-account-token'), false);

            const recovered = await apply(3);
            assert.equal(recovered.code, 'OK');
            assert.equal(recovered.error, null);
            assert.equal(recovered.data.sessionRemainingPct, 85);
            assert.equal(recovered.data.weeklyRemainingPct, 65);
        }
    });

    test(`${runtime} Muse does not mistake malformed or inactive quota for idle availability`, async () => {
        for (const [payload, expected] of [
            [{is_subs_active: false}, 'auth_expired'],
            [{}, 'schema_changed'],
            [{is_subs_active: true, subs_usage: {}}, 'schema_changed'],
            [{is_subs_active: true, subs_usage: {weekly: {used_percent: '10'}}}, 'schema_changed'],
        ]) {
            const result = await create({readMuseCredential: async () => credential,
                fetch: async () => ({ok: true, status: 200, json: async () => payload})}).getUsage();
            assert.equal(result.error.code, expected);
        }
    });
}
