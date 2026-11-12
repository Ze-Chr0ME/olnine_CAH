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
    $: () => view, notice: () => {}, writeError: e => c.errors.push(e), isHost: () => c.ME === (c.L.host || 'a'),
    commit: () => c.commits++,
    myRef: () => ({ update: async a => { writes.push({ pid: c.ME, ...a }); Object.assign(c.P[c.ME], a); } }),
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; }, clearTimeout: id => timers.delete(id)
  };
  for (let i = 0; i < n; i++) c.P[String.fromCharCode(97 + i)] = { joined: i + 1, name: `Player ${i}`, face: null };
  Object.assign(c, { document: { addEventListener() {} }, setInterval() {} }); vm.createContext(c); vm.runInContext(source, c);
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
  assert.equal(g.deadline, 102500); assert.equal(game.tick(g), false);
  h.advance(2999); assert.equal(game.tick(g), false);
  h.advance(1); assert.equal(game.tick(g), true); assert.equal(h.timers.size, 0);
  assert.equal(c.commits, 0); assert.equal(g.wisher, 'b'); assert.equal(g.round, 2); assert.equal(c.mpMine(), null);
  await judge(h);
  await as(c, 'b', () => c.mpPick(g.order.findIndex(a => a.pid === 'c')));
  game.tick(g); assert.equal(g.scores.c, 2); assert.equal(g.phase, 'over'); assert.equal(c.L.status, 'over');
  assert.deepEqual(Array.from(g.champions), ['c']); assert.equal(g.log.length, 2);

  // Equal join times rotate by pid, including after the previous seat is deleted.
  const tied = setup(4);
  for (const p of Object.values(tied.c.P)) p.joined = 1;
  const rotation = [tied.g.wisher];
  for (let i = 0; i < 4; i++) { tied.c.mpStartRound(tied.g); rotation.push(tied.g.wisher); }
  assert.deepEqual(rotation, ['a', 'b', 'c', 'd', 'a']);
  delete tied.c.P.a; tied.c.mpStartRound(tied.g); assert.equal(tied.g.wisher, 'b');
  tied.c.P.e = { joined: 2, name: 'New' };
  tied.c.P.b.gone = true; tied.c.mpStartRound(tied.g); assert.equal(tied.g.wisher, 'c');

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
  dropped.expire(); dropped.game.tick(dropped.g); assert.equal(dropped.g.phase, 'over'); assert.equal(dropped.g.winner, null);

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
  // Result timing is entirely serialized: a new host resumes the remaining delay.
  const handoff = setup(4); await judge(handoff); await handoff.c.mpPick(0); handoff.game.tick(handoff.g);
  const saved = JSON.parse(JSON.stringify(handoff.g)), deadline = saved.deadline;
  handoff.advance(2000);
  const newHost = setup(4); newHost.advance(2000); newHost.c.ME = 'b'; newHost.c.L.host = 'b'; newHost.c.L.game = saved;
  assert.equal(newHost.game.tick(saved), false); assert.equal(saved.deadline, deadline);
  newHost.advance(1000); assert.equal(newHost.game.tick(saved), true); assert.equal(saved.round, 2);
  assert.equal(saved.wisher, 'b'); assert.equal(newHost.timers.size, 0);
  // Wish/twist/judge deadlines also survive host replacement and clock skew.
  for (const phase of ['wish', 'twist', 'judge']) {
    const old = setup(4);
    if (phase === 'twist') { await old.c.mpSendWish('wish'); old.game.tick(old.g); }
    if (phase === 'judge') await judge(old);
    const restored = JSON.parse(JSON.stringify(old.g)), nextHost = setup(4);
    nextHost.c.L.game = restored; nextHost.c.L.host = 'b'; nextHost.c.ME = 'b';
    nextHost.c.skew = 2500; nextHost.advance(2000);
    assert.equal(nextHost.game.tick(restored), false); assert.equal(restored.phase, phase);
    nextHost.expire(); assert.equal(nextHost.game.tick(restored), true);
    assert.equal(restored.phase, phase === 'wish' ? 'twist' : phase === 'twist' ? 'wish' : 'result');
  }
  // Older persisted result states without a deadline gain one exactly once.
  const legacy = setup(4); await judge(legacy); await legacy.c.mpPick(0); legacy.game.tick(legacy.g);
  legacy.g.deadline = 0; assert.equal(legacy.game.tick(legacy.g), true);
  const restoredDeadline = legacy.g.deadline; assert.equal(legacy.game.tick(legacy.g), false);
  assert.equal(legacy.g.deadline, restoredDeadline);

  // The minimum applies throughout play; zero seats cannot create endless skipped rounds.
  for (const phase of ['wish', 'twist', 'judge', 'result']) {
    const few = setup(3);
    if (phase === 'twist') { await few.c.mpSendWish('wish'); few.game.tick(few.g); }
    if (phase === 'judge' || phase === 'result') await judge(few);
    if (phase === 'result') { await few.c.mpPick(0); few.game.tick(few.g); }
    few.c.P.b.gone = true;
    assert.equal(few.game.tick(few.g), true); assert.equal(few.g.phase, 'over'); assert.equal(few.c.L.status, 'over');
    assert.equal(few.game.tick(few.g), false);
  }
  const empty = setup(3); empty.c.P = {}; assert.equal(empty.game.tick(empty.g), true);
  assert.equal(empty.g.phase, 'over'); assert.deepEqual(Array.from(empty.g.champions), []);
  assert.equal(empty.game.tick(null), false);
  const tiedEnd = setup(3); tiedEnd.g.scores.a = 2; tiedEnd.g.scores.b = 2; tiedEnd.c.P.c.gone = true;
  tiedEnd.game.tick(tiedEnd.g); assert.deepEqual(Array.from(tiedEnd.g.champions), ['a', 'b']);
  const manual = setup(3); manual.c.P.b.gone = true; manual.c.mpStartRound(manual.g);
  assert.equal(manual.g.phase, 'over');

  // New arrivals wait for the next round; stamped spectator actions cannot participate.
  const join = setup(3); join.c.P.d = { joined: 4, name: 'Newcomer' };
  await as(join.c, 'd', () => join.c.mpSendTwist('spectator')); assert.equal(join.writes.length, 0);
  await join.c.mpSendWish('wish'); join.game.tick(join.g);
  join.c.P.d.twist = { gid: join.g.gid, round: join.g.round, text: 'injected' };
  for (const pid of ['b', 'c']) await as(join.c, pid, () => join.c.mpSendTwist(pid));
  join.game.tick(join.g); assert.equal(join.g.order.length, 2); assert.ok(join.g.order.every(a => a.pid !== 'd'));
  join.c.mpStartRound(join.g); assert.ok(join.g.seats.includes('d')); assert.equal(join.g.scores.d, 0);

  // A departed author's index stays stable while the remaining players can still judge.
  const stable = setup(5); await judge(stable); stable.c.P[stable.g.order[0].pid].gone = true;
  stable.c.P.a.pick = { gid: stable.g.gid, round: stable.g.round, k: 0 };
  assert.equal(stable.game.tick(stable.g), false);
  await stable.c.mpPick(1); stable.game.tick(stable.g); assert.equal(stable.g.winner, 1);
  const awarded = stable.g.scores[stable.g.order[1].pid]; stable.game.tick(stable.g);
  assert.equal(stable.g.scores[stable.g.order[1].pid], awarded);

  // Duplicate/empty client submissions never replace an accepted seat action.
  const duplicates = setup(3);
  await duplicates.c.mpSendWish('  first  '); await duplicates.c.mpSendWish('second');
  assert.equal(duplicates.writes.length, 1); duplicates.game.tick(duplicates.g);
  await as(duplicates.c, 'b', async () => {
    await duplicates.c.mpSendTwist('   '); await duplicates.c.mpSendTwist('first twist'); await duplicates.c.mpSendTwist('replacement');
  });
  assert.equal(duplicates.writes.length, 2); assert.equal(duplicates.c.P.b.twist.text, 'first twist');
  // No-limit wish and twist deadlines remain disabled even after a long wait.
  const noLimit = setup(3, { mpTime: 0 }); await noLimit.c.mpSendWish('wish'); noLimit.game.tick(noLimit.g);
  noLimit.advance(1e9); assert.equal(noLimit.g.deadline, 0); assert.equal(noLimit.game.tick(noLimit.g), false);
  // Render is UI and is checked in the browser; it escapes player text with esc().
  assert.equal(c.errors.length, 0);
  console.log('PASS Monkey Paw game logic');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
