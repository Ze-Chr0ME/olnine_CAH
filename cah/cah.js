/* ---------- card packs ---------- */
function allPacks() {
  const list = Object.entries(packs).map(([id, p]) => ({ id, ...p }))
    .filter(p => typeof p.name === "string" && Array.isArray(p.black) && Array.isArray(p.white))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(p => ({ ...p, kind: "custom" }));
  return [...BUILTIN_PACKS, ...list];
}
const packById = id => allPacks().find(p => p.id === id);
const packBy = p => p.kind === "nsfw" ? "Unofficial" : p.builtin ? "Official" : `by @${esc(p.byName || "anonymous")}`;
/* Card counts for the lobby summary, counted the same way buildDeck counts them (before any size trimming). */
function deckCounts(ids) {
  const b = new Set(), w = new Set();
  for (const id of ids) { const p = packById(id); if (!p) continue; p.black.forEach(c => b.add(cleanCard(c))); p.white.forEach(c => w.add(cleanCard(c))); }
  b.delete(""); w.delete("");
  return { black: b.size, white: w.size };
}
/* lang -> "loading" | "failed" | { packId: { black, white } }, index-aligned with BUILTIN_PACKS; null keeps the English card */
const tr = {};
function loadLang(lang) {
  if (!LANGS[lang] || lang === "en" || tr[lang]) return;
  tr[lang] = "loading";
  fetch(`i18n/cards.${lang}.json`).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(d => { tr[lang] = d; }, () => { tr[lang] = "failed"; })
    .then(() => { if (L && L.status === "lobby") render(); });
}
function buildDeck(ids, lang) {
  let white = [], black = [];
  const t = lang && typeof tr[lang] === "object" ? tr[lang] : {};
  const text = (p, k) => t[p.id] ? p[k].map((c, i) => t[p.id][k][i] ?? c) : p[k];
  for (const id of ids) {
    const p = packById(id);
    if (!p) continue;
    white.push(...text(p, "white").map(cleanCard).filter(Boolean));
    black.push(...text(p, "black").map(cleanCard).filter(Boolean));
  }
  white = shuffle(uniq(white)); black = shuffle(uniq(black));
  /* keep the lobby document well under the store's 256 KiB limit */
  while (JSON.stringify(white).length + JSON.stringify(black).length > 150000) {
    white = white.slice(0, Math.floor(white.length * .85)); black = black.slice(0, Math.floor(black.length * .85));
  }
  return { white, black };
}
async function submitCards() {
  const g = L.game;
  if (!g || g.phase !== "pick" || selected.length !== need(g.black)) return;
  const hand = g.hands[ME] || [];
  const cards = selected.map(i => hand[i]);
  selected = [];
  try { await myRef().update({ sub: { gid: g.gid, round: g.round, cards } }); } catch (e) { writeError(e); }
  render();
}
async function awardPick() {
  const g = L.game;
  if (!g || g.phase !== "judge" || g.czar !== ME || czarPick == null || revealedOf(g).length < g.order.length) return;
  try { await myRef().update({ pick: { gid: g.gid, round: g.round, k: czarPick } }); } catch (e) { writeError(e); }
}
/* The czar flips submissions face up one at a time; the list lives on the czar's own seat so every table sees it. */
let myReveal = { key: "", ks: [] };
function revealedOf(g) {
  const key = g.gid + ":" + g.round, r = P[g.czar] && P[g.czar].reveal;
  const ks = r && r.gid === g.gid && r.round === g.round && Array.isArray(r.ks) ? r.ks.slice() : [];
  if (g.czar === ME && myReveal.key === key) for (const k of myReveal.ks) if (!ks.includes(k)) ks.push(k);
  return ks.filter(k => Number.isInteger(k) && k >= 0 && k < g.order.length);
}
async function revealSub(k) {
  const g = L.game;
  if (!g || g.phase !== "judge" || g.czar !== ME) return;
  const ks = revealedOf(g);
  if (ks.includes(k)) return;
  ks.push(k);
  myReveal = { key: g.gid + ":" + g.round, ks };
  try { await myRef().update({ reveal: { gid: g.gid, round: g.round, ks } }); } catch (e) { writeError(e); }
}
/* The draw and discard piles are most of a game's size and only the host reads them, so they go in
   lobbies/<code>/deck/piles instead of the lobby document every player downloads on every change.
   If the server's rules don't allow that document yet, they stay in the lobby document as before. */
