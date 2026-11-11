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
  sdCloseCycle(g, seats);
  if (g.phase === "over") return;
  const unplayed = seats.filter(pid => !g.cycle.includes(pid));
  const speaker = unplayed.find(pid => g.speaker && P[g.speaker] ? pid !== g.speaker && byJoined(pid, g.speaker) > 0 :
    (P[pid].joined || 0) > prev || ((P[pid].joined || 0) === prev && pid > g.speaker)) || unplayed[0];
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
  /* A small pool makes a shorter date; never repeat a deck category. */
  for (const t of players) traits.splice(Math.min(3, traits.length) + Math.floor(Math.random() * (Math.max(0, traits.length - 3) + 1)), 0, t);
  const twist = traits.findIndex(t => t.cat === "dealbreaker_twist");
  if (twist >= 0) traits.push(...traits.splice(twist, 1));
  return traits;
}
function sdFinishTurn(g) {
  const votes = sdListeners(g).map(pid => sdValue(g, pid, "rate")).filter(v => v !== null);
  const avg = votes.length ? votes.reduce((a, b) => a + b, 0) / votes.length : null;
  g.turns[g.round] = { pid: g.speaker, avg, n: votes.length };
  if (!g.cycle.includes(g.speaker)) g.cycle.push(g.speaker);
  g.cycleWinners = [];
  Object.assign(g, { phase: "result", deadline: settings().next ? sdNow() + settings().next * 1000 : 0 });
  sdCloseCycle(g, Object.keys(P).filter(present));
}
function sdCloseCycle(g, seats) {
  if (!g.cycle.length || !seats.every(pid => g.cycle.includes(pid))) return;
  const seen = new Set(), turns = Object.entries(g.turns).filter(([r]) => +r >= g.cycleFrom).sort((a, b) => +a[0] - +b[0])
    .map(([, t]) => t).filter(t => { if (seen.has(t.pid)) return false; seen.add(t.pid); return t.avg !== null; });
  const best = Math.max(...turns.map(t => t.avg));
  g.cycleWinners = turns.filter(t => t.avg === best).map(t => t.pid);
  for (const pid of g.cycleWinners) { g.scores[pid] = (g.scores[pid] || 0) + 1; g.log.unshift({ h: "R" + g.round, who: pid, what: `best date of the lap, ${best.toFixed(1)} out of 5` }); }
  g.log = g.log.slice(0, 7);
  g.cycle = []; g.cycleFrom = g.round + 1;
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
function sdScheduleNext(g) {
  if (!g.deadline) {
    if (!settings().next) return false;
    g.deadline = sdNow() + settings().next * 1000; return true;
  }
  if (sdNow() < g.deadline) return false;
  sdStartRound(g); return true;
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
  if (g.phase === "reveal" && sdNow() >= g.startAt + g.traits.length * g.every * 1000 + 3000) {
    Object.assign(g, { phase: "rate", deadline: sdNow() + 30000 }); return true;
  }
  if (g.phase === "rate" && (late || sdListeners(g).every(pid => sdValue(g, pid, "rate") !== null))) { sdFinishTurn(g); return true; }
  if (g.phase === "result") return sdScheduleNext(g);
  return false;
}
/* ---------- Speed Date table ---------- */
/* A late-night dating show: the speaker in the spotlight, one trait card flipping in at a time, the table holding up score paddles. */
const SD_RATES = [[1, "Dead air"], [2, "Awkward"], [3, "Decent"], [4, "Funny"], [5, "Iconic"]];
let sdLastKey = "", sdFrame = "", sdShown = -1;
const sdPad = n => String(n).padStart(2, "0");
const sdWord = avg => SD_RATES[Math.max(0, Math.min(4, Math.round(avg) - 1))][1];
const sdCount = g => g.phase === "reveal" && sdNow() < g.startAt ? Math.max(1, Math.ceil((g.startAt - sdNow()) / 1000)) : 0;
function sdNextIn(g) {
  const next = sdNextAt(g);
  return next && !sdCount(g) ? Math.max(1, Math.ceil((next - sdNow()) / 1000)) : 0;
}
/* The traits so far as tags; the ones still to come as empty slots. */
function sdChips(g, upto, slots, after) {
  return `<ul class="sd-chips">${g.traits.slice(0, upto).map(t => `<li class="${t.by ? "own" : ""}">${t.by ? ICONS.pencil : ""}${esc(t.text)}${after && t.by
    ? `<span class="sd-by">${avHTML(lookOf(t.by), "sm", false)}@${esc(nameOf(t.by))}</span>` : ""}</li>`).join("")}${Array.from({ length: slots }, () => `<li class="todo" aria-hidden="true"></li>`).join("")}</ul>`;
}
/* Game over: the champion takes the spotlight */
function sdCrown(g) {
  const c = g.champions || [], top = c[0];
  const name = !c.length ? "Nobody" : c.map(p => p === ME ? "You" : `@${esc(nameOf(p))}`).join(" & ");
  return `<article class="sd-set over"><header class="sd-spot">${top ? avHTML(lookOf(top), "lg", false) : ""}<div><span class="sd-air"><i></i>${c.length > 1 ? "Joint champions" : "Champion"}</span>
    <b>${name}</b></div><span class="sd-no">Final</span></header>
    ${c.length ? `<div class="sd-score"><b>${g.scores[top] || 0}</b><span>pts</span><em>${c.length > 1 ? "Tied at the top" : "Most dateable"}</em><small>first to ${settings().target}</small></div>`
      : `<div class="sd-score none"><b>-</b><em>Nobody scored</em></div>`}</article>`;
}
function sdSet(g, n, act = "") {
  const phase = g.phase, sp = g.speaker, total = g.traits.length || g.count, cd = sdCount(g), after = phase === "result" || phase === "over";
  if (phase === "over") return sdCrown(g);
  const air = { write: "Getting ready", reveal: cd ? "Going live" : "On air", rate: "The verdict" }[phase] || "Off air";
  const head = `<header class="sd-spot">${avHTML(lookOf(sp), "lg", false)}<div><span class="sd-air"><i></i>${air}</span>
    <b>${sp === ME ? "You" : `@${esc(nameOf(sp))}`}</b></div><span class="sd-no">Date ${g.round}</span></header>`;
  let body = "";
  if (phase === "write") body = `<p class="sd-meta">${total} traits, one every ${g.every}s</p>${sdChips(g, 0, total)}`;
  else if (phase === "reveal") {
    const t = g.traits[n - 1], flip = !cd && n !== sdShown;
    sdShown = cd ? -1 : n;
    const next = sdNextIn(g), since = next ? g.every * 1000 - (sdNextAt(g) - sdNow()) : 0;
    body = cd ? `<div class="sd-now count"><b>${cd}</b><span>${sp === ME ? "Start talking on zero" : "Going live"}</span></div>`
      : `<div class="sd-now${flip ? " flip" : ""}"><span class="sd-k">${sdPad(n)}<small>/${sdPad(total)}</small></span>
        <p class="sd-trait${t.text.length > 28 ? " long" : ""}">${esc(t.text)}</p>${t.by ? `<span class="sd-from">${ICONS.pencil}Written by someone here</span>` : ""}</div>
        ${next ? `<div class="sd-next" aria-hidden="true"><span class="bar"><i style="--dur:${g.every}s;--since:-${Math.max(0, since)}ms"></i></span><span>Next in <b>${next}</b></span></div>`
        : `<div class="sd-next last"><span>Last one. Bring it home.</span></div>`}`;
    body += sdChips(g, cd ? 0 : n - 1, cd ? total : total - n);
  } else {
    const turn = g.turns[g.round];
    if (after && turn && turn.pid === sp) body = turn.avg === null ? `<div class="sd-score none"><b>-</b><em>Nobody rated</em></div>`
      : `<div class="sd-score"><b>${turn.avg.toFixed(1)}</b><span>/5</span><em>${sdWord(turn.avg)}</em><small>${plural(turn.n, "rating", "ratings")}</small></div>`;
    body += act + sdChips(g, g.traits.length, 0, after);
  }
  if (phase !== "reveal") sdShown = -1;
  return `<article class="sd-set ${phase}">${head}${body}</article>`;
}
function sdRender(g) {
  const phase = g.phase, sp = g.speaker, iSpeak = sp === ME, role = sdRole(), host = isHost(), cfg = settings();
  const key = g.gid + ":" + g.round + ":" + phase, fresh = key !== sdLastKey;
  if (fresh) sdLastKey = key;
  const n = sdVisible(g), lst = g.seats.filter(pid => pid !== sp && present(pid));
  const wrote = pid => !!sdValue(g, pid, "trait"), rated = pid => sdValue(g, pid, "rate") !== null;
  const myT = sdMyTrait(), myR = sdMyRate();
  sdFrame = n + ":" + sdCount(g);

  $("roundInfo").textContent = `Date ${g.round} · first to ${cfg.target}`;
  $("rulesLine").textContent = `${g.traits.length || g.count} traits, one every ${g.every}s. The best speaker of each lap gets a point.`;
  updateTimer();
  $("stage").classList.toggle("fresh", fresh);
  /* A listener rates right under the speaker's name, above the traits, so the paddles are in reach without scrolling */
  const paddles = phase === "rate" && role === "listener" ? `<div class="sd-paddles" role="radiogroup" aria-label="Rate @${esc(nameOf(sp))}">${SD_RATES.map(([v, l]) => `<button type="button" class="paddle${myR === v ? " on" : ""}" data-sd-rate="${v}" role="radio" aria-checked="${myR === v}" aria-label="${v}: ${l}" title="${v}: ${l}"><b>${v}</b><span>${l}</span></button>`).join("")}</div>` : "";
  $("blackCard").innerHTML = sdSet(g, n, paddles);

  let status;
  if (role === "spectator" && !["result", "over"].includes(phase)) status = `<b class="cue">Watching.</b> You're in from the next date.`;
  else if (phase === "write") status = iSpeak ? `<b class="cue">You're in the hot seat.</b> The table is writing your date.`
    : myT ? `<b class="cue">Trait sent.</b> Act natural.` : `<b class="cue">Set ${at(sp)} up.</b> Write one secret trait for their date.`;
  else if (phase === "reveal") status = iSpeak ? (sdCount(g) ? `<b class="cue">Get ready.</b> Talk from zero and don't stop.` : `<b class="cue loud">Keep talking.</b> React to every trait out loud.`)
    : `<b class="cue">Listen.</b> You rate ${at(sp)} when the date ends.`;
  else if (phase === "rate") status = iSpeak ? `<b class="cue">The verdict.</b> The table is rating you<span class="dots"></span>`
    : myR ? `<b class="cue">You gave ${myR}.</b> You can change it until everyone's in.` : `<b class="cue">Rate ${at(sp)}.</b> Be honest. Be cruel.`;
  else if (phase === "result") {
    status = g.cycleWinners.length ? `<b class="cue">Lap over.</b> +1 to ${g.cycleWinners.map(p => p === ME ? "you" : at(p)).join(" and ")}.`
      : `<b class="cue">${iSpeak ? "Your" : `${at(sp)}'s`} date is over.</b>`;
    if (!cfg.next) status += host ? " Start the next date when you're ready." : " Waiting for the host.";
  } else status = `<span class="over">${tableOverStatus(g)}</span>`;
  $("status").innerHTML = status;

  $("pile").innerHTML = phase === "write" ? tableRoster(lst, wrote, "Traits in") : phase === "rate" ? tableRoster(lst, rated, "Votes in") : "";

  tableSide(g, {
    won: pid => phase === "over" ? (g.champions || []).includes(pid) : phase === "result" && g.cycleWinners.includes(pid),
    chip: pid => pid === sp && phase !== "over" ? `<span class="chip czar">on a date</span>`
      : phase === "write" ? (wrote(pid) ? `<span class="chip done">wrote</span>` : `<span class="chip">${pid === ME ? "your move" : `writing<span class="dots"></span>`}</span>`)
      : phase === "rate" ? (rated(pid) ? `<span class="chip done">rated</span>` : `<span class="chip">judging<span class="dots"></span></span>`) : "",
    empty: "No laps finished yet. The best talkers land here."
  });

  let title = "", hint = "", body = "", action = "", idle = false;
  if (phase === "write" && role === "listener") {
    title = myT ? "Your trait" : "Your secret trait";
    hint = myT ? "Sent. If it's picked, it drops after the first three." : "One short trait. It drops after the first three.";
    if (myT) body = `<p class="sd-mine">${ICONS.pencil}${esc(myT)}</p>`;
    else {
      body = composer("sdForm", key, "Your date", "still lives with their ex", 60);
      action = `<button class="btn primary" type="submit" form="sdForm">${ICONS.send}Add trait</button>`;
    }
  } else if (phase === "result" || phase === "over") {
    title = "Dates so far";
    body = `<ol class="sd-turns">${Object.entries(g.turns).sort((a, b) => b[0] - a[0]).slice(0, 12).map(([r, t]) => `<li class="${+r === g.round ? "now" : ""}">${avHTML(lookOf(t.pid), "sm", false)}
      <span class="nm">${t.pid === ME ? "You" : `@${esc(nameOf(t.pid))}`}</span><span class="bar" aria-hidden="true"><i style="width:${t.avg === null ? 0 : t.avg * 20}%"></i></span>
      <b>${t.avg === null ? "-" : t.avg.toFixed(1)}</b></li>`).join("")}</ol>`;
    if (phase === "result" && host) action = `<button class="btn primary" type="button" data-act="next">Next date${ICONS.arrowR}</button>`;
    if (phase === "over") action = host ? `<button class="btn primary" type="button" data-act="again">${ICONS.arrowL}Back to lobby</button>` : `<span class="hint">Waiting for the host to start another game.</span>`;
  } else idle = true;
  $("trayWrap").classList.toggle("fresh", fresh);
  $("trayWrap").classList.toggle("idle", idle);
  $("trayTitle").textContent = title;
  $("trayHint").textContent = hint;
  $("trayActions").innerHTML = action;
  keepDraft(() => { $("tray").className = "sd-tray"; $("tray").innerHTML = body; });
}
/* The reveal runs off the clock: redraw when a trait or a countdown second is due; between those only the "next in" number moves. */
setInterval(() => {
  const g = L && L.game;
  if (!g || g.type !== "sd" || g.phase !== "reveal" || $("viewGame").hidden) return;
  if (sdVisible(g) + ":" + sdCount(g) !== sdFrame) return render();
  const b = $("blackCard").querySelector(".sd-next b"), s = String(sdNextIn(g));
  if (b && b.textContent !== s) b.textContent = s;
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
/* The rating countdown: a recording light, in the show's neon */
const sdClock = () => `<svg class="sd-clock" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".45"/><circle cx="12" cy="12" r="5" fill="currentColor"/></svg>`;
GAMES.sd = {
  id: "sd", name: "Speed Date", min: 2, defaults: { sdCount: 8, sdEvery: 5, sdWrite: 40 },
  check: sdCheck, start: sdStart, tick: sdTick, render: sdRender, clock: sdClock,
  next: g => sdStartRound(g), skip: g => sdSkipRound(g, "The host skipped this date.")
};
