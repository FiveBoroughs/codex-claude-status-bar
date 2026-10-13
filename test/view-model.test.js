import {test} from 'node:test';
import assert from 'node:assert/strict';

import {buildUsageViewModel} from '../core/view-model.js';

const NOW = Date.parse('2026-07-27T12:00:00Z');

const SUMMARY = {
    lastUpdatedAtIso: '2026-07-27T11:59:00Z',
    providers: {
        claude: {
            code: 'OK',
            data: {
                sessionRemainingPct: 93.4,
                weeklyRemainingPct: 95,
                sessionResetsAtIso: '2026-07-27T16:49:00Z',
                fableRemainingPct: 100,
                fableResetsAtIso: null,
            },
        },
        codex: {
            code: 'OK',
            data: {weeklyRemainingPct: 100, weeklyResetsAtIso: '2026-08-03T11:59:00Z'},
        },
    },
};

const serviceNamed = (vm, key) => vm.services.find(s => s.key === key);

test('services come out in popup order and are identified by key', () => {
    const vm = buildUsageViewModel(SUMMARY, {now: NOW});

    assert.deepEqual(vm.services.map(s => s.key), ['codex', 'claude', 'meridian']);
    assert.deepEqual(vm.services.map(s => s.name), ['Codex', 'Claude', 'Meridian']);
});

test('window figures are rounded and phrased for display', () => {
    const claude = serviceNamed(buildUsageViewModel(SUMMARY, {now: NOW}), 'claude');
    const [session] = claude.windows;

    assert.equal(session.label, 'Session');
    assert.equal(session.remainingPct, 93);
    assert.equal(session.remainingText, '93% left');
    assert.equal(session.resetsInText, 'Resets in 4h 49m');
    assert.equal(session.dotColor, 'green');
});

test('a window the provider does not report still occupies its row', () => {
    const codex = serviceNamed(buildUsageViewModel(SUMMARY, {now: NOW}), 'codex');
    const [session] = codex.windows;

    assert.equal(session.remainingPct, 0);
    assert.equal(session.remainingText, '-- left');
    assert.equal(session.resetsInText, '--');
    assert.equal(session.dotColor, 'red');
});

test('the fable row appears only when it is switched on', () => {
    const off = serviceNamed(buildUsageViewModel(SUMMARY, {now: NOW}), 'claude');
    assert.deepEqual(off.windows.map(w => w.label), ['Session', 'Weekly']);

    const on = serviceNamed(buildUsageViewModel(SUMMARY, {now: NOW, showClaudeFable: true}), 'claude');
    assert.deepEqual(on.windows.map(w => w.label), ['Session', 'Weekly', 'Fable']);
    assert.equal(on.windows[2].remainingText, '100% left');
});

test('codex never grows a fable row', () => {
    const codex = serviceNamed(buildUsageViewModel(SUMMARY, {now: NOW, showClaudeFable: true}), 'codex');

    assert.deepEqual(codex.windows.map(w => w.label), ['Session', 'Weekly']);
});

test('a healthy provider carries no warning', () => {
    const vm = buildUsageViewModel(SUMMARY, {now: NOW});

    assert.equal(serviceNamed(vm, 'claude').warning, '');
});

test('state codes become readable warnings naming the provider', () => {
    const cases = [
        ['AUTH_EXPIRED', 'Claude: authentication expired'],
        ['PARTIAL_DATA', 'Claude: partial usage data'],
        ['NETWORK_ERROR', 'Claude: network error'],
        ['SCHEMA_CHANGED', 'Claude: schema changed'],
    ];

    for (const [code, expected] of cases) {
        const vm = buildUsageViewModel({providers: {claude: {code, data: null}}}, {now: NOW});
        assert.equal(serviceNamed(vm, 'claude').warning, expected, code);
    }
});

test('OK and unknown codes produce no warning text', () => {
    for (const code of ['OK', 'RATE_LIMITED', undefined]) {
        const vm = buildUsageViewModel({providers: {claude: {code, data: null}}}, {now: NOW});
        assert.equal(serviceNamed(vm, 'claude').warning, '', String(code));
    }
});

test('an empty summary still produces a drawable view model', () => {
    for (const summary of [null, undefined, {}, {providers: {}}]) {
        const vm = buildUsageViewModel(summary, {now: NOW});

        assert.equal(vm.services.length, 3);
        assert.equal(vm.services[0].windows.length, 2);
        assert.equal(vm.services[0].windows[0].remainingText, '-- left');
        assert.equal(vm.lastUpdate, 'Next update in --');
    }
});

