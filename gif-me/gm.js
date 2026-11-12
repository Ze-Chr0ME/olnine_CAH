/* Public client key from the Klipy Partner Panel, pasted by the owner. */
const KLIPY_KEY = "crddJ85kalBAjswqrfjHxztH6arD0dvJt5gHj6akFwA3yOh6APnlOgPXV71ZAeoE";
const gmNow = () => Date.now() - (skew || 0);
const gmText = text => typeof text === "string" ? text.trim().slice(0, 200) : "";
const gmUrl = url => typeof url === "string" && url.length <= 300 && /^https:\/\/static[12]?\.klipy\.com\//.test(url);
function gmValidGif(a) {
  return !!a && typeof a.id === "string" && a.id.length <= 64 && gmUrl(a.url) && gmUrl(a.still)
    && Number.isInteger(a.w) && a.w > 0 && a.w <= 2000 && Number.isInteger(a.h) && a.h > 0 && a.h <= 2000;
}
function gmAction(g, pid, key) {
  const a = P[pid] && P[pid][key];
  if (!a || a.gid !== g.gid || a.round !== g.round) return null;
  if (key === "sit") return typeof a.text === "string" && typeof a.photo === "boolean" && (a.photo || gmText(a.text)) ? { text: gmText(a.text), photo: a.photo } : null;
  if (key === "gif") return gmValidGif(a) ? { id: a.id, url: a.url, still: a.still, w: a.w, h: a.h } : null;
  return Number.isInteger(a.k) && a.k >= 0 && a.k < g.order.length && g.order[a.k].pid !== pid ? a.k : null;
}
/* UI globals: gmRole() -> setter|player|spectator; gmMySit() -> {text,photo}|null;
   gmMyGif() -> {id,url,still,w,h}|null; gmMyVote() -> index|null; gmPhoto(g) -> data URL|null.
   Actions: gmTakeSit(i), gmSendSit(text), gmSendPhoto(dataUrl, caption), gmResizePhoto(file),
   gmSendGif(item), gmVote(k), gmSearchGifs(q, cursor=1) -> Promise<{items,next}>.
   Resize returns a Promise<data URL>; senders catch write failures via writeError.
   Game shape: {type:"gm", gid, round, phase, setter, setterJoined, seats:[pid],
     sit:null|{text,photo}, sitCards:[text], sitPile:[index], sitLang, sitCount,
     order:[{pid,gif:{id,url,still,w,h}}], tally:[count], winners:[index],
     scores:{pid:points}, names:{pid:name}, faces:{pid:face|null}, deadline, log:[{h,who,what}],
     champions:[pid] (added on over)}. Deadlines are host-clock milliseconds, 0 disables them. */
