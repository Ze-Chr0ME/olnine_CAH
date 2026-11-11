/* ---------- Monkey Paw ---------- */
const mpNow = () => Date.now() - (skew || 0);
const mpText = text => typeof text === "string" ? text.trim().slice(0, 200) : "";
function mpSeatText(g, pid, key) {
  const a = P[pid] && P[pid][key];
  return a && a.gid === g.gid && a.round === g.round ? mpText(a.text) || null : null;
}
function mpRole() {
  const g = L && L.game;
  if (!g || g.type !== "mp" || !g.seats.includes(ME) || !present(ME)) return "spectator";
  return g.wisher === ME ? "wisher" : "twister";
}
function mpMine() {
  const g = L && L.game;
  return g && g.type === "mp" ? mpSeatText(g, ME, "twist") : null;
}
async function mpSendWish(text) {
  const g = L && L.game, value = mpText(text);
  if (!g || g.type !== "mp" || g.phase !== "wish" || mpRole() !== "wisher" || !value) return;
  try { await myRef().update({ wish: { gid: g.gid, round: g.round, text: value } }); } catch (e) { writeError(e); }
}
function mpTakeWish(i) {
  const g = L && L.game;
  if (!g || g.type !== "mp" || !Number.isInteger(i) || i < 0 || i >= g.wishCards.length) return;
  return mpSendWish(g.wishCards[i]);
}
async function mpSendTwist(text) {
  const g = L && L.game, value = mpText(text);
  if (!g || g.type !== "mp" || g.phase !== "twist" || mpRole() !== "twister" || !value) return;
  try { await myRef().update({ twist: { gid: g.gid, round: g.round, text: value } }); } catch (e) { writeError(e); }
}
async function mpPick(k) {
  const g = L && L.game;
  if (!g || g.type !== "mp" || g.phase !== "judge" || mpRole() !== "wisher" || !Number.isInteger(k) || k < 0 || k >= g.order.length || !present(g.order[k].pid)) return;
  try { await myRef().update({ pick: { gid: g.gid, round: g.round, k } }); } catch (e) { writeError(e); }
}
function mpDeal(g) {
  const decks = typeof MP_WISHES === "undefined" ? {} : MP_WISHES || {}, lang = settings().lang || "en";
  const key = Array.isArray(decks[lang]) ? lang : "en", deck = Array.isArray(decks[key]) ? decks[key] : [];
  if (g.wishLang !== key || g.wishCount !== deck.length) { g.wishPile = []; g.wishLang = key; g.wishCount = deck.length; }
  const cards = [];
  for (let i = 0; i < Math.min(3, deck.length); i++) {
    if (!g.wishPile.length) g.wishPile = shuffle(deck.map((_, k) => k));
    const text = mpText(deck[g.wishPile.pop()]);
    if (text) cards.push(text);
  }
  return cards;
}
function mpStartRound(g) {
  const s = settings(), seats = Object.keys(P).filter(present).sort(byJoined), prev = g.wisherJoined ?? -1;
  const wisher = seats.find(pid => (P[pid].joined || 0) > prev) || seats[0] || null;
  Object.assign(g, { seats, wisher, wisherJoined: (P[wisher] && P[wisher].joined) || 0, round: g.round + 1,
    phase: "wish", wish: null, wishCards: [], order: [], winner: null, randomWin: false, deadline: s.mpTime ? mpNow() + s.mpTime * 1000 : 0 });
  g.wishCards = mpDeal(g);
  for (const pid of seats) {
    g.scores[pid] ??= 0; g.names[pid] = P[pid].name; g.faces[pid] = P[pid].face || null;
  }
}
function mpSkipRound(g, why) {
  g.log.unshift({ h: "-------", who: null, what: why }); g.log = g.log.slice(0, 7);
  mpStartRound(g);
}
function mpToTwist(g, text) {
  const t = settings().mpTime;
  Object.assign(g, { wish: text, phase: "twist", deadline: t ? mpNow() + t * 1000 : 0 });
}
function mpToJudge(g, pids) {
  const t = settings().judgeTime;
  Object.assign(g, { order: shuffle(pids.map(pid => ({ pid, text: mpSeatText(g, pid, "twist") }))), phase: "judge", deadline: t ? mpNow() + t * 1000 : 0 });
}
function mpEndGame(g, champions) {
  if (!champions) {
    const top = Math.max(0, ...Object.values(g.scores));
    champions = top ? Object.keys(g.scores).filter(pid => g.scores[pid] === top) : [];
  }
  Object.assign(g, { phase: "over", champions, deadline: 0 }); L.status = "over";
}
function mpAward(g, k, random = false) {
  const a = g.order[k];
  g.winner = k; g.randomWin = random; g.scores[a.pid] = (g.scores[a.pid] || 0) + 1;
  g.log.unshift({ h: "R" + g.round, who: a.pid, what: a.text }); g.log = g.log.slice(0, 7); g.deadline = 0;
  if (g.scores[a.pid] >= settings().target) mpEndGame(g, [a.pid]);
  else g.phase = "result";
}
let mpNextTimer = null, mpNextKey = "";
function mpScheduleNext(g) {
  const key = g.gid + ":" + g.round, delay = settings().next;
  if (mpNextKey === key || !delay) return;
  mpNextKey = key; clearTimeout(mpNextTimer);
  mpNextTimer = setTimeout(() => {
    const cur = L && L.game;
    if (isHost() && cur && cur.type === "mp" && cur.gid + ":" + cur.round === key && cur.phase === "result") { mpStartRound(cur); commit(); }
  }, delay * 1000);
}
function mpCheck(players, s) {
  const n = players.filter(present).length;
  return n < 3 ? { ok: false, why: `Waiting for players: ${n} of 3 needed.` } : { ok: true };
}
function mpStart(players, s, data) {
  const g = { type: "mp", gid: rid(8), round: 0, phase: "wish", wisher: null, wisherJoined: null, seats: [], wish: null,
    wishCards: [], wishPile: [], order: [], winner: null, scores: {}, names: {}, faces: {}, deadline: 0, log: [] };
  mpStartRound(g); return g;
}
function mpTick(g) {
  const late = g.deadline && mpNow() >= g.deadline;
  if (["wish", "twist", "judge"].includes(g.phase) && !present(g.wisher)) {
    mpSkipRound(g, `@${nameOf(g.wisher)} left, so the round was skipped.`); return true;
  }
  if (g.phase === "wish") {
    const text = mpSeatText(g, g.wisher, "wish");
    if (text) { mpToTwist(g, text); return true; }
    if (late) {
      if (g.wishCards.length) mpToTwist(g, g.wishCards[Math.floor(Math.random() * g.wishCards.length)]);
      else mpSkipRound(g, "No wish was made in time, so the round was skipped.");
      return true;
    }
  } else if (g.phase === "twist") {
    const others = g.seats.filter(pid => pid !== g.wisher && present(pid)), subs = others.filter(pid => mpSeatText(g, pid, "twist"));
    if (late || subs.length === others.length) {
      if (subs.length) mpToJudge(g, subs);
      else mpSkipRound(g, "Nobody twisted the wish in time, so the round was skipped.");
      return true;
    }
  } else if (g.phase === "judge") {
    /* Keep indices stable for stamped picks already in flight; departed authors cannot win. */
    const eligible = g.order.map((a, k) => k).filter(k => present(g.order[k].pid)), pk = P[g.wisher] && P[g.wisher].pick;
    if (!eligible.length) { mpSkipRound(g, "All twisters left, so the round was skipped."); return true; }
    if (pk && pk.gid === g.gid && pk.round === g.round && Number.isInteger(pk.k) && eligible.includes(pk.k)) { mpAward(g, pk.k); return true; }
    if (late) { mpAward(g, eligible[Math.floor(Math.random() * eligible.length)], true); return true; }
  } else if (g.phase === "result") mpScheduleNext(g);
  return false;
}
function mpRender(g) { $("viewGame").innerHTML = `<p>${esc(g.phase)}</p><p>${esc(g.wish || "")}</p>`; }
GAMES.mp = { id: "mp", name: "Monkey Paw", min: 3, defaults: { mpTime: 60 }, check: mpCheck, start: mpStart, tick: mpTick, render: mpRender };