const PILES = ["white", "blacks", "whiteDiscard", "blackDiscard"];
const piled = g => Array.isArray(g.white);
let pilesSig = "", inlinePiles = false, pilesLoading = false;
async function savePiles(c, body) {
  const g = body.game;
  if (inlinePiles || !g || (g.type || "cah") !== "cah" || !piled(g)) return;
  const piles = { gid: g.gid };
  for (const k of PILES) piles[k] = g[k];
  const sig = c + JSON.stringify(piles);
  if (sig !== pilesSig) {
    try { await db.doc(`lobbies/${c}/deck/piles`).set(piles); pilesSig = sig; }
    catch (e) { if (e && e.code === "permission-denied") { inlinePiles = true; return; } throw e; }
  }
  for (const k of PILES) delete g[k];
}
/* A new host fetches the piles; if they're missing, it rebuilds them from the packs minus the cards in play. */
async function loadPiles() {
  if (pilesLoading || !L || !L.game) return;
  pilesLoading = true;
  const c = code, gid = L.game.gid;
  let d = null;
  try { const s = await db.doc(`lobbies/${c}/deck/piles`).get(); d = s.exists ? s.data() : null; } catch {}
  pilesLoading = false;
  const g = L && L.game;
  if (code !== c || !isHost() || !g || g.gid !== gid || piled(g)) return;
  if (d && d.gid === gid && PILES.every(k => Array.isArray(d[k]))) for (const k of PILES) g[k] = d[k];
  else {
    const s = settings(), deck = buildDeck(s.packs || [], s.lang), held = new Set(Object.values(g.hands).flat());
    Object.assign(g, { white: deck.white.filter(x => !held.has(x)), blacks: deck.black, whiteDiscard: [], blackDiscard: [] });
  }
  pilesSig = "";
  hostTick();
}
function draw(g, pile, discard) {
  if (!g[pile].length) { g[pile] = shuffle(g[discard]); g[discard] = []; }
  return g[pile].pop();
}
function subOf(pid) {
  const g = L.game, s = P[pid] && P[pid].sub;
  if (!s || s.gid !== g.gid || s.round !== g.round || !Array.isArray(s.cards) || s.cards.length !== need(g.black)) return null;
  const hand = (g.hands[pid] || []).slice();
  for (const c of s.cards) { const i = hand.indexOf(c); if (i < 0) return null; hand.splice(i, 1); }
  return s.cards;
}
function startRound(g) {
  const s = settings();
  if (s.rounds && g.round >= s.rounds) return endGame(g);
  if (g.black) g.blackDiscard.push(g.blackRaw || g.black);
  for (const pid of Object.keys(g.hands)) if (!P[pid]) { g.whiteDiscard.push(...g.hands[pid]); delete g.hands[pid]; }
  const seats = Object.keys(P).filter(present).sort(byJoined);
  const prev = g.czarJoined ?? -1;
  const czar = seats.find(pid => (P[pid].joined || 0) > prev) || seats[0];
  Object.assign(g, { seats, czar, czarJoined: (P[czar] && P[czar].joined) || 0, round: g.round + 1, phase: "pick", order: [], winner: null, randomWin: false,
    deadline: s.pickTime ? Date.now() + s.pickTime * 1000 : 0 });
  g.blackRaw = draw(g, "blacks", "blackDiscard");
  g.black = namePlayer(g.blackRaw, seats);
  for (const pid of seats) {
    const h = g.hands[pid] || (g.hands[pid] = []);
    while (h.length < g.hand) { const c = draw(g, "white", "whiteDiscard"); if (c == null) break; h.push(c); }
    g.scores[pid] ??= 0;
    g.names[pid] = P[pid].name;
    (g.faces ||= {})[pid] = P[pid].face || null;
  }
}
/* Fills each [player] in a prompt with one random seated player (underscores stripped so a name can't add blanks). */
function namePlayer(text, seats) {
  if (text == null || !text.includes("[player]")) return text;
  const pid = seats[Math.floor(Math.random() * seats.length)];
  const name = String(nameOf(pid)).replace(/_/g, "");
  return text.replaceAll("[player]", () => name);
}
function discardOrder(g) { for (const s of g.order) g.whiteDiscard.push(...s.cards); }
function skipRound(g, why) {
  if (g.phase === "judge") discardOrder(g);
  g.log.unshift({ h: "-------", who: null, what: why }); g.log = g.log.slice(0, 7);
  startRound(g);
}
/* Moves to judging. `late` players ran out of time: the timer plays random cards from their hand. */
function toJudge(g, pids, late = []) {
  const n = need(g.black);
  const played = pids.map(pid => ({ pid, cards: subOf(pid) }));
  for (const pid of late) {
    const h = g.hands[pid] || [];
    if (h.length >= n) played.push({ pid, cards: shuffle(h).slice(0, n), auto: true });
  }
  if (!played.length) return false;
  g.order = shuffle(played);
  for (const s of g.order) for (const c of s.cards) { const h = g.hands[s.pid]; h.splice(h.indexOf(c), 1); }
  const t = settings().judgeTime;
  Object.assign(g, { phase: "judge", deadline: t ? Date.now() + t * 1000 : 0 });
  return true;
}
function award(g, k, random = false) {
  const s = g.order[k];
  g.winner = s.pid; g.randomWin = random; g.scores[s.pid] = (g.scores[s.pid] || 0) + 1;
  g.log.unshift({ h: "R" + g.round, who: s.pid, what: s.cards.join(" / ") });
  g.log = g.log.slice(0, 7);
  discardOrder(g);
  g.deadline = 0;
  if (g.scores[s.pid] >= settings().target) endGame(g, [s.pid]);
  else g.phase = "result";
}
/* Ends on the target score (one champion) or the round limit (everyone tied for the top score). */
function endGame(g, champions) {
  if (!champions) {
    const top = Math.max(0, ...Object.values(g.scores));
    champions = top ? Object.keys(g.scores).filter(pid => g.scores[pid] === top) : [];
  }
  Object.assign(g, { phase: "over", champions, deadline: 0 });
  L.status = "over";
}
let nextTimer = null, nextKey = "";
function scheduleNext(g) {
  const key = g.gid + ":" + g.round, delay = settings().next;
  if (nextKey === key || !delay) return;
  nextKey = key; clearTimeout(nextTimer);
  nextTimer = setTimeout(() => {
    const cur = L && L.game;
    if (isHost() && cur && cur.gid + ":" + cur.round === key && cur.phase === "result" && piled(cur)) { startRound(cur); commit(); }
  }, delay * 1000);
}
function cahCheck(players, s) {
  const deck = buildDeck(s.packs || [], s.lang), want = players.length * (s.hand + 1);
  if (players.length < curGame().min) return { ok: false, why: `Waiting for players: ${players.length} of ${curGame().min} needed.` };
  if (s.lang && s.lang !== "en") {
    loadLang(s.lang);
    if (tr[s.lang] === "loading") return { ok: false, why: `Loading the ${LANGS[s.lang]} cards…` };
    if (tr[s.lang] === "failed") return { ok: false, why: `Couldn't load the ${LANGS[s.lang]} cards. Reload the page or pick English.` };
  }
  if (!deck.black.length) return { ok: false, why: "The selected packs have no black cards." };
  if (deck.white.length < want) return { ok: false, why: `The selected packs need at least ${want} white cards for ${players.length} players with ${s.hand}-card hands.` };
  return { ok: true, data: deck };
}
function cahStart(players, s, deck) {
  const g = { type: "cah", faces: {}, gid: rid(8), round: 0, hand: s.hand, czar: null, czarJoined: null, seats: [], black: null, phase: "pick", order: [], winner: null,
    hands: {}, scores: {}, names: {}, log: [], white: deck.white, whiteDiscard: [], blacks: deck.black, blackDiscard: [] };
  startRound(g);
  return g;
}
function blackCard(text, cards) {
  let i = 0;
  let body = esc(text).replace(/____/g, () => {
    const c = cards && cards[i++];
    return c ? `<mark>${esc(trimDot(c))}</mark>` : `<span class="blank" role="img" aria-label="blank"></span>`;
  });
  if (!blanks(text)) body += cards && cards[0] ? `<br><mark>${esc(cards[0])}</mark>` : "";
  const n = need(text);
  return `<article class="card black"><p class="card-text">${body}</p>
    <footer class="card-meta">${MAKER}${n > 1 ? `<span class="pick">Pick <b>${n}</b></span>` : ""}</footer></article>`;
}
function whiteCard(text, { tag = "div", attrs = "", badge = "", cls = "", i = 0 } = {}) {
  return `<${tag} class="card white ${cls}" style="--i:${i}" ${attrs}><span class="card-text">${esc(text)}</span>
    <span class="card-meta">${MAKER}</span>${badge}</${tag}>`;
}
/* The small three-card mark printed at the foot of every card */
const MAKER = `<span class="maker"><svg viewBox="0 0 16 16" aria-hidden="true" fill="var(--card-fill)" stroke="currentColor" stroke-width="1.2">
  <rect x="2.2" y="3.4" width="6.4" height="9" rx="1" transform="rotate(-16 5.4 7.9)"/><rect x="4.8" y="2.8" width="6.4" height="9" rx="1"/>
  <rect x="7.4" y="3.4" width="6.4" height="9" rx="1" transform="rotate(16 10.6 7.9)"/></svg>Party Games</span>`;
