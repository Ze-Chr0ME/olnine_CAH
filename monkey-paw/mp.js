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
/* ---------- Monkey Paw table ---------- */
let mpChoice = null, mpLastKey = "";
const mpGranted = t => String(t || "").replace(/^\s*granted\s*,?\s*(but\s*,?)?\s*/i, "");
function mpWishCard(wish, twist) {
  return `<article class="card black wish-card"><p class="wish-lbl">${ICONS.paw}I wish</p>
    <p class="card-text">${wish ? esc(wish) : `<span class="blank" role="img" aria-label="no wish yet"></span>`}</p>
    ${twist ? `<p class="granted"><span>Granted, but</span>${esc(mpGranted(twist))}</p>` : ""}
    <footer class="card-meta">${MAKER}<span class="pick">${ICONS.paw}Monkey Paw</span></footer></article>`;
}
function mpTwistCard(text, { tag = "div", attrs = "", cls = "", i = 0 } = {}) {
  return `<${tag} class="card white twist ${cls}" style="--i:${i}" ${attrs}><span class="card-text"><span class="twist-lbl">Granted, but</span>${esc(mpGranted(text))}</span>
    <span class="card-meta">${MAKER}</span></${tag}>`;
}
function mpRender(g) {
  const phase = g.phase, w = g.wisher, iWish = w === ME, role = mpRole(), host = isHost(), cfg = settings();
  const key = g.gid + ":" + g.round + ":" + phase, fresh = key !== mpLastKey;
  if (fresh) { mpLastKey = key; mpChoice = null; }
  if (mpChoice != null && !(g.order[mpChoice] && present(g.order[mpChoice].pid))) mpChoice = null;
  const mine = mpMine(), wished = !!mpSeatText(g, ME, "wish");
  const twisted = pid => phase === "twist" ? !!mpSeatText(g, pid, "twist") : g.order.some(a => a.pid === pid);
  const others = g.seats.filter(pid => pid !== w), waiting = others.filter(pid => present(pid) && !twisted(pid));
  const won = g.order[g.winner];

  $("roundInfo").textContent = `Round ${g.round} · first to ${cfg.target}`;
  $("rulesLine").textContent = `${cfg.mpTime ? `${cfg.mpTime}s to wish and to twist.` : "No timer."} The wisher keeps the twist they'd hate most.`;
  updateTimer();

  const shown = phase === "judge" ? (iWish && g.order[mpChoice]) : (phase === "result" || phase === "over") ? won : null;
  $("stage").classList.toggle("fresh", fresh && (phase === "wish" || phase === "twist"));
  $("blackCard").innerHTML = mpWishCard(g.wish, shown && shown.text);

  let status;
  if (role === "spectator" && phase !== "over") status = `You joined mid-round. You're in from the next wish. ${at(w)} holds the paw.`;
  else if (phase === "wish") status = iWish
    ? (wished ? `Wish made. The paw curls a finger<span class="dots"></span>` : `You hold the monkey paw. Make a wish, and everyone else will make you regret it.`)
    : `${at(w)} holds the paw and is making a wish<span class="dots"></span>`;
  else if (phase === "twist") status = iWish
    ? `Your wish is being granted. ${waiting.length ? `Waiting on ${waiting.map(at).join(", ")}.` : `Collecting the twists<span class="dots"></span>`}`
    : !mine ? `Grant ${at(w)}'s wish, but make it backfire. Finish the sentence after <strong>Granted, but</strong>.`
    : waiting.length ? `Twist sent. Waiting on ${waiting.map(at).join(", ")}.` : `Twist sent. Shuffling them up<span class="dots"></span>`;
  else if (phase === "judge") status = iWish ? `Every twist is in. Keep the one you'd hate most.` : `${at(w)} is picking the cruelest twist<span class="dots"></span>`;
  else if (phase === "result") {
    const wp = won && won.pid, to = wp === ME ? "you" : at(wp);
    status = g.randomWin ? `Time ran out for ${iWish ? "you" : at(w)}, so the paw chose. +1 to ${to}.`
      : wp === ME ? `${at(w)} picked your twist. You get a point.` : `${iWish ? "You" : at(w)} picked ${at(wp)}'s twist. +1 to ${at(wp)}.`;
    status += cfg.next ? " Next wish in a few seconds." : host ? " Click Next round when everyone is ready." : " Waiting for the host to start the next round.";
  } else status = tableOverStatus(g);
  $("status").innerHTML = status;

  if (phase === "twist") {
    const slots = others.map(pid => twisted(pid) ? `<div class="slot down">Party<br>Games.</div>` : `<div class="slot" aria-hidden="true"></div>`).join("");
    $("pile").innerHTML = `<div class="pile-label">${others.filter(twisted).length} of ${others.length} twisted</div><div class="slots">${slots}</div>`;
  } else $("pile").innerHTML = "";

  tableSide(g, {
    won: pid => phase === "over" ? (g.champions || []).includes(pid) : phase === "result" && won && won.pid === pid,
    chip: pid => pid === w ? `<span class="chip czar">wisher</span>`
      : phase === "twist" ? (twisted(pid) ? `<span class="chip done">twisted</span>` : `<span class="chip">${pid === ME ? "your move" : `scheming<span class="dots"></span>`}</span>`) : "",
    empty: "No wishes ruined yet. The cruelest twists land here."
  });

  let title, hint = "", body = "", cls = "cards", action = "";
  if (phase === "wish") {
    title = iWish ? "Make a wish" : "The wish";
    if (iWish && !wished) {
      hint = g.wishCards.length ? "Take one of these or write your own." : "Write your wish.";
      body = g.wishCards.map((t, i) => `<button type="button" class="card white wish-opt" style="--i:${i}" data-mp-wish="${i}"><span class="wish-lbl">${ICONS.paw}I wish</span><span class="card-text">${esc(t)}</span><span class="card-meta">${MAKER}</span></button>`).join("")
        + composer("mpForm", key, "I wish", "…I could eat anything without getting fat.", 200);
      action = `<button class="btn primary" type="submit" form="mpForm">${ICONS.send}Make the wish</button>`;
    } else hint = iWish ? "Your wish is locked in." : `${nameOf(w)} can draw a wish or write their own.`;
  } else if (phase === "twist") {
    title = iWish ? "Your wish" : "Your twist";
    if (role === "twister" && !mine) {
      hint = "Keep it short. The wisher reads every twist without names.";
      body = composer("mpForm", key, "Granted, but", "…every calorie goes straight to your face.", 200);
      action = `<button class="btn primary" type="submit" form="mpForm">${ICONS.send}Send twist</button>`;
    } else if (mine) { hint = "Locked in. Now look innocent."; body = mpTwistCard(mine, { cls: "mine" }); }
    else hint = iWish ? "Sit tight. They're working on it." : "";
  } else {
    title = "Twists";
    const canPick = phase === "judge" && iWish;
    const picked = canPick && P[ME] && P[ME].pick && P[ME].pick.gid === g.gid && P[ME].pick.round === g.round;
    hint = canPick ? (picked ? "Done. Waiting for the host to record it." : "Tap a twist to hold it up against your wish, then keep it.")
      : phase === "judge" ? "Twists stay anonymous until the wisher decides." : "Here is who wrote what.";
    cls = "subs";
    body = g.order.map((a, k) => {
      const gone1 = !present(a.pid), c = [canPick && !gone1 ? "can-pick" : "", canPick && mpChoice === k ? "chosen" : "", phase !== "judge" && k === g.winner ? "winner" : ""].join(" ");
      const by = phase === "judge" ? "" : `<span class="sub-by">${avHTML(lookOf(a.pid), "sm")}@${esc(nameOf(a.pid))}${a.pid === ME ? " (you)" : ""}${k === g.winner ? ` <span class="chip won">won</span>` : ""}</span>`;
      const inner = mpTwistCard(a.text, { tag: "span", i: k }) + by;
      return canPick && !gone1 ? `<button type="button" class="sub ${c}" data-mp-sub="${k}" aria-pressed="${mpChoice === k}">${inner}</button>` : `<div class="sub ${c}">${inner}</div>`;
    }).join("");
    if (canPick) action = `<button class="btn gold" type="button" data-act="mp-pick" ${mpChoice != null && !picked ? "" : "disabled"}>${ICONS.trophy}Keep this one</button>`;
    if (phase === "result" && host) action = `<button class="btn primary" type="button" data-act="next">Next round${ICONS.arrowR}</button>`;
    if (phase === "over") action = host ? `<button class="btn primary" type="button" data-act="again">${ICONS.arrowL}Back to lobby</button>` : `<span class="hint">Waiting for the host to start another game.</span>`;
  }
  $("trayWrap").classList.toggle("fresh", fresh);
  $("trayTitle").textContent = title;
  $("trayHint").textContent = hint;
  $("trayActions").innerHTML = action;
  keepDraft(() => { $("tray").className = cls; $("tray").innerHTML = body; });
}
document.addEventListener("click", e => {
  const g = L && L.game;
  if (!g || g.type !== "mp") return;
  const b = e.target.closest("[data-mp-wish], [data-mp-sub], [data-act='mp-pick']");
  if (!b || b.disabled) return;
  if (b.dataset.mpWish != null) mpTakeWish(+b.dataset.mpWish);
  else if (b.dataset.mpSub != null) { mpChoice = +b.dataset.mpSub; render(); }
  else if (mpChoice != null) mpPick(mpChoice);
});
document.addEventListener("submit", e => {
  const g = L && L.game;
  if (e.target.id !== "mpForm" || !g || g.type !== "mp") return;
  e.preventDefault();
  const t = e.target.querySelector("textarea").value;
  if (!mpText(t)) return notice("Write something first.", { error: true });
  (g.phase === "wish" ? mpSendWish : mpSendTwist)(t);
});
GAMES.mp = { id: "mp", name: "Monkey Paw", min: 3, defaults: { mpTime: 60 }, check: mpCheck, start: mpStart, tick: mpTick, render: mpRender,
  next: g => mpStartRound(g), skip: g => mpSkipRound(g, "The host skipped this round.") };
