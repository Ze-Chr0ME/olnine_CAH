/* ---------- Speed Date: host state machine, seat-only player actions ---------- */
const sdNow = () => Date.now() - (skew || 0);
const sdNum = (v, fallback) => Number.isInteger(v) && v > 0 ? v : fallback;
function sdPool(s = settings()) {
  const all = typeof SD_TRAITS === "object" ? SD_TRAITS : {};
  return all[s.lang] || all.en || {};
}
function sdListeners(g) { return g.seats.filter(pid => pid !== g.speaker && present(pid)); }
function sdValue(g, pid, key) {
  const v = P[pid] && P[pid][key];
  if (!v || v.gid !== g.gid || v.round !== g.round) return null;
  if (key === "trait") return typeof v.text === "string" && v.text.length <= 60 && v.text.trim() ? v.text.trim() : null;
  return Number.isInteger(v.v) && v.v >= 1 && v.v <= 5 ? v.v : null;
}
function sdRole() {
  const g = L && L.game;
  return !g || g.type !== "sd" || !g.seats.includes(ME) || !present(ME) ? "spectator" : g.speaker === ME ? "speaker" : "listener";
}
function sdMyTrait() { return sdRole() === "listener" ? sdValue(L.game, ME, "trait") : null; }
function sdMyRate() { return sdRole() === "listener" ? sdValue(L.game, ME, "rate") : null; }
async function sdSendTrait(text) {
  const g = L && L.game;
  if (sdRole() !== "listener" || g.phase !== "write" || typeof text !== "string") return;
  text = text.trim().slice(0, 60);
  if (!text) return;
  try { await myRef().update({ trait: { gid: g.gid, round: g.round, text } }); } catch (e) { writeError(e); }
}
async function sdRate(v) {
  const g = L && L.game;
  if (sdRole() !== "listener" || g.phase !== "rate" || !Number.isInteger(v) || v < 1 || v > 5) return;
  try { await myRef().update({ rate: { gid: g.gid, round: g.round, v } }); } catch (e) { writeError(e); }
}
/* Next-at is in the host clock, like deadline; subtract sdNow() for a countdown. */
function sdVisible(g) {
  if (!g || !g.traits || g.phase === "write") return 0;
  if (g.phase !== "reveal") return g.traits.length;
  return Math.min(g.traits.length, Math.max(0, Math.floor((sdNow() - g.startAt) / (g.every * 1000)) + 1));
}
function sdNextAt(g) {
  if (!g || g.phase !== "reveal" || sdVisible(g) >= g.traits.length) return null;
  return g.startAt + sdVisible(g) * g.every * 1000;
}
function sdStartRound(g) {
  const s = settings(), seats = Object.keys(P).filter(present).sort(byJoined), prev = g.speakerJoined ?? -1;
  if (!seats.length) return sdEndGame(g);
  const speaker = seats.find(pid => (P[pid].joined || 0) > prev) || seats[0];
  Object.assign(g, { seats, speaker, speakerJoined: P[speaker].joined || 0, round: g.round + 1, phase: "write", traits: [], startAt: 0,
    count: sdNum(s.sdCount, 8), every: sdNum(s.sdEvery, 5), deadline: s.sdWrite === 0 ? 0 : sdNow() + sdNum(s.sdWrite, 40) * 1000, cycleWinners: [] });
  for (const pid of seats) {
    g.scores[pid] ??= 0; g.names[pid] = P[pid].name; g.faces[pid] = P[pid].face || null;
  }
}
function sdSkipRound(g, why) {
  g.log.unshift({ h: "R" + g.round, who: null, what: why }); g.log = g.log.slice(0, 7);
  sdStartRound(g);
}
function sdBuildTraits(g) {
  const pool = sdPool(), used = new Set(), traits = [], fixed = ["gender", "age", "height"];
  const written = shuffle(sdListeners(g).map(pid => ({ text: sdValue(g, pid, "trait"), cat: "player", by: pid })).filter(t => t.text));
  const players = [];
  const values = cat => Array.isArray(pool[cat]) ? pool[cat].filter(t => typeof t === "string" && t.trim() && !used.has(t.trim())).map(t => t.trim()) : [];
  const draw = cat => {
    const text = shuffle(values(cat))[0];
    if (!text) return false;
    used.add(text); traits.push({ text, cat, by: null }); return true;
  };
  for (const cat of fixed.slice(0, g.count)) draw(cat);
  for (const t of written) {
    if (players.length >= Math.min(Math.floor(g.count / 2), Math.max(0, g.count - 3))) break;
    if (!used.has(t.text)) { used.add(t.text); players.push(t); }
  }
  const cats = Object.keys(pool).filter(cat => !fixed.includes(cat));
  for (const cat of shuffle(cats)) { if (traits.length >= g.count - players.length) break; draw(cat); }
  /* Exhaust distinct categories first; larger counts can reuse categories, never text. */
  while (traits.length < g.count - players.length) {
    const available = Object.keys(pool).filter(cat => values(cat).length);
    if (!available.length) break;
    draw(shuffle(available)[0]);
  }
  for (const t of players) traits.splice(Math.min(3, traits.length) + Math.floor(Math.random() * (Math.max(0, traits.length - 3) + 1)), 0, t);
  const twist = traits.findIndex(t => t.cat === "dealbreaker_twist");
  if (twist >= 0) traits.push(...traits.splice(twist, 1));
  return traits;
}
function sdFinishTurn(g) {
  const votes = sdListeners(g).map(pid => sdValue(g, pid, "rate")).filter(v => v !== null);
  const avg = votes.length ? Math.round(votes.reduce((a, b) => a + b, 0) / votes.length * 100) / 100 : null;
  g.turns[g.round] = { pid: g.speaker, avg, n: votes.length };
  if (!g.cycle.includes(g.speaker)) g.cycle.push(g.speaker);
  g.cycleWinners = [];
  if (Object.keys(P).filter(present).every(pid => g.cycle.includes(pid))) {
    const turns = Object.entries(g.turns).filter(([r, t]) => +r >= g.cycleFrom && t.avg !== null).map(([, t]) => t);
    const best = Math.max(...turns.map(t => t.avg));
    g.cycleWinners = [...new Set(turns.filter(t => t.avg === best).map(t => t.pid))];
    for (const pid of g.cycleWinners) g.scores[pid] = (g.scores[pid] || 0) + 1;
    g.cycle = []; g.cycleFrom = g.round + 1;
  }
  Object.assign(g, { phase: "result", deadline: 0 });
  const champions = g.cycleWinners.filter(pid => g.scores[pid] >= settings().target);
  if (champions.length) sdEndGame(g, champions);
}
function sdEndGame(g, champions) {
  if (!champions) {
    const top = Math.max(0, ...Object.values(g.scores));
    champions = top ? Object.keys(g.scores).filter(pid => g.scores[pid] === top) : [];
  }
  Object.assign(g, { phase: "over", champions, deadline: 0 }); L.status = "over";
}
let sdNextTimer = null, sdNextKey = "";
function sdScheduleNext(g) {
  const key = g.gid + ":" + g.round, delay = settings().next;
  if (sdNextKey === key || !delay) return;
  sdNextKey = key; clearTimeout(sdNextTimer);
  sdNextTimer = setTimeout(() => {
    const cur = L && L.game;
    if (isHost() && L.status === "playing" && cur && cur.type === "sd" && cur.gid + ":" + cur.round === key && cur.phase === "result") { sdStartRound(cur); commit(); }
  }, delay * 1000);
}
function sdCheck(players, s) {
  if (players.length < 2) return { ok: false, why: `Waiting for players: ${players.length} of 2 needed.` };
  const texts = new Set(Object.values(sdPool(s)).filter(Array.isArray).flat().filter(t => typeof t === "string" && t.trim()).map(t => t.trim()));
  if (texts.size < sdNum(s.sdCount, 8)) return { ok: false, why: "Not enough different date traits for this trait count." };
  return { ok: true };
}
function sdStart(players, s) {
  const g = { type: "sd", gid: rid(8), round: 0, scores: {}, names: {}, faces: {}, seats: [], speaker: null, speakerJoined: null,
    turns: {}, cycle: [], cycleFrom: 1, cycleWinners: [], log: [] };
  sdStartRound(g); return g;
}
function sdTick(g) {
  if (["write", "reveal", "rate"].includes(g.phase) && !present(g.speaker)) {
    sdSkipRound(g, `@${nameOf(g.speaker)} left, so the turn was skipped.`); return true;
  }
  const late = g.deadline && sdNow() >= g.deadline;
  if (g.phase === "write" && (late || sdListeners(g).every(pid => sdValue(g, pid, "trait") !== null))) {
    g.traits = sdBuildTraits(g);
    Object.assign(g, { phase: "reveal", startAt: sdNow() + 3000, deadline: 0 }); return true;
  }
  if (g.phase === "reveal" && sdNow() >= g.startAt + g.count * g.every * 1000 + 3000) {
    Object.assign(g, { phase: "rate", deadline: sdNow() + 30000 }); return true;
  }
  if (g.phase === "rate" && (late || sdListeners(g).every(pid => sdValue(g, pid, "rate") !== null))) { sdFinishTurn(g); return true; }
  if (g.phase === "result") sdScheduleNext(g);
  return false;
}
function renderSD(g) {
  $("viewGame").innerHTML = `<p>${esc(g.phase)}</p>` + g.traits.slice(0, sdVisible(g)).map(t => `<p>${esc(t.text)}</p>`).join("");
}
GAMES.sd = {
  id: "sd", name: "Speed Date", min: 2, defaults: { sdCount: 8, sdEvery: 5, sdWrite: 40 },
  check: sdCheck, start: sdStart, tick: sdTick, render: renderSD
};