/* Home page: a random prompt with a random answer next to it, from the official packs */
function dealHero() {
  const official = BUILTIN_PACKS.filter(p => p.kind !== "edition" && p.kind !== "nsfw");
  const prompts = official.flatMap(p => p.black).filter(t => need(t) === 1 && t.length < 110);
  const answers = official.flatMap(p => p.white).filter(t => t.length < 70);
  if (!prompts.length || !answers.length) return;
  const pick = a => cleanCard(a[Math.floor(Math.random() * a.length)]);
  $("heroCards").innerHTML = blackCard(pick(prompts), null) + whiteCard(pick(answers));
  const d = $("heroDeal");
  d.classList.remove("fresh"); void d.offsetWidth; d.classList.add("fresh");
}
function settingsNote(s) {
  return [
    s.rounds ? `First to ${s.target} points, or the top score after ${s.rounds} rounds.` : `First to ${s.target} points wins.`,
    s.pickTime ? `${s.pickTime}s to pick; the timer plays random cards for anyone too slow.` : "No time limit to pick.",
    s.judgeTime ? `${s.judgeTime}s for the czar, then a random submission wins.` : "No time limit for the czar."
  ].join(" ");
}
function renderCAH(g) {
  if (!g) return;
  const phase = g.phase, n = need(g.black), czar = g.czar;
  const iAmCzar = czar === ME, seated = g.seats.includes(ME), host = isHost();
  const mySub = P[ME] && P[ME].sub && P[ME].sub.gid === g.gid && P[ME].sub.round === g.round ? P[ME].sub.cards : null;
  const subbed = pid => phase === "pick" ? (pid === ME ? !!mySub : !!subOf(pid)) : g.order.some(s => s.pid === pid);
  let hand = (g.hands[ME] || []).slice();
  if (phase === "pick" && mySub) for (const c of mySub) { const i = hand.indexOf(c); if (i >= 0) hand.splice(i, 1); }
  selected = selected.filter(i => i < hand.length);
  const key = g.gid + g.round + phase;
  const fresh = key !== lastKey;
  if (fresh) { lastKey = key; if (phase !== "judge") czarPick = null; }

  const cfg = settings();
  $("roundInfo").textContent = `Round ${g.round}${cfg.rounds ? ` of ${cfg.rounds}` : ""} · first to ${cfg.target}`;
  $("rulesLine").textContent = `${settingsNote(cfg)} ${g.hand}-card hands.`;
  updateTimer();

  /* who the czar is looking at, from their presence */
  let reading = -1;
  if (phase === "judge" && !iAmCzar && room) {
    const peer = room.peers().find(p => p.presence && p.presence.pid === czar && p.presence.lobby === code);
    const look = peer && peer.presence.look;
    if (look && look.gid === g.gid && look.round === g.round && Number.isInteger(look.k)) reading = look.k;
  }
  /* which submissions the czar has flipped face up, and when each flip reached this table */
  const shown = phase === "judge" ? revealedOf(g) : g.order.map((_, k) => k);
  if (phase === "judge" && !shown.includes(reading)) reading = shown[shown.length - 1] ?? -1;
  const flipKey = g.gid + ":" + g.round;
  if (flipSeen.key !== flipKey) flipSeen = { key: flipKey, at: {} };
  for (const k of shown) flipSeen.at[k] ??= phase === "judge" ? Date.now() : 0;

  /* black card, previewing whatever is being considered */
  let fill = null;
  if (phase === "pick" && !iAmCzar && seated) fill = mySub || selected.map(i => hand[i]);
  else if (phase === "judge") {
    const k = iAmCzar && shown.includes(czarPick) ? czarPick : reading;
    fill = g.order[k] ? g.order[k].cards : null;
  }
  else if (phase === "result" || phase === "over") { const w = g.order.find(s => s.pid === g.winner); fill = w ? w.cards : null; }
  $("stage").classList.toggle("fresh", fresh && phase === "pick");
  $("blackCard").innerHTML = blackCard(g.black, fill);

  /* status line */
  const waiting = g.seats.filter(pid => pid !== czar && present(pid) && !subbed(pid));
  const pickWord = n === 1 ? "a card" : `${n} cards`;
  let status = "";
  if (phase === "pick") {
    if (!seated) status = `You joined mid-round. You'll be dealt in next round. ${at(czar)} is judging this one.`;
    else if (iAmCzar) status = `You are the Card Czar this round. Everyone else is picking ${pickWord}; you choose the winner.`;
    else if (!mySub) status = `Pick ${n === 1 ? "a card" : `${n} cards, in order,`} to complete the prompt. ${at(czar)} is judging this round.`;
    else status = waiting.length ? `Submitted. Waiting on ${waiting.map(at).join(", ")}.` : `Submitted. Shuffling the submissions<span class="dots"></span>`;
  } else if (phase === "judge") {
    const left = g.order.length - shown.length;
    if (iAmCzar) status = left ? `All submissions are in. Flip them over one at a time; everyone sees each card as you reveal it.` : `Every card is face up. Pick the funniest.`;
    else status = left ? `${at(czar)} is revealing the submissions, ${shown.length} of ${g.order.length} so far<span class="dots"></span>` : `${at(czar)} is choosing a winner<span class="dots"></span>`;
  } else if (phase === "result") {
    const w = g.winner, to = w === ME ? "you" : at(w);
    const next = cfg.rounds && g.round >= cfg.rounds ? " That was the last round." : cfg.next ? " Next round starts in a few seconds."
      : host ? " Click Next round when everyone is ready." : " Waiting for the host to start the next round.";
    if (g.randomWin) status = `Time ran out for ${iAmCzar ? "you" : at(czar)}, so a random submission won. +1 to ${to}.`;
    else status = w === ME ? `${at(czar)} picked your card. You get a point.` : `${iAmCzar ? "You" : at(czar)} picked ${at(w)}'s card. +1 to ${at(w)}.`;
    status += next;
  } else {
    const champs = g.champions || [g.winner], pts = plural(champs.length ? g.scores[champs[0]] || 0 : 0, "point", "points");
    if (!champs.length) status = `The round limit is up and nobody scored. Everyone loses.`;
    else if (champs.length === 1) status = champs[0] === ME ? `You won the game with ${pts}. You monster.` : `${at(champs[0])} won the game with ${pts}.`;
    else {
      const names = champs.slice().sort((x, y) => (y === ME) - (x === ME)).map(pid => pid === ME ? "You" : at(pid));
      status = `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} tied for the win with ${pts}.`;
    }
  }
  $("status").innerHTML = status;

  /* face-down pile during picking */
  if (phase === "pick") {
    const others = g.seats.filter(pid => pid !== czar);
    const slots = others.map(pid => subbed(pid) ? `<div class="slot down">Party<br>Games.</div>` : `<div class="slot" aria-hidden="true"></div>`).join("");
    $("pile").innerHTML = `<div class="pile-label">${others.filter(subbed).length} of ${others.length} played</div><div class="slots">${slots}</div>`;
  } else $("pile").innerHTML = "";

  /* scoreboard: everyone seated, everyone waiting for next round, and anyone who left with points */
  const ids = uniq(g.seats.concat(Object.keys(P).sort(byJoined), Object.keys(g.scores).filter(pid => g.scores[pid] > 0)));
  const target = cfg.target;
  fetchPeople(ids.map(pid => P[pid] && P[pid].uid));
  $("scores").innerHTML = ids.map(pid => {
    const score = g.scores[pid] || 0, left = !P[pid], away = !left && (gone(pid) || !online(pid));
    const won = phase === "over" ? (g.champions || [g.winner]).includes(pid) : phase === "result" && g.winner === pid;
    let chip;
    if (won) chip = `<span class="chip won">${phase === "over" ? "winner" : "won"}</span>`;
    else if (left) chip = `<span class="chip">left</span>`;
    else if (pid === czar && g.seats.includes(pid)) chip = `<span class="chip czar">czar</span>`;
    else if (!g.seats.includes(pid)) chip = `<span class="chip">next round</span>`;
    else if (away) chip = `<span class="chip">away</span>`;
    else if (phase === "pick") chip = subbed(pid) ? `<span class="chip done">played</span>` : `<span class="chip">${pid === ME ? "your move" : `thinking<span class="dots"></span>`}</span>`;
    else chip = "";
    const cells = Array.from({ length: target }, (_, k) => `<span class="cell ${k < score ? "l" + Math.min(4, 1 + Math.floor(k * 4 / target)) : ""}"></span>`).join("");
    const tags = [pid === ME ? "you" : "", pid === L.host ? "host" : ""].filter(Boolean).join(", ");
    return `<li class="player ${won ? "is-winner" : ""} ${left || away ? "is-away" : ""}">
      ${avHTML(lookOf(pid), "md")}
      <span class="pname">@${esc(nameOf(pid))}${tags ? ` <em>(${tags})</em>` : ""}</span>
      <span class="pstate">${chip}</span>
      <span class="graph" role="img" aria-label="${score} of ${target} points">${cells}</span>
      <span class="pts">${score}/${target}</span></li>`;
  }).join("");

  $("log").innerHTML = g.log.length
    ? g.log.map(l => `<li><span class="h">${esc(l.h)}</span><span class="t">${l.who ? `<b>@${esc(nameOf(l.who))}</b> ` : ""}${esc(l.what)}</span></li>`).join("")
    : `<li class="empty">No winners yet. Winning cards land here.</li>`;

  $("hostTools").innerHTML = host
    ? (phase === "over" ? "" : `<button class="btn small icon" type="button" data-act="skip" data-tip="Skip round" aria-label="Skip round">${ICONS.skip}</button><button class="btn small danger icon" type="button" data-act="end" data-tip="End game" aria-label="End game">${ICONS.stop}</button>`)
    : !room ? `<button class="btn small" type="button" data-act="take-over">${ICONS.crown}Host not responding? Take over</button>` : "";

  /* tray: hand while picking, submissions afterwards */
  const tray = $("tray");
  $("trayWrap").classList.toggle("fresh", fresh);
  let title, hint = "", action = "";
  if (phase === "pick") {
    title = "Your hand";
    const locked = !seated || iAmCzar || !!mySub;
    if (!seated) hint = "You'll get cards when the next round starts.";
    else if (iAmCzar) hint = "You sit this one out while you judge.";
    else if (mySub) hint = "Your cards are in. New cards are dealt at the start of the next round.";
    else hint = n === 1 ? "Tap a card to preview it on the prompt." : `Tap ${n} cards in the order they should fill the blanks.`;
    tray.className = "cards";
    tray.innerHTML = hand.map((c, i) => {
      const pos = selected.indexOf(i);
      return whiteCard(c, {
        tag: "button", i, cls: pos >= 0 ? "selected" : "",
        attrs: `type="button" data-hand="${i}" aria-pressed="${pos >= 0}" ${locked ? "disabled" : ""}`,
        badge: pos >= 0 && n > 1 ? `<span class="badge"><span>${pos + 1}</span></span>` : ""
      });
    }).join("") || `<p class="empty">No cards yet.</p>`;
    if (!locked) action = `<button class="btn primary" type="button" data-act="submit" ${selected.length === n ? "" : "disabled"}>${ICONS.send}Submit${n > 1 ? ` ${selected.length}/${n}` : ""}</button>`;
  } else {
    title = "Submissions";
    const canPick = phase === "judge" && iAmCzar;
    const awarded = canPick && P[ME] && P[ME].pick && P[ME].pick.gid === g.gid && P[ME].pick.round === g.round;
    const hidden = g.order.length - shown.length;
    if (canPick) hint = awarded ? "Point awarded. Waiting for the host to record it."
      : hidden ? `Tap a face-down card to reveal it to the table. ${plural(hidden, "card", "cards")} left.` : "Tap a submission to preview it, then award the point.";
    else if (phase === "judge") hint = hidden ? "The czar flips the cards over one at a time. Submissions stay anonymous until the czar decides." : "Submissions stay anonymous until the czar decides.";
    else hint = "Here is who played what.";
    tray.className = "subs";
    tray.innerHTML = g.order.map((s, k) => {
      const up = shown.includes(k), since = Date.now() - (flipSeen.at[k] || 0);
      const cls = [canPick ? "can-pick" : "", canPick && czarPick === k ? "chosen" : "",
        phase === "judge" && !iAmCzar && reading === k ? "reading" : "",
        up ? "" : "down", up && since < 600 ? "flipping" : "",
        phase !== "judge" && s.pid === g.winner ? "winner" : ""].join(" ");
      const by = phase === "judge" ? "" : `<span class="sub-by">${avHTML(lookOf(s.pid), "sm")}@${esc(nameOf(s.pid))}${s.pid === ME ? " (you)" : ""}${s.pid === g.winner ? ` <span class="chip won">won</span>` : ""}${s.auto ? ` <span class="chip">played by the timer</span>` : ""}</span>`;
      const inner = up
        ? s.cards.map((c, j) => whiteCard(c, { tag: "span", i: k * 2 + j })).join("") + by
        : s.cards.map(() => `<span class="card white back"><span class="card-text">Party<br>Games.</span></span>`).join("");
      const style = since < 600 ? ` style="--since:-${since}ms"` : "";
      const label = up ? "" : ` aria-label="Face-down submission ${k + 1}${canPick ? ", tap to reveal" : ""}"`;
      return canPick
        ? `<button type="button" class="sub ${cls}"${style}${label} data-sub="${k}" aria-pressed="${czarPick === k}">${inner}</button>`
        : `<div class="sub ${cls}"${style}${label}>${inner}</div>`;
    }).join("");
    if (canPick) action = `<button class="btn gold" type="button" data-act="award" ${czarPick != null && !hidden && !awarded ? "" : "disabled"}>${ICONS.trophy}Award the point</button>`;
    if (phase === "result" && host) action = `<button class="btn primary" type="button" data-act="next">Next round${ICONS.arrowR}</button>`;
    if (phase === "over") action = host ? `<button class="btn primary" type="button" data-act="again">${ICONS.arrowL}Back to lobby</button>` : `<span class="hint">Waiting for the host to start another game.</span>`;
  }
  $("trayTitle").textContent = title;
  $("trayHint").textContent = hint;
  $("trayActions").innerHTML = action;
}

