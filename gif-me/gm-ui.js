/* ---------- GIF Me table ---------- */
/* An image editor: the scene is a caption layer on a transparency checkerboard, the GIFs are the replies.
   Whatever you have picked wears the editor's selection (marching ants); winning GIFs get pasted onto the scene. */
ICONS.gif = ic(`<rect x="1.5" y="3.5" width="13" height="9" rx="2"/><path d="M6.6 6.6H5.2a.9.9 0 0 0-.9.9v1a.9.9 0 0 0 .9.9h1.4V8H5.8M8.6 6.6v2.8M10.6 9.4V6.6h2M10.6 8h1.5"/>`);
ICONS.search = ic(`<circle cx="7" cy="7" r="4.5"/><path d="m10.4 10.4 3.6 3.6"/>`);
ICONS.camera = ic(`<path d="M2 5.6A1.6 1.6 0 0 1 3.6 4H5l1-1.5h4L11 4h1.4A1.6 1.6 0 0 1 14 5.6v5.8a1.6 1.6 0 0 1-1.6 1.6H3.6A1.6 1.6 0 0 1 2 11.4Z"/><circle cx="8" cy="8.4" r="2.3"/>`);
if (GAME_UI.gm) GAME_UI.gm.icon = "gif";

let gmRk = "", gmLastKey = "", gmQ = "", gmItems = [], gmNext = null, gmBusy = false, gmReq = 0, gmErr = "", gmLoaded = false, gmShown = "";
let gmPick = null, gmChoice = null, gmSitPick = null, gmDraft = null, gmSending = false, gmObs = null;
const GM_MAX_ITEMS = 200;   // endless scroll stops here so one player can't page through the whole API quota
const gmLong = t => String(t || "").length > 110 ? "long" : "";
const gmHash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h); };
/* Width over height, kept in a sane band so a freak panorama can't eat a whole row */
const gmR = a => Math.min(2.2, Math.max(.7, a.w && a.h ? a.w / a.h : 1)).toFixed(3);
/* Reduced motion gets Klipy's still frame instead of the animation */
const gmImg = a => `<picture>${a.still ? `<source media="(prefers-reduced-motion: reduce)" srcset="${esc(a.still)}">` : ""}<img src="${esc(a.url)}" width="${a.w}" height="${a.h}" alt="${esc(a.title || "GIF")}" loading="lazy" decoding="async" draggable="false"></picture>`;
const gmWho = pid => pid === ME ? "You" : `@${esc(nameOf(pid))}`;

