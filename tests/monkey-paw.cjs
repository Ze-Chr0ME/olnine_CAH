const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../monkey-paw/mp.js'), 'utf8');
function setup(n = 4, options = {}) {
  let now = 100000, id = 0, timerId = 0;
  const timers = new Map(), writes = [], view = { innerHTML: '' };
  const c = {
    GAMES: {}, L: { status: 'playing', settings: { mpTime: 60, judgeTime: 10, target: 2, next: 3, lang: 'en', ...options } }, P: {}, ME: 'a', skew: 500,
    MP_WISHES: { en: Array.from({ length: 9 }, (_, i) => `Wish ${i}`), fr: ['Un', 'Deux', 'Trois'] },
    Date: { now: () => now }, Math, commits: 0, errors: [],
    settings: () => c.L.settings, present: pid => !!c.P[pid] && !c.P[pid].gone,
    byJoined: (a, b) => (c.P[a].joined - c.P[b].joined) || (a < b ? -1 : 1),
    nameOf: pid => c.P[pid]?.name || pid, rid: () => `game${++id}`,
    shuffle: a => a.slice().reverse(), clone: a => JSON.parse(JSON.stringify(a)),
    esc: a => String(a).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    $: () => view, notice: () => {}, writeError: e => c.errors.push(e), isHost: () => c.ME === 'a',
    commit: () => c.commits++,
    myRef: () => ({ update: async a => { writes.push({ pid: c.ME, ...a }); Object.assign(c.P[c.ME], a); } }),
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; }, clearTimeout: id => timers.delete(id)
  };
  for (let i = 0; i < n; i++) c.P[String.fromCharCode(97 + i)] = { joined: i + 1, name: `Player ${i}`, face: null };
  vm.createContext(c); vm.runInContext(source, c);
  const game = c.GAMES.mp;
  c.L.game = game.start(Object.keys(c.P), c.settings());
  return { c, game, g: c.L.game, writes, timers, view, expire: () => { now = c.L.game.deadline + c.skew; }, advance: ms => { now += ms; } };
}
async function as(c, pid, fn) { const prev = c.ME; c.ME = pid; try { return await fn(); } finally { c.ME = prev; } }
async function judge(h) {
  const { c, g, game } = h;
  await as(c, g.wisher, () => c.mpSendWish('  I want everything  '));
  assert.equal(game.tick(g), true); assert.equal(g.phase, 'twist'); assert.equal(g.wish, 'I want everything');
  for (const pid of g.seats.filter(pid => pid !== g.wisher && c.present(pid))) await as(c, pid, () => c.mpSendTwist(`Granted, but ${pid}`));
  assert.equal(game.tick(g), true); assert.equal(g.phase, 'judge');
}
async function main() {
  const h = setup(), { c, g, game } = h;
  assert.equal(game.id, 'mp'); assert.equal(game.min, 3); assert.equal(game.defaults.mpTime, 60);
  assert.equal(game.check(['a', 'b'], c.settings()).ok, false);
  assert.equal(game.check(['a', 'b', 'c'], c.settings()).ok, true);
  assert.equal(g.wisher, 'a'); assert.equal(g.round, 1); assert.equal(g.wishCards.length, 3);
  assert.equal(g.deadline, 159500); assert.equal(c.mpRole(), 'wisher'); assert.equal(c.mpMine(), null);
  await judge(h);
  assert.equal(g.order.length, 3); assert.equal(g.deadline, 109500);
  assert.equal(h.writes[0].wish.gid, g.gid); assert.equal(h.writes[0].wish.round, 1);
  await as(c, 'b', () => { assert.equal(c.mpRole(), 'twister'); assert.equal(c.mpMine(), 'Granted, but b'); });
  await as(c, 'spectator', () => { assert.equal(c.mpRole(), 'spectator'); });
  const k = g.order.findIndex(a => a.pid === 'c');
  await c.mpPick(k); assert.equal(game.tick(g), true);
  assert.equal(g.phase, 'result'); assert.equal(g.winner, k); assert.equal(g.scores.c, 1);
  assert.equal(game.tick(g), false); game.tick(g); assert.equal(h.timers.size, 1);
  const timer = [...h.timers.values()][0]; assert.equal(timer.delay, 3000); timer.fn();
  assert.equal(c.commits, 1); assert.equal(g.wisher, 'b'); assert.equal(g.round, 2); assert.equal(c.mpMine(), null);
  await judge(h);
  await as(c, 'b', () => c.mpPick(g.order.findIndex(a => a.pid === 'c')));
  game.tick(g); assert.equal(g.scores.c, 2); assert.equal(g.phase, 'over'); assert.equal(c.L.status, 'over');
  assert.deepEqual(Array.from(g.champions), ['c']); assert.equal(g.log.length, 2);

  // All deck indices are drawn before recycling; missing languages fall back to English.
  const deck = setup(3, { lang: 'missing' }), dealt = [];
  for (let i = 0; i < 3; i++) { dealt.push(...deck.g.wishCards); deck.c.mpStartRound(deck.g); }
  assert.equal(new Set(dealt).size, 9); assert.equal(deck.g.wishCards.length, 3);
  const french = setup(3, { lang: 'fr' }); assert.equal(french.g.wishLang, 'fr');
  assert.ok(french.g.wishCards.includes('Un'));
  const absent = setup(3); delete absent.c.MP_WISHES; absent.c.mpStartRound(absent.g);
  assert.equal(absent.g.wishCards.length, 0); absent.expire(); absent.game.tick(absent.g); assert.equal(absent.g.round, 3);
  const timeout = setup(3); timeout.expire(); timeout.game.tick(timeout.g);
  assert.equal(timeout.g.phase, 'twist'); assert.ok(timeout.g.wishCards.includes(timeout.g.wish));
  timeout.expire(); timeout.game.tick(timeout.g); assert.equal(timeout.g.round, 2); assert.equal(timeout.g.wisher, 'b');
  const partial = setup(4); await partial.c.mpTakeWish(0); partial.game.tick(partial.g);
  await as(partial.c, 'b', () => partial.c.mpSendTwist('Only twist')); partial.expire(); partial.game.tick(partial.g);
  assert.equal(partial.g.phase, 'judge'); assert.equal(partial.g.order.length, 1);
  partial.expire(); partial.game.tick(partial.g); assert.equal(partial.g.scores.b, 1); assert.equal(partial.g.randomWin, true);

  // Departure skips in each active phase, drops absent twisters, and preserves pick indices.
  for (const phase of ['wish', 'twist', 'judge']) {
    const left = setup(4);
    if (phase === 'twist') { await left.c.mpSendWish('wish'); left.game.tick(left.g); }
    if (phase === 'judge') await judge(left);
    left.c.P.a.gone = true; left.game.tick(left.g); assert.equal(left.g.round, 2); assert.equal(left.g.wisher, 'b');
  }
  const dropped = setup(4); await dropped.c.mpSendWish('wish'); dropped.game.tick(dropped.g);
  await as(dropped.c, 'b', () => dropped.c.mpSendTwist('left'));
  dropped.c.P.b.gone = true;
  for (const pid of ['c', 'd']) await as(dropped.c, pid, () => dropped.c.mpSendTwist(pid));
  dropped.game.tick(dropped.g); assert.equal(dropped.g.order.length, 2);
  dropped.c.P[dropped.g.order[0].pid].gone = true;
  await dropped.c.mpPick(0); assert.equal(dropped.c.P.a.pick, undefined);
  dropped.expire(); dropped.game.tick(dropped.g); assert.equal(dropped.g.winner, 1);

  // Host treats every seat as untrusted; stale actions, malformed values and invalid picks are ignored.
  const bad = setup(3), b = bad.c, bg = bad.g;
  b.P.a.wish = { gid: 'old', round: bg.round, text: 'stale' }; assert.equal(bad.game.tick(bg), false);
  b.P.a.wish = { gid: bg.gid, round: 0, text: 'stale' }; assert.equal(bad.game.tick(bg), false);
  b.P.a.wish = { gid: bg.gid, round: bg.round, text: {} }; assert.equal(bad.game.tick(bg), false);
  b.P.a.wish.text = '  ' + 'x'.repeat(250); bad.game.tick(bg); assert.equal(bg.wish.length, 200);
  b.P.b.twist = { gid: 'old', round: bg.round, text: 'stale' };
  b.P.c.twist = { gid: bg.gid, round: 0, text: 'stale' }; assert.equal(bad.game.tick(bg), false);
  b.P.b.twist = { gid: bg.gid, round: bg.round, text: 12 }; assert.equal(b.mpSeatText(bg, 'b', 'twist'), null);
  for (const pid of ['b', 'c']) b.P[pid].twist = { gid: bg.gid, round: bg.round, text: 'y'.repeat(250) };
  bad.game.tick(bg); assert.ok(bg.order.every(a => a.text.length === 200));
  for (const pick of [{ gid: 'old', round: bg.round, k: 0 }, { gid: bg.gid, round: 0, k: 0 }, { gid: bg.gid, round: bg.round, k: '0' }, { gid: bg.gid, round: bg.round, k: 99 }]) {
    b.P.a.pick = pick; assert.equal(bad.game.tick(bg), false);
  }
  const actions = setup(3), a = actions.c;
  await as(a, 'b', () => a.mpSendWish('unauthorized')); await a.mpSendTwist('wrong phase'); await a.mpPick(0);
  await a.mpSendWish(null); await a.mpTakeWish(-1); await a.mpTakeWish('0'); assert.equal(actions.writes.length, 0);
  await a.mpSendWish('z'.repeat(250)); assert.equal(actions.writes[0].wish.text.length, 200); actions.game.tick(actions.g);
  await a.mpSendWish('wrong phase'); await a.mpSendTwist('wisher cannot twist');
  await as(a, 'b', () => a.mpSendTwist('t'.repeat(250))); assert.equal(actions.writes[1].twist.text.length, 200);
  assert.equal(actions.writes[1].twist.round, actions.g.round); assert.equal(actions.writes[1].twist.gid, actions.g.gid);

  const unlimited = setup(3, { mpTime: 0, judgeTime: 0, next: 0 });
  assert.equal(unlimited.g.deadline, 0); unlimited.advance(1e9); assert.equal(unlimited.game.tick(unlimited.g), false);
  await judge(unlimited); assert.equal(unlimited.g.deadline, 0); unlimited.advance(1e9); assert.equal(unlimited.game.tick(unlimited.g), false);
  await unlimited.c.mpPick(0); unlimited.game.tick(unlimited.g); unlimited.game.tick(unlimited.g); assert.equal(unlimited.timers.size, 0);
  const guarded = setup(); await judge(guarded); await guarded.c.mpPick(0); guarded.game.tick(guarded.g); guarded.game.tick(guarded.g);
  guarded.c.L.game = { type: 'mp', gid: 'replacement', round: 1, phase: 'result' };
  [...guarded.timers.values()][0].fn(); assert.equal(guarded.c.commits, 0);
  bg.wish = '<script>&'; bad.game.render(bg); assert.ok(bad.view.innerHTML.includes('&lt;script&gt;&amp;'));
  assert.equal(c.errors.length, 0);
  console.log('PASS Monkey Paw game logic');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
