const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '../gif-me/gm.js'), 'utf8');
function setup(n = 4, options = {}, key = '') {
  let now = 100000, id = 0, media = null, listener = null;
  const writes = [], mediaWrites = [], requests = [];
  const c = {
    GAMES: {}, L: { status: 'playing', settings: { gmSearch: 90, gmVote: 30, target: 2, next: 3, lang: 'en', ...options } },
    P: {}, ME: 'a', code: 'TEST', skew: 500, crypto: webcrypto, Date: { now: () => now }, Math, URLSearchParams, AbortController, AbortSignal, setTimeout, clearTimeout,
    GM_SITUATIONS: { en: Array.from({ length: 9 }, (_, i) => `Situation ${i}`), fr: ['Un', 'Deux', 'Trois'] },
    settings: () => c.L.settings, present: pid => !!c.P[pid] && !c.P[pid].gone,
    byJoined: (a, b) => (c.P[a].joined - c.P[b].joined) || (a < b ? -1 : 1),
    nameOf: pid => c.P[pid]?.name || pid, rid: () => `game${++id}`, shuffle: a => a.slice().reverse(),
    errors: [], writeError: e => c.errors.push(e), isHost: () => c.ME === 'a', render() {}, afterChange() { c.render(); },
    firebase: { auth: () => ({ currentUser: { uid: 'auth-user' } }) },
    myRef: () => ({ update: async a => { writes.push({ pid: c.ME, ...a }); Object.assign(c.P[c.ME], a); } }),
    fetch: async url => { requests.push(url); return { ok: true, json: async () => c.response }; }
  };
  const ref = {
    set: async value => { mediaWrites.push(value); media = value; if (listener) listener({ exists: true, data: () => media }); },
    onSnapshot: fn => { listener = fn; fn({ exists: !!media, data: () => media }); return () => { listener = null; }; }
  };
  const lobbyRef = {};
  c.db = { doc: path => path === 'lobbies/TEST' ? lobbyRef : ref, runTransaction: async fn => fn({
    get: async target => target === lobbyRef ? { exists: !!c.L, data: () => c.L } : { exists: !!media, data: () => media },
    set: (target, value) => { assert.equal(target, ref); return ref.set(value); },
    delete: target => { assert.equal(target, ref); media = null; }
  }) };
  for (let i = 0; i < n; i++) c.P[String.fromCharCode(97 + i)] = { joined: i + 1, name: `Player ${i}`, face: null };
  vm.createContext(c); vm.runInContext(source.replace(/const KLIPY_KEY = "[^"]*";/, `const KLIPY_KEY = ${JSON.stringify(key)};`), c);
  const game = c.GAMES.gm; c.L.game = game.start(Object.keys(c.P), c.settings());
  return { c, game, g: c.L.game, writes, mediaWrites, requests, media: () => media, listening: () => !!listener,
    expire: () => { now = c.L.game.deadline + c.skew; }, advance: ms => { now += ms; } };
}
async function as(c, pid, fn) { const prev = c.ME; c.ME = pid; try { return await fn(); } finally { c.ME = prev; } }
const gif = id => ({ id, url: `https://static2.klipy.com/${id}/200.webp`, still: `https://static.klipy.com/${id}/200_s.gif`, w: 200, h: 120 });
const stamp = (g, value) => ({ gid: g.gid, round: g.round, ...value });
async function search(h) { await as(h.c, h.g.setter, () => h.c.gmSendSit('  The situation  ')); h.game.tick(h.g); assert.equal(h.g.phase, 'search'); }
async function vote(h) {
  await search(h);
  for (const pid of h.g.seats.filter(pid => pid !== h.g.setter)) await as(h.c, pid, () => h.c.gmSendGif(gif(pid)));
  h.game.tick(h.g); assert.equal(h.g.phase, 'vote');
}
async function main() {
  const h = setup(), { c, g, game } = h;
  assert.equal(game.min, 3); assert.equal(game.ownsMin, true); assert.equal(game.defaults.gmSearch, 90);
  assert.equal(game.check(['a', 'b', 'c'], c.settings()).ok, false);
  assert.equal(game.check(['a', 'b', 'c'], c.settings()).why, 'GIF search is not configured.');
  const configured = setup(3, {}, 'public-key');
  assert.equal(configured.game.check(['a', 'b'], configured.c.settings()).ok, false);
  assert.equal(configured.game.check(['a', 'b', 'c'], configured.c.settings()).ok, true);
  assert.equal(g.setter, 'a'); assert.equal(g.round, 1); assert.equal(g.sitCards.length, 3); assert.equal(g.deadline, 189500);
  assert.equal(c.gmRole(), 'setter'); assert.equal(c.gmMySit(), null); assert.equal(c.gmMyVote(), null);
  await as(c, 'x', () => { assert.equal(c.gmRole(), 'spectator'); return c.gmSendSit('x'); });
  await as(c, 'b', () => { assert.equal(c.gmRole(), 'player'); return c.gmSendSit('x'); });
  await c.gmTakeSit(-1); await c.gmSendSit(' '); assert.equal(h.writes.length, 0);
  await c.gmTakeSit(1); await c.gmSendSit('replacement'); assert.equal(h.writes.length, 1);
  assert.equal(c.gmMySit().text, g.sitCards[1]); game.tick(g); assert.equal(g.sit.photo, false);
  assert.equal(g.sit.text, g.sitCards[1]); assert.equal(g.phase, 'search');
  await c.gmSendGif(gif('setter')); assert.equal(c.gmMyGif(), null);
  await as(c, 'b', () => c.gmSendGif(gif('b'))); await as(c, 'b', () => c.gmSendGif(gif('replacement')));
  await as(c, 'b', () => assert.equal(c.gmMyGif().id, 'b'));
  assert.equal(game.tick(g), false); h.expire(); game.tick(g); assert.equal(g.phase, 'result'); assert.equal(g.scores.b, 1);
  assert.deepEqual(Array.from(g.winners), [0]); assert.equal(game.tick(g), false); h.expire(); game.tick(g);
  assert.equal(g.setter, 'b'); assert.equal(g.round, 2); assert.equal(c.gmMySit(), null);
  await search(h); await as(c, 'b', () => c.gmVote(0)); assert.equal(c.P.b.vote, undefined);

  // Rotation, deleted seats, no-repeat deck, language fallback.
  const rotation = setup(); Object.values(rotation.c.P).forEach(p => { p.joined = 1; });
  const setters = [rotation.g.setter];
  for (let i = 0; i < 4; i++) { rotation.c.gmStartRound(rotation.g); setters.push(rotation.g.setter); }
  assert.deepEqual(setters, ['a', 'b', 'c', 'd', 'a']); delete rotation.c.P.a;
  rotation.c.gmStartRound(rotation.g); assert.equal(rotation.g.setter, 'b');
  const deck = setup(3, { lang: 'missing' }), dealt = [];
  for (let i = 0; i < 3; i++) { dealt.push(...deck.g.sitCards); deck.c.gmStartRound(deck.g); }
  assert.equal(new Set(dealt).size, 9); assert.equal(deck.g.sitLang, 'en'); assert.equal(setup(3, { lang: 'fr' }).g.sitLang, 'fr');
  const text = setup(); await text.c.gmSendSit('  ' + 'a'.repeat(250) + '  '); text.game.tick(text.g); assert.equal(text.g.sit.text.length, 200);
  const timeout = setup(); timeout.expire(); timeout.game.tick(timeout.g); assert.equal(timeout.g.phase, 'search'); assert.ok(timeout.g.sitCards.includes(timeout.g.sit.text));
  const emptyDeck = setup(); delete emptyDeck.c.GM_SITUATIONS; emptyDeck.c.gmStartRound(emptyDeck.g);
  emptyDeck.expire(); emptyDeck.game.tick(emptyDeck.g); assert.equal(emptyDeck.g.round, 3);
  const noLimit = setup(3, { gmSearch: 0, gmVote: 0, next: 0 }); noLimit.advance(1e9); assert.equal(noLimit.game.tick(noLimit.g), false);
  await search(noLimit); assert.equal(noLimit.g.deadline, 0); assert.equal(noLimit.game.tick(noLimit.g), false);
  const zero = setup(); await search(zero); zero.expire(); zero.game.tick(zero.g); assert.equal(zero.g.round, 2); assert.equal(zero.g.phase, 'set');

  // Validate untrusted host reads as well as the client sender.
  const bad = setup(3); await search(bad);
  for (const invalid of [ { ...gif('b'), url: 'https://static.klipy.com.evil.test/a' }, { ...gif('b'), still: 'http://static.klipy.com/a' },
    { ...gif('b'), url: 'https://static3.klipy.com/a' }, { ...gif('b'), url: 'https://static.klipy.com@evil.test/a' },
    { ...gif('b'), url: 'https://static.klipy.com:443/a' }, { ...gif('b'), url: 'https://static.klipy.com\\@evil.test/a' },
    { ...gif('b'), id: 'x'.repeat(65) }, { ...gif('b'), w: 2.5 }, { ...gif('b'), h: 2001 }, { ...gif('b'), url: 'https://static.klipy.com/' + 'x'.repeat(300) } ]) {
    await as(bad.c, 'b', () => bad.c.gmSendGif(invalid)); assert.equal(bad.c.P.b.gif, undefined);
    bad.c.P.b.gif = stamp(bad.g, invalid); assert.equal(bad.game.tick(bad.g), false); assert.equal(bad.c.gmAction(bad.g, 'b', 'gif'), null); delete bad.c.P.b.gif;
  }
  bad.c.P.b.gif = stamp(bad.g, { ...gif('b'), url: 'https://evil.test/a' }); bad.expire(); bad.game.tick(bad.g); assert.equal(bad.g.round, 2);

  // Own votes rejected; three valid votes tie three authors, all reaching target together.
  const tie = setup(4, { target: 1 }); await vote(tie);
  const own = tie.g.order.findIndex(a => a.pid === 'b');
  await as(tie.c, 'b', () => tie.c.gmVote(own)); assert.equal(tie.c.P.b.vote, undefined);
  tie.c.P.b.vote = stamp(tie.g, { k: own }); assert.equal(tie.c.gmAction(tie.g, 'b', 'vote'), null);
  delete tie.c.P.b.vote;
  for (let k = 0; k < tie.g.order.length; k++) {
    const voter = tie.g.order[(k + 1) % tie.g.order.length].pid;
    await as(tie.c, voter, () => tie.c.gmVote(k)); await as(tie.c, voter, () => assert.equal(tie.c.gmMyVote(), k));
  }
  assert.equal(tie.game.tick(tie.g), false); tie.expire(); tie.game.tick(tie.g);
  assert.deepEqual(Array.from(tie.g.tally), [1, 1, 1]); assert.equal(tie.g.winners.length, 3);
  assert.equal(tie.g.phase, 'over'); assert.equal(tie.c.L.status, 'over'); assert.equal(tie.g.champions.length, 3);
  for (const a of tie.g.order) assert.equal(tie.g.scores[a.pid], 1);
  const all = setup(3); await vote(all);
  for (const pid of all.g.seats) await as(all.c, pid, () => all.c.gmVote(all.g.order.findIndex(a => a.pid !== pid)));
  all.game.tick(all.g); assert.equal(all.g.phase, 'result');
  const points = Object.values(all.g.scores).reduce((a, b) => a + b, 0); all.game.tick(all.g);
  assert.equal(Object.values(all.g.scores).reduce((a, b) => a + b, 0), points);
  const none = setup(); await vote(none); none.expire(); none.game.tick(none.g);
  assert.equal(none.g.phase, 'result'); assert.equal(none.g.winners.length, 0); assert.ok(none.g.log[0].what.includes('No votes'));
  assert.ok(Object.values(none.g.scores).every(x => x === 0));
  const left = setup(5); await vote(left); const author = left.g.order[0].pid; left.c.P[author].gone = true;
  left.c.P.a.vote = stamp(left.g, { k: 0 }); left.expire(); left.game.tick(left.g);
  assert.equal(left.g.order[0].pid, author); assert.equal(left.g.scores[author], 0); assert.equal(left.g.winners.length, 0);
  // A departed leader does not mask a remaining author's lower positive tally.
  const departed = setup(5); await vote(departed); departed.c.P[departed.g.order[0].pid].gone = true;
  departed.c.P.a.vote = stamp(departed.g, { k: 0 });
  const voter = departed.g.seats.find(pid => departed.c.present(pid) && pid !== departed.g.order[1].pid && pid !== 'a');
  departed.c.P[voter].vote = stamp(departed.g, { k: 1 }); departed.expire(); departed.game.tick(departed.g);
  assert.deepEqual(Array.from(departed.g.winners), [1]);
  for (const phase of ['set', 'search', 'vote']) {
    const skip = setup(4); if (phase === 'search') await search(skip); if (phase === 'vote') await vote(skip);
    skip.c.P.a.gone = true; skip.game.tick(skip.g); assert.equal(skip.g.round, 2); assert.equal(skip.g.setter, 'b');
  }
  const end = setup(3); end.g.scores.a = 2; end.g.scores.b = 2; end.c.P.c.gone = true; end.game.tick(end.g);
  assert.deepEqual(Array.from(end.g.champions), ['a', 'b']); assert.equal(end.g.phase, 'over'); assert.equal(end.g.scores.a, 2);
  assert.equal(end.game.tick(end.g), false); assert.equal(end.game.tick(null), false);
  const noScore = setup(3); noScore.c.P.c.gone = true; noScore.game.tick(noScore.g); assert.equal(noScore.g.champions.length, 0);
  const manual = setup(3, { next: 0 }); await vote(manual); manual.expire(); manual.game.tick(manual.g);
  manual.advance(1e8); assert.equal(manual.game.tick(manual.g), false); manual.game.next(manual.g); assert.equal(manual.g.round, 2);

  // All actions are stamped; new arrivals wait for the next round.
  const stale = setup(3);
  for (const delta of [{ gid: 'old' }, { round: 0 }]) {
    stale.c.P.a.sit = { ...stamp(stale.g, { text: 'old', photo: false }), ...delta }; assert.equal(stale.game.tick(stale.g), false);
  }
  await search(stale);
  stale.c.P.d = { joined: 4, name: 'New' }; await as(stale.c, 'd', () => stale.c.gmSendGif(gif('d'))); assert.equal(stale.c.P.d.gif, undefined);
  stale.c.P.b.gif = { ...stamp(stale.g, gif('b')), round: 0 }; stale.c.P.c.gif = { ...stamp(stale.g, gif('c')), gid: 'old' };
  assert.equal(stale.game.tick(stale.g), false);
  for (const pid of ['b', 'c']) await as(stale.c, pid, () => stale.c.gmSendGif(gif(pid)));
  stale.game.tick(stale.g); assert.equal(stale.g.order.length, 2);
  stale.c.P.a.vote = { ...stamp(stale.g, { k: 0 }), round: 0 }; stale.c.P.b.vote = { ...stamp(stale.g, { k: 0 }), gid: 'old' };
  assert.equal(stale.c.gmMyVote(), null); assert.equal(stale.game.tick(stale.g), false);

  // Photos are written before the seat, cached only while live, and matched by stamp/setter.
  const photo = setup(); photo.c.gmSyncMedia(); assert.equal(photo.listening(), true);
  await photo.c.gmSendPhoto('data:image/jpeg;base64,YQ==', '  caption  ');
  assert.equal(photo.mediaWrites.length, 1); assert.equal(photo.mediaWrites[0].uid, 'auth-user');
  assert.equal(photo.c.P.a.sit.photo, true); photo.game.tick(photo.g); assert.equal(photo.g.sit.text, 'caption');
  assert.equal(photo.c.gmPhoto(photo.g), 'data:image/jpeg;base64,YQ==');
  photo.media().gid = 'old-game'; assert.equal(photo.c.gmPhoto(photo.g), null); photo.media().gid = photo.g.gid;
  photo.media().pid = 'b'; assert.equal(photo.c.gmPhoto(photo.g), null); photo.media().pid = 'a';
  photo.media().round++; assert.equal(photo.c.gmPhoto(photo.g), null);
  photo.media().round--;
  photo.c.L.game = null; photo.c.gmSyncMedia(); assert.equal(photo.listening(), false);
  const captionless = setup(); captionless.c.gmSyncMedia(); await captionless.c.gmSendPhoto('data:image/jpeg;base64,YQ==', ''); captionless.game.tick(captionless.g);
  assert.equal(captionless.g.sit.photo, true); assert.equal(captionless.g.sit.text, '');
  await captionless.c.gmResizePhoto({ type: 'text/plain' }).then(() => assert.fail('accepted text'), e => assert.match(e.message, /image/));
  let revoked = false; const sizes = [], qualities = [];
  captionless.c.URL = { createObjectURL: () => 'blob:test', revokeObjectURL: () => { revoked = true; } };
  captionless.c.Image = class { constructor() { this.naturalWidth = 2000; this.naturalHeight = 1000; } set src(value) { this.onload(); } };
  const canvas = { getContext: () => ({ fillRect() {}, drawImage() { sizes.push([canvas.width, canvas.height]); } }),
    toDataURL: (type, quality) => { assert.equal(type, 'image/jpeg'); qualities.push(quality); return 'data:image/jpeg;base64,' + 'a'.repeat(canvas.width > 540 ? 200001 : 100); } };
  captionless.c.document = { createElement: name => { assert.equal(name, 'canvas'); return canvas; } };
  const resized = await captionless.c.gmResizePhoto({ type: 'image/png' }); assert.ok(resized.length <= 200000);
  assert.deepEqual(sizes, [[720, 360], [540, 270]]); assert.ok(qualities.includes(.25)); assert.equal(revoked, true);
  const failure = setup(); failure.c.myRef = () => ({ update: async () => { throw Error('write failed'); } });
  await failure.c.gmSendSit('hello'); assert.equal(failure.c.errors.length, 1);

  // A forged/missing photo action waits; only matching media can release it before timeout.
  for (const mismatch of ['missing', 'gid', 'round', 'pid', 'data', 'empty', 'oversize']) {
    const pending = setup(); pending.c.gmSyncMedia();
    pending.c.P.a.sit = stamp(pending.g, { text: 'photo', photo: true });
    const media = { gid: pending.g.gid, round: pending.g.round, pid: 'a', data: 'data:image/jpeg;base64,YQ==' };
    if (mismatch === 'gid') media.gid = 'old';
    if (mismatch === 'round') media.round++;
    if (mismatch === 'pid') media.pid = 'b';
    if (mismatch === 'data') media.data = null;
    if (mismatch === 'empty') media.data = '';
    if (mismatch === 'oversize') media.data += 'a'.repeat(200000);
    if (mismatch !== 'missing') await pending.c.db.doc('lobbies/TEST/media/sit').set(media);
    assert.equal(pending.game.tick(pending.g), false, mismatch); assert.equal(pending.g.phase, 'set');
    pending.expire(); pending.game.tick(pending.g);
    assert.equal(pending.g.phase, 'search'); assert.equal(pending.g.sit.photo, false);
    assert.ok(pending.g.sitCards.includes(pending.g.sit.text));
  }
  const arrival = setup(); arrival.c.gmSyncMedia();
  arrival.c.P.a.sit = stamp(arrival.g, { text: '', photo: true });
  assert.equal(arrival.game.tick(arrival.g), false);
  let changes = 0;
  arrival.c.afterChange = () => { changes++; arrival.game.tick(arrival.g); };
  await arrival.c.db.doc('lobbies/TEST/media/sit').set({ gid: arrival.g.gid, round: arrival.g.round, pid: 'a', data: 'data:image/jpeg;base64,YQ==' });
  assert.equal(changes, 1); assert.equal(arrival.g.phase, 'search'); assert.equal(arrival.g.sit.photo, true);

  // An unrelated lobby snapshot during the upload must not discard a valid photo.
  const snapshot = setup(), snapshotTx = snapshot.c.db.runTransaction;
  snapshot.c.db.runTransaction = async fn => {
    const result = await snapshotTx(fn);
    snapshot.c.L.game = structuredClone(snapshot.c.L.game);
    return result;
  };
  await snapshot.c.gmSendPhoto('data:image/jpeg;base64,YQ==', 'snapshot');
  assert.equal(snapshot.writes.length, 1); assert.equal(snapshot.mediaWrites.length, 1);
  // Pause before the transaction reads the authoritative lobby, like a delayed upload/retry.
  for (const change of ['end', 'next', 'gid', 'phase', 'setter', 'type', 'deleted']) {
    const delayed = setup(); await Promise.resolve();
    const transaction = delayed.c.db.runTransaction;
    let resume;
    delayed.c.db.runTransaction = async fn => { await new Promise(resolve => { resume = resolve; }); return transaction(fn); };
    const pending = delayed.c.gmSendPhoto('data:image/jpeg;base64,YQ==', 'late');
    if (change === 'end') { delayed.g.phase = 'over'; await transaction(async tx => tx.delete(delayed.c.db.doc('lobbies/TEST/media/sit'))); }
    if (change === 'next') {
      delayed.g.round++;
      await delayed.c.db.doc('lobbies/TEST/media/sit').set({ gid: delayed.g.gid, round: delayed.g.round, data: 'new photo' });
    }
    if (change === 'gid') delayed.g.gid = 'new-game';
    if (change === 'phase') delayed.g.phase = 'search';
    if (change === 'setter') delayed.g.setter = 'b';
    if (change === 'type') delayed.g.type = 'cah';
    if (change === 'deleted') delayed.c.L = null;
    resume(); await pending;
    assert.equal(delayed.writes.length, 0, change);
    assert.equal(delayed.mediaWrites.length, change === 'next' ? 1 : 0, change);
    assert.equal(delayed.media()?.data ?? null, change === 'next' ? 'new photo' : null, change);
  }
  // Recheck current state after a successful transaction, too.
  for (const change of ['round', 'gid', 'phase', 'setter', 'sit', 'type', 'missing']) {
    const changed = setup(), transaction = changed.c.db.runTransaction;
    changed.c.db.runTransaction = async fn => {
      const result = await transaction(fn);
      const current = changed.c.L.game = structuredClone(changed.g);
      if (change === 'round') current.round++;
      if (change === 'gid') current.gid = 'other';
      if (change === 'phase') current.phase = 'search';
      if (change === 'setter') current.setter = 'b';
      if (change === 'sit') changed.c.P.a.sit = stamp(current, { text: 'already sent', photo: false });
      if (change === 'type') current.type = 'cah';
      if (change === 'missing') changed.c.L.game = null;
      return result;
    };
    await changed.c.gmSendPhoto('data:image/jpeg;base64,YQ==', 'late');
    assert.equal(changed.writes.length, 0, change);
  }

  await assert.rejects(c.gmSearchGifs('cats'), /^Error: GIF key missing$/);
  const api = setup(3, { lang: 'fr' }, 'public-key');
  const apiItem = id => ({ id, title: 'Hello', type: 'gif', file: { sm: {
    webp: { url: gif(String(id)).url, width: 200, height: 120 },
    jpg: { url: gif(String(id)).still, width: 200, height: 120 }
  } } });
  const invalid = apiItem('bad'); invalid.file.sm.webp.url = 'https://evil.test/a';
  api.c.response = { result: true, data: { data: [apiItem(123), invalid, { type: 'ad' }], current_page: 2, has_next: true } };
  let result = await api.c.gmSearchGifs('  cats & dogs  ', 2); const url = new URL(api.requests[0]);
  assert.equal(url.pathname, '/api/v1/public-key/gifs/search'); assert.equal(url.searchParams.get('q'), 'cats & dogs');
  for (const [k, v] of Object.entries({ per_page: '50', page: '2', content_filter: 'low', locale: 'fr', format_filter: 'gif,webp,jpg' })) assert.equal(url.searchParams.get(k), v);
  assert.match(url.searchParams.get('customer_id'), /^[a-f0-9]{32}$/);
  assert.equal(result.items.length, 1); assert.equal(result.items[0].id, '123'); assert.equal(result.items[0].w, 200); assert.equal(result.next, 3);
  assert.equal(await api.c.gmSearchGifs('cats & dogs', 2), result); assert.equal(api.requests.length, 1);
  api.c.L.settings.lang = 'de'; await api.c.gmSearchGifs('cats & dogs', 2); assert.equal(api.requests.length, 2);
  assert.equal(new URL(api.requests[1]).searchParams.get('customer_id'), url.searchParams.get('customer_id'));
  const fallback = apiItem('gif-only'); fallback.file.sm.gif = fallback.file.sm.webp; delete fallback.file.sm.webp;
  api.c.response = { result: true, data: { data: [fallback], current_page: 3, has_next: false } };
  result = await api.c.gmSearchGifs(' ', 3); assert.equal(result.next, null); assert.equal(result.items.length, 1);
  assert.equal(new URL(api.requests[2]).pathname, '/api/v1/public-key/gifs/trending'); assert.equal(new URL(api.requests[2]).searchParams.has('q'), false);
  for (const host of ['static', 'static1', 'static2']) assert.equal(vm.runInContext(`gmUrl("https://${host}.klipy.com/a.gif")`, api.c), true);
  api.c.fetch = async () => { throw Error('offline'); }; await assert.rejects(api.c.gmSearchGifs('x'), /offline/);
  api.c.fetch = async () => ({ ok: false, status: 429 }); await assert.rejects(api.c.gmSearchGifs('x'), /^Error: GIF search busy$/);
  api.c.fetch = async () => ({ ok: false, status: 503 }); await assert.rejects(api.c.gmSearchGifs('x'), /^Error: GIF search failed: 503$/);
  // Native and fallback deadlines abort hung fetches and body reads, and clear fallback timers.
  for (const native of [true, false]) for (const stage of ['fetch', 'body']) {
    const timed = setup(3, {}, 'public-key'); let fire, ready, cleared = 0, ms;
    const started = new Promise(resolve => { ready = resolve; });
    timed.c.AbortSignal = native ? { timeout: delay => { ms = delay; const ctl = new AbortController(); fire = () => ctl.abort(); return ctl.signal; } } : {};
    timed.c.setTimeout = (fn, delay) => { fire = fn; ms = delay; return 42; };
    timed.c.clearTimeout = id => { assert.equal(id, 42); cleared++; };
    timed.c.fetch = async (url, { signal }) => {
      const hang = () => new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(Error('aborted')), { once: true }); ready(); });
      return stage === 'fetch' ? hang() : { ok: true, json: hang };
    };
    const pending = timed.c.gmSearchGifs('hung');
    await started; assert.equal(ms, 10000); fire();
    await assert.rejects(pending, /^Error: GIF search timed out$/);
    assert.equal(cleared, native ? 0 : 1);
  }
  // The oldest entry is evicted; a rejected request never occupies the cache.
  api.c.fetch = async url => { api.requests.push(url); return { ok: true, json: async () => api.c.response }; };
  for (let i = 0; i < 51; i++) await api.c.gmSearchGifs('cache-' + i);
  const count = api.requests.length;
  await api.c.gmSearchGifs('cache-50'); assert.equal(api.requests.length, count);
  await api.c.gmSearchGifs('cache-0'); assert.equal(api.requests.length, count + 1);
  await atomicCleanupTests();
  mediaCleanupTests();
  await roomCleanupTests();
  console.log('PASS GIF Me game logic, media, atomic lobby cleanup and Klipy client');
}
function mediaCleanupTests() {
  const { c, g } = setup();
  const count = (previous, next) => {
    const deletes = []; c.gmCommitMedia({ delete: ref => deletes.push(ref) }, 'TEST', previous, next); return deletes.length;
  };
  const state = (phase, photo = false) => ({ ...structuredClone(g), phase, sit: { text: 'scene', photo } });
  for (const phase of ['search', 'vote', 'result', 'over']) {
    const text = state(phase); assert.equal(count(text, text), 0, phase + ' text heartbeat');
    const photo = state(phase, true); assert.equal(count(photo, photo), 0, phase + ' photo heartbeat');
  }
  const set = state('set'), search = state('search');
  assert.equal(count(set, set), 0);
  assert.equal(count(set, search), 1);
  assert.equal(count(set, state('search', true)), 0);
  for (const phase of ['search', 'vote', 'result']) for (const photo of [false, true]) {
    const before = state(phase, photo);
    assert.equal(count(before, state('over', photo)), 1, phase + ' end');
    assert.equal(count(before, null), 1, phase + ' lobby');
    assert.equal(count(before, { type: 'mp' }), 1, phase + ' switch');
    assert.equal(count(before, { ...set, round: before.round + 1 }), photo ? 1 : 0, phase + ' advance');
  }
  assert.equal(count(state('result', true), { ...set, gid: 'new' }), 1);
  assert.equal(count(state('search', true), { ...set, setter: 'b' }), 1);
  assert.equal(count(null, set), 0);
}
async function roomCleanupTests() {
  const core = fs.readFileSync(path.join(__dirname, '../shared/core.js'), 'utf8');
  for (const close of [false, true]) {
    const deletes = []; let exists = true, media = true;
    const c = vm.createContext({ code: 'TEST', ME: 'a', P: { a: {} }, L: {},
      isHost: () => true, byJoined: () => 0, firebaseAccountUser: 'uid', uid: 'uid',
      writeError: e => { throw e; }, exitLobby() {},
      db: { doc: path => ({
        get: async () => ({ exists, data: () => ({ host: 'a' }) }),
        delete: async () => {
          deletes.push(path);
          if (path === 'lobbies/TEST') { media = true; exists = false; } // Last allowed upload wins just before deletion.
          if (path.endsWith('/media/sit')) { media = false; if (exists) media = true; } // A live lobby permits recreation.
        }
      }), collection: () => ({ get: async () => ({ docs: [] }) }) }
    });
    vm.runInContext(core.slice(core.indexOf('async function leaveLobby()'), core.indexOf('/* Lobbies abandoned')), c);
    await (close ? c.closeLobby('TEST') : c.leaveLobby());
    assert.equal(media, false); assert.equal(exists, false);
    assert.ok(deletes.indexOf('directory/TEST') < deletes.indexOf('lobbies/TEST'));
    assert.ok(deletes.indexOf('lobbies/TEST') < deletes.indexOf('lobbies/TEST/media/sit'));
  }
}
async function atomicCleanupTests() {
  const core = fs.readFileSync(path.join(__dirname, '../shared/core.js'), 'utf8');
  const commitSource = core.slice(core.indexOf('let writing = false'), core.indexOf('async function syncDirectory'));
  for (const transition of ['next', 'skip', 'end', 'lobby', 'text', 'photo', 'rejected', 'failed']) {
    // Persisted state must be independent of the host's mutable local game.
    const h = setup(), { c, g } = h;
    Object.assign(c.L, { host: 'a', hostUid: 'auth-user', rev: 1 });
    let persisted = structuredClone(c.L), media = null, version = 0, attempts = 0;
    let releaseUpload, uploadRead, releaseCommit, commitReady;
    const read = new Promise(resolve => { uploadRead = resolve; });
    const ready = new Promise(resolve => { commitReady = resolve; });
    const lobbyRef = {}, mediaRef = { onSnapshot: () => () => {} };
    Object.assign(c, { leaving: false, firebaseAccountUser: 'auth-user', uid: 'auth-user',
      clone: structuredClone, savePiles: async () => {}, syncDirectory: async () => {} });
    c.firebase.firestore = { FieldValue: { serverTimestamp: () => 100000 } };
    c.db = { doc: p => p === 'lobbies/TEST' ? lobbyRef : mediaRef,
      runTransaction: async fn => {
        for (;;) {
          const seen = version, ops = [];
          const result = await fn({
            get: async ref => {
              assert.equal(ref, lobbyRef);
              const data = structuredClone(persisted);
              return { exists: !!data, data: () => data };
            },
            set: (ref, data) => ops.push({ ref, data: structuredClone(data) }),
            delete: ref => ops.push({ ref, data: null })
          });
          const lobbyWrite = ops.some(o => o.ref === lobbyRef);
          if (!lobbyWrite && attempts++ === 0) {
            uploadRead(); await new Promise(resolve => { releaseUpload = resolve; });
          }
          if (lobbyWrite) {
            commitReady(); await new Promise(resolve => { releaseCommit = resolve; });
            if (transition === 'failed') throw Error('commit failed');
          }
          if (seen !== version) continue; // Firestore retries a transaction with a changed read.
          for (const op of ops) {
            if (op.ref === lobbyRef) { persisted = op.data; version++; }
            else { assert.equal(op.ref, mediaRef); media = op.data; }
          }
          return result;
        }
      }
    };
    vm.runInContext(commitSource, c);
    const upload = c.gmSendPhoto('data:image/jpeg;base64,YQ==', 'late');
    await read; // Upload has read the old persisted set phase, but has not committed.
    media = { gid: g.gid, round: g.round, pid: g.setter, uid: 'auth-user', data: 'old' };
    if (transition === 'next') c.gmStartRound(g);
    if (transition === 'skip') c.gmSkipRound(g, 'skip');
    if (transition === 'end') c.gmEndGame(g);
    if (transition === 'lobby') { c.L.game = null; c.L.status = 'lobby'; }
    if (transition === 'text' || transition === 'photo') c.gmToSearch(g, { text: 'scene', photo: transition === 'photo' });
    if (transition === 'rejected') { persisted.rev = 99; version++; }
    assert.equal(media.data, 'old', transition + ': no eager cleanup');
    assert.equal(persisted.game.phase, 'set'); assert.equal(persisted.game.round, 1);
    const saving = c.commit();
    if (transition !== 'rejected') {
      await ready;
      assert.equal(media.data, 'old', transition + ': cleanup waits for lobby commit');
      releaseCommit();
    }
    await saving;
    const unchanged = ['photo', 'rejected', 'failed'].includes(transition);
    assert.equal(media?.data ?? null, unchanged ? 'old' : null, transition);
    releaseUpload(); await upload;
    if (!['rejected', 'failed'].includes(transition)) {
      assert.ok(attempts >= 2, transition + ': upload retries against committed lobby');
      assert.equal(c.P.a.sit, undefined, transition + ': stale upload sends no seat action');
      assert.equal(media?.data ?? null, transition === 'photo' ? 'old' : null, transition);
      // An upload starting after the transition must also fail against persisted state.
      if (transition === 'next' || transition === 'skip') { c.L.game = structuredClone({ ...persisted.game, round: 1, setter: 'a' }); }
      await c.gmSendPhoto('data:image/jpeg;base64,YQ==', 'late again');
      assert.equal(media?.data ?? null, transition === 'photo' ? 'old' : null, transition);
    }
    assert.equal(c.errors.length, transition === 'failed' ? 1 : 0, transition);
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