function toggleCard(i) {
  const n = need(L.game.black), pos = selected.indexOf(i);
  if (pos >= 0) selected.splice(pos, 1);
  else { if (selected.length >= n) selected.shift(); selected.push(i); }
}

function cahTick(g) {
  let changed = false;
  if (!piled(g)) loadPiles();
  else if ((g.phase === "pick" || g.phase === "judge") && !present(g.czar)) {
    skipRound(g, `@${nameOf(g.czar)} left while judging, so the round was skipped.`); changed = true;
  } else if (g.phase === "pick") {
    const others = g.seats.filter(pid => pid !== g.czar);
    const waiting = others.filter(pid => present(pid) && !subOf(pid));
    const subs = others.filter(pid => subOf(pid));
    const late = g.deadline && Date.now() >= g.deadline;
    if (!waiting.length && subs.length) { toJudge(g, subs); changed = true; }
    else if (late) {
      if (!toJudge(g, subs, waiting)) skipRound(g, "Nobody played a card in time, so the round was skipped.");
      changed = true;
    }
  } else if (g.phase === "judge") {
    const pk = P[g.czar] && P[g.czar].pick;
    if (pk && pk.gid === g.gid && pk.round === g.round && Number.isInteger(pk.k) && pk.k >= 0 && pk.k < g.order.length) { award(g, pk.k); changed = true; }
    else if (g.deadline && Date.now() >= g.deadline) { award(g, Math.floor(Math.random() * g.order.length), true); changed = true; }
  } else if (g.phase === "result") scheduleNext(g);
  return changed;
}

GAMES.cah = {
  id: "cah", name: "Cards Against Humanity", min: MIN_PLAYERS,
  defaults: { rounds: 0, pickTime: 0, judgeTime: 0, hand: 7, packs: ["builtin", ...BUILTIN_PACKS.filter(p => p.kind === "nsfw").map(p => p.id)] },
  check: cahCheck, start: cahStart, tick: cahTick, render: renderCAH
};