function gmRole() {
  const g = L && L.game;
  if (!g || g.type !== "gm" || !g.seats.includes(ME) || !present(ME)) return "spectator";
  return g.setter === ME ? "setter" : "player";
}
function gmMine(key) { const g = L && L.game; return g && g.type === "gm" ? gmAction(g, ME, key) : null; }
function gmMySit() { return gmMine("sit"); }
function gmMyGif() { return gmMine("gif"); }
function gmMyVote() { return gmMine("vote"); }
function gmCanSet(g) { return g && g.type === "gm" && g.phase === "set" && gmRole() === "setter" && !gmMySit(); }
async function gmSendSit(text) {
  const g = L && L.game, value = gmText(text);
  if (!gmCanSet(g) || !value) return;
  try { await myRef().update({ sit: { gid: g.gid, round: g.round, text: value, photo: false } }); } catch (e) { writeError(e); }
}
function gmTakeSit(i) {
  const g = L && L.game;
  if (!g || g.type !== "gm" || !Number.isInteger(i) || i < 0 || i >= g.sitCards.length) return;
  return gmSendSit(g.sitCards[i]);
}
async function gmSendGif(item) {
  const g = L && L.game;
  if (!g || g.type !== "gm" || g.phase !== "search" || gmRole() !== "player" || gmMyGif() || !gmValidGif(item)) return;
  const { id, url, still, w, h } = item;
  try { await myRef().update({ gif: { gid: g.gid, round: g.round, id, url, still, w, h } }); } catch (e) { writeError(e); }
}
async function gmVote(k) {
  const g = L && L.game;
  if (!g || g.type !== "gm" || g.phase !== "vote" || gmRole() === "spectator" || gmMyVote() !== null
    || !Number.isInteger(k) || k < 0 || k >= g.order.length || g.order[k].pid === ME) return;
  try { await myRef().update({ vote: { gid: g.gid, round: g.round, k } }); } catch (e) { writeError(e); }
}
let gmMedia = null, gmMediaUnsub = null, gmMediaCode = null;
function gmStopMedia() {
  if (gmMediaUnsub) gmMediaUnsub();
  gmMediaUnsub = null; gmMediaCode = null; gmMedia = null;
}
function gmSyncMedia() {
  const g = L && L.game, live = code && g && g.type === "gm" && g.phase !== "over";
  if (!live) { gmStopMedia(); return; }
  if (gmMediaCode === code) return;
  gmStopMedia(); gmMediaCode = code;
  const c = code;
  gmMediaUnsub = db.doc(`lobbies/${c}/media/sit`).onSnapshot(snap => {
    if (gmMediaCode !== c) return;
    gmMedia = snap.exists ? snap.data() : null; afterChange();
  }, writeError);
}
function gmPhoto(g, sit = g && g.sit) {
  const a = gmMedia;
  return g && g.type === "gm" && sit && sit.photo && a && a.gid === g.gid && a.round === g.round && a.pid === g.setter
    && typeof a.data === "string" && a.data.length <= 200000 && a.data.startsWith("data:image/jpeg;base64,") ? a.data : null;
}
function gmCommitMedia(tx, roomCode, previous, next) {
  if (!previous || previous.type !== "gm") return;
  const leaving = !next || next.type !== "gm" || (next.phase === "over" && previous.phase !== "over");
  if (!leaving && previous.phase !== "set" && !(previous.phase !== "over" && previous.sit && previous.sit.photo)) return;
  /* Run inside the lobby commit: setter transactions must retry against the new state.
     Retain the accepted photo through search/vote/result, but remove abandoned uploads. */
  if (!next || next.type !== "gm" || next.gid !== previous.gid || next.round !== previous.round
    || next.setter !== previous.setter || next.phase === "over"
    || (next.phase !== "set" && !(next.sit && next.sit.photo))) {
    tx.delete(db.doc(`lobbies/${roomCode}/media/sit`));
  }
}
async function gmSendPhoto(dataUrl, caption) {
  const g = L && L.game;
  if (!gmCanSet(g) || typeof dataUrl !== "string" || dataUrl.length > 200000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) return;
  const round = g.round, gid = g.gid;
  try {
    const roomCode = code, pid = ME, uid = firebase.auth().currentUser.uid;
    const saved = await db.runTransaction(async tx => {
      const snap = await tx.get(db.doc(`lobbies/${roomCode}`));
      const current = snap.exists && snap.data().game;
      if (!current || current.type !== "gm" || current.gid !== gid || current.round !== round
        || current.phase !== "set" || current.setter !== pid) return false;
      tx.set(db.doc(`lobbies/${roomCode}/media/sit`), { gid, round, pid, uid, data: dataUrl });
      return true;
    });
    const current = L && L.game;
    if (!saved || code !== roomCode || ME !== pid || !gmCanSet(current) || current.round !== round || current.gid !== gid) return;
    await myRef().update({ sit: { gid, round, text: gmText(caption), photo: true } });
  } catch (e) { writeError(e); }
}
async function gmResizePhoto(file) {
  if (!file || typeof file.type !== "string" || !file.type.startsWith("image/")) throw Error("Choose an image");
  const url = URL.createObjectURL(file), img = new Image();
  try {
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(Error("Image could not be read")); img.src = url; });
    if (!img.naturalWidth || !img.naturalHeight) throw Error("Empty image");
    const canvas = document.createElement("canvas"), scale = Math.min(1, 720 / Math.max(img.naturalWidth, img.naturalHeight));
    let w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
    for (;;) {
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "white"; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
      for (const quality of [.85, .7, .55, .4, .25]) {
        const data = canvas.toDataURL("image/jpeg", quality);
        if (data.startsWith("data:image/jpeg;base64,") && data.length <= 200000) return data;
      }
      if (w === 1 && h === 1) throw Error("Image could not be resized");
      w = Math.max(1, Math.floor(w * .75)); h = Math.max(1, Math.floor(h * .75));
    }
  } finally { URL.revokeObjectURL(url); }
}
const gmGifCache = new Map();
let gmCustomer = null;
function gmCustomerId() {
  if (gmCustomer) return gmCustomer;
  try { gmCustomer = localStorage.getItem("gmKlipyCustomer"); } catch (_) { /* Storage may be disabled. */ }
  if (!gmCustomer || !/^[a-f0-9]{32}$/.test(gmCustomer)) {
    gmCustomer = Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, "0")).join("");
    try { localStorage.setItem("gmKlipyCustomer", gmCustomer); } catch (_) { /* Keep it for this session. */ }
  }
  return gmCustomer;
}
async function gmSearchGifs(q, cursor = 1) {
  if (!KLIPY_KEY) throw Error("GIF key missing");
  const query = typeof q === "string" ? q.trim() : "", page = Number.isInteger(cursor) && cursor >= 1 ? cursor : 1;
  const lang = settings().lang || "en", cacheKey = JSON.stringify([query, page, lang]);
  if (gmGifCache.has(cacheKey)) return gmGifCache.get(cacheKey);
  // Low filtering retains adult humour; also configure the Partner Panel safety cap (see docs/GAMES.md).
  const params = new URLSearchParams({ per_page: "50", page: String(page), customer_id: gmCustomerId(),
    locale: lang, content_filter: "low", format_filter: "gif,webp,jpg" });
  if (query) params.set("q", query);
  let timer, body;
  const controller = new AbortController(), signal = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(10000) : (timer = setTimeout(() => controller.abort(), 10000), controller.signal);
  try {
    const res = await fetch(`https://api.klipy.com/api/v1/${encodeURIComponent(KLIPY_KEY)}/gifs/${query ? "search" : "trending"}?${params}`, { signal });
    if (!res.ok) throw Error(res.status === 429 ? "GIF search busy" : "GIF search failed: " + res.status);
    body = await res.json();
  } catch (e) { if (signal.aborted) throw Error("GIF search timed out"); throw e; }
  finally { if (timer !== undefined) clearTimeout(timer); }
  const data = body.data || {}, items = [];
  for (const a of data.data || []) {
    if (!a || a.type === "ad") continue;
    // Prefer small animated WebP; GIF fallback and JPG preview come from the same size variant.
    for (const size of ["sm", "xs", "md", "hd"]) {
      const files = a.file && a.file[size];
      if (!files) continue;
      const image = files.webp || files.gif, still = files.jpg;
      const item = { id: a.id == null ? "" : String(a.id), url: image && image.url, still: still && still.url,
        w: image && Number(image.width), h: image && Number(image.height), title: gmText(a.title) };
      if (gmValidGif(item)) { items.push(item); break; }
    }
  }
  const currentPage = Number.isInteger(data.current_page) && data.current_page >= 1 ? data.current_page : page;
  const result = { items, next: data.has_next === true ? currentPage + 1 : null };
  if (gmGifCache.size >= 50) gmGifCache.delete(gmGifCache.keys().next().value);
  gmGifCache.set(cacheKey, result);
  return result;
}
function gmDeal(g) {
  const decks = typeof GM_SITUATIONS === "undefined" ? {} : GM_SITUATIONS || {}, lang = settings().lang || "en";
  const key = Array.isArray(decks[lang]) ? lang : "en", deck = Array.isArray(decks[key]) ? decks[key] : [];
  if (g.sitLang !== key || g.sitCount !== deck.length) { g.sitPile = []; g.sitLang = key; g.sitCount = deck.length; }
  const cards = [];
  for (let i = 0; i < Math.min(3, deck.length); i++) {
    if (!g.sitPile.length) g.sitPile = shuffle(deck.map((_, k) => k));
    const text = gmText(deck[g.sitPile.pop()]); if (text) cards.push(text);
  }
  return cards;
}
function gmStartRound(g) {
  const s = settings(), seats = Object.keys(P).filter(present).sort(byJoined), prev = g.setterJoined ?? -1;
  if (seats.length < 3) { gmEndGame(g); return; }
  const setter = seats.find(pid => g.setter && P[g.setter] ? pid !== g.setter && byJoined(pid, g.setter) > 0 :
    (P[pid].joined || 0) > prev || ((P[pid].joined || 0) === prev && pid > g.setter)) || seats[0];
  Object.assign(g, { seats, setter, setterJoined: P[setter].joined || 0, round: g.round + 1, phase: "set", sit: null,
    sitCards: [], order: [], tally: [], winners: [], deadline: s.gmSearch ? gmNow() + s.gmSearch * 1000 : 0 });
  g.sitCards = gmDeal(g);
  for (const pid of seats) { g.scores[pid] ??= 0; g.names[pid] = P[pid].name; g.faces[pid] = P[pid].face || null; }
}
function gmLog(g, what, who = null) { g.log.unshift({ h: "R" + g.round, who, what }); g.log = g.log.slice(0, 7); }
function gmSkipRound(g, why) { gmLog(g, why); gmStartRound(g); }
function gmEndGame(g, champions) {
  if (!champions) {
    const top = Math.max(0, ...Object.values(g.scores));
    champions = top ? Object.keys(g.scores).filter(pid => g.scores[pid] === top) : [];
  }
  Object.assign(g, { phase: "over", champions, deadline: 0 }); L.status = "over";
}
function gmToSearch(g, sit) { Object.assign(g, { sit, phase: "search", deadline: settings().gmSearch ? gmNow() + settings().gmSearch * 1000 : 0 }); }
function gmResult(g, winners) {
  g.winners = winners;
  for (const k of winners) { const pid = g.order[k].pid; g.scores[pid] = (g.scores[pid] || 0) + 1; }
  gmLog(g, winners.length ? "Winning GIF" + (winners.length > 1 ? "s (tie)." : ".") :
    g.tally.some(n => n > 0) ? "No eligible GIF received votes. No points." : "No votes. No points.", winners.length === 1 ? g.order[winners[0]].pid : null);
  const champions = Object.keys(g.scores).filter(pid => g.scores[pid] >= settings().target);
  if (champions.length) gmEndGame(g, champions);
  else { g.phase = "result"; g.deadline = settings().next ? gmNow() + settings().next * 1000 : 0; }
}
function gmCheck(players, s) {
  if (!KLIPY_KEY) return { ok: false, why: "GIF search is not configured." };
  const n = players.filter(present).length;
  return n < 3 ? { ok: false, why: `Waiting for players: ${n} of 3 needed.` } : { ok: true };
}
function gmStart(players, s, data) {
  const g = { type: "gm", gid: rid(8), round: 0, phase: "set", setter: null, setterJoined: null, seats: [], sit: null,
    sitCards: [], sitPile: [], sitLang: null, sitCount: 0, order: [], tally: [], winners: [], scores: {}, names: {}, faces: {}, deadline: 0, log: [] };
  gmStartRound(g); return g;
}
function gmTick(g) {
  if (!g || g.phase === "over") return false;
  if (Object.keys(P).filter(present).length < 3) { gmEndGame(g); return true; }
  const late = g.deadline && gmNow() >= g.deadline;
  if (["set", "search", "vote"].includes(g.phase) && !present(g.setter)) { gmSkipRound(g, `@${nameOf(g.setter)} left, so the round was skipped.`); return true; }
  if (g.phase === "set") {
    const sit = gmAction(g, g.setter, "sit");
    if (sit && (!sit.photo || gmPhoto(g, sit))) { gmToSearch(g, sit); return true; }
    if (late) {
      if (g.sitCards.length) gmToSearch(g, { text: g.sitCards[Math.floor(Math.random() * g.sitCards.length)], photo: false });
      else gmSkipRound(g, "No situation was set in time, so the round was skipped.");
      return true;
    }
  } else if (g.phase === "search") {
    const others = g.seats.filter(pid => pid !== g.setter && present(pid)), subs = others.filter(pid => gmAction(g, pid, "gif"));
    if (late || subs.length === others.length) {
      if (!subs.length) gmSkipRound(g, "Nobody found a GIF in time, so the round was skipped.");
      else {
        g.order = shuffle(subs.map(pid => ({ pid, gif: gmAction(g, pid, "gif") }))); g.tally = g.order.map(() => 0);
        if (subs.length === 1) gmResult(g, [0]);
        else { g.phase = "vote"; g.deadline = settings().gmVote ? gmNow() + settings().gmVote * 1000 : 0; }
      }
      return true;
    }
  } else if (g.phase === "vote") {
    const voters = g.seats.filter(pid => present(pid) && g.order.some(a => a.pid !== pid));
    if (late || voters.every(pid => gmAction(g, pid, "vote") !== null)) {
      g.tally = g.order.map(() => 0);
      for (const pid of voters) { const k = gmAction(g, pid, "vote"); if (k !== null) g.tally[k]++; }
      const eligible = g.order.map((a, k) => k).filter(k => present(g.order[k].pid));
      const max = Math.max(0, ...eligible.map(k => g.tally[k]));
      gmResult(g, max ? eligible.filter(k => g.tally[k] === max) : []); return true;
    }
  } else if (g.phase === "result") {
    if (!g.deadline) { if (!settings().next) return false; g.deadline = gmNow() + settings().next * 1000; return true; }
    if (late) { gmStartRound(g); return true; }
  }
  return false;
}
GAMES.gm = { id: "gm", name: "GIF Me", min: 3, ownsMin: true, defaults: { gmSearch: 90, gmVote: 30 }, check: gmCheck, start: gmStart, tick: gmTick,
  render: g => gmRender(g), clock: (g, left) => (typeof gmClock === "function" ? gmClock(g, left) : null),
  next: g => { if (g.phase === "result") gmStartRound(g); }, skip: g => gmSkipRound(g, "The host skipped this round.") };