/* The countdown face: a buffering ring that drains as time runs out */
function gmClock(g, left) {
  const s = settings(), total = (g.phase === "vote" ? s.gmVote : g.phase === "result" ? s.next : s.gmSearch) || left || 1;
  const C = 2 * Math.PI * 8, f = Math.max(0, Math.min(1, left / total));
  return `<svg class="gm-clock" viewBox="0 0 24 24" aria-hidden="true"><circle class="trk" cx="12" cy="12" r="8"/>
    <circle class="arc" cx="12" cy="12" r="8" stroke-dasharray="${(f * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 12 12)"/><path class="play" d="M10.4 9.1v5.8l4.7-2.9Z"/></svg>`;
}
/* The setter sees the scene they are building: the picked card, or what they type, live */
function gmEditing(g) { return g.phase === "set" && g.setter === ME && gmRole() === "setter" && !gmMySit(); }
function gmDraftText(g) {
  if (gmSitPick != null && g.sitCards[gmSitPick]) return g.sitCards[gmSitPick];
  const t = document.querySelector("#gmForm textarea");
  return t ? t.value : "";
}
function gmScene(g) {
  const s = g.setter, sit = g.sit, open = g.phase === "result" || g.phase === "over";
  let body;
  if (gmEditing(g)) {
    const t = gmDraftText(g);
    body = `${gmDraft ? `<figure class="gm-photo"><img src="${esc(gmDraft)}" alt="Your photo"></figure>` : ""}
      <p class="gm-text gm-live ${gmDraft ? "cap" : gmLong(t)}"><span>${esc(t)}</span><i class="gm-caret"></i></p>`;
  } else if (!sit) body = `<p class="gm-text"><i class="gm-caret"></i><span class="vh">No scene yet</span></p>`;
  else if (sit.photo) {
    const src = gmPhoto(g);
    body = `<figure class="gm-photo">${src ? `<img src="${esc(src)}" alt="The scene">` : `<span class="gm-load" role="img" aria-label="Loading the photo"></span>`}</figure>${sit.text ? `<p class="gm-text cap">${esc(sit.text)}</p>` : ""}`;
  } else body = `<p class="gm-text ${gmLong(sit.text)}">${esc(sit.text)}</p>`;
  const wins = open ? (g.winners || []).filter(k => g.order[k]) : [];
  const pasted = wins.length ? `<div class="gm-wins${wins.length > 1 ? " many" : ""}">${wins.map(k => {
    const a = g.order[k], n = (g.tally || [])[k] || 0;
    return `<figure class="gm-win" style="--r:${gmR(a.gif)}">${gmImg(a.gif)}<figcaption>${avHTML(lookOf(a.pid), "sm", false)}<b class="gm-nm">${gmWho(a.pid)}</b>${g.order.length > 1 ? `<span class="gm-v">${plural(n, "vote", "votes")}</span>` : ""}</figcaption></figure>`;
  }).join("")}</div>` : "";
  return `<article class="gm-scene ${g.phase}${gmEditing(g) ? " editing" : ""}">
    <header class="gm-who">${avHTML(lookOf(s), "sm", false)}<b class="gm-lbl">${s === ME ? "Your scene" : `@${esc(nameOf(s))}'s scene`}</b></header>
    <div class="gm-body">${body}</div>${pasted}</article>`;
}
function gmMessage(e) {
  const m = String(e && e.message || "");
  return /missing/i.test(m) ? "GIF search isn't set up on this site yet." : /busy/i.test(m) ? "GIF search is busy. Try again in a minute." : "GIF search failed. Check your connection.";
}
async function gmFind(q, more) {
  /* A new query replaces whatever is loading; only page loads wait their turn */
  if (more && (gmBusy || gmNext == null)) return;
  const rk = gmRk, req = ++gmReq, live = () => rk === gmRk && req === gmReq;
  gmBusy = true; gmErr = "";
  if (!more) { gmItems = []; gmNext = null; gmPick = null; gmShown = q; }
  render();
  try {
    const r = await (more ? gmSearchGifs(q, gmNext) : gmSearchGifs(q));
    if (!live()) return;
    const seen = new Set(gmItems.map(i => i.id));
    gmItems = gmItems.concat((r.items || []).filter(i => !seen.has(i.id))); gmNext = r.next == null ? null : r.next;
  } catch (e) { if (live()) gmErr = gmMessage(e); }
  finally { if (req === gmReq) gmBusy = false; if (live()) render(); }
}
/* The search is drawn once per round; results are appended in place so the GIFs already on screen never reload */
const gmSearchShell = () => `<div class="gm-search">
  <form id="gmFind" class="gm-find" role="search" autocomplete="off"><span class="gm-lens">${ICONS.search}</span>
    <input id="gmQ" type="search" enterkeyhint="search" maxlength="60" placeholder="Search KLIPY" aria-label="Search KLIPY">
    <button class="btn small icon" type="submit" data-tip="Search" aria-label="Search">${ICONS.arrowR}<span class="gm-spin"></span></button></form>
  <p class="gm-meta"><span data-gm-shown></span><span class="gm-credit">Powered by KLIPY</span></p>
  <div class="gm-grid"></div><div data-gm-msg></div><div class="gm-end" aria-hidden="true"><span class="gm-spin"></span></div></div>`;
const gmTile = (a, i) => `<button type="button" class="gm-gif" style="--r:${gmR(a)}" data-gm-gif="${i}" aria-pressed="false" aria-label="${esc(a.title || `GIF ${i + 1}`)}">${gmImg(a)}</button>`;
function gmPaintSearch(root) {
  root.querySelector(".gm-find").classList.toggle("busy", gmBusy);
  root.querySelector("[data-gm-shown]").textContent = gmErr ? "" : gmShown ? `“${gmShown}”` : "Trending";
  const msg = gmErr ? `<p class="gm-err" role="alert">${esc(gmErr)}${/set up/.test(gmErr) ? "" : `<button type="button" class="btn small icon" data-gm-retry data-tip="Try again" aria-label="Try again">${ICONS.sync}</button>`}</p>`
    : !gmBusy && gmLoaded && !gmItems.length ? `<p class="gm-none">Nothing for “${esc(gmShown)}”. Try other words.</p>` : "";
  const box = root.querySelector("[data-gm-msg]");
  if (box.dataset.h !== msg) { box.dataset.h = msg; box.innerHTML = msg; }
  const grid = root.querySelector(".gm-grid"), ghost = gmBusy && !gmItems.length, key = ghost ? "ghost" : gmRk + "|" + gmShown;
  if (grid.dataset.k !== key || grid.children.length > gmItems.length) {
    grid.dataset.k = key; grid.classList.toggle("ghost", ghost);
    grid.innerHTML = ghost ? [1.78, 1, 1.33, .8, 1.5, 1.2, 1.78, .9, 1.4].map(r => `<span style="--r:${r}"></span>`).join("") : "";
  }
  if (!ghost && grid.children.length < gmItems.length) grid.insertAdjacentHTML("beforeend", gmItems.slice(grid.children.length).map((a, j) => gmTile(a, grid.children.length + j)).join(""));
  const end = root.querySelector(".gm-end");
  end.classList.toggle("on", gmBusy && gmItems.length > 0);
  /* Endless scroll: the next page loads before the bottom comes into view */
  if (!("IntersectionObserver" in window)) return;
  gmObs ??= new IntersectionObserver(es => {
    if (es.some(e => e.isIntersecting) && gmNext != null && !gmBusy && !gmErr && gmItems.length && gmItems.length < GM_MAX_ITEMS) gmFind(gmShown, true);
  }, { rootMargin: "0px 0px 900px 0px" });
  gmObs.disconnect(); gmObs.observe(end);
}
/* Picks are marked after the tray is drawn, so choosing a GIF never redraws (and reloads) the grid */
function gmMark() {
  for (const [sel, key, cur] of [["[data-gm-gif]", "gmGif", gmPick], ["[data-gm-vote]", "gmVote", gmChoice], ["[data-gm-sit]", "gmSit", gmSitPick]])
    document.querySelectorAll("#tray " + sel).forEach(b => { const on = +b.dataset[key] === cur; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
}
function gmRender(g) {
  const phase = g.phase, s = g.setter, role = gmRole(), host = isHost(), cfg = settings();
  const rk = g.gid + ":" + g.round, key = rk + ":" + phase, fresh = key !== gmLastKey;
  if (rk !== gmRk) { gmRk = rk; gmQ = ""; gmItems = []; gmNext = null; gmErr = ""; gmBusy = false; gmReq++; gmLoaded = false; gmShown = ""; gmPick = null; gmChoice = null; gmSitPick = null; gmDraft = null; gmSending = false; }
  if (fresh) gmLastKey = key;
  const mySit = gmMySit(), myGif = gmMyGif(), myVote = gmMyVote();
  const players = g.seats.filter(pid => pid !== s && present(pid));
  const locked = pid => phase === "search" ? !!gmAction(g, pid, "gif") : g.order.some(a => a.pid === pid);
  const voters = g.seats.filter(pid => present(pid) && g.order.some(a => a.pid !== pid)), voted = pid => gmAction(g, pid, "vote") !== null;
  const wins = g.winners || [], wp = wins.length === 1 && g.order[wins[0]] ? g.order[wins[0]].pid : null;
  if (gmChoice != null && (myVote !== null || !g.order[gmChoice] || g.order[gmChoice].pid === ME)) gmChoice = null;
  const searching = phase === "search" && role === "player" && !myGif;
  if (searching && !gmLoaded) { gmLoaded = true; gmFind(""); return; }

  $("roundInfo").textContent = `Round ${g.round} · first to ${cfg.target}`;
  $("rulesLine").textContent = `${cfg.gmSearch ? `${cfg.gmSearch}s to find a GIF` : "No search timer"}, ${cfg.gmVote ? `${cfg.gmVote}s to vote` : "no vote timer"}. Most votes takes the round; you can't vote for your own.`;
  updateTimer();
  $("stage").classList.toggle("fresh", fresh);
  /* Same scene, same markup: skip the write so the photo and the pasted GIFs don't restart */
  const scene = gmScene(g), sh = gmHash(scene), sc = $("blackCard").firstElementChild;
  if (!sc || sc.dataset.h !== sh) $("blackCard").innerHTML = scene.replace("<article ", `<article data-h="${sh}" `);

  let status;
  if (role === "spectator" && !["result", "over"].includes(phase)) status = `<b class="cue">Watching.</b> You're in from the next scene.`;
  else if (phase === "set") status = s === ME ? `<b class="cue">${mySit ? "Scene set." : "Set the scene."}</b>` : `${at(s)} is setting the scene<span class="dots"></span>`;
  else if (phase === "search") status = s === ME ? `<b class="cue">Sit back.</b> They're hunting for reactions.` : myGif ? `<b class="cue">Locked in.</b> Now act natural.` : `<b class="cue">Find the GIF.</b>`;
  else if (phase === "vote") status = myVote !== null ? `<b class="cue">Voted.</b> Waiting on the rest.` : `<b class="cue">Vote.</b> Best reaction wins. Not yours, nice try.`;
  else if (phase === "result") {
    status = !wins.length ? `<b class="cue">No votes.</b> Nobody scores this round.`
      : g.order.length === 1 ? `<b class="cue">Only one GIF made it.</b> +1 to ${wp === ME ? "you" : at(wp)}.`
      : wins.length > 1 ? `<b class="cue">Tie.</b> +1 each to ${wins.map(k => g.order[k].pid === ME ? "you" : at(g.order[k].pid)).join(" and ")}.`
      : `<b class="cue">${wp === ME ? "Your GIF wins." : `${at(wp)} wins the round.`}</b>`;
    if (!cfg.next) status += host ? " Start the next round when you're ready." : " Waiting for the host.";
  } else status = `<span class="over">${tableOverStatus(g)}</span>`;
  $("status").innerHTML = status;

  $("pile").innerHTML = phase === "search" ? tableRoster(players, locked, "GIFs locked", ICONS.check) : phase === "vote" ? tableRoster(voters, voted, "Votes in", ICONS.check) : "";

  tableSide(g, {
    won: pid => phase === "over" ? (g.champions || []).includes(pid) : phase === "result" && wins.some(k => g.order[k] && g.order[k].pid === pid),
    chip: pid => pid === s && phase !== "over" ? `<span class="chip czar">setter</span>`
      : phase === "search" ? (locked(pid) ? `<span class="chip done">locked</span>` : `<span class="chip">${pid === ME ? "your move" : `digging<span class="dots"></span>`}</span>`)
      : phase === "vote" && voters.includes(pid) ? (voted(pid) ? `<span class="chip done">voted</span>` : `<span class="chip">voting<span class="dots"></span></span>`) : "",
    empty: "No reactions yet. The best GIFs land here."
  });

  let title = "", hint = "", body = "", action = "", idle = false;
  if (phase === "set") {
    if (gmEditing(g)) {
      title = "Your scene";
      hint = gmDraft ? "Add a caption, or send the photo as it is." : "Pick one, write your own, or add a photo.";
      const opts = gmDraft ? "" : `<div class="gm-opts">${g.sitCards.map((t, i) => `<button type="button" class="gm-opt" style="--i:${i}" data-gm-sit="${i}" aria-pressed="false"><p class="${gmLong(t)}">${esc(t)}</p></button>`).join("")}</div>`;
      const cam = gmDraft ? `<button type="button" class="btn small icon gm-cam" data-gm-unphoto data-tip="Remove photo" aria-label="Remove photo">${ICONS.x}</button>`
        : `<label class="btn small icon gm-cam" data-tip="Add a photo">${ICONS.camera}<input type="file" accept="image/*" data-gm-file aria-label="Add a photo"></label>`;
      body = `${opts}<div class="gm-compose">${composer("gmForm", rk + (gmDraft ? ":cap" : ":own"), gmDraft ? "Caption" : g.sitCards.length ? "Or write your own" : "The scene", gmDraft ? "My face when…" : "When the group chat finds your old blog.", 200)}${cam}</div>`;
      action = `<button class="btn primary" type="submit" form="gmForm" ${gmSending ? "disabled" : ""}>${ICONS.send}${gmSending ? "Sending" : "Set the scene"}</button>`;
    } else idle = true;
  } else if (phase === "search") {
    if (searching) {
      title = "Your reaction"; hint = "Anonymous until the votes are in.";
      body = null;
      action = `<button class="btn primary" type="button" data-act="gm-lock" ${gmPick != null && gmItems[gmPick] ? "" : "disabled"}>${ICONS.check}Lock it in</button>`;
    } else if (myGif) {
      title = "Your reaction"; hint = "Anonymous until the votes are in.";
      body = `<figure class="gm-mine" style="--r:${gmR(myGif)}">${gmImg(myGif)}</figure>`;
    } else idle = true;
  } else {
    const open = phase !== "vote", canVote = phase === "vote" && role !== "spectator" && myVote === null;
    /* After the votes: winners are already pasted on the scene, the rest line up by votes */
    const ks = g.order.map((_, k) => k).filter(k => !open || !wins.includes(k));
    if (open) ks.sort((x, y) => ((g.tally || [])[y] || 0) - ((g.tally || [])[x] || 0) || x - y);
    title = open ? (wins.length ? "The rest" : "Who sent what") : "The reactions";
    body = ks.length ? `<ol class="gm-board${open ? " open" : ""}">${ks.map((k, j) => {
      const a = g.order[k], mine = a.pid === ME, tap = canVote && !mine, n = (g.tally || [])[k] || 0;
      const cls = ["gm-gif", mine ? "mine" : "", !present(a.pid) ? "gone" : "", myVote === k ? "voted" : ""].filter(Boolean).join(" ");
      const tag = open ? `<span class="gm-tag${n ? " pick" : ""}">${plural(n, "vote", "votes")}</span>`
        : `<span class="gm-n">${k + 1}</span>${mine ? `<span class="gm-tag">yours</span>` : myVote === k ? `<span class="gm-tag pick">your vote</span>` : ""}`;
      const foot = open ? `<span class="gm-auth">${avHTML(lookOf(a.pid), "sm", false)}<b class="gm-nm">${gmWho(a.pid)}</b></span>` : "";
      const inner = `<span class="gm-pic">${gmImg(a.gif)}${tag}</span>${foot}`;
      return `<li style="--i:${j};--r:${gmR(a.gif)}">${tap ? `<button type="button" class="${cls}" data-gm-vote="${k}" aria-pressed="false" aria-label="Reaction ${k + 1}">${inner}</button>` : `<div class="${cls}">${inner}</div>`}</li>`;
    }).join("")}</ol>` : "";
    if (canVote) action = `<button class="btn primary" type="button" data-act="gm-vote" ${gmChoice != null ? "" : "disabled"}>${ICONS.check}Vote</button>`;
    if (phase === "result" && host) action = `<button class="btn primary" type="button" data-act="next">Next round${ICONS.arrowR}</button>`;
    if (phase === "over") action = host ? `<button class="btn primary" type="button" data-act="again">${ICONS.arrowL}Back to lobby</button>` : `<span class="hint">Waiting for the host to start another game.</span>`;
    idle = !ks.length && !action;
  }
  $("trayWrap").classList.toggle("fresh", fresh);
  $("trayWrap").classList.toggle("idle", idle);
  $("trayTitle").textContent = title;
  $("trayHint").textContent = hint;
  $("trayActions").innerHTML = action;
  const tray = $("tray");
  if (body === null) {
    let wrap = tray.querySelector(":scope > .gm-wrap");
    if (!wrap || wrap.dataset.h !== "search:" + rk || tray.className !== "gm-tray") {
      tray.className = "gm-tray"; tray.innerHTML = `<div class="gm-wrap" data-h="search:${rk}">${gmSearchShell()}</div>`;
      wrap = tray.firstElementChild; wrap.querySelector("#gmQ").value = gmQ;
    }
    gmPaintSearch(wrap);
  } else {
    if (gmObs) gmObs.disconnect();
    /* Only redraw the tray when its content changed: a redraw reloads every GIF */
    const hash = gmHash(body);
    keepDraft(() => {
      const cur = tray.querySelector(":scope > .gm-wrap");
      if (cur && cur.dataset.h === hash && tray.className === "gm-tray") return;
      tray.className = "gm-tray"; tray.innerHTML = `<div class="gm-wrap" data-h="${hash}">${body}</div>`;
    });
  }
  gmMark();
}
document.addEventListener("click", e => {
  const g = L && L.game;
  if (!g || g.type !== "gm") return;
  const b = e.target.closest("[data-gm-gif], [data-gm-vote], [data-gm-sit], [data-gm-retry], [data-gm-unphoto], [data-act='gm-lock'], [data-act='gm-vote']");
  if (!b || b.disabled) return;
  if (b.dataset.gmGif != null) { gmPick = gmPick === +b.dataset.gmGif ? null : +b.dataset.gmGif; render(); }
  else if (b.dataset.gmVote != null) { gmChoice = +b.dataset.gmVote; render(); }
  else if (b.dataset.gmSit != null) {
    const i = +b.dataset.gmSit, t = document.querySelector("#gmForm textarea");
    gmSitPick = gmSitPick === i ? null : i;
    if (gmSitPick != null && t) { t.value = ""; t.dispatchEvent(new Event("input", { bubbles: true })); }   // a deck scene and your own text never both stand: the pick replaces the draft
    render();
  }
  else if (b.dataset.gmRetry != null) gmFind(gmShown, gmItems.length > 0);
  else if (b.dataset.gmUnphoto != null) { gmDraft = null; render(); }
  else if (b.dataset.act === "gm-lock") { if (gmPick != null && gmItems[gmPick]) gmSendGif(gmItems[gmPick]); }
  else if (gmChoice != null) gmVote(gmChoice);
});
document.addEventListener("change", async e => {
  const f = e.target.closest && e.target.closest("[data-gm-file]");
  if (!f || !f.files || !f.files[0]) return;
  try { gmDraft = await gmResizePhoto(f.files[0]); gmSitPick = null; render(); }
  catch (err) { notice(err && err.message || "That photo didn't work.", { error: true }); }
});
document.addEventListener("input", e => {
  if (e.target.id === "gmQ") { gmQ = e.target.value; return; }
  if (!e.target.closest || !e.target.closest("#gmForm")) return;
  if (e.isTrusted && gmSitPick != null) { gmSitPick = null; gmMark(); }   // a redraw restoring the draft is not typing
  /* the scene above mirrors the box as you type */
  const live = document.querySelector("#blackCard .gm-live");
  if (live && gmSitPick == null) { live.firstElementChild.textContent = e.target.value; if (!gmDraft) live.classList.toggle("long", !!gmLong(e.target.value)); }
});
document.addEventListener("submit", async e => {
  const g = L && L.game;
  if (!g || g.type !== "gm" || !["gmForm", "gmFind"].includes(e.target.id)) return;
  e.preventDefault();
  if (e.target.id === "gmFind") { const q = e.target.querySelector("input"); gmQ = q.value; q.blur(); return gmFind(gmQ.trim()); }
  const t = e.target.querySelector("textarea").value;
  if (gmDraft) { gmSending = true; render(); await gmSendPhoto(gmDraft, t); gmSending = false; render(); return; }
  if (gmText(t)) return gmSendSit(t);
  if (gmSitPick != null) return gmTakeSit(gmSitPick);
  notice(g.sitCards.length ? "Pick a scene, write one, or add a photo." : "Write a scene or add a photo.", { error: true });
});
