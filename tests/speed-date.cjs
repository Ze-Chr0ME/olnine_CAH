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
  const rate = () => { const g = c.L.game; at(g.startAt + g.count * g.every * 1000 + 3000); tick(); assert.equal(g.phase, 'rate'); };
  const finish = votes => { reveal(); rate(); for (const [pid, v] of Object.entries(votes)) stamp(pid, 'rate', { v }); at(c.L.game.deadline); tick(); };
  const next = () => { const g = c.L.game; tick(); assert.equal(g.phase, 'result'); const t = [...timers.values()][0]; assert.ok(t); timers.clear(); at(t.at); t.fn(); };
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
    assert.equal(g.traits.length, count); assert.equal(new Set(g.traits.map(v => v.text)).size, count);
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
    assert.equal(t.tick(), true); assert.equal(g.turns[1].avg, 3.67); assert.equal(g.turns[1].n, 3);
    t.next(); assert.equal(g.speaker, 'p2'); assert.equal(g.round, 2); assert.equal(t.commits(), 1);
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
  {
    const t = table(); t.finish({ p2: 3 }); t.tick(); const callback = [...t.timers.values()][0].fn;
    t.c.L.game = null; callback(); assert.equal(t.commits(), 0);
  }
  console.log('PASS');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
