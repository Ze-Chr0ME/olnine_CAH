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
  if (!g || g.type !== "mp" || g.phase !== "wish" || mpRole() !== "wisher" || !value || mpSeatText(g, ME, "wish")) return;
  try { await myRef().update({ wish: { gid: g.gid, round: g.round, text: value } }); } catch (e) { writeError(e); }
}
function mpTakeWish(i) {
  const g = L && L.game;
  if (!g || g.type !== "mp" || !Number.isInteger(i) || i < 0 || i >= g.wishCards.length) return;
  return mpSendWish(g.wishCards[i]);
}
async function mpSendTwist(text) {
  const g = L && L.game, value = mpText(text);
  if (!g || g.type !== "mp" || g.phase !== "twist" || mpRole() !== "twister" || !value || mpSeatText(g, ME, "twist")) return;
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
  if (seats.length < 3) { mpEndGame(g); return; }
  const wisher = seats.find(pid => g.wisher && P[g.wisher] ? pid !== g.wisher && byJoined(pid, g.wisher) > 0 :
    (P[pid].joined || 0) > prev || ((P[pid].joined || 0) === prev && pid > g.wisher)) || seats[0] || null;
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
  else { g.phase = "result"; g.deadline = settings().next ? mpNow() + settings().next * 1000 : 0; }
}
function mpScheduleNext(g) {
  if (!g.deadline) {
    if (!settings().next) return false;
    g.deadline = mpNow() + settings().next * 1000; return true;
  }
  if (mpNow() < g.deadline) return false;
  mpStartRound(g); return true;
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
  if (!g || g.phase === "over") return false;
  if (Object.keys(P).filter(present).length < 3) { mpEndGame(g); return true; }
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
  } else if (g.phase === "result") return mpScheduleNext(g);
  return false;
}
/* ---------- Monkey Paw table ---------- */
/* The table reads like a cursed contract: the wish on a parchment slip, the winning twist sealed in red wax under it. */
let mpChoice = null, mpLastKey = "", mpHeld = null, mpWishPick = null;
const mpGranted = t => String(t || "").replace(/^\s*granted\s*,?\s*(but\s*,?)?\s*/i, "");
const mpLong = t => String(t || "").length > 110 ? "long" : "";
const mpRoman = n => [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]].reduce((s, [v, r]) => { while (n >= v) { s += r; n -= v; } return s; }, "");
/* A wax seal with a paw pressed into it; the scalloped rim is drawn once. */
const MP_SEAL = (() => {
  const N = 11, jit = [1.2, .4, 1.6, .7, 1.4, .2, 1.1, 1.7, .5, 1.3, .8];
  let d = "";
  for (let i = 0; i < N; i++) {
    const a = i / N * Math.PI * 2, b = (i + .5) / N * Math.PI * 2, r = 20.2 + jit[i] * .4, c = 23 + jit[i];
    d += (i ? "" : `M${(24 + r * Math.cos(a)).toFixed(1)} ${(24 + r * Math.sin(a)).toFixed(1)}`)
      + `Q${(24 + c * Math.cos(b)).toFixed(1)} ${(24 + c * Math.sin(b)).toFixed(1)} ${(24 + r * Math.cos(a + Math.PI * 2 / N)).toFixed(1)} ${(24 + r * Math.sin(a + Math.PI * 2 / N)).toFixed(1)}`;
  }
  return `<svg class="mp-seal" viewBox="0 0 48 48" aria-hidden="true"><path class="wax" d="${d}Z"/><circle class="rim" cx="24" cy="24" r="14.5"/>
    <g class="press" transform="translate(12.8 12.4) scale(1.4)"><path d="M5 11c0-1.9 1.4-3.3 3-3.3s3 1.4 3 3.3c0 1.4-.9 2.4-1.9 2.4-.6 0-.7-.4-1.1-.4s-.5.4-1.1.4C5.9 13.4 5 12.4 5 11Z"/><circle cx="3.3" cy="7.6" r="1.3"/><circle cx="6" cy="4.4" r="1.3"/><circle cx="10" cy="4.4" r="1.3"/><circle cx="12.7" cy="7.6" r="1.3"/></g></svg>`;
})();
/* The countdown face: a withered paw that curls one finger for every fifth of the time used up. */
function mpClock(g, left) {
  const s = settings(), total = (g.phase === "judge" ? s.judgeTime : g.phase === "result" ? s.next : s.mpTime) || left || 1;
  const up = Math.max(0, Math.min(5, Math.ceil(left / total * 5)));
  const F = [[8.4, 11.6, -16], [11, 10.4, -6], [13.8, 10.4, 5], [16.3, 11.6, 15], [7.4, 15.4, -64]];
  return `<svg class="mp-clock" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
    <path d="M7.4 13.4c0-2 2.2-3.4 4.9-3.4 2.6 0 4.6 1.4 4.6 3.4 0 3.6-1.6 6.6-3.3 7.8l-.3 2.3h-2.6l-.3-2.3c-1.7-1.2-3-4.2-3-7.8Z" fill="currentColor" stroke="none"/>
    ${F.map(([x, y, a], i) => `<path transform="translate(${x} ${y}) rotate(${a})" d="${i < up ? (i === 4 ? "M0 0l-.5-2.6.6-2.2" : "M0 0l.5-3.6-.6-3.6") : "M0 0l.3-1.9"}" class="${i < up ? "" : "curl"}"/>`).join("")}</svg>`;
}
function mpSlip(g, twist, state) {
  const w = g.wisher, wish = g.wish;
  const grant = twist ? `<div class="mp-grant">${MP_SEAL}<p class="${mpLong(twist.text)}"><em>Granted, but</em> ${esc(mpGranted(twist.text))}</p>
    ${state === "granted" ? `<p class="mp-by">${avHTML(lookOf(twist.pid), "sm", false)}<span>${twist.pid === ME ? "your curse" : `@${esc(nameOf(twist.pid))}'s curse`}${g.randomWin ? ", picked by the paw" : ""}</span></p>` : ""}</div>` : "";
  return `<article class="mp-slip ${state}${wish ? "" : " empty"}">
    <header class="mp-who">${avHTML(lookOf(w), "sm", false)}<span>${w === ME ? "Your wish" : `@${esc(nameOf(w))} wishes`}</span></header>
    <p class="mp-wish ${mpLong(wish)}">${wish ? esc(wish) : `<span class="mp-ink" aria-label="no wish yet"></span>`}</p>${grant}</article>`;
}
/* Game over: the champion's last wish, granted with the usual catch */
function mpCrown(g) {
  const c = g.champions || [], me = c.includes(ME), them = c.length > 1 ? "them" : me ? "you" : "them";
  const who = c.map(p => p === ME ? "you" : `@${esc(nameOf(p))}`).join(" and ");
  return `<article class="mp-slip granted over">
    <header class="mp-who">${c.map(p => avHTML(lookOf(p), "sm", false)).join("")}<span>${c.length ? (me && c.length === 1 ? "Your last wish" : `${who}'s last wish`) : "Nobody's last wish"}</span></header>
    <p class="mp-wish">${c.length ? "I wish I'd win." : "I wish somebody would win."}</p>
    <div class="mp-grant">${MP_SEAL}<p><em>Granted, but</em> ${c.length ? `now everyone at this table wants ${them} dead.` : "nobody did."}</p></div></article>`;
}
function mpRender(g) {
  const phase = g.phase, w = g.wisher, iWish = w === ME, role = mpRole(), host = isHost(), cfg = settings();
  const key = g.gid + ":" + g.round + ":" + phase, fresh = key !== mpLastKey;
  if (fresh) { mpLastKey = key; mpChoice = null; mpWishPick = null; }
  if (mpChoice != null && !(g.order[mpChoice] && present(g.order[mpChoice].pid))) mpChoice = null;
  const mine = mpMine(), wished = !!mpSeatText(g, ME, "wish");
  const twisted = pid => phase === "twist" ? !!mpSeatText(g, pid, "twist") : g.order.some(a => a.pid === pid);
  const others = g.seats.filter(pid => pid !== w), live = others.filter(present);
  const won = g.order[g.winner], wp = won && won.pid, canPick = phase === "judge" && iWish;
  const picked = canPick && !!P[ME] && !!P[ME].pick && P[ME].pick.gid === g.gid && P[ME].pick.round === g.round;

  $("roundInfo").textContent = `Round ${g.round} · first to ${cfg.target}`;
  $("rulesLine").textContent = `${cfg.mpTime ? `${cfg.mpTime}s to wish and to twist.` : "No timer."} The wisher keeps the twist they'd hate most.`;
  updateTimer();

  /* The slip: the wish, and under it the twist the wisher is holding up, or the one that won */
  const held = canPick && mpChoice != null && !(typeof matchMedia === "function" && matchMedia("(max-width: 640px)").matches) ? g.order[mpChoice] : null;   // on a phone the choice stays in the list, so the list doesn't jump
  const shown = held || ((phase === "result" || phase === "over") ? won : null);
  $("stage").classList.toggle("fresh", fresh);
  $("stage").classList.toggle("swap", !!held && mpHeld !== mpChoice);
  mpHeld = held ? mpChoice : null;
  $("blackCard").innerHTML = phase === "over" ? mpCrown(g) : mpSlip(g, shown, held ? "held" : shown ? "granted" : phase);

  let status;
  if (role === "spectator" && !["result", "over"].includes(phase)) status = `<b class="cue">Watching.</b> You're in from the next wish.`;
  else if (phase === "wish") status = iWish ? (wished ? `<b class="cue">Wish made.</b>` : `<b class="cue">Make a wish.</b> The others will twist it.`)
    : `${at(w)} is making a wish<span class="dots"></span>`;
  else if (phase === "twist") status = iWish ? `<b class="cue">Brace yourself.</b> The table is twisting your wish.`
    : mine ? `<b class="cue">Sealed.</b> Now look innocent.` : `<b class="cue">Twist it.</b> Grant the wish, but make it backfire.`;
  else if (phase === "judge") status = iWish ? (picked ? `<b class="cue">Kept.</b>` : `<b class="cue">Choose your curse.</b> Keep the one you'd hate most.`)
    : `${at(w)} is choosing a curse<span class="dots"></span>`;
  else if (phase === "result") {
    status = g.randomWin ? `<b class="cue">The paw chose.</b> Time ran out. +1 to ${wp === ME ? "you" : at(wp)}.`
      : `<b class="cue">${wp === ME ? "Your twist wins." : `${at(wp)} wins the round.`}</b>`;
    if (!cfg.next) status += host ? " Start the next round when you're ready." : " Waiting for the host.";
  } else status = `<span class="over">${tableOverStatus(g)}</span>`;
  $("status").innerHTML = status;

  $("pile").innerHTML = phase === "twist" ? tableRoster(live, twisted, "Twists sealed", MP_SEAL) : "";

  tableSide(g, {
    won: pid => phase === "over" ? (g.champions || []).includes(pid) : phase === "result" && wp === pid,
    chip: pid => pid === w && phase !== "over" ? `<span class="chip czar">wisher</span>`
      : phase === "twist" ? (twisted(pid) ? `<span class="chip done">sealed</span>` : `<span class="chip">${pid === ME ? "your move" : `scheming<span class="dots"></span>`}</span>`) : "",
    empty: "No wishes ruined yet. The cruelest twists land here."
  });

  let title = "", hint = "", body = "", action = "", idle = false;
  if (phase === "wish") {
    if (iWish && !wished) {
      title = "Make a wish";
      hint = g.wishCards.length ? "Pick one, or write your own." : "";
      body = (g.wishCards.length ? `<div class="mp-opts">${g.wishCards.map((t, i) => `<button type="button" class="mp-opt${mpWishPick === i ? " on" : ""}" style="--i:${i}" data-mp-wish="${i}" aria-pressed="${mpWishPick === i}" title="Choose this wish">
        <span class="mp-n">${mpRoman(i + 1)}</span><p class="${mpLong(t)}">${esc(t)}</p></button>`).join("")}</div>` : "")
        + composer("mpForm", key, g.wishCards.length ? "Or write your own" : "I wish", "I wish I could eat anything without getting fat.", 200);
      action = `<button class="btn primary" type="submit" form="mpForm">${ICONS.send}Make the wish</button>`;
    } else idle = true;
  } else if (phase === "twist") {
    if (role === "twister" && !mine) {
      title = "Twist it";
      body = composer("mpForm", key, "Granted, but", "every calorie goes straight to your face.", 200);
      action = `<button class="btn primary" type="submit" form="mpForm">${ICONS.send}Seal it</button>`;
    } else if (mine) {
      title = "Your twist";
      hint = "Anonymous until the wisher chooses.";
      body = `<div class="mp-twists one"><div class="mp-twist mine"><p class="${mpLong(mine)}"><em>Granted, but</em> ${esc(mpGranted(mine))}</p>${MP_SEAL}</div></div>`;
    } else idle = true;
  } else {
    title = phase === "judge" ? "The twists" : "Who wrote what";
    hint = canPick ? (picked ? "Kept. The paw is granting it." : "Tap the one you'd hate most, then keep it.") : phase === "judge" ? `Anonymous until @${nameOf(w)} chooses.` : "";
    body = `<ol class="mp-twists">${g.order.map((a, k) => {
      const gone1 = !present(a.pid), tap = canPick && !gone1 && !picked, open = phase !== "judge";
      const cls = ["mp-twist", canPick && mpChoice === k ? "chosen" : "", open && k === g.winner ? "won" : "", open && a.pid === ME ? "mine" : "", gone1 && !open ? "gone" : ""].filter(Boolean).join(" ");
      const onSlip = phase === "result" && k === g.winner;   // the winner is already written on the slip above; here it only names its author
      const inner = `<span class="mp-n">${mpRoman(k + 1)}</span>${onSlip ? `<p class="mp-onslip">On the slip</p>` : `<p class="${mpLong(a.text)}"><em>Granted, but</em> ${esc(mpGranted(a.text))}</p>`}
        ${open ? `<span class="mp-auth">${avHTML(lookOf(a.pid), "sm", false)}${a.pid === ME ? "You" : `@${esc(nameOf(a.pid))}`}</span>` : ""}${open && k === g.winner ? MP_SEAL : ""}`;
      return `<li style="--i:${k}">${tap ? `<button type="button" class="${cls}" data-mp-sub="${k}" aria-pressed="${mpChoice === k}">${inner}</button>` : `<div class="${cls}">${inner}</div>`}</li>`;
    }).join("")}</ol>`;
    if (canPick) action = `<button class="btn primary" type="button" data-act="mp-pick" ${mpChoice != null && !picked ? "" : "disabled"}>${MP_SEAL}Keep this curse</button>`;
    if (phase === "result" && host) action = `<button class="btn primary" type="button" data-act="next">Next round${ICONS.arrowR}</button>`;
    if (phase === "over") action = host ? `<button class="btn primary" type="button" data-act="again">${ICONS.arrowL}Back to lobby</button>` : `<span class="hint">Waiting for the host to start another game.</span>`;
  }
  $("trayWrap").classList.toggle("fresh", fresh);
  $("trayWrap").classList.toggle("idle", idle);
  $("trayTitle").textContent = title;
  $("trayHint").textContent = hint;
  $("trayActions").innerHTML = action;
  keepDraft(() => { $("tray").className = "mp-tray"; $("tray").innerHTML = body; });
}
document.addEventListener("click", e => {
  const g = L && L.game;
  if (!g || g.type !== "mp") return;
  const b = e.target.closest("[data-mp-wish], [data-mp-sub], [data-act='mp-pick']");
  if (!b || b.disabled) return;
  if (b.dataset.mpWish != null) { const i = +b.dataset.mpWish; mpWishPick = mpWishPick === i ? null : i; render(); }
  else if (b.dataset.mpSub != null) { mpChoice = +b.dataset.mpSub; render(); }
  else if (mpChoice != null) mpPick(mpChoice);
});
document.addEventListener("submit", e => {
  const g = L && L.game;
  if (e.target.id !== "mpForm" || !g || g.type !== "mp") return;
  e.preventDefault();
  const t = e.target.querySelector("textarea").value;
  if (g.phase === "wish" && mpWishPick != null && !mpText(t)) return mpTakeWish(mpWishPick);
  if (!mpText(t)) return notice(g.phase === "wish" && g.wishCards.length ? "Pick a wish or write one first." : "Write something first.", { error: true });
  (g.phase === "wish" ? mpSendWish : mpSendTwist)(t);
});
GAMES.mp = { id: "mp", name: "Monkey Paw", min: 3, ownsMin: true, defaults: { mpTime: 60 }, check: mpCheck, start: mpStart, tick: mpTick, render: mpRender, clock: mpClock,
  next: g => mpStartRound(g), skip: g => mpSkipRound(g, "The host skipped this round.") };
/* Typing your own wish lets go of a picked deck wish */
document.addEventListener("input", e => {
  if (mpWishPick == null || !e.target.closest || !e.target.closest("#mpForm")) return;
  mpWishPick = null;
  document.querySelectorAll(".mp-opt.on").forEach(b => { b.classList.remove("on"); b.setAttribute("aria-pressed", "false"); });
});
