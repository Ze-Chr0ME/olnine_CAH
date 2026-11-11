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
/* ---------- Speed Date table ---------- */
const SD_RATES = [[1, "Dead air"], [2, "Awkward"], [3, "Decent"], [4, "Funny"], [5, "Iconic"]];
let sdLastKey = "", sdFrame = "";
function sdDateCard(g, n) {
  const host = sdNow(), phase = g.phase, total = g.traits.length || g.count;
  const sp = g.speaker === ME ? "Your date" : `@${esc(nameOf(g.speaker))}'s date`;
  const count = phase === "reveal" && host < g.startAt ? Math.max(1, Math.ceil((g.startAt - host) / 1000)) : 0;
  const after = phase === "result" || phase === "over";
  const rows = Array.from({ length: total }, (_, i) => {
    const t = g.traits[i];
    if (!t || i >= n) return `<li class="trait hidden"><span class="tr-n">${String(i + 1).padStart(2, "0")}</span><span class="tr-q">???</span></li>`;
    const by = t.by ? (after ? `<span class="tr-by">${avHTML(lookOf(t.by), "sm")}@${esc(nameOf(t.by))}</span>` : `<span class="tr-by">${ICONS.pencil}a player</span>`) : "";
    return `<li class="trait ${i === n - 1 && phase === "reveal" ? "new" : ""}"><span class="tr-n">${String(i + 1).padStart(2, "0")}</span><span class="tr-t">${esc(t.text)}</span>${by}</li>`;
  }).join("");
  const next = sdNextAt(g), since = next ? g.every * 1000 - (next - host) : 0;
  const bar = phase === "reveal" && !count && next ? `<div class="date-bar" aria-hidden="true"><i style="--dur:${g.every}s;--since:-${Math.max(0, since)}ms"></i></div>` : "";
  return `<article class="date-card ${phase}"><header><span class="date-ic">${ICONS.heart}</span><span><b>${sp}</b><small>${Math.min(n, total)} of ${total} revealed</small></span></header>
    ${count ? `<div class="date-count" aria-live="assertive"><b>${count}</b><span>Start talking on zero</span></div>` : ""}
    <ol class="traits">${rows}</ol>${bar}</article>`;
}
function sdRender(g) {
  const phase = g.phase, sp = g.speaker, iSpeak = sp === ME, role = sdRole(), host = isHost(), cfg = settings();
  const key = g.gid + ":" + g.round + ":" + phase, fresh = key !== sdLastKey;
  if (fresh) sdLastKey = key;
  const n = sdVisible(g), lst = g.seats.filter(pid => pid !== sp && present(pid));
  const wrote = pid => !!sdValue(g, pid, "trait"), rated = pid => sdValue(g, pid, "rate") !== null;
  const turn = g.turns[g.round], myT = sdMyTrait(), myR = sdMyRate();
  sdFrame = n + ":" + (phase === "reveal" && sdNow() < g.startAt ? Math.ceil((g.startAt - sdNow()) / 1000) : 0);

  $("roundInfo").textContent = `Date ${g.round} · first to ${cfg.target}`;
  $("rulesLine").textContent = `${g.count} traits, one every ${g.every}s. The best speaker of each lap gets a point.`;
  updateTimer();
  $("stage").classList.toggle("fresh", fresh && phase === "reveal");
  $("blackCard").innerHTML = phase === "write" ? `<article class="date-card write"><header><span class="date-ic">${ICONS.heart}</span><span><b>${iSpeak ? "Your date" : `@${esc(nameOf(sp))}'s date`}</b><small>is getting ready</small></span></header>
    <p class="date-wait">${iSpeak ? "Warm up your voice. Once the first trait shows, you talk and you don't stop." : "Slip in a trait they won't see coming."}</p></article>` : sdDateCard(g, n);

  let status;
  if (role === "spectator" && phase !== "over") status = `You joined mid-date. You're in from the next one. ${at(sp)} is in the hot seat.`;
  else if (phase === "write") status = iSpeak ? `You're in the hot seat. The others are secretly adding traits to your date<span class="dots"></span>`
    : myT ? `Trait sent. ${lst.filter(p => !wrote(p)).length ? `Waiting on ${lst.filter(p => !wrote(p)).map(at).join(", ")}.` : `Your date is on the way<span class="dots"></span>`}`
    : `${at(sp)} is going on a blind date. Write one thing about the date.`;
  else if (phase === "reveal") status = iSpeak ? `<strong class="loud">Keep talking!</strong> React to every trait out loud. Silence loses.` : `Listen to ${at(sp)} talk their way through it. Rating opens when the date ends.`;
  else if (phase === "rate") status = iSpeak ? `The date is over. The table is rating you<span class="dots"></span>` : myR ? `Rated ${myR}/5. Waiting on the others.` : `How did ${at(sp)} do? Be honest. Be cruel.`;
  else if (phase === "result") {
    status = turn && turn.avg !== null ? `${iSpeak ? "You" : at(sp)} scored <strong>${turn.avg.toFixed(1)}/5</strong> from ${plural(turn.n, "rating", "ratings")}.` : `Nobody rated ${iSpeak ? "you" : at(sp)}.`;
    if (g.cycleWinners.length) status += ` Lap over: ${g.cycleWinners.map(p => p === ME ? "you" : at(p)).join(" and ")} +1.`;
    status += cfg.next ? " Next date in a few seconds." : host ? " Click Next round when everyone is ready." : " Waiting for the host to start the next date.";
  } else status = tableOverStatus(g);
  $("status").innerHTML = status;

  if (phase === "write" || phase === "rate") {
    const done = phase === "write" ? wrote : rated, word = phase === "write" ? "wrote a trait" : "rated";
    $("pile").innerHTML = `<div class="pile-label">${lst.filter(done).length} of ${lst.length} ${word}</div><div class="slots">${lst.map(p => done(p) ? `<div class="slot down">Party<br>Games.</div>` : `<div class="slot" aria-hidden="true"></div>`).join("")}</div>`;
  } else $("pile").innerHTML = "";

  tableSide(g, {
    won: pid => phase === "over" ? (g.champions || []).includes(pid) : phase === "result" && g.cycleWinners.includes(pid),
    chip: pid => pid === sp ? `<span class="chip czar">on a date</span>`
      : phase === "write" ? (wrote(pid) ? `<span class="chip done">wrote</span>` : `<span class="chip">${pid === ME ? "your move" : `writing<span class="dots"></span>`}</span>`)
      : phase === "rate" ? (rated(pid) ? `<span class="chip done">rated</span>` : `<span class="chip">judging<span class="dots"></span></span>`) : "",
    empty: "No laps finished yet. The best talkers land here."
  });

  let title = "", hint = "", body = "", action = "";
  if (phase === "write") {
    title = iSpeak ? "Hot seat" : "Your secret trait";
    if (role === "listener" && !myT) {
      hint = "One short trait. It shows up somewhere after the first three.";
      body = composer("sdForm", key, "Your date", "…still lives with their ex", 60);
      action = `<button class="btn primary" type="submit" form="sdForm">${ICONS.send}Add trait</button>`;
    } else if (myT) { hint = "In the deck. Act natural."; body = `<p class="trait-mine">${ICONS.pencil}${esc(myT)}</p>`; }
    else hint = "Get ready. Traits drop one at a time and you talk the whole way through.";
  } else if (phase === "reveal") {
    title = iSpeak ? "Keep talking" : "Listen";
    hint = iSpeak ? "Don't stop. Don't pause. Don't apologise." : "Rating opens when the last trait is out.";
  } else if (phase === "rate") {
    title = iSpeak ? "Judgement" : "Rate the date";
    if (role === "listener") {
      hint = "Tap a score. You can change it until everyone has voted.";
      body = `<div class="rates" role="radiogroup" aria-label="Rate @${esc(nameOf(sp))}">${SD_RATES.map(([v, l]) => `<button type="button" class="rate ${myR === v ? "on" : ""}" data-sd-rate="${v}" role="radio" aria-checked="${myR === v}"><b>${v}</b><span>${l}</span></button>`).join("")}</div>`;
    } else hint = "No peeking. Ratings are anonymous.";
  } else {
    title = "Dates so far";
    hint = "Average rating per date.";
    body = `<ol class="turns">${Object.entries(g.turns).sort((a, b) => b[0] - a[0]).slice(0, 12).map(([r, t]) => `<li class="${+r === g.round ? "now" : ""}">${avHTML(lookOf(t.pid), "sm")}<span>@${esc(nameOf(t.pid))}</span><span class="tr-score">${t.avg === null ? "no ratings" : `${t.avg.toFixed(1)}<small>/5</small>`}</span></li>`).join("")}</ol>`;
    if (phase === "result" && host) action = `<button class="btn primary" type="button" data-act="next">Next date${ICONS.arrowR}</button>`;
    if (phase === "over") action = host ? `<button class="btn primary" type="button" data-act="again">${ICONS.arrowL}Back to lobby</button>` : `<span class="hint">Waiting for the host to start another game.</span>`;
  }
  $("trayWrap").classList.toggle("fresh", fresh);
  $("trayTitle").textContent = title;
  $("trayHint").textContent = hint;
  $("trayActions").innerHTML = action;
  keepDraft(() => { $("tray").className = "sd-tray"; $("tray").innerHTML = body; });
}
/* The reveal runs off the clock: redraw only when a new trait or countdown second is due. */
setInterval(() => {
  const g = L && L.game;
  if (!g || g.type !== "sd" || g.phase !== "reveal" || $("viewGame").hidden) return;
  const n = sdVisible(g), c = sdNow() < g.startAt ? Math.ceil((g.startAt - sdNow()) / 1000) : 0;
  if (n + ":" + c !== sdFrame) render();
}, 200);
document.addEventListener("click", e => {
  const b = e.target.closest("[data-sd-rate]");
  if (b && L && L.game && L.game.type === "sd") sdRate(+b.dataset.sdRate);
});
document.addEventListener("submit", e => {
  if (e.target.id !== "sdForm" || !L || !L.game || L.game.type !== "sd") return;
  e.preventDefault();
  const t = e.target.querySelector("textarea").value.trim();
  if (!t) return notice("Write something first.", { error: true });
  sdSendTrait(t);
});
GAMES.sd = {
  id: "sd", name: "Speed Date", min: 2, defaults: { sdCount: 8, sdEvery: 5, sdWrite: 40 },
  check: sdCheck, start: sdStart, tick: sdTick, render: sdRender,
  next: g => sdStartRound(g), skip: g => sdSkipRound(g, "The host skipped this date.")
};
