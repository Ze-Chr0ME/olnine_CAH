const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../speed-date/sd.js'), 'utf8');
function table(n = 2, opts = {}) {
  let now = 100000, seq = 0, timerId = 0, commits = 0;
  const timers = new Map(), writes = [], errors = [], view = { innerHTML: '' };
  const cats = ['gender', 'age', 'height', 'job', 'looks', 'habit', 'secret', 'redflag', 'relation', 'dealbreaker_twist'];
  const c = { GAMES: {}, L: { host: 'p1', status: 'playing', settings: opts }, P: {}, ME: 'p1', skew: 0,
    SD_TRAITS: { en: Object.fromEntries(cats.map(cat => [cat, Array.from({ length: 4 }, (_, i) => cat + i)])) },
    Date: { now: () => now }, Math, Set, console,
    present: pid => !!c.P[pid] && !c.P[pid].gone,
    byJoined: (a, b) => (c.P[a].joined - c.P[b].joined) || (a < b ? -1 : 1),
    nameOf: pid => c.P[pid]?.name || 'someone', isHost: () => c.L?.host === c.ME,
    settings: () => ({ target: 5, next: 9, lang: 'en', ...c.GAMES.sd?.defaults, ...c.L.settings }),
    rid: () => 'game' + ++seq, shuffle: a => a.slice().reverse(), clone: x => JSON.parse(JSON.stringify(x)),
    myRef: () => { const pid = c.ME; return { update: async patch => { writes.push({ pid, patch }); Object.assign(c.P[pid], patch); } }; },
    commit: () => commits++, notice: () => {}, writeError: e => errors.push(e),
    esc: v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'), $: () => view,
    setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: id => timers.delete(id)
  };
  for (let i = 1; i <= n; i++) c.P['p' + i] = { joined: i, name: 'Player ' + i };
  Object.assign(c, { document: { addEventListener() {} }, setInterval() {} }); vm.createContext(c); vm.runInContext(source, c);
  const start = () => c.L.game = c.GAMES.sd.start(Object.keys(c.P).filter(c.present).sort(c.byJoined), c.settings());
  const tick = () => c.GAMES.sd.tick(c.L.game);
  const at = t => { now = t; };
  const stamp = (pid, key, value) => c.P[pid][key] = { gid: c.L.game.gid, round: c.L.game.round, ...value };
  const reveal = () => { at(c.L.game.deadline); assert.equal(tick(), true); assert.equal(c.L.game.phase, 'reveal'); };
  const rate = () => { const g = c.L.game; at(g.startAt + g.traits.length * g.every * 1000 + 3000); tick(); assert.equal(g.phase, 'rate'); };
  const finish = votes => { reveal(); rate(); for (const [pid, v] of Object.entries(votes)) stamp(pid, 'rate', { v }); at(c.L.game.deadline); tick(); };
  const next = () => { const g = c.L.game; assert.equal(g.phase, 'result'); assert.ok(g.deadline); at(g.deadline); assert.equal(tick(), true); };
  start(); return { c, start, tick, at, stamp, reveal, rate, finish, next, timers, writes, errors, view, commits: () => commits };
}
async function main() {
  for (const n of [2, 4]) {
    const t = table(n), { c } = t, g = c.L.game;
    assert.equal(c.GAMES.sd.min, 2); assert.equal(c.GAMES.sd.check(Object.keys(c.P), c.settings()).ok, true);
    assert.equal(c.GAMES.sd.check(['p1'], c.settings()).ok, false);
    assert.equal(g.phase, 'write'); assert.equal(g.speaker, 'p1'); assert.equal(g.round, 1);
    assert.equal(Object.keys(g.scores).length, n); assert.equal(g.deadline, 140000);
    assert.equal(c.sdRole(), 'speaker'); c.ME = 'p2'; assert.equal(c.sdRole(), 'listener');
    c.ME = 'outsider'; assert.equal(c.sdRole(), 'spectator');
  }
  {
    const t = table(12, { sdCount: 8, lang: 'missing' }), { c } = t, g = c.L.game;
    for (let i = 2; i <= 12; i++) t.stamp('p' + i, 'trait', { text: 'written ' + i });
    assert.equal(t.tick(), true); assert.equal(g.traits.length, 8);
    assert.deepEqual(Array.from(g.traits.slice(0, 3), v => v.cat), ['gender', 'age', 'height']);
    assert.equal(g.traits.filter(v => v.by).length, 4);
    assert.deepEqual(Array.from(g.traits.filter(v => v.by), v => v.by).sort(), ['p10', 'p11', 'p12', 'p9']);
    assert.equal(new Set(g.traits.map(v => v.text)).size, 8);
    t.at(g.startAt - 1); assert.equal(c.sdVisible(g), 0); assert.equal(c.sdNextAt(g), g.startAt);
    t.at(g.startAt); assert.equal(c.sdVisible(g), 1); assert.equal(c.sdNextAt(g), g.startAt + 5000);
    t.at(g.startAt + 4999); assert.equal(c.sdVisible(g), 1);
    t.at(g.startAt + 5000); assert.equal(c.sdVisible(g), 2);
    c.skew = 12000; t.at(g.startAt + 12000); assert.equal(c.sdVisible(g), 1);
    c.skew = 0; t.at(g.startAt + 35000); assert.equal(c.sdVisible(g), 8); assert.equal(c.sdNextAt(g), null);
    t.at(g.startAt + 42999); assert.equal(t.tick(), false);
    t.at(g.startAt + 43000); assert.equal(t.tick(), true); assert.equal(g.phase, 'rate');
    assert.equal(g.deadline, g.startAt + 73000);
  }
  for (const count of [1, 2, 3, 4, 8, 16]) {
    const t = table(4, { sdCount: count });
    t.stamp('p2', 'trait', { text: 'custom' }); t.stamp('p3', 'trait', { text: 'custom' }); t.stamp('p4', 'trait', { text: 'gender3' });
    t.tick(); const g = t.c.L.game;
    const total = Math.min(count, 10 + g.traits.filter(v => v.by).length);
    assert.equal(g.traits.length, total); assert.equal(new Set(g.traits.map(v => v.text)).size, total);
    const deck = g.traits.filter(v => !v.by);
    assert.equal(new Set(deck.map(v => v.cat)).size, deck.length);
    assert.deepEqual(Array.from(g.traits.slice(0, Math.min(3, count)), v => v.cat), ['gender', 'age', 'height'].slice(0, count));
    assert.ok(g.traits.filter(v => v.by).length <= Math.floor(count / 2));
  }
  {
    const t = table(2, { sdCount: 10 }); t.reveal();
    const g = t.c.L.game;
    assert.equal(g.traits[9].cat, 'dealbreaker_twist'); assert.equal(new Set(g.traits.map(v => v.cat)).size, 10);
  }
  {
    const t = table(4), { c } = t, g = c.L.game;
    t.stamp('p2', 'trait', { text: '  valid  ' }); t.stamp('p3', 'trait', { text: ' ' }); t.stamp('p4', 'trait', { text: 'x'.repeat(61) });
    assert.equal(t.tick(), false); t.reveal();
    assert.equal(g.traits.filter(v => v.by).length, 1); assert.ok(g.traits.some(v => v.text === 'valid'));
    t.rate(); t.stamp('p2', 'rate', { v: 3 }); t.stamp('p3', 'rate', { v: 4 }); t.stamp('p4', 'rate', { v: 4 });
    assert.equal(t.tick(), true); assert.equal(g.turns[1].avg, 11 / 3); assert.equal(g.turns[1].n, 3);
    t.next(); assert.equal(g.speaker, 'p2'); assert.equal(g.round, 2); assert.equal(t.commits(), 0);
    t.reveal(); t.rate(); assert.equal(t.tick(), false); // previous-round votes cannot finish this turn
  }
  {
    const t = table(2, { target: 1 }), g = t.c.L.game;
    t.finish({ p2: 4 }); assert.equal(g.phase, 'result'); assert.equal(g.scores.p1, 0); assert.equal(g.cycle[0], 'p1');
    t.next(); assert.equal(g.speaker, 'p2'); t.finish({ p1: 4 });
    assert.equal(g.phase, 'over'); assert.equal(t.c.L.status, 'over');
    assert.deepEqual(Array.from(g.cycleWinners), ['p1', 'p2']); assert.deepEqual(Array.from(g.champions), ['p1', 'p2']);
    assert.equal(g.scores.p1, 1); assert.equal(g.scores.p2, 1); assert.equal(g.cycle.length, 0);
  }
  {
    const t = table(), g = t.c.L.game;
    t.finish({ p2: 5 }); t.next(); t.finish({ p1: 2 });
    assert.equal(g.scores.p1, 1); assert.equal(g.scores.p2, 0); t.next(); assert.equal(g.speaker, 'p1');
    t.finish({}); assert.equal(g.turns[3].avg, null); t.next(); t.finish({}); assert.equal(g.cycleWinners.length, 0);
    assert.equal(g.scores.p1, 1);
  }
  {
    const t = table(), g = t.c.L.game;
    t.finish({ p2: 4 }); t.c.P.p3 = { name: 'New', joined: 3 }; t.next();
    t.finish({ p1: 3, p3: 3 }); assert.equal(g.scores.p1, 0); t.next();
    assert.equal(g.speaker, 'p3'); assert.equal(g.scores.p3, 0); t.finish({ p1: 2, p2: 2 }); assert.equal(g.scores.p1, 1);
  }
  for (const phase of ['write', 'reveal', 'rate']) {
    const t = table(4), g = t.c.L.game;
    if (phase !== 'write') t.reveal(); if (phase === 'rate') t.rate();
    t.c.P.p1.gone = true; assert.equal(t.tick(), true);
    assert.equal(g.speaker, 'p2'); assert.equal(g.round, 2); assert.equal(g.phase, 'write');
    assert.equal(Object.keys(g.turns).length, 0); assert.equal(g.cycle.length, 0);
  }
  {
    const t = table(), { c } = t, g = c.L.game;
    c.ME = 'p2'; await c.sdSendTrait('  '); await c.sdSendTrait(42); assert.equal(t.writes.length, 0);
    await c.sdSendTrait('  ' + 'x'.repeat(100)); assert.equal(c.sdMyTrait().length, 60);
    assert.equal(c.P.p2.trait.gid, g.gid); assert.equal(c.P.p2.trait.round, g.round);
    c.P.p2.trait.gid = 'old'; assert.equal(c.sdMyTrait(), null); assert.equal(t.tick(), false);
    c.P.p2.trait = { gid: g.gid, round: g.round, text: {} }; assert.equal(t.tick(), false);
    t.reveal(); await c.sdSendTrait('late'); assert.equal(t.writes.length, 1); t.rate();
    for (const v of [0, 6, '3', 2.5]) {
      await c.sdRate(v); assert.equal(t.writes.length, 1);
      t.stamp('p2', 'rate', { v }); assert.equal(c.sdMyRate(), null); assert.equal(t.tick(), false);
    }
    t.stamp('p2', 'rate', { v: 3 }); c.P.p2.rate.round--; assert.equal(t.tick(), false);
    await c.sdRate(5); assert.equal(c.sdMyRate(), 5); assert.equal(t.tick(), true);
    c.ME = 'p1'; await c.sdSendTrait('speaker'); await c.sdRate(5); assert.equal(t.writes.length, 2);
    assert.equal(t.errors.length, 0);
  }
  // Equal timestamps must include every speaker and complete a scoring lap.
  {
    const t = table(4), g = t.c.L.game, rotation = [];
    for (const p of Object.values(t.c.P)) p.joined = 1;
    for (let i = 0; i < 4; i++) {
      rotation.push(g.speaker);
      t.finish(Object.fromEntries(Object.keys(t.c.P).filter(pid => pid !== g.speaker).map(pid => [pid, 4])));
      t.next();
    }
    assert.deepEqual(rotation, ['p1', 'p2', 'p3', 'p4']); assert.equal(g.speaker, 'p1');
    assert.deepEqual(Object.values(g.scores), [1, 1, 1, 1]);
    delete t.c.P.p1; t.tick(); assert.equal(g.speaker, 'p2');
  }
  // A new seat before the previous speaker still takes its unplayed turn first.
  {
    const t = table(3), g = t.c.L.game;
    t.finish({ p2: 3, p3: 3 }); t.next();
    t.c.P.p0 = { joined: 0, name: 'New' };
    t.finish({ p1: 3, p3: 3 }); t.next(); t.finish({ p1: 3, p2: 3, p0: 3 }); t.next();
    assert.equal(g.speaker, 'p0'); assert.equal(g.scores.p1, 0);
  }
  // Leaving the last unplayed seat closes the lap before a repeat turn, even on a skip.
  for (const active of [false, true]) for (const target of [1, 5]) {
    const t = table(3, { target }), g = t.c.L.game;
    t.finish({ p2: 4, p3: 4 }); t.next(); t.finish({ p1: 2, p3: 2 });
    if (active) { t.next(); assert.equal(g.speaker, 'p3'); }
    delete t.c.P.p3;
    if (active) t.tick(); else t.next();
    assert.equal(g.scores.p1, 1); assert.equal(g.scores.p2, 0);
    assert.equal(Object.keys(g.turns).length, 2); assert.equal(g.cycle.length, 0);
    assert.equal(g.phase, target === 1 ? 'over' : 'write');
    if (target === 5) {
      assert.equal(g.speaker, 'p1'); t.finish({ p2: 1 }); t.next(); t.finish({ p1: 5 });
      assert.equal(g.scores.p1, 1); assert.equal(g.scores.p2, 1);
    }
  }
  // Old lobby state with duplicate turns counts only each speaker's first attempt.
  for (const first of [2, null]) {
    const t = table(2), g = t.c.L.game;
    g.turns = { 1: { pid: 'p1', avg: first }, 2: { pid: 'p1', avg: 5 } };
    g.cycle = ['p1']; g.round = 2; g.speaker = 'p2';
    t.finish({ p1: 4 });
    assert.deepEqual(Array.from(g.cycleWinners), ['p2']); assert.equal(g.scores.p1, 0); assert.equal(g.scores.p2, 1);
  }
  // Exercise real clock tracking and host-change paths without browser/Firebase startup.
  {
    const core = fs.readFileSync(path.join(__dirname, '../shared/core.js'), 'utf8');
    const functions = [
      core.slice(core.indexOf('let takingOver = false;'), core.indexOf('function afterChange()')),
      core.slice(core.indexOf('function rebaseClock(g, offset) {'), core.indexOf('const TIMER_LBL')),
      core.slice(core.indexOf('function listen(c) {'), core.indexOf('function exitLobby(msg) {')),
      core.slice(core.indexOf('async function leaveLobby() {'), core.indexOf('async function closeLobby(c) {'))
    ].join('\n');
    function client(host, skew, game) {
      const c = { L: { host: 'old', game, rev: 1 }, ME: host, myName: host, skew, skewHost: 'old',
        P: { old: { owner: 'old' }, new: { owner: 'new' } }, code: 'TEST', seenRev: 0, unsubLobby: null, unsubPlayers: null, leaving: false,
        clone: x => JSON.parse(JSON.stringify(x)), isHost: () => c.L.host === c.ME,
        piled: () => true, notice() {}, setPresence() {}, dbErr(e) { throw e; }, afterChange() {},
        savePiles: async () => {}, online: () => true, gone: () => false, byJoined: () => 0,
        nameOf: pid => pid, exitLobby() {}, writeError(e) { throw e; }, commits: 0,
        Date: { now: () => 400000 },
        hostStamp: () => 400000,
        commit() { c.commits++; c.L.rev++; c.L.updated = c.Date.now(); c.L.clockHost = c.ME; },
        db: { runTransaction: async fn => fn({
          get: async () => ({ exists: true, data: () => c.server || c.L }),
          set: (ref, body) => {
            c.saved = body; c.server = body;
            if (c.snapshot) c.snapshot({ exists: true, data: () => body });
          }
        }), doc: () => ({
          onSnapshot: cb => { c.snapshot = cb; return () => {}; },
          set: async body => { c.saved = body; }, delete: async () => {}
        }), collection: () => ({ onSnapshot: () => () => {} }) }
      };
      vm.createContext(c); vm.runInContext(functions, c);
      return c;
    }
    for (const type of ['cah', 'mp', 'sd']) for (const skew of [-120000, 120000]) {
      for (const path of ['takeover', 'voluntary']) {
        const g = { type, deadline: 500000, startAt: type === 'sd' ? 390000 : 0 };
        const c = client('new', skew, { ...g });
        c.listen('TEST');
        if (path === 'takeover') await c.maybeTakeOver(true);
        else {
          const old = client('old', 0, { ...g });
          await old.leaveLobby();
          assert.equal(old.saved.host, 'new');
          assert.equal(old.saved.game.deadline, g.deadline); // still in the departing host's clock
          c.afterChange = () => {
            assert.equal(c.L.game.deadline, g.deadline + skew); // before any host rules run
            assert.equal(c.skew, 0); assert.equal(c.commits, 1);
          };
          c.snapshot({ exists: true, data: () => old.saved });
        }
        assert.equal(c.L.game.deadline - 400000, g.deadline - (400000 - skew));
        assert.equal(c.L.game.startAt, type === 'sd' ? g.startAt + skew : 0);
        assert.equal(c.skew, 0); assert.equal(c.skewHost, 'new'); assert.equal(c.L.host, 'new');
        assert.equal(c.commits, 1);
        if (type === 'sd') {
          const t = table();
          t.c.L.game = { ...t.c.L.game, ...c.L.game, count: 8, every: 5, phase: 'reveal', traits: Array(8).fill({}) };
          t.c.skew = c.skew; t.at(400000 + skew);
          assert.equal(t.c.sdVisible(t.c.L.game), 3);
          assert.equal(t.c.sdNextAt(t.c.L.game), 405000 + skew);
          assert.equal(t.tick(), false); assert.equal(t.c.L.game.round, 1);
          t.at(433000 + skew); assert.equal(t.tick(), true);
          assert.equal(t.c.L.game.phase, 'rate'); assert.equal(t.c.L.game.deadline, 463000 + skew);
        }
        // Pending and acknowledged echoes, plus repeated takeover checks, never rebase again.
        const echo = c.clone(c.L);
        for (const pending of [true, false]) {
          c.snapshot({ exists: true, data: () => echo, metadata: { hasPendingWrites: pending } });
          await c.maybeTakeOver(true);
          assert.equal(c.L.game.deadline, g.deadline + skew);
          assert.equal(c.L.game.startAt, type === 'sd' ? g.startAt + skew : 0);
          assert.equal(c.commits, 1);
        }
      }
    }
    for (const deadline of [0, null, '500000']) {
      const c = client('new', 123, { deadline });
      c.listen('TEST');
      await c.maybeTakeOver(true);
      assert.equal(c.L.host, 'new');
      assert.equal(c.L.game.deadline, deadline);
    }
    // No game and first joining an already-owned lobby require no timestamp conversion.
    const empty = client('new', 123, null);
    empty.listen('TEST'); await empty.maybeTakeOver(true); assert.equal(empty.L.game, null);
    const initial = client('new', 123, null);
    initial.L = null; initial.listen('TEST');
    initial.snapshot({ exists: true, data: () => ({ host: 'new', rev: 1, game: { deadline: 500000 } }) });
    assert.equal(initial.L.game.deadline, 500000); assert.equal(initial.commits, 0);
  }
  // All shipped languages have ten categories. Larger dates stop at category exhaustion,
  // with the actual deck length controlling the reveal-to-rate transition.
  {
    const data = {};
    vm.createContext(data);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../speed-date/traits.js'), 'utf8') + ';this.pool = SD_TRAITS;', data);
    for (const lang of ['en', 'de', 'fr']) for (const written of [false, true]) {
      const t = table(2, { lang, sdCount: 15 }), { c } = t, g = c.L.game;
      c.SD_TRAITS = data.pool;
      assert.equal(Object.keys(data.pool[lang]).length, 10);
      assert.equal(c.sdCheck(Object.keys(c.P), c.settings()).ok, true);
      if (written) t.stamp('p2', 'trait', { text: 'A unique player trait' });
      else t.at(g.deadline);
      t.tick();
      assert.equal(g.traits.length, written ? 11 : 10);
      assert.deepEqual(Array.from(g.traits.slice(0, 3), v => v.cat), ['gender', 'age', 'height']);
      const deck = g.traits.filter(v => !v.by);
      assert.equal(new Set(deck.map(v => v.cat)).size, deck.length);
      const end = g.startAt + g.traits.length * g.every * 1000 + 3000;
      t.at(end - 1); assert.equal(t.tick(), false);
      t.at(end); assert.equal(t.tick(), true); assert.equal(g.phase, 'rate');
      assert.equal(g.deadline, end + 30000);
    }
  }
  // Distinct real averages which both round to 2.04 must not tie for a cycle point.
  {
    const t = table(28), { c } = t, g = c.L.game;
    t.finish(Object.fromEntries(Object.keys(c.P).filter(p => p !== 'p1').map(p => [p, p === 'p2' ? 3 : 2])));
    assert.equal(g.turns[1].avg, 55 / 27);
    t.next(); c.P.p28.gone = true;
    g.cycle = Object.keys(c.P).filter(p => p !== 'p2');
    t.finish(Object.fromEntries(Object.keys(c.P).filter(p => p !== 'p2' && c.present(p)).map(p => [p, p === 'p1' ? 3 : 2])));
    assert.equal(g.turns[2].avg, 53 / 26);
    assert.equal(g.turns[1].avg.toFixed(2), g.turns[2].avg.toFixed(2));
    assert.deepEqual(Array.from(g.cycleWinners), ['p2']);
    assert.equal(g.scores.p1, 0); assert.equal(g.scores.p2, 1);
  }
  // A fresh host resumes the persisted result deadline without local timers.
  {
    const old = table(); old.finish({ p2: 3 });
    const deadline = old.c.L.game.deadline;
    assert.equal(deadline, 225000); // rate ends at 216000; next is nine seconds
    const fresh = table();
    fresh.c.L = JSON.parse(JSON.stringify(old.c.L));
    fresh.c.L.host = fresh.c.ME = 'p2';
    fresh.at(deadline - 4000);
    assert.equal(fresh.tick(), false);
    assert.equal(fresh.c.L.game.deadline, deadline);
    assert.equal(fresh.timers.size, 0);
    fresh.at(deadline - 1); assert.equal(fresh.tick(), false);
    fresh.at(deadline); assert.equal(fresh.tick(), true);
    assert.equal(fresh.c.L.game.round, 2);
    assert.equal(fresh.c.L.game.phase, 'write');
  }
  // Manual results remain untimed; older result state acquires one persisted deadline.
  {
    const t = table(2, { next: 0 }); t.finish({ p2: 3 });
    assert.equal(t.c.L.game.deadline, 0);
    t.at(999999); assert.equal(t.tick(), false);
    assert.equal(t.c.L.game.phase, 'result');
    t.c.L.settings.next = 9;
    assert.equal(t.tick(), true);
    const deadline = t.c.L.game.deadline;
    assert.equal(deadline, 1008999);
    t.at(deadline - 1); assert.equal(t.tick(), false);
    assert.equal(t.c.L.game.deadline, deadline);
    t.at(deadline); assert.equal(t.tick(), true);
  }
  // Departed listeners stop blocking both phases; their old submissions do not count.
  for (const phase of ['write', 'rate']) {
    const t = table(3), { c } = t, g = c.L.game;
    if (phase === 'rate') { t.reveal(); t.rate(); }
    t.stamp('p2', phase === 'write' ? 'trait' : 'rate', phase === 'write' ? { text: 'present' } : { v: 5 });
    assert.equal(t.tick(), false);
    c.P.p3.gone = true;
    assert.equal(t.tick(), true); assert.equal(g.phase, phase === 'write' ? 'reveal' : 'result');
    if (phase === 'rate') { assert.equal(g.turns[1].avg, 5); assert.equal(g.turns[1].n, 1); }
  }
  // A joiner is a spectator until the next turn and cannot block or rate this one.
  {
    const t = table(), { c } = t, g = c.L.game;
    c.P.p3 = { name: 'New', joined: 3 }; c.ME = 'p3';
    assert.equal(c.sdRole(), 'spectator');
    await c.sdSendTrait('ignored'); assert.equal(t.writes.length, 0);
    t.stamp('p2', 'trait', { text: 'ready' }); assert.equal(t.tick(), true); t.rate();
    t.stamp('p3', 'rate', { v: 1 }); await c.sdRate(1); assert.equal(t.writes.length, 0);
    t.stamp('p2', 'rate', { v: 5 }); assert.equal(t.tick(), true);
    assert.equal(g.turns[1].n, 1); assert.equal(g.turns[1].avg, 5);
  }
  // No present seats during an active turn ends safely; zero-listener turns earn no point.
  for (const all of [false, true]) {
    const t = table(), { c } = t, g = c.L.game;
    delete c.P.p2;
    if (all) { delete c.P.p1; assert.equal(t.tick(), true); assert.equal(g.phase, 'over'); }
    else {
      assert.equal(t.tick(), true); t.rate(); assert.equal(t.tick(), true);
      assert.equal(g.turns[1].avg, null); assert.equal(g.scores.p1, 0); assert.equal(g.cycleWinners.length, 0);
      t.next(); assert.equal(g.speaker, 'p1');
    }
  }
  console.log('PASS');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