test('the footer reports when the next poll is due', () => {
    const vm = buildUsageViewModel(SUMMARY, {now: NOW, pollIntervalMs: 180_000});

    assert.equal(vm.lastUpdate, 'Next update in 2m');
});

test('the version string is carried through and overridable', () => {
    assert.match(buildUsageViewModel(SUMMARY, {now: NOW}).version, /^codex-claude-status-bar /);
    assert.equal(buildUsageViewModel(SUMMARY, {now: NOW, version: 'test 9.9'}).version, 'test 9.9');
});

test('an exhausted weekly limit hides session until weekly allowance returns', () => {
    for (const key of ['codex', 'claude', 'meridian']) {
        const data = {
            sessionRemainingPct: 100,
            weeklyRemainingPct: 0,
            weeklyResetsAtIso: '2026-07-29T12:00:00Z',
        };
        const summary = {providers: {[key]: {code: 'OK', data}}};
        const blocked = serviceNamed(buildUsageViewModel(summary, {now: NOW}), key);

        assert.deepEqual(blocked.windows.map(w => w.label), ['Weekly'], key);
        assert.equal(blocked.windows[0].remainingText, '0% left', key);
        assert.equal(blocked.windows[0].resetsInText, 'Resets in 2d', key);
        assert.equal(data.sessionRemainingPct, 100, 'raw usage remains unchanged');

        data.weeklyRemainingPct = 100;
        const restored = serviceNamed(buildUsageViewModel(summary, {now: NOW}), key);
        assert.deepEqual(restored.windows.map(w => w.label), ['Session', 'Weekly'], key);
        assert.equal(restored.windows[0].remainingText, '100% left', key);
    }
});

test('a weekly allowance that is merely small or unknown does not hide session', () => {
    // 0.4 rounds to a displayed 0%, but the raw allowance is not exhausted;
    // an unreported weekly figure is likewise no evidence of exhaustion.
    for (const weeklyRemainingPct of [0.4, null, undefined, NaN]) {
        const summary = {
            providers: {
                claude: {code: 'OK', data: {sessionRemainingPct: 100, weeklyRemainingPct}},
            },
        };
        const claude = serviceNamed(buildUsageViewModel(summary, {now: NOW}), 'claude');

        assert.deepEqual(claude.windows.map(w => w.label), ['Session', 'Weekly'], String(weeklyRemainingPct));
    }
});

test('an exhausted weekly limit leaves the fable window in place', () => {
    const data = {
        sessionRemainingPct: 100,
        weeklyRemainingPct: 0,
        fableRemainingPct: 80,
    };

    const claude = serviceNamed(
        buildUsageViewModel({providers: {claude: {code: 'OK', data}}}, {now: NOW, showClaudeFable: true}),
        'claude',
    );
    assert.deepEqual(claude.windows.map(w => w.label), ['Weekly', 'Fable']);
    assert.equal(claude.windows[1].remainingText, '80% left');

    const meridian = serviceNamed(
        buildUsageViewModel({providers: {meridian: {code: 'OK', data}}}, {now: NOW, showMeridianFable: true}),
        'meridian',
    );
    assert.deepEqual(meridian.windows.map(w => w.label), ['Weekly', 'Fable']);
    assert.equal(meridian.windows[1].remainingText, '80% left');
});

test('GNOME hides exhausted sessions and restores them after weekly recovery', async () => {
    const {buildUsageViewModel: buildGnomeView} = await import('../src/lib/ui/render.js');

    for (const key of ['codex', 'claude', 'meridian']) {
        const data = {
            sessionRemainingPct: 100,
            weeklyRemainingPct: 0,
            weeklyResetsAtIso: '2026-07-29T12:00:00Z',
            fableRemainingPct: 80,
        };
        const summary = {providers: {[key]: {code: 'OK', data}}};
        const options = {now: NOW, showClaudeFable: true, showMeridianFable: true};
        const service = () => buildGnomeView(summary, options).services
            .find(s => s.name.toLowerCase() === key);
        const blocked = service();

        assert.deepEqual(blocked.windows.map(w => w.label),
            key === 'codex' ? ['Weekly'] : ['Weekly', 'Fable'], key);
        assert.equal(blocked.windows[0].resetsInText, 'Resets in 2d', key);
        if (key !== 'codex')
            assert.equal(blocked.windows[1].remainingText, '80% left', key);

        for (const weeklyRemainingPct of [100, 0.4, null]) {
            data.weeklyRemainingPct = weeklyRemainingPct;
            assert.equal(service().windows[0].label, 'Session', key);
            assert.equal(service().windows[0].remainingText, '100% left', key);
        }
    }
});
