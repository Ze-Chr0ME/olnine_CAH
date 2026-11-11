/* ---------- constants & helpers ---------- */
const MIN_PLAYERS = 3, MAX_PLAYERS = 20;
const GONE_MS = 20000;            // a player missing from the room this long is skipped
/* Lobby settings: the host picks from these; seconds are 0 for "no timer" / "host decides". */
const DEFAULTS = { game: "cah", target: 5, next: 9, maxPlayers: 10, private: false, lang: "en" };
const GAMES = {};
function gameId() { return (L && L.settings && L.settings.game) || "cah"; }
function curGame() { return GAMES[gameId()] || GAMES.cah; }
/* Card text languages. Translations of the official packs load from i18n/ the first time a lobby picks one. */
const LANGS = { en: "English", de: "Deutsch", fr: "Français" };
/* Each numeric setting is a slider from min to max in steps of `step`; the box beside it takes any whole number from min up to `cap`.
   Settings with `none` also allow 0 (no limit, no timer, the host clicks): one step past the slider's max, or an empty box. */
const SETTINGS = [
  { key: "target", icon: "trophy", label: "Points to win", min: 1, max: 20, step: 1, cap: 99, fmt: n => `${n} points` },
  { key: "rounds", icon: "repeat", label: "Round limit", min: 1, max: 30, step: 1, cap: 999, none: "∞", fmt: n => n ? `${n} rounds` : "No limit" },
  { key: "pickTime", icon: "hourglass", label: "Time to pick cards", min: 10, max: 180, step: 5, cap: 3600, unit: "s", none: "∞", fmt: n => n ? `${n} seconds` : "No timer" },
  { key: "judgeTime", icon: "gavel", label: "Time for the czar", min: 10, max: 180, step: 5, cap: 3600, unit: "s", none: "∞", fmt: n => n ? `${n} seconds` : "No timer" },
  { key: "hand", icon: "cards", label: "Cards in hand", min: 3, max: 12, step: 1, cap: 30, fmt: n => `${n} cards` },
  { key: "next", icon: "skip", label: "Next round starts", min: 3, max: 30, step: 1, cap: 300, unit: "s", none: "Host", fmt: n => n ? `After ${n} seconds` : "When the host clicks" },
  { key: "maxPlayers", icon: "users", label: "Max players", min: 3, max: 10, step: 1, cap: 20, fmt: n => `${n} players` },
  { key: "mpTime", icon: "hourglass", label: "Time to wish and twist", min: 10, max: 180, step: 1, cap: 3600, unit: "s", none: "∞", fmt: n => n ? `${n} seconds` : "No timer" },
  { key: "sdCount", icon: "list", label: "Traits per date", min: 3, max: 15, step: 1, cap: 30, fmt: n => `${n} traits` },
  { key: "sdEvery", icon: "eye", label: "Seconds per reveal", min: 2, max: 15, step: 1, cap: 60, unit: "s", fmt: n => `${n} seconds` },
  { key: "sdWrite", icon: "pencil", label: "Time to write traits", min: 10, max: 120, step: 1, cap: 600, unit: "s", fmt: n => `${n} seconds` }
];
/* What the menu shows for each game: icon, one-line pitch, what its lobby language picks, the start line. */
const GAME_UI = {
  cah: { icon: "cards", pitch: "Fill in the blank. The czar picks the worst.", deck: "Cards", go: "Let the bad answers begin." },
  mp: { icon: "paw", pitch: "Make a wish. Everyone ruins it.", deck: "Wishes", go: "Careful what you wish for." },
  sd: { icon: "heart", pitch: "Keep talking. Your date keeps getting worse.", deck: "Traits", go: "Your date is on the way." }
};
const GAME_ORDER = ["cah", "mp", "sd"];
let homeGame = "cah";
/* Radio tiles for picking a game; `name` keeps the home menu and the lobby picker apart. */
function gameTiles(name, chosen, off) {
  return GAME_ORDER.filter(id => GAMES[id]).map(id => {
    const g = GAMES[id], u = GAME_UI[id];
    return `<label class="game-tile g-${id}"><input type="radio" name="${name}" value="${id}" ${name === "set-game" ? `data-setting="game"` : `data-home-game`} ${chosen === id ? "checked" : ""} ${off ? "disabled" : ""}>
      <span class="gt-ic">${ICONS[u.icon]}</span><span class="gt-name">${esc(g.name)}</span><span class="gt-pitch">${u.pitch}</span>
      <span class="gt-min">${ICONS.users}${g.min}+</span></label>`;
  }).join("");
}
const showSetting = (o, n) => n ? `${n}${o.unit || ""}` : o.none;
// Slider position for a value: "none" sits one step past max, typed values past the range pin to the end
const slideAt = (o, n) => n ? Math.min(o.max, Math.max(o.min, n)) : o.max + o.step;
const FLAGS = {
  en: `<svg viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><clipPath id="ukClip"><path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z"/></clipPath><path d="M0 0v30h60V0z" fill="#012169"/><path d="M0 0l60 30m0-30L0 30" stroke="#fff" stroke-width="6"/><path d="M0 0l60 30m0-30L0 30" clip-path="url(#ukClip)" stroke="#C8102E" stroke-width="4"/><path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/><path d="M30 0v30M0 15h60" stroke="#C8102E" stroke-width="6"/></svg>`,
  de: `<svg viewBox="0 0 5 3" preserveAspectRatio="none" aria-hidden="true"><path d="M0 0h5v1H0z"/><path d="M0 1h5v1H0z" fill="#D00"/><path d="M0 2h5v1H0z" fill="#FFCE00"/></svg>`,
  fr: `<svg viewBox="0 0 3 2" preserveAspectRatio="none" aria-hidden="true"><path d="M0 0h1v2H0z" fill="#002654"/><path d="M1 0h1v2H1z" fill="#fff"/><path d="M2 0h1v2H2z" fill="#CE1126"/></svg>`
};
let sliding = false;   // the host is dragging a setting slider: don't re-render it out from under them
const settings = (s = L && L.settings) => ({ ...DEFAULTS, ...Object.assign({}, ...Object.values(GAMES).map(g => g.defaults)), ...s });
const STALE_MS = 3 * 3600e3;      // open-lobby list hides lobbies idle longer than this
const PRUNE_MS = 48 * 3600e3;     // lobbies idle longer than this get deleted when someone creates a lobby
const EMPTY_MS = 60000;           // a lobby with nobody's page open this long gets closed
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const MAX_CARDS = 400, MAX_CARD_LEN = 150;

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const fnv = s => { let h = 2166136261 >>> 0; for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
const blanks = t => (t.match(/____/g) || []).length;
const need = t => Math.min(3, Math.max(1, blanks(t)));
const trimDot = s => s.replace(/\.$/, "");
const clone = o => JSON.parse(JSON.stringify(o));
const uniq = a => [...new Set(a)];
const rid = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, b => (b % 36).toString(36)).join(""); };
const cleanName = s => String(s || "").trim().replace(/^@+/, "").replace(/\s+/g, "_").replace(/[^\p{L}\p{N}_.-]/gu, "").slice(0, 20);
const cleanCard = s => String(s).replace(/\s+/g, " ").trim().replace(/_{3,}/g, "____").slice(0, MAX_CARD_LEN);
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const makeStore = area => ({
  get(k, d) { try { const v = window[area].getItem(k); return v == null ? d : v; } catch { return d; } },
  set(k, v) { try { v == null ? window[area].removeItem(k) : window[area].setItem(k, v); } catch {} }
});
const store = makeStore("localStorage");    // remembered name
const tab = makeStore("sessionStorage");    // player id + current lobby: per tab, so a reload keeps your seat

/* This tab's player id (not an account: just how lobbies tell players apart). */
let ME = tab.get("cah-pid", "");
if (!/^p[a-z0-9]{12}$/.test(ME)) { ME = "p" + rid(12); tab.set("cah-pid", ME); }
let myName = cleanName(store.get("cah-name", ""));

/* ---------- runtime state ---------- */
let db = null, room = null, roomSince = 0, canWrite = true;
let packs = {};               // id -> pack document from the shared library
let directory = [];           // open-lobby summaries
let code = null, L = null, P = {};   // current lobby code, lobby document, players by id
let seenLobby = false, seenSelf = false, leaving = false;
let unsubLobby = null, unsubPlayers = null;
let view = "home";            // home | packs, while not in a lobby
let editingPack = null, armedDelete = null;
let selected = [], czarPick = null, lastKey = "", lastOnline = "", flipSeen = { key: "", at: {} };
const offlineSince = {};

/* ---------- ruler portraits ---------- */
/* A face is { s: species, k: skin, e: eyes, a: uniform, b: backdrop }, each an index into the lists below. */
const SPECIES = ["Mammalian", "Reptilian", "Avian", "Arthropoid", "Molluscoid", "Fungoid", "Lithoid", "Machine", "Plantoid", "Humanoid"];
const SKINS = ["#8fbf6a", "#5aa9a0", "#c98b5a", "#c4b06e", "#9480cc", "#d4776b", "#6d8fc9", "#a7adb0", "#e0c88a", "#6b7a52"];
const EYES = ["#ffd84a", "#6ff0ff", "#ff5e5e", "#b4ff6a", "#f4f4f4", "#c58cff"];
const ATTIRE = ["#1f3a5f", "#5a1f33", "#2a4a28", "#3b2f5c", "#5a4320", "#24363f", "#6a1e1e", "#1b4a52"];
const BACKS = ["#12466a", "#43175c", "#5a2016", "#0f4d43", "#4a4212", "#1c1c52"];
const FACE_KEYS = { s: SPECIES, k: SKINS, e: EYES, a: ATTIRE, b: BACKS };
function seedFace(seed) {
  const h = fnv("face" + seed);
  return { s: h % SPECIES.length, k: (h >>> 4) % SKINS.length, e: (h >>> 9) % EYES.length, a: (h >>> 13) % ATTIRE.length, b: (h >>> 17) % BACKS.length };
}
function cleanFace(f, seed) {
  const d = seedFace(seed), out = {};
  for (const [k, list] of Object.entries(FACE_KEYS)) out[k] = f && Number.isInteger(f[k]) && f[k] >= 0 && f[k] < list.length ? f[k] : d[k];
  return out;
}
const shade = (hex, f) => {
  const n = parseInt(hex.slice(1), 16), c = x => Math.max(0, Math.min(255, Math.round(x * f)));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
};
const eyePair = (y, r, E, dx = 8) => `<circle cx="${50 - dx}" cy="${y}" r="${r}" fill="${E}"/><circle cx="${50 + dx}" cy="${y}" r="${r}" fill="${E}"/>
  <circle cx="${50 - dx}" cy="${y}" r="${r * .4}" fill="#0a0a0a"/><circle cx="${50 + dx}" cy="${y}" r="${r * .4}" fill="#0a0a0a"/>`;
/* Each species draws a head over the shared neck and uniform; S = skin, D = shadow, E = eyes. */
const HEADS = [
  (S, D, E) => `<circle cx="31" cy="27" r="8" fill="${D}"/><circle cx="69" cy="27" r="8" fill="${D}"/><circle cx="31" cy="27" r="4" fill="${S}"/><circle cx="69" cy="27" r="4" fill="${S}"/>
    <ellipse cx="50" cy="45" rx="20" ry="21" fill="${S}"/><ellipse cx="50" cy="55" rx="10" ry="7.5" fill="${shade("#ffffff", .85)}" opacity=".55"/>
    ${eyePair(41, 3.4, E)}<ellipse cx="50" cy="51" rx="3" ry="2" fill="#2a1a14"/>`,
  (S, D, E) => `<path d="M38 22 42 10 46 21 50 6 54 21 58 10 62 22Z" fill="${D}"/><ellipse cx="50" cy="42" rx="16" ry="24" fill="${S}"/>
    <circle cx="44" cy="56" r="1.3" fill="${D}"/><circle cx="56" cy="56" r="1.3" fill="${D}"/><circle cx="50" cy="30" r="1.6" fill="${D}"/><circle cx="45" cy="26" r="1.2" fill="${D}"/><circle cx="55" cy="26" r="1.2" fill="${D}"/>
    <ellipse cx="43" cy="40" rx="4.5" ry="3" fill="${E}"/><ellipse cx="57" cy="40" rx="4.5" ry="3" fill="${E}"/><rect x="42.4" y="37" width="1.2" height="6" fill="#0a0a0a"/><rect x="56.4" y="37" width="1.2" height="6" fill="#0a0a0a"/>
    <path d="M44 58q6 3 12 0" stroke="${D}" stroke-width="1.5" fill="none"/>`,
  (S, D, E) => `<path d="M50 24C46 10 38 8 34 12c6 1 9 6 10 12ZM50 24c4-14 12-16 16-12-6 1-9 6-10 12ZM50 22c0-10 2-15 0-18-2 3 0 8 0 18Z" fill="${D}"/>
    <circle cx="50" cy="40" r="18" fill="${S}"/>${eyePair(37, 3.6, E, 8.5)}<path d="M43 45h14l-7 15Z" fill="#e8b347"/><path d="M43 45h14l-7 5Z" fill="#c48a2a"/>`,
  (S, D, E) => `<path d="M42 26C38 16 32 10 26 10" stroke="${D}" stroke-width="2" fill="none"/><path d="M58 26c4-10 10-16 16-16" stroke="${D}" stroke-width="2" fill="none"/>
    <circle cx="26" cy="10" r="3" fill="${E}"/><circle cx="74" cy="10" r="3" fill="${E}"/><ellipse cx="50" cy="43" rx="17" ry="19" fill="${S}"/>
    <path d="M36 52c-6 4-6 10-2 14 0-5 3-8 7-9ZM64 52c6 4 6 10 2 14 0-5-3-8-7-9Z" fill="${D}"/>
    <ellipse cx="41" cy="40" rx="6.5" ry="5" fill="${E}"/><ellipse cx="59" cy="40" rx="6.5" ry="5" fill="${E}"/><circle cx="39.5" cy="38.5" r="1.6" fill="#fff" opacity=".8"/><circle cx="57.5" cy="38.5" r="1.6" fill="#fff" opacity=".8"/>
    <path d="M44 30h12" stroke="${D}" stroke-width="1.5"/>`,
  (S, D, E) => `<path d="M38 50c-4 10-8 16-12 18M45 52c-1 10-3 15-6 18M55 52c1 10 3 15 6 18M62 50c4 10 8 16 12 18" stroke="${D}" stroke-width="5" stroke-linecap="round" fill="none"/>
    <ellipse cx="50" cy="35" rx="21" ry="21" fill="${S}"/><ellipse cx="44" cy="26" rx="6" ry="4" fill="#ffffff" opacity=".18"/>${eyePair(42, 4, E, 8)}`,
  (S, D, E) => `<ellipse cx="50" cy="49" rx="14" ry="15" fill="${S}"/><path d="M20 38C20 18 34 10 50 10s30 8 30 28c-8 4-52 4-60 0Z" fill="${D}"/>
    <circle cx="38" cy="24" r="3.5" fill="#f2e8d0" opacity=".85"/><circle cx="56" cy="19" r="2.8" fill="#f2e8d0" opacity=".85"/><circle cx="66" cy="30" r="3.2" fill="#f2e8d0" opacity=".85"/>
    ${eyePair(47, 2.6, E, 6)}<path d="M46 56q4 2 8 0" stroke="#2a1a14" stroke-width="1.4" fill="none"/>`,
  (S, D, E) => `<path d="M36 22 50 14l15 7 4 18-5 20-14 6-14-6-5-19Z" fill="${S}"/><path d="M50 14v14l-14-6ZM50 28l19 11-4-18ZM36 41l14-13M50 28v37M36 41l-5-2M64 59l-14-20" stroke="${D}" stroke-width="1.2" fill="none"/>
    <path d="M36 22l14 6-14 13-5-2Z" fill="${D}" opacity=".5"/><rect x="38" y="38" width="9" height="3.5" fill="${E}"/><rect x="53" y="38" width="9" height="3.5" fill="${E}"/>`,
  (S, D, E) => `<path d="M50 12v8" stroke="${D}" stroke-width="2"/><circle cx="50" cy="11" r="3" fill="${E}"/><rect x="31" y="20" width="38" height="40" rx="7" fill="${S}"/>
    <rect x="35" y="33" width="30" height="9" rx="4.5" fill="#06121a"/><rect x="38" y="35.5" width="24" height="4" rx="2" fill="${E}"/>
    <rect x="40" y="49" width="20" height="5" rx="1" fill="${D}"/><path d="M44 49v5M48 49v5M52 49v5M56 49v5" stroke="${S}" stroke-width=".8"/>
    <circle cx="35" cy="24" r="1.4" fill="${D}"/><circle cx="65" cy="24" r="1.4" fill="${D}"/><rect x="27" y="34" width="4" height="10" fill="${D}"/><rect x="69" y="34" width="4" height="10" fill="${D}"/>`,
  (S, D, E) => `<ellipse cx="34" cy="24" rx="6" ry="13" transform="rotate(-35 34 24)" fill="${D}"/><ellipse cx="66" cy="24" rx="6" ry="13" transform="rotate(35 66 24)" fill="${D}"/>
    <ellipse cx="50" cy="18" rx="6" ry="13" fill="${D}"/><path d="M50 8v22" stroke="${S}" stroke-width="1"/><ellipse cx="50" cy="44" rx="17" ry="19" fill="${S}"/>
    ${eyePair(42, 3, E, 7)}<path d="M45 53q5 3 10 0" stroke="${D}" stroke-width="1.5" fill="none"/>`,
  (S, D, E) => `<ellipse cx="50" cy="42" rx="16" ry="20" fill="${S}"/><path d="M33 40c-2-18 8-26 17-26s20 6 17 26c-3-9-8-13-17-14-10 1-15 5-17 14Z" fill="${D}"/>
    ${eyePair(42, 2.7, E, 6.5)}<path d="M41 36.5h6M53 36.5h6" stroke="${D}" stroke-width="1.6"/><path d="M50 44v5h-2" stroke="${shade("#000000", 1)}" stroke-opacity=".35" stroke-width="1.2" fill="none"/>
    <path d="M45 54q5 2.5 10 0" stroke="#5a2a22" stroke-width="1.6" fill="none"/>`
];
function portrait(face) {
  const f = cleanFace(face, ""), S = SKINS[f.k], D = shade(S, .62), E = EYES[f.e], A = ATTIRE[f.a], B = BACKS[f.b];
  return `<svg viewBox="0 0 100 100" aria-hidden="true">
    <defs><radialGradient id="pb${f.b}" cx=".5" cy=".35" r=".75"><stop offset="0" stop-color="${shade(B, 1.5)}"/><stop offset="1" stop-color="${shade(B, .25)}"/></radialGradient></defs>
    <rect width="100" height="100" fill="url(#pb${f.b})"/>
    <circle cx="18" cy="16" r=".9" fill="#fff" opacity=".7"/><circle cx="84" cy="22" r=".7" fill="#fff" opacity=".6"/><circle cx="77" cy="8" r=".5" fill="#fff" opacity=".5"/><circle cx="10" cy="44" r=".6" fill="#fff" opacity=".5"/>
    <path d="M-10 100a60 26 0 0 1 120 0Z" fill="${shade(B, .55)}" opacity=".8"/>
    <rect x="43" y="58" width="14" height="16" fill="${D}"/>
    <path d="M8 100c3-17 17-26 42-26s39 9 42 26Z" fill="${A}"/><path d="M36 76l14 14 14-14" stroke="#d9b45a" stroke-width="2" fill="none"/>
    <path d="M18 88h10M72 88h10" stroke="#d9b45a" stroke-width="1.5" opacity=".7"/>
    ${HEADS[f.s](S, D, E)}</svg>`;
}
const validImg = s => typeof s === "string" && s.length < 60000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s) ? s : null;
const avHTML = (look, size = "", lvl = true) => `<span class="av ${size}"><span class="pt">${look.img ? `<img src="${esc(look.img)}" alt="">` : portrait(look.face)}</span>${lvl ? `<span class="lv">${look.lvl || 1}</span>` : ""}</span>`;

/* ---------- ruler profile: XP, level, stats ---------- */
/* XP needed to go from level l to l + 1 grows by 50 each level. */
const stepXP = l => 100 + 50 * (l - 1);
function levelOf(xp) {
  let lvl = 1, base = 0;
  while (lvl < 99 && xp >= base + stepXP(lvl)) { base += stepXP(lvl); lvl++; }
  return { lvl, into: xp - base, need: stepXP(lvl) };
}
const RANKS = [[1, "Cadet"], [3, "Ensign"], [5, "Lieutenant"], [8, "Commander"], [12, "Captain"], [16, "Commodore"], [20, "Admiral"], [25, "Grand Admiral"], [32, "Galactic Custodian"], [40, "Galactic Emperor"]];
const rankOf = lvl => RANKS.filter(r => lvl >= r[0]).pop()[1];
const XP = { round: 10, merged: 50, judged: 15, game: 40, victory: 150 };
const STAT_KEYS = ["games", "wins", "merged", "judged", "cards", "lucky", "big"];
let uid = null;                // the viewer's account id for this game, from the user capability
let people = {};               // uid -> profile documents from the shared store (standings + anyone seated with you)
let standings = [];            // top profiles by XP
const asked = new Set();       // uids already fetched once
function cleanProfile(d, seed) {
  d = d || {};
  const stats = {};
  for (const k of STAT_KEYS) stats[k] = Math.max(0, Math.floor(+((d.stats || {})[k]) || 0));
  return {
    name: cleanName(d.name) || "", face: cleanFace(d.face, seed), img: validImg(d.img),
    xp: Math.max(0, Math.floor(+d.xp || 0)), stats, awarded: Array.isArray(d.awarded) ? d.awarded.filter(x => typeof x === "string").slice(-200) : []
  };
}
let profile = (() => { try { return cleanProfile(JSON.parse(store.get("cah-profile", "null")), ME); } catch { return cleanProfile(null, ME); } })();
if (!profile.name) profile.name = myName;
const myLook = () => ({ face: profile.face, img: profile.img, lvl: levelOf(profile.xp).lvl });
function lookOf(pid) {
  if (pid === ME) return myLook();
  const s = P[pid] || {}, pr = s.uid && people[s.uid];
  const face = s.face || (L && L.game && L.game.faces && L.game.faces[pid]) || seedFace(pid);
  return { face: cleanFace(face, pid), img: pr ? validImg(pr.img) : null, lvl: pr ? levelOf(+pr.xp || 0).lvl : Math.max(1, Math.floor(+s.lvl || 1)) };
}
/* Fetches profiles of seated players who are not in the standings, once each. */
function fetchPeople(uids) {
  for (const u of uids) {
    if (!u || typeof u !== "string" || people[u] || asked.has(u) || !db) continue;
    asked.add(u);
    db.doc("profiles/" + u).get().then(s => { if (s.exists) { people[u] = s.data(); render(); } }).catch(() => {});
  }
}
let saving = false, saveAgain = false, saveTask = null;
let firebaseAccountUser = null, personalCode = "", accountBusy = false, unsubProfile = null;
let pendingRewards = [], syncedLook = null;
const profileLook = p => ({ name: p.name, face: clone(p.face), img: p.img });
const rewardStoreKey = () => "cah-rewards:" + uid + ":" + ME;
function cacheRewards() { store.set(rewardStoreKey(), JSON.stringify(pendingRewards)); }
function applyRewards(data, rewards) {
  const d = cleanProfile(data, ME);
  for (const r of rewards) {
    if (d.awarded.includes(r.id)) continue;
    d.xp += r.xp;
    for (const k of STAT_KEYS) d.stats[k] += r.stats[k] || 0;
    d.awarded = uniq(d.awarded.concat(r.marks, r.id)).slice(-200);
  }
  return d;
}
function saveProfile() {
  store.set("cah-profile", JSON.stringify(profile));
  if (!db || !uid || !canWrite) return Promise.resolve(false);
  if (saving) { saveAgain = true; return saveTask; }
  saving = true;
  saveTask = (async () => {
    try {
      do {
        saveAgain = false;
        const target = uid, local = clone(profile), rewards = clone(pendingRewards);
        const ref = db.doc("profiles/" + target);
        const edits = Object.fromEntries(Object.entries(profileLook(local)).filter(([k, v]) => !syncedLook || JSON.stringify(v) !== JSON.stringify(syncedLook[k])));
        if (firebaseAccountUser) {
          const saved = await db.runTransaction(async tx => {
            const snap = await tx.get(ref);
            const next = snap.exists ? applyRewards(snap.data(), rewards) : {
              ...local, awarded: uniq(local.awarded.concat(rewards.map(r => r.id))).slice(-200)
            };
            Object.assign(next, edits);
            tx.set(ref, { ...next, updated: Date.now() });
            return next;
          });
          if (target !== uid) return false;
          const ids = new Set(rewards.map(r => r.id));
          pendingRewards = pendingRewards.filter(r => !ids.has(r.id)); cacheRewards();
          const current = profile;
          syncedLook = profileLook(saved);
          profile = applyRewards(saved, pendingRewards);
          if (saveAgain) Object.assign(profile, { name: current.name, face: current.face, img: current.img });
          myName = profile.name; store.set("cah-name", myName);
          store.set("cah-profile", JSON.stringify(profile));
          syncSeat();
        } else await ref.set({ ...local, updated: Date.now() });
      } while (saveAgain);
      return true;
    } catch (e) { dbErr(e); return false; }
    finally { saving = false; saveAgain = false; render(); }
  })();
  return saveTask;
}
/* Keeps your seat in the lobby showing your current name, portrait and level. */
function syncSeat() {
  if (!code || !db || !P[ME]) return;
  const lvl = levelOf(profile.xp).lvl, s = P[ME];
  if (s.name === myName && JSON.stringify(s.face) === JSON.stringify(profile.face) && s.lvl === lvl && s.uid === uid) return;
  myRef().update({ name: myName, face: profile.face, lvl, uid }).catch(dbErr);
}
/* Shared profiles are authoritative; unsaved rewards are replayed until the server confirms them.
   The claude.ai backend retains its original local-progress behavior. */
function adoptProfile(data) {
  const old = profile;
  syncedLook = profileLook(cleanProfile(data, ME));
  const d = firebaseAccountUser ? applyRewards(data, pendingRewards) : cleanProfile(data, ME);
  const behind = !firebaseAccountUser && d.xp < old.xp;
  if (behind) { d.xp = old.xp; d.stats = old.stats; }
  if (!firebaseAccountUser) d.awarded = uniq(d.awarded.concat(old.awarded)).slice(-200);
  if (!d.name) d.name = old.name;
  profile = d;
  if (profile.name) { myName = profile.name; store.set("cah-name", myName); if (!code) $("nameInput").value = myName; }
  store.set("cah-profile", JSON.stringify(profile));
  if (behind) saveProfile();
  syncSeat();
}
const seatFields = () => ({ name: myName, face: profile.face, lvl: levelOf(profile.xp).lvl, uid });

/* Each player credits only themselves, from what the lobby document shows, once per round and once per game. */
function earn() {
  const g = L && L.game;
  if (!g || (g.type || "cah") !== "cah" || !g.seats || !g.seats.includes(ME) || (g.phase !== "result" && g.phase !== "over")) return;
  const before = clone(profile);
  const gains = [], s = profile.stats, lvl0 = levelOf(profile.xp).lvl;
  const mark = k => { const key = `${ME}:${g.gid}:${k}`; if (profile.awarded.includes(key)) return false; profile.awarded.push(key); return true; };
  if (g.winner && g.order.length && mark(g.round)) {
    const mine = g.order.find(o => o.pid === ME);
    if (mine) { s.cards += mine.cards.length; gains.push([XP.round, "Cards played"]); }
    if (g.winner === ME) { s.merged++; if (g.randomWin) s.lucky++; gains.push([XP.merged, g.randomWin ? "Won on the timer" : "Round won"]); }
    if (g.czar === ME && !g.randomWin) { s.judged++; gains.push([XP.judged, "Round judged"]); }
  }
  if (g.phase === "over" && mark("over")) {
    s.games++; if (g.seats.length >= 6) s.big++;
    gains.push([XP.game, "Game finished"]);
    if ((g.champions || []).includes(ME)) { s.wins++; gains.push([XP.victory, "Victory"]); }
  }
  if (!gains.length) return;
  profile.awarded = profile.awarded.slice(-200);
  profile.xp += gains.reduce((a, b) => a + b[0], 0);
  if (firebaseAccountUser) {
    pendingRewards.push({ id: "reward:" + rid(24), xp: profile.xp - before.xp,
      stats: Object.fromEntries(STAT_KEYS.map(k => [k, s[k] - before.stats[k]])),
      marks: profile.awarded.filter(k => !before.awarded.includes(k)) });
    cacheRewards();
  }
  for (const [n, why] of gains) toast(`+${n} XP`, why);
  const lvl = levelOf(profile.xp).lvl;
  if (lvl > lvl0) toast("Promoted", `Level ${lvl}: ${rankOf(lvl)}`, "", true);
  saveProfile(); syncSeat();
}

/* ---------- notices & errors ---------- */
let noticeTimer = null;
function notice(msg, { error = false, sticky = false } = {}) {
  const n = $("notice");
  clearTimeout(noticeTimer);
  n.hidden = !msg; n.textContent = msg || ""; n.classList.toggle("error", error);
  if (msg && !sticky) noticeTimer = setTimeout(() => { n.hidden = true; }, 7000);
}
function writeError(e) {
  if (e && e.code === "invalid_argument") notice("You can view this game but can't save to it. Ask the person who shared it to give you edit access.", { error: true, sticky: true });
  else if (e && e.code === "permission-denied") notice("The game server refused that change. Reload the page and try again.", { error: true });
  else if (e && e.code === "quota_exceeded") notice("The game's storage is full. Delete some card packs and try again.", { error: true });
  else if (e && e.code === "resource-exhausted") notice("The game server hit its free daily limit. It resets within a day.", { error: true, sticky: true });
  else notice(`That didn't save (${(e && e.code) || "network error"}). Try again.`, { error: true });
}
const dbErr = e => { if (e && e.code !== "revoked") writeError(e); };
function toast(head, label, sub = "", big = false) {
  const t = document.createElement("div");
  t.className = `toast${big ? " big" : ""}`;
  t.innerHTML = `<b>${esc(head)}</b><span>${esc(label)}</span>${sub ? `<small>${esc(sub)}</small>` : ""}`;
  $("toasts").append(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), reduced ? 0 : 400); }, big ? 6000 : 3800);
}

/* ---------- presence (who has the page open right now) ---------- */
/* Presence also carries the last lobby revision this page got from the server, so a page that falls behind can tell. */
let presenceExtra = {}, seenRev = 0;
function setPresence(extra) {
  presenceExtra = { ...presenceExtra, ...extra };
  if (room) room.presence({ pid: ME, lobby: code, rev: code ? seenRev : 0, ...presenceExtra }).catch(() => {});
}
function online(pid) {
  if (pid === ME || !room || !roomSince) return true;
  return room.peers().some(p => p.presence && p.presence.pid === pid && p.presence.lobby === code);
}
function trackPresence() {
  if (!L || (room && !room.connected())) return;
  const now = Date.now();
  for (const pid of uniq(Object.keys(P).concat(L.host))) {
    if (online(pid)) delete offlineSince[pid]; else offlineSince[pid] ??= now;
  }
}
const gone = pid => !!offlineSince[pid] && Date.now() - offlineSince[pid] > GONE_MS;
const present = pid => !!P[pid] && !gone(pid);
const byJoined = (a, b) => ((P[a] && P[a].joined) || 0) - ((P[b] && P[b].joined) || 0) || (a < b ? -1 : 1);
const nameOf = pid => (P[pid] && P[pid].name) || (L && L.game && L.game.names[pid]) || "someone";
const isHost = () => !!L && L.host === ME;

function parseLines(text) { return uniq(String(text).split(/\r?\n/).map(cleanCard).filter(Boolean)); }

async function savePack(e) {
  e.preventDefault();
  const name = $("packName").value.trim().slice(0, 40);
  const black = parseLines($("packBlack").value), white = parseLines($("packWhite").value);
  const msg = m => { $("packFormMsg").hidden = !m; $("packFormMsg").textContent = m || ""; };
  if (!name) return msg("Give the pack a name.");
  if (!black.length && !white.length) return msg("Add at least one card.");
  if (black.length > MAX_CARDS || white.length > MAX_CARDS) return msg(`Packs hold up to ${MAX_CARDS} cards of each colour.`);
  const tooMany = black.find(b => blanks(b) > 3);
  if (tooMany) return msg(`This prompt has more than 3 blanks: "${tooMany}"`);
  msg("");
  const id = editingPack || "k" + rid(10);
  try {
    await db.doc("packs/" + id).set({ name, black, white, by: ME, byName: myName || "anonymous", updated: Date.now() });
    closePackForm();
    notice(`Saved "${name}".`);
  } catch (err) { writeError(err); }
}
function openPackForm(id, copyFrom) {
  const src = packById(copyFrom || id);
  editingPack = copyFrom ? null : id;
  $("packFormTitle").textContent = id && !copyFrom ? "Edit pack" : copyFrom ? "Copy of a pack" : "New pack";
  $("packName").value = src ? (copyFrom ? `${src.name} (copy)`.slice(0, 40) : src.name) : "";
  $("packBlack").value = src ? src.black.join("\n") : "";
  $("packWhite").value = src ? src.white.join("\n") : "";
  $("packFormMsg").hidden = true;
  $("packForm").hidden = false;
  $("packName").focus();
}
function closePackForm() { editingPack = null; $("packForm").hidden = true; }

/* ---------- joining & leaving lobbies ---------- */
function requireName() {
  const n = cleanName($("nameInput").value);
  if (!n) { notice("Choose a name first.", { error: true }); $("nameInput").focus(); return null; }
  if (n !== myName || n !== profile.name) { myName = profile.name = n; store.set("cah-name", n); saveProfile(); }
  $("nameInput").value = n;
  return n;
}
async function createLobby() {
  if (!db || !requireName()) return;
  try {
    let c = "";
    for (let i = 0; i < 8; i++) {
      c = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
      if (!(await db.doc("lobbies/" + c).get()).exists) break;
    }
    const now = Date.now();
    await db.doc("lobbies/" + c).set({ code: c, host: ME, hostName: myName, status: "lobby", rev: 1, count: 1, created: now, updated: now, settings: { ...settings(null), game: GAMES[homeGame] ? homeGame : "cah" }, game: null });
    await enterLobby(c);
    pruneOldLobbies();
  } catch (e) { writeError(e); }
}
async function joinLobby(c) {
  if (!db || !requireName()) return;
  c = String(c || "").toUpperCase().trim();
  if (!/^[A-Z]{4}$/.test(c)) return notice("Lobby codes are 4 letters.", { error: true });
  try {
    const s = await db.doc("lobbies/" + c).get();
    if (!s.exists) return notice(`No lobby uses the code ${c}. Check the code with the host.`, { error: true });
    const ps = await db.collection(`lobbies/${c}/players`).get();
    const max = Math.min(MAX_PLAYERS, (s.data().settings || {}).maxPlayers || MAX_PLAYERS);
    if (ps.size >= max && !ps.docs.some(d => d.id === ME)) return notice(`Lobby ${c} is full (${max} players).`, { error: true });
    await enterLobby(c);
  } catch (e) { writeError(e); }
}
async function enterLobby(c) {
  const me = db.doc(`lobbies/${c}/players/${ME}`);
  const s = await me.get();
  if (s.exists) await me.update(seatFields());
  else await me.set({ ...seatFields(), joined: Date.now(), sub: null, pick: null });
  code = c; tab.set("cah-lobby", c);
  seenLobby = false; seenSelf = false; leaving = false; L = null; P = {};
  for (const k in offlineSince) delete offlineSince[k];
  selected = []; czarPick = null; seenRev = 0; behindSince = 0; lagCount = 0;
  $("renameInput").value = myName; $("nameInput").value = myName;
  setPresence({ look: null });
  listen(c);
  render();
}
function listen(c) {
  unsubLobby && unsubLobby(); unsubPlayers && unsubPlayers();
  unsubLobby = db.doc("lobbies/" + c).onSnapshot(snap => {
    if (!snap.exists) { if (seenLobby) exitLobby("The lobby was closed."); return; }
    seenLobby = true;
    const d = clone(snap.data());
    /* while hosting, ignore echoes older than what this browser already decided */
    if (L && L.host === ME && d.host === ME && (d.rev || 0) < (L.rev || 0)) return;
    if (!L || d.rev !== L.rev) noteSkew(d);
    /* the draw piles live in their own document; the host keeps its copy across its own echoes */
    if (d.host === ME && d.game && (d.game.type || "cah") === "cah" && !piled(d.game) && L && L.game && L.game.gid === d.game.gid && piled(L.game)) for (const k of PILES) d.game[k] = L.game[k];
    if (!(snap.metadata && snap.metadata.hasPendingWrites) && (d.rev || 0) !== seenRev) { seenRev = d.rev || 0; setPresence({}); }
    L = d; afterChange();
  }, dbErr);
  unsubPlayers = db.collection(`lobbies/${c}/players`).onSnapshot(snap => {
    P = {};
    for (const d of snap.docs) P[d.id] = d.data();
    if (P[ME]) seenSelf = true;
    else if (seenSelf && !leaving) return exitLobby("The host removed you from the lobby.");
    afterChange();
  }, dbErr);
}
function exitLobby(msg) {
  unsubLobby && unsubLobby(); unsubPlayers && unsubPlayers();
  unsubLobby = unsubPlayers = null;
  clearTimeout(nextTimer); nextKey = "";
  code = null; L = null; P = {}; view = "home";
  tab.set("cah-lobby", null);
  setPresence({ look: null });
  if (msg) notice(msg);
  render();
}
async function leaveLobby() {
  if (!code) return;
  leaving = true;
  const c = code;
  try {
    if (isHost()) {
      const others = Object.keys(P).filter(pid => pid !== ME).sort(byJoined);
      const next = others.find(pid => online(pid) && !gone(pid)) || others[0];
      if (next) { L.host = next; L.hostName = nameOf(next); L.rev++; const body = clone(L); await savePiles(c, body); await db.doc("lobbies/" + c).set(body); }
      else { await db.doc("lobbies/" + c).delete(); await db.doc("directory/" + c).delete(); }
    }
    await db.doc(`lobbies/${c}/players/${ME}`).delete();
  } catch (e) { writeError(e); }
  exitLobby("");
}
async function closeLobby(c) {
  const ps = await db.collection(`lobbies/${c}/players`).get();
  for (const p of ps.docs) await db.doc(`lobbies/${c}/players/${p.id}`).delete();
  await db.doc(`lobbies/${c}/deck/piles`).delete().catch(() => {});
  await db.doc("lobbies/" + c).delete();
  await db.doc("directory/" + c).delete();
}
/* Lobbies abandoned for days get cleared out so the store doesn't fill up. */
async function pruneOldLobbies() {
  try {
    const old = await db.collection("directory").orderBy("updated", "asc").limit(10).get();
    for (const d of old.docs) {
      if (Date.now() - (d.data().updated || 0) < PRUNE_MS) break;
      await closeLobby(d.id);
    }
  } catch {}
}
/* Lobby codes someone has open right now, from the presence list; null until that list can be trusted. */
function occupied() {
  if (!room || !room.connected() || !roomSince || Date.now() - roomSince < 5000) return null;
  const here = new Set(room.peers().map(p => p.presence && p.presence.lobby).filter(Boolean));
  if (code) here.add(code);
  return here;
}
/* Once everyone has closed or left a lobby's page, any browser that sees it empty for EMPTY_MS closes it.
   The wait covers players reloading the page. */
const emptySince = {};
let lastHere = null;
function closeEmptyLobbies() {
  const here = occupied();
  if (!here) return;
  const key = [...here].sort().join();
  if (!code && key !== lastHere) { lastHere = key; render(); }   // the open-lobby list depends on who is where
  if (!db || !canWrite) return;
  const now = Date.now();
  for (const d of directory) {
    if (here.has(d.id) || now - (d.updated || 0) < EMPTY_MS) { delete emptySince[d.id]; continue; }
    emptySince[d.id] ??= now;
    if (now - emptySince[d.id] < EMPTY_MS) continue;
    emptySince[d.id] = Infinity;   // one try per page load; the directory snapshot drops it once deleted
    closeLobby(d.id).catch(() => { delete emptySince[d.id]; });
  }
}

/* ---------- player actions (each player only writes their own document) ---------- */
const myRef = () => db.doc(`lobbies/${code}/players/${ME}`);
async function rename(e) {
  e.preventDefault();
  const n = cleanName($("renameInput").value);
  if (!n) return notice("Names need at least one letter or number.", { error: true });
  myName = profile.name = n; store.set("cah-name", n); $("nameInput").value = n; $("renameInput").value = n;
  saveProfile();
  try { await myRef().update({ name: n }); notice(`You are now @${n}.`); } catch (err) { writeError(err); }
}

/* ---------- host: the host's browser runs the rules and is the only writer of the lobby document ---------- */
let writing = false, dirty = false, lastDir = "", lastDirAt = 0;
async function commit() {
  if (!isHost()) return;
  L.rev = (L.rev || 0) + 1; L.updated = Date.now();
  dirty = true; render();
  if (writing) return;
  writing = true;
  try {
    while (dirty && isHost()) {
      dirty = false;
      const c = code, body = clone(L);
      await savePiles(c, body);
      await db.doc("lobbies/" + c).set(body);
      await syncDirectory(c, body);
    }
  } catch (e) { writeError(e); }
  finally { writing = false; }
}
async function syncDirectory(c, body) {
  const s = settings(body.settings);
  const sum = { hostName: body.hostName || "", count: body.count || 0, max: s.maxPlayers, private: !!s.private, status: body.status, round: body.game ? body.game.round : 0, game: s.game };
  const key = c + JSON.stringify(sum);
  if (key === lastDir && Date.now() - lastDirAt < 600000) return;
  lastDir = key; lastDirAt = Date.now();
  await db.doc("directory/" + c).set({ ...sum, updated: Date.now() });
}

function hostTick() {
  if (!isHost()) return;
  let changed = false;
  const count = Object.keys(P).length;
  if (L.count !== count) { L.count = count; changed = true; }
  if (P[ME] && L.hostName !== P[ME].name) { L.hostName = P[ME].name; changed = true; }
  const g = L.game;
  if (L.status === "playing" && g) changed = (GAMES[g.type || "cah"] || curGame()).tick(g) || changed;
  if (changed) commit();
}
function backToLobby() { if (!isHost()) return; L.status = "lobby"; L.game = null; commit(); }
/* If the host's page has been gone a while, the longest-seated player still here takes over. */
function maybeTakeOver(force) {
  if (!L || isHost()) return;
  if (!force) {
    if (!room || !roomSince || Date.now() - roomSince < 8000 || !gone(L.host)) return;
    const next = Object.keys(P).filter(pid => pid !== L.host && online(pid)).sort(byJoined)[0];
    if (next !== ME) return;
  }
  if (L.game) for (const key of ["deadline", "startAt"]) {
    if (typeof L.game[key] === "number" && L.game[key] > 0) L.game[key] += skew || 0;
  }
  skew = 0; skewHost = ME;
  L.host = ME; L.hostName = myName;
  notice("The host left, so you are hosting now.");
  commit();
}

function afterChange() { trackPresence(); earn(); render(); hostTick(); }

/* ---------- staying in sync ----------
   Phones drop or stall their connection when the screen sleeps, the app is switched or the network changes,
   and the database then backs off before retrying. A resync restarts the connection and re-reads the lobby.
   It runs on its own when the page comes back, when the network returns, and when another player's page
   reports a newer lobby revision than this one has for a few seconds. */
let resyncing = false, behindSince = 0, lagCount = 0, hiddenAt = 0;
const LAG_MS = 4000;
async function resync(full) {
  if (!db || resyncing) return;
  resyncing = true; behindSince = 0; renderSync();
  try {
    if (full && room && room.reconnect) room.reconnect();
    if (db.disableNetwork && db.enableNetwork) { await db.disableNetwork(); await db.enableNetwork(); }
    if (code) listen(code);
  } catch (e) { console.error(e); }
  setTimeout(() => { resyncing = false; renderSync(); }, 600);
}
/* the newest lobby revision another page in this lobby has seen */
function peerRev() {
  if (!room || !code) return 0;
  return Math.max(0, ...room.peers().filter(p => p.presence && p.presence.lobby === code && p.presence.pid !== ME).map(p => +p.presence.rev || 0));
}
function checkLag() {
  const behind = !!L && peerRev() > (L.rev || 0);
  if (!behind) { if (behindSince) { behindSince = 0; renderSync(); } return; }
  if (!behindSince) { behindSince = Date.now(); renderSync(); return; }
  if (Date.now() - behindSince < LAG_MS || resyncing) return;
  /* a page that keeps falling behind switches to long polling, which survives networks that buffer the live stream */
  if (++lagCount >= 3 && !store.get("cah-longpoll", false)) store.set("cah-longpoll", true);
  resync(false);
}
function renderSync() {
  const b = $("syncBtn");
  b.hidden = !code;
  if (!code) return;
  const offline = room && !room.connected(), behind = !!behindSince;
  b.classList.toggle("spin", resyncing);
  b.dataset.state = offline ? "off" : behind ? "lag" : "ok";
  const tip = resyncing ? "Resyncing…" : offline ? "Offline. Tap to reconnect" : behind ? "Behind the table. Tap to resync" : "In sync. Tap to resync";
  b.dataset.tip = tip; b.setAttribute("aria-label", tip);
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > 2000) { hiddenAt = 0; resync(true); }
});
window.addEventListener("online", () => resync(true));
window.addEventListener("pageshow", e => { if (e.persisted) resync(true); });

function tick() {
  checkLag();
  if (!L) return;
  trackPresence();
  hostTick();
  maybeTakeOver(false);
  updateTimer();
  const key = Object.keys(P).sort().map(pid => pid + (gone(pid) ? 0 : 1) + (online(pid) ? 1 : 0)).join();
  if (key !== lastOnline) { lastOnline = key; render(); }
}

/* ---------- rendering ---------- */
function identicon(seed) {
  const h = fnv(seed), hue = h % 360;
  let r = "";
  for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) {
    if ((h >> (y * 3 + x)) & 1) {
      r += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
      if (x < 2) r += `<rect x="${4 - x}" y="${y}" width="1" height="1"/>`;
    }
  }
  return `<svg viewBox="-0.5 -0.5 6 6" aria-hidden="true"><g fill="hsl(${hue} 55% 48%)">${r}</g></svg>`;
}
/* Countdown from the host's deadline, corrected by the best clock offset seen from the host's writes. */
let skew = null, skewHost = null;
function noteSkew(d) {
  if (d.host === ME) { skew = 0; skewHost = ME; return; }
  if (skewHost !== d.host) { skew = null; skewHost = d.host; }
  const s = Date.now() - (d.updated || 0);
  if (Math.abs(s) < 3600e3 && (skew == null || s < skew)) skew = s;
}
const TIMER_LBL = { pick: "to pick", wish: "to wish", twist: "to twist", write: "to write", rate: "to rate" };
function updateTimer() {
  const el = $("timer"), g = L && L.game;
  const live = g && g.deadline && !["result", "over", "reveal"].includes(g.phase);
  el.hidden = !live;
  if (!live) return;
  const left = Math.max(0, Math.ceil((g.deadline + (skew || 0) - Date.now()) / 1000));
  el.innerHTML = `${ICONS.clock}${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}<span class="lbl"> ${TIMER_LBL[g.phase] || (g.type === "mp" ? "for the wisher" : "for the czar")}</span>`;
  el.classList.toggle("urgent", left <= 10);
}
const at = pid => `<strong>@${esc(nameOf(pid))}</strong>`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function render() {
  const v = draft ? "profile" : !code ? view : (!L || L.status === "lobby") ? "lobby" : "game";
  $("viewHome").hidden = v !== "home"; $("viewPacks").hidden = v !== "packs"; $("viewProfile").hidden = v !== "profile";
  $("viewLobby").hidden = v !== "lobby"; $("viewGame").hidden = v !== "game";
  $("leaveBtn").hidden = !code;
  $("codeChip").hidden = v !== "game";   // the lobby shows its code big
  $("roundInfo").hidden = v !== "game";
  if (code) $("codeChip").innerHTML = `<span class="lbl">Lobby </span>${esc(code)}`;
  renderSync();
  renderTop();
  if (v === "home") renderHome();
  else if (v === "packs") renderPacks();
  else if (v === "profile") renderProfile();
  else if (v === "lobby") renderLobby();
  else renderGame();
}

const ic = d => `<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`, dot = (x, y) => `<circle cx="${x}" cy="${y}" r=".9" fill="currentColor" stroke="none"/>`;
const ICONS = {
  trophy: `<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 2h7v4a3.5 3.5 0 0 1-7 0Z" fill="currentColor"/><path d="M4.5 3.5H2v.8A2.6 2.6 0 0 0 4.7 7M11.5 3.5H14v.8A2.6 2.6 0 0 1 11.3 7M8 9.5v3M5 14h6"/></svg>`,
  palette: `<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 1.5a6.5 6.5 0 1 0 0 13c1 0 1.5-.6 1.5-1.4 0-1-.9-1.3-.9-2.2 0-.8.6-1.4 1.4-1.4h1.6a2.9 2.9 0 0 0 2.9-2.9C14.5 3.9 11.6 1.5 8 1.5Z"/><circle cx="4.8" cy="7.2" r="1" fill="currentColor" stroke="none"/><circle cx="7.2" cy="4.4" r="1" fill="currentColor" stroke="none"/><circle cx="10.6" cy="5.2" r="1" fill="currentColor" stroke="none"/></svg>`,
  check: `<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 8.5 3 3 7-7"/></svg>`,
  plus: ic(`<path d="M8 3v10M3 8h10"/>`),
  login: ic(`<path d="M10 2h2.5A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5H10M6.5 5 10 8l-3.5 3M10 8H2"/>`),
  logout: ic(`<path d="M6 14H3.5A1.5 1.5 0 0 1 2 12.5v-9A1.5 1.5 0 0 1 3.5 2H6M10.5 11 14 8l-3.5-3M14 8H6"/>`),
  arrowL: ic(`<path d="M13 8H3M7 4 3 8l4 4"/>`),
  arrowR: ic(`<path d="M3 8h10M9 4l4 4-4 4"/>`),
  cards: ic(`<rect x="2.5" y="4" width="7.5" height="10" rx="1.2"/><path d="M5.5 4V3.2A1.2 1.2 0 0 1 6.7 2h5.6a1.2 1.2 0 0 1 1.2 1.2v7.6a1.2 1.2 0 0 1-1.2 1.2H10"/>`),
  copy: ic(`<rect x="5.5" y="5.5" width="8.5" height="8.5" rx="1.5"/><path d="M10.5 5.5v-2A1.5 1.5 0 0 0 9 2H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2"/>`),
  upload: ic(`<path d="M8 10.5v-8M4.5 6 8 2.5 11.5 6M2.5 10.5v2A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5v-2"/>`),
  undo: ic(`<path d="M2.5 2.5v4h4"/><path d="M2.9 6.5a5.5 5.5 0 1 1 .4 4.6"/>`),
  dice: ic(`<rect x="2" y="2" width="12" height="12" rx="2.5"/>${dot(5.5, 5.5)}${dot(8, 8)}${dot(10.5, 10.5)}`),
  pencil: ic(`<path d="M11 2.5 13.5 5 5.5 13H3v-2.5ZM9.5 4 12 6.5"/>`),
  trash: ic(`<path d="M2.5 4.5h11M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M4 4.5l.7 8.6a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.6"/>`),
  x: ic(`<path d="m4 4 8 8M12 4l-8 8"/>`),
  play: ic(`<path d="M5 3v10l8-5Z" fill="currentColor"/>`),
  skip: ic(`<path d="M3.5 3.5v9l6-4.5Z" fill="currentColor"/><path d="M12.5 3.5v9"/>`),
  stop: ic(`<rect x="3.5" y="3.5" width="9" height="9" rx="1.5"/>`),
  send: ic(`<path d="M14 2 7 9M14 2 9.5 14 7 9 2 6.5Z"/>`),
  crown: ic(`<path d="M2.5 5 5.5 8 8 3l2.5 5 3-3-1 7.5h-9Z"/>`),
  clock: ic(`<circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/>`),
  users: ic(`<circle cx="6" cy="5.5" r="2.5"/><path d="M1.5 13.5a4.5 4.5 0 0 1 9 0M10.5 3.2a2.5 2.5 0 0 1 0 4.6M12.2 9.6a4.5 4.5 0 0 1 2.3 3.9"/>`),
  globe: ic(`<circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c1.8 1.7 2.6 3.7 2.6 6S9.8 12.3 8 14C6.2 12.3 5.4 10.3 5.4 8S6.2 3.7 8 2Z"/>`),
  skull: ic(`<path d="M8 1.8a5.5 5.5 0 0 0-5.5 5.5c0 1.8.8 3 2 3.8V14h7v-2.9c1.2-.8 2-2 2-3.8A5.5 5.5 0 0 0 8 1.8ZM7 14v-1.5M9 14v-1.5"/>${dot(5.8, 7.5)}${dot(10.2, 7.5)}`),
  scroll: ic(`<path d="M4.5 2h8A1.5 1.5 0 0 1 14 3.5V5h-3M11 5v7.5A1.5 1.5 0 0 1 9.5 14h-6A1.5 1.5 0 0 1 2 12.5V11h7M4.5 2A1.5 1.5 0 0 0 3 3.5V11M5.5 5.5h3M5.5 8h3"/>`),
  sync: ic(`<path d="M13.5 8A5.5 5.5 0 0 1 3.6 11.3M2.5 8a5.5 5.5 0 0 1 9.9-3.3"/><path d="M12.6 1.6v3.2H9.4M3.4 14.4v-3.2h3.2"/>`),
  repeat: ic(`<path d="M2.5 7.5V6A2.5 2.5 0 0 1 5 3.5h8.5M11 1l2.5 2.5L11 6M13.5 8.5V10a2.5 2.5 0 0 1-2.5 2.5H2.5M5 15l-2.5-2.5L5 10"/>`),
  hourglass: ic(`<path d="M3.5 1.5h9M3.5 14.5h9M4.5 1.5v2.2a3 3 0 0 0 1.2 2.4L8 8l2.3-1.9a3 3 0 0 0 1.2-2.4V1.5M4.5 14.5v-2.2a3 3 0 0 1 1.2-2.4L8 8l2.3 1.9a3 3 0 0 1 1.2 2.4v2.2"/>`),
  gavel: ic(`<rect x="5.5" y="1.6" width="4" height="8" rx="1" transform="rotate(45 7.5 5.6)"/><path d="m9.2 7.3 4.8 4.8M2 14.5h6"/>`),
  lock: ic(`<rect x="3" y="7" width="10" height="7.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>`),
  paw: ic(`<path d="M5 11c0-1.9 1.4-3.3 3-3.3s3 1.4 3 3.3c0 1.4-.9 2.4-1.9 2.4-.6 0-.7-.4-1.1-.4s-.5.4-1.1.4C5.9 13.4 5 12.4 5 11Z"/><circle cx="3.3" cy="7.6" r="1.3"/><circle cx="6" cy="4.4" r="1.3"/><circle cx="10" cy="4.4" r="1.3"/><circle cx="12.7" cy="7.6" r="1.3"/>`),
  heart: ic(`<path d="M8 13.5S2 10.2 2 6.1A2.9 2.9 0 0 1 8 4.6a2.9 2.9 0 0 1 6 1.5c0 4.1-6 7.4-6 7.4Z"/>`),
  list: ic(`<path d="M6 4h8M6 8h8M6 12h8"/><circle cx="2.8" cy="4" r=".6" fill="currentColor"/><circle cx="2.8" cy="8" r=".6" fill="currentColor"/><circle cx="2.8" cy="12" r=".6" fill="currentColor"/>`),
  eye: ic(`<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/>`),
  sliders: ic(`<path d="M2 4.5h7M12 4.5h2M2 11.5h2M7 11.5h7"/><circle cx="10.5" cy="4.5" r="1.5"/><circle cx="5.5" cy="11.5" r="1.5"/>`),
  chev: `<svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`
};
// Static markup marks its icons with <i data-ic="name">
document.querySelectorAll("[data-ic]").forEach(el => { el.outerHTML = ICONS[el.dataset.ic]; });
function renderTop() {
  const { lvl, into, need: n } = levelOf(profile.xp), s = profile.stats;
  $("meChip").innerHTML = `${avHTML(myLook(), "md")}<span class="me-name">@${esc(myName || "unnamed ruler")}</span>
    <span class="me-rank">Lv. ${lvl}<span class="xpbar" title="${into} / ${n} XP to level ${lvl + 1}"><i style="width:${(into / n * 100).toFixed(1)}%"></i></span></span>
    ${ICONS.chev}`;
  $("meChip").setAttribute("aria-label", `Your ruler, @${myName || "unnamed ruler"}, level ${lvl}`);
  if (menuOpen === "ruler") renderRuler();
  $("victories").setAttribute("aria-label", `${s.wins} victories`);
  $("victories").innerHTML = `${ICONS.trophy}<strong>${s.wins}</strong><span>Victories</span>`;
}

function renderRuler() {
  const { lvl, into, need: n } = levelOf(profile.xp), s = profile.stats;
  $("rulerCard").innerHTML = `
    <div class="ruler-top">${avHTML(myLook(), "xl")}
      <div><p class="ruler-name">@${esc(myName || "unnamed ruler")}</p>
        <p class="ruler-rank">${esc(rankOf(lvl))} · Level ${lvl}</p>
        <div class="xpbar"><i style="width:${(into / n * 100).toFixed(1)}%"></i></div>
        <div class="xp-line"><span>${into.toLocaleString()} / ${n.toLocaleString()} XP</span><span>${profile.xp.toLocaleString()} total</span></div></div></div>
    <dl class="stats">
      ${[["Victories", s.wins], ["Games played", s.games]]
        .map(([k, v]) => `<div class="stat"><dt>${k}</dt><dd>${v}</dd></div>`).join("")}
    </dl>
    <p class="hint">Play, judge and win to earn XP and climb the ranks.</p>
    <div class="menu-actions"><button class="btn small primary" type="button" data-act="open-profile">${ICONS.pencil}Edit portrait and name</button>
      ${firebaseAccountUser ? `<button class="btn small" type="button" data-act="account-open">${ICONS.login}Connect devices</button>` : ""}</div>`;
}

function renderStandings() {
  const list = standings.filter(d => d.xp > 0 || d.id === uid);
  if (uid && !list.some(d => d.id === uid) && profile.xp > 0) list.push({ id: uid, ...profile });
  list.sort((a, b) => b.xp - a.xp);
  $("standings").innerHTML = !db ? `<li class="empty">Standings show up here once the game is connected.</li>`
    : list.length ? list.slice(0, 10).map((d, i) => {
      const me = d.id === uid, lvl = levelOf(d.xp).lvl;
      const look = me ? myLook() : { face: d.face, img: d.img, lvl };
      return `<li class="row std ${me ? "me" : ""} ${i < 3 ? `top${i + 1}` : ""}"><span class="rank-n">${i + 1}</span>${avHTML(look, "")}
        <span class="row-main"><span class="row-title">@${esc((me ? myName || "unnamed ruler" : d.name) || "unknown ruler")}${me ? " (you)" : ""}</span>
          <span class="row-sub">${esc(rankOf(lvl))} · Level ${lvl} · ${plural(d.stats.wins, "victory", "victories")}</span></span>
        <span class="xp-num">${d.xp.toLocaleString()} XP</span></li>`;
    }).join("")
    : `<li class="empty">Nobody has earned XP yet. Finish a game to claim the top spot.</li>`;
}

/* Personal codes are random bearer credentials. They never appear in public profile documents. */
const ACCOUNT_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const normalizeAccountCode = value => String(value).toUpperCase().replace(/[\s-]/g, "");
const validAccountCode = value => /^[A-HJ-NP-Z2-9]{24}$/.test(value);
const formatAccountCode = value => value.match(/.{1,6}/g)?.join("-") || "";
function newAccountCode() {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), n => ACCOUNT_ALPHABET[n & 31]).join("");
}
function accountMessage(message) { $("accountMsg").textContent = message; }
function renderAccount() {
  $("accountPanel").hidden = !firebaseAccountUser;
  $("personalCode").value = formatAccountCode(personalCode);
  $("accountCopy").textContent = personalCode ? "Copy code" : "Get my code";
  $("accountCopy").disabled = accountBusy || !canWrite;
  $("accountConnect").disabled = accountBusy || !!code || !canWrite;
}
function accountError(e) {
  accountMessage(e.code === "permission-denied"
    ? "Account connections are not available on this server yet. Please try again later."
    : "Couldn't connect. Check your connection and try again.");
}
async function bindProfile(id, replace = false) {
  unsubProfile && unsubProfile(); unsubProfile = null;
  const previous = uid;
  const snap = await db.doc("profiles/" + id).get();
  uid = id;
  try { pendingRewards = JSON.parse(store.get(rewardStoreKey(), "[]")); if (!Array.isArray(pendingRewards)) pendingRewards = []; } catch { pendingRewards = []; }
  if (replace || (store.get("cah-profile-account", previous) !== id)) {
    profile = cleanProfile(null, ME); syncedLook = null; myName = "";
  }
  store.set("cah-profile-account", id);
  if (snap.exists) adoptProfile(snap.data()); else if (canWrite) await saveProfile();
  if (pendingRewards.length) await saveProfile();
  unsubProfile = db.doc("profiles/" + id).onSnapshot(s => {
    if (uid === id && s.exists && !saving && !saveAgain) { adoptProfile(s.data()); render(); }
  }, dbErr);
  $("nameInput").value = $("renameInput").value = myName;
}
async function copyPersonalCode() {
  if (!firebaseAccountUser || accountBusy) return;
  accountBusy = true; renderAccount();
  try {
    if (!personalCode) {
      if (!await saveProfile()) throw new Error("Profile not saved");
      const candidate = newAccountCode(), linkRef = db.doc("accountLinks/" + firebaseAccountUser);
      const link = await db.runTransaction(async tx => {
        const existing = await tx.get(linkRef);
        if (existing.exists) return existing.data();
        const keyRef = db.doc("accountKeys/" + candidate), key = await tx.get(keyRef);
        if (key.exists) throw new Error("Code collision; try again");
        const data = { accountId: firebaseAccountUser, code: candidate };
        tx.set(keyRef, { accountId: firebaseAccountUser }); tx.set(linkRef, data);
        return data;
      });
      if (link.accountId !== uid) { accountMessage("Your account changed in another tab. Reload before continuing."); return; }
      personalCode = link.code;
    }
    renderAccount();
    try { await navigator.clipboard.writeText(formatAccountCode(personalCode)); accountMessage("Copied. Enter this code in your profile on another device."); }
    catch { $("personalCode").focus(); $("personalCode").select(); accountMessage("Your code is ready. Select and copy it to use on another device."); }
  } catch (e) { accountError(e); }
  finally { accountBusy = false; renderAccount(); }
}
async function connectAccount(e) {
  e.preventDefault();
  if (!firebaseAccountUser || accountBusy) return;
  if (code) { accountMessage("Leave your lobby before switching profiles."); return; }
  const key = normalizeAccountCode($("accountInput").value);
  if (!validAccountCode(key)) { accountMessage("Enter all 24 letters and numbers of your personal code."); return; }
  accountBusy = true; renderAccount();
  try {
    const snap = await db.doc("accountKeys/" + key).get();
    if (!snap.exists) { accountMessage("That personal code wasn't found. Check it and try again."); return; }
    const target = snap.data().accountId;
    if (target === uid) { personalCode = key; accountMessage("This device is already connected to that profile."); return; }
    if (!await saveProfile()) { accountMessage("Couldn't save this profile. Try again before switching."); return; }
    await db.doc("accountLinks/" + firebaseAccountUser).set({ accountId: target, code: key });
    await bindProfile(target, true);
    personalCode = key; draft = null; $("accountInput").value = "";
    notice("Connected to @" + (myName || "your ruler") + ". Your profile will stay in sync on this device.");
    render();
  } catch (err) { accountError(err); }
  finally { accountBusy = false; renderAccount(); }
}

/* Portrait editor: `draft` holds the unsaved face, picture and name while the editor is open. */
let draft = null;
function openProfile() { draft = { face: { ...profile.face }, img: profile.img, name: myName }; $("pfName").value = myName; $("pfMsg").hidden = true; render(); }
function renderProfile() {
  renderAccount();
  const lvl = levelOf(profile.xp).lvl;
  $("pfBig").innerHTML = avHTML({ face: draft.face, img: draft.img, lvl }, "xxl");
  $("pfRank").textContent = `${rankOf(lvl)} · Level ${lvl}`;
  $("pfClearImg").hidden = !draft.img;
  const f = draft.face;
  $("pfSpecies").innerHTML = SPECIES.map((name, i) => `<button class="sp" type="button" data-face="s" data-val="${i}" aria-pressed="${f.s === i}">
    ${avHTML({ face: { ...f, s: i } }, "lg", false)}<span>${name}</span></button>`).join("");
  const sw = (key, list, label) => list.map((c, i) => `<button class="sw" type="button" style="--sw:${c}" data-face="${key}" data-val="${i}" aria-pressed="${f[key] === i}" aria-label="${label} ${i + 1}"></button>`).join("");
  $("pfSkin").innerHTML = sw("k", SKINS, "Skin colour");
  $("pfEyes").innerHTML = sw("e", EYES, "Eye colour");
  $("pfAttire").innerHTML = sw("a", ATTIRE, "Uniform colour");
  $("pfBack").innerHTML = sw("b", BACKS, "Backdrop colour");
}
function saveRuler() {
  const n = cleanName($("pfName").value);
  if (!n) { $("pfMsg").hidden = false; $("pfMsg").textContent = "Names need at least one letter or number."; return; }
  myName = profile.name = n; store.set("cah-name", n);
  profile.face = cleanFace(draft.face, ME); profile.img = validImg(draft.img);
  $("nameInput").value = $("renameInput").value = n;
  draft = null;
  saveProfile(); syncSeat();
  notice("Ruler saved.");
  render();
}
/* Crops an uploaded picture to a square and shrinks it so it fits comfortably in the profile document. */
function loadPicture(file) {
  if (!file || !/^image\//.test(file.type)) return;
  const url = URL.createObjectURL(file), im = new Image();
  im.onload = () => {
    const c = document.createElement("canvas"), n = 128, side = Math.min(im.width, im.height);
    c.width = c.height = n;
    c.getContext("2d").drawImage(im, (im.width - side) / 2, (im.height - side) / 2, side, side, 0, 0, n, n);
    URL.revokeObjectURL(url);
    let q = .85, data = c.toDataURL("image/jpeg", q);
    while (data.length > 50000 && q > .3) { q -= .15; data = c.toDataURL("image/jpeg", q); }
    if (!validImg(data)) { $("pfMsg").hidden = false; $("pfMsg").textContent = "That picture couldn't be used. Try a JPEG or PNG."; return; }
    if (draft) { draft.img = data; $("pfMsg").hidden = true; renderProfile(); }
  };
  im.onerror = () => { URL.revokeObjectURL(url); $("pfMsg").hidden = false; $("pfMsg").textContent = "That file isn't a picture this browser can read."; };
  im.src = url;
}

function renderHome() {
  renderStandings();
  if (!$("gameMenu").querySelector(`input[value="${homeGame}"]:checked`)) $("gameMenu").innerHTML = gameTiles("home-game", homeGame, false);
  const off = !db || !canWrite;
  $("createBtn").disabled = $("joinBtn").disabled = off;
  const now = Date.now(), here = occupied();
  /* lobbies still waiting for players come first; ones nobody has open are hidden while they wait to be closed */
  const rows = directory.filter(d => /^[A-Z]{4}$/.test(d.id) && d.count > 0 && !d.private && now - (d.updated || 0) < STALE_MS
      && (!here || here.has(d.id) || now - (d.updated || 0) < EMPTY_MS))
    .sort((a, b) => (b.status === "lobby") - (a.status === "lobby"));
  $("lobbyCount").hidden = !db || !rows.length;
  $("lobbyCount").textContent = `${rows.length} open`;
  $("lobbyList").innerHTML = !db
    ? `<li class="empty">Open lobbies show up here once the game is connected.</li>`
    : rows.length ? rows.map(d => {
      const max = Math.min(MAX_PLAYERS, d.max || MAX_PLAYERS), full = d.count >= max, waiting = d.status === "lobby";
      const state = waiting ? ["waiting", "Waiting for players"] : d.status === "over" ? ["over", "Game over"] : ["playing", `Round ${d.round || 1} in play`];
      const pips = Array.from({ length: max }, (_, i) => `<i class="${i < d.count ? "on" : ""}"></i>`).join("");
      return `<li class="row lobby-row">
        <span class="code-tag">${d.id}</span><span class="dir-game" data-tip="${esc((GAMES[d.game] || GAMES.cah).name)}">${ICONS[(GAME_UI[d.game] || GAME_UI.cah).icon]}</span>
        <span class="row-main"><span class="row-title">@${esc(d.hostName || "host")}'s lobby</span>
          <span class="row-sub"><span class="state ${state[0]}">${state[1]}</span>
            <span class="seats" role="img" aria-label="${d.count} of ${max} players">${pips}<b>${d.count}/${max}</b></span></span></span>
        <span class="row-actions"><button class="btn small ${waiting && !full ? "primary" : ""}" type="button" data-join="${d.id}" ${off || full ? "disabled" : ""}>${full ? "Full" : `${ICONS.login}Join`}</button></span></li>`;
    }).join("")
    : `<li class="lobby-empty"><strong>No open lobbies right now.</strong>Create one and send the code to your friends.</li>`;
}

function renderPacks() {
  $("packList").innerHTML = allPacks().map(p => {
    const mine = !p.builtin && p.by === ME;
    const kind = KINDS.find(k => k.kind === p.kind);
    const by = `${kind && p.builtin ? `${kind.label} · ` : ""}${packBy(p)}${mine ? " (you)" : ""}`;
    return `<li class="row">
      <span class="avatar">${identicon(p.id)}</span>
      <span class="row-main"><span class="row-title">${esc(p.name)}</span>
        <span class="row-sub">${by} · ${plural(p.black.length, "prompt", "prompts")} · ${plural(p.white.length, "answer", "answers")}</span></span>
      <span class="row-actions">
        ${mine ? `<button class="btn small icon" type="button" data-edit-pack="${esc(p.id)}" data-tip="Edit" aria-label="Edit ${esc(p.name)}">${ICONS.pencil}</button>` : ""}
        <button class="btn small icon" type="button" data-copy-pack="${esc(p.id)}" data-tip="Make a copy" aria-label="Copy ${esc(p.name)}" ${db && canWrite ? "" : "disabled"}>${ICONS.copy}</button>
        ${mine ? `<button class="btn small danger ${armedDelete === p.id ? "armed" : "icon"}" type="button" data-del-pack="${esc(p.id)}" ${armedDelete === p.id ? "" : `data-tip="Delete" aria-label="Delete ${esc(p.name)}"`}>${ICONS.trash}${armedDelete === p.id ? "Confirm delete" : ""}</button>` : ""}
      </span></li>`;
  }).join("");
  document.querySelector('[data-act="new-pack"]').disabled = !db || !canWrite;
}

let packOpen = "";   // the pack group expanded in the lobby picker
function renderLobby() {
  $("lobbyCode").innerHTML = code ? `${esc(code)}${ICONS.copy}` : "";
  $("lobbyCode").setAttribute("aria-label", `Copy lobby code ${code || ""}`.trim());
  if (!L) {
    $("lobbyPlayers").innerHTML = `<li class="empty">Connecting to the lobby<span class="dots"></span></li>`;
    $("lobbySettings").innerHTML = ""; $("lobbyStart").innerHTML = "";
    return;
  }
  const host = isHost();
  const ids = Object.keys(P).sort(byJoined);
  $("playersHead").innerHTML = `${ICONS.users}Players · ${ids.length} of ${settings().maxPlayers}`;
  fetchPeople(ids.map(pid => P[pid].uid));
  $("lobbyPlayers").innerHTML = ids.map(pid => {
    const away = gone(pid) || !online(pid), look = lookOf(pid);
    return `<li class="seat ${pid === ME ? "me" : ""} ${away ? "away" : ""}">${avHTML(look, "md")}
      <span class="row-main"><span class="row-title" title="@${esc(P[pid].name || "player")}">@${esc(P[pid].name || "player")}</span>
        <span class="row-sub"><span class="dot ${away ? "off" : ""}"></span>${away ? "Away" : esc(rankOf(look.lvl))}</span></span>
      <span class="seat-badges">${pid === L.host ? `<span class="chip won">Host</span>` : ""}${pid === ME ? `<span class="chip">You</span>` : ""}
        ${host && pid !== ME ? `<button class="btn small danger icon" type="button" data-kick="${pid}" data-tip="Remove from lobby" aria-label="Remove @${esc(P[pid].name || "player")}">${ICONS.x}</button>` : ""}</span></li>`;
  }).join("") + Array.from({ length: Math.max(0, settings().maxPlayers - ids.length) }, (_, i) => `<li class="seat vacant"><span class="seat-number">${ids.length + i + 1}</span>Open seat</li>`).join("");

  const s = settings(), chosen = new Set(s.packs || []), off = host ? "" : "disabled";
  const all = allPacks(), counts = deckCounts([...chosen]);
  const onCount = all.filter(p => chosen.has(p.id)).length;
  const packRows = KINDS.map(k => {
    const list = all.filter(p => p.kind === k.kind);
    if (!list.length) return "";
    const on = list.filter(p => chosen.has(p.id)).length;
    const all1 = on === list.length, open = packOpen === k.kind;
    const bulk = host && list.length > 1 ? `<button class="btn small" type="button" data-pack-group="${k.kind}" data-on="${all1 ? 0 : 1}">${all1 ? "None" : "All"}</button>` : "";
    return `<li class="pg ${open ? "open" : ""}">
      <div class="pg-head"><button class="pg-name" type="button" data-pack-open="${k.kind}" aria-expanded="${open}">${ICONS.chev}<span>${k.label}</span><b class="${on ? "on" : ""}">${on}/${list.length}</b></button>${bulk}</div>
      ${open ? `${k.hint ? `<p class="hint">${k.hint}</p>` : ""}<div class="pchips">${list.map(p => `<label class="pchip" title="${packBy(p)} · ${p.black.length} black · ${p.white.length} white">
        <input type="checkbox" id="pk-${esc(p.id)}" data-pack="${esc(p.id)}" ${chosen.has(p.id) ? "checked" : ""} ${off}><span>${esc(p.name)}</span></label>`).join("")}</div>` : ""}</li>`;
  }).join("");
  const fields = keys => keys.map(k => SETTINGS.find(o => o.key === k)).map(o => {
    const n = s[o.key], top = o.none ? o.max + o.step : o.max, at = slideAt(o, n);
    return `<div class="slide"><span class="slide-ic" data-tip="${o.label}">${ICONS[o.icon]}</span>
      <input type="range" id="set-${o.key}" data-setting="${o.key}" min="${o.min}" max="${top}" step="${o.step}" value="${at}" style="--p:${(at - o.min) / (top - o.min) * 100}%"
        aria-label="${o.label}" aria-valuetext="${o.fmt(n)}" ${off}>
      <span ${host ? `data-tip="Type any value up to ${o.cap}"` : ""}><input class="num" type="text" inputmode="numeric" maxlength="5" data-num="${o.key}" value="${showSetting(o, n)}" aria-label="${o.label}" ${off}></span></div>`;
  }).join("");
  const gid = GAMES[s.game] ? s.game : "cah", ui = GAME_UI[gid];
  const flags = Object.keys(LANGS).map(l => `<label class="flag" data-tip="${LANGS[l]}"><input type="radio" name="set-lang" data-setting="lang" value="${l}" aria-label="${ui.deck} in ${LANGS[l]}" ${s.lang === l ? "checked" : ""} ${off}>${FLAGS[l]}</label>`).join("");
  const lang = `<div class="flags" role="radiogroup" aria-label="${ui.deck} language">${flags}</div>`;
  const rules = keys => `<fieldset class="setting-section"><legend>${ICONS.scroll}House rules</legend><div class="settings-grid">${fields(keys)}</div>
      <label class="slide toggle ${host ? "" : "disabled"}"><span class="slide-ic" data-tip="Only friends with the code can find you">${ICONS.lock}</span>
        <span class="row-title">Private table</span><input type="checkbox" id="set-private" data-setting="private" ${s.private ? "checked" : ""} ${off}></label></fieldset>`;
  const body = gid === "mp" ? `${rules(["target", "maxPlayers"])}
    <fieldset class="setting-section"><legend>${ICONS.clock}Timers</legend><div class="settings-grid">${fields(["mpTime", "next"])}</div></fieldset>
    <fieldset class="setting-section"><legend>${ICONS.paw}Wish deck</legend>${lang}<p class="hint">The wisher can draw one of three wishes or type their own.</p></fieldset>`
    : gid === "sd" ? `${rules(["target", "maxPlayers"])}
    <fieldset class="setting-section"><legend>${ICONS.heart}The date</legend><div class="settings-grid">${fields(["sdCount", "sdEvery", "sdWrite", "next"])}</div>
      ${lang}<p class="hint">Listeners secretly add one trait each, up to half the date. The rest is drawn at random. The best speaker of each lap scores.</p></fieldset>`
    : "";
  const picker = `<div class="game-tiles compact" role="radiogroup" aria-label="Game">${gameTiles("set-game", gid, !host)}</div>`;
  if (!sliding && !(document.activeElement && document.activeElement.dataset.num)) $("lobbySettings").innerHTML = picker + (body || `
    <fieldset class="setting-section"><legend>${ICONS.scroll}House rules</legend><div class="settings-grid">${fields(["target", "rounds", "hand", "maxPlayers"])}</div>
      <label class="slide toggle ${host ? "" : "disabled"}"><span class="slide-ic" data-tip="Only friends with the code can find you">${ICONS.lock}</span>
        <span class="row-title">Private table</span><input type="checkbox" id="set-private" data-setting="private" ${s.private ? "checked" : ""} ${off}></label></fieldset>
    <fieldset class="setting-section"><legend>${ICONS.clock}Timers</legend><div class="settings-grid">${fields(["pickTime", "judgeTime", "next"])}</div></fieldset>
    <fieldset class="setting-section"><legend>${ICONS.cards}Deck</legend><div class="flags" role="radiogroup" aria-label="Card language">${flags}</div>
      ${s.lang && s.lang !== "en" ? `<p class="hint">Built-in packs use ${LANGS[s.lang]}; untranslated and player-made cards stay in English.</p>` : ""}
      <div class="pack-picker"><div class="pack-sum"><span class="row-title">Card packs</span>
        <span class="hint">${plural(onCount, "pack", "packs")} &middot; ${counts.black.toLocaleString()} black &middot; ${counts.white.toLocaleString()} white</span></div>
        <ul class="pgs">${packRows}</ul></div></fieldset>`) + (host ? "" : `<p class="hint">Only the host can change these settings.</p>`);

  if (host) {
    const chk = startCheck(), missing = Math.max(0, curGame().min - ids.filter(present).length);
    $("lobbyStart").innerHTML = `<button class="btn primary big" type="button" data-act="start" ${chk.ok ? "" : "disabled"}>${ICONS.play}Start game</button>
      <span class="hint">${chk.ok ? `${plural(ids.filter(present).length, "player", "players")} ready. ${ui.go}` : missing ? `Need ${plural(missing, "more player", "more players")} to start. Share the lobby code.` : esc(chk.why)}</span>`;
  } else {
    $("lobbyStart").innerHTML = `<span class="hint">Waiting for ${at(L.host)} to start the game.</span>
      ${!room ? `<button class="btn small" type="button" data-act="take-over">${ICONS.crown}Host not responding? Take over</button>` : ""}`;
  }
}

/* ---------- input ---------- */
async function copyCode() {
  const m = $("copyMsg");
  try { await navigator.clipboard.writeText(code); m.textContent = "Copied. Send it to your friends."; }
  catch { m.textContent = "Select the code to copy it."; const r = document.createRange(); r.selectNodeContents($("lobbyCode")); getSelection().removeAllRanges(); getSelection().addRange(r); }
}
/* Themes: a per-browser preference. Dark unless the player picks otherwise; "system" follows the OS light/dark setting. */
const THEMES = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
  { id: "felt", label: "Felt" },
  { id: "oled", label: "Midnight" },
  { id: "crimson", label: "Crimson" },
  { id: "paper", label: "Newsprint" },
  { id: "system", label: "Match system" }
];
const lightOS = matchMedia("(prefers-color-scheme: light)");
let themePref = store.get("cah-theme", "dark");
if (!THEMES.some(t => t.id === themePref)) themePref = "dark";
function applyTheme() {
  const t = themePref === "system" ? (lightOS.matches ? "light" : "dark") : themePref;
  document.documentElement.setAttribute("data-theme", t);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  const cur = THEMES.find(x => x.id === themePref);
  $("themeBtn").innerHTML = ICONS.palette;
  $("themeBtn").setAttribute("aria-label", `Theme: ${cur.label}`);
  if (menuOpen === "theme") renderThemes();
}
function renderThemes() {
  $("themeMenu").innerHTML = `
    <h2 class="ptitle">Theme</h2>
    <ul class="themes" role="radiogroup" aria-label="Theme">${THEMES.map(t => `
      <li><button class="theme-opt" type="button" role="radio" aria-checked="${t.id === themePref}" data-theme-pick="${t.id}">
        <span class="theme-sw${t.id === "system" ? " split" : ""}"${t.id === "system" ? "" : ` data-theme="${t.id}"`}><i></i><b></b></span>
        <span class="tname">${t.label}${t.id === themePref ? ICONS.check : ""}</span>
      </button></li>`).join("")}
    </ul>`;
}
function setTheme(id) {
  themePref = id; store.set("cah-theme", id);
  applyTheme();
  const b = $("themeMenu").querySelector(`[data-theme-pick="${id}"]`); if (b) b.focus();
}
lightOS.addEventListener("change", () => { if (themePref === "system") applyTheme(); });

/* Top-bar dropdowns: the ruler dossier under the profile chip, the theme picker. One is open at a time. */
let menuOpen = null;
const MENUS = { ruler: ["meChip", "rulerCard", ".me-wrap"], theme: ["themeBtn", "themeMenu", ".theme-wrap"] };
function setMenu(which) {
  menuOpen = which && !(which === "ruler" && draft) ? which : null;
  for (const [k, [btn, box]] of Object.entries(MENUS)) { $(box).hidden = menuOpen !== k; $(btn).setAttribute("aria-expanded", menuOpen === k); }
  if (menuOpen === "ruler") renderRuler();
  if (menuOpen === "theme") renderThemes();
}
applyTheme();
document.addEventListener("keydown", e => { if (e.key === "Escape" && menuOpen) { const btn = MENUS[menuOpen][0]; setMenu(null); $(btn).focus(); } });
document.addEventListener("click", e => {
  const t = e.target;
  if (menuOpen && !t.closest(MENUS[menuOpen][2])) setMenu(null);
  const tp = t.closest("[data-theme-pick]");
  if (tp) return setTheme(tp.dataset.themePick);
  const h = t.closest("[data-hand]");
  if (h && !h.disabled && L && L.game && L.game.phase === "pick") { toggleCard(+h.dataset.hand); return render(); }
  const s = t.closest("[data-sub]");
  if (s && L && L.game && L.game.phase === "judge" && L.game.czar === ME) {
    czarPick = +s.dataset.sub; setPresence({ look: { gid: L.game.gid, round: L.game.round, k: czarPick } });
    revealSub(czarPick); return render();
  }
  const j = t.closest("[data-join]");
  if (j && !j.disabled) return joinLobby(j.dataset.join);
  const k = t.closest("[data-kick]");
  if (k && isHost()) { db.doc(`lobbies/${code}/players/${k.dataset.kick}`).delete().catch(writeError); return; }
  const po = t.closest("[data-pack-open]");
  if (po) { packOpen = packOpen === po.dataset.packOpen ? "" : po.dataset.packOpen; return render(); }
  const pg = t.closest("[data-pack-group]");
  if (pg && !pg.disabled && isHost() && L.status === "lobby") {
    const set = new Set(settings().packs), ids = allPacks().filter(p => p.kind === pg.dataset.packGroup).map(p => p.id);
    for (const id of ids) pg.dataset.on === "1" ? set.add(id) : set.delete(id);
    L.settings = { ...settings(), packs: [...set] }; commit();
    return;
  }
  const ep = t.closest("[data-edit-pack]");
  if (ep) return openPackForm(ep.dataset.editPack);
  const cp = t.closest("[data-copy-pack]");
  if (cp && !cp.disabled) return openPackForm(null, cp.dataset.copyPack);
  const dp = t.closest("[data-del-pack]");
  if (dp) {
    const id = dp.dataset.delPack;
    if (armedDelete !== id) { armedDelete = id; return renderPacks(); }
    armedDelete = null;
    if (editingPack === id) closePackForm();
    db.doc("packs/" + id).delete().then(() => notice("Pack deleted.")).catch(writeError);
    return;
  }
  const fc = t.closest("[data-face]");
  if (fc && draft) { draft.face[fc.dataset.face] = +fc.dataset.val; draft.img = null; return renderProfile(); }
  const a = t.closest("[data-act]");
  if (!a || a.disabled) return;
  const act = a.dataset.act;
  if (act === "toggle-menu") setMenu(menuOpen === "ruler" ? null : "ruler");
  else if (act === "toggle-theme") setMenu(menuOpen === "theme" ? null : "theme");
  else if (act === "account-open") { setMenu(null); openProfile(); $("accountPanel").scrollIntoView({ behavior: "smooth", block: "center" }); }
  else if (act === "account-copy") copyPersonalCode();
  else if (act === "open-profile") { setMenu(null); openProfile(); }
  else if (act === "pf-save" && draft) saveRuler();
  else if (act === "pf-cancel") { draft = null; render(); }
  else if (act === "pf-random" && draft) { draft.face = seedFace(rid(6)); draft.img = null; renderProfile(); }
  else if (act === "pf-clear-img" && draft) { draft.img = null; renderProfile(); }
  else if (act === "join-code") joinLobby($("codeInput").value);
  else if (act === "open-packs") { view = "packs"; render(); }
  else if (act === "close-packs") { view = "home"; closePackForm(); render(); }
  else if (act === "new-pack") openPackForm(null);
  else if (act === "cancel-pack") closePackForm();
  else if (act === "leave") leaveLobby();
  else if (act === "resync") resync(true);
  else if (act === "copy-code") copyCode();
  else if (act === "deal") dealHero();
  else if (act === "start") startGame();
  else if (act === "take-over") maybeTakeOver(true);
  else if (act === "submit") submitCards();
  else if (act === "award") awardPick();
  else if ((act === "next" || act === "skip") && isHost() && L.game && GAMES[L.game.type] && GAMES[L.game.type][act]) {
    if (act === "skip" || L.game.phase === "result") { GAMES[L.game.type][act](L.game); commit(); }
  }
  else if (act === "next" && isHost() && L.game.phase === "result" && piled(L.game)) { startRound(L.game); commit(); }
  else if (act === "skip" && isHost() && piled(L.game)) { skipRound(L.game, "The host skipped this round."); commit(); }
  else if (act === "end" || act === "again") backToLobby();
});
document.addEventListener("change", e => { if (e.target.dataset.homeGame !== undefined) homeGame = e.target.value; });
document.addEventListener("change", e => {
  if (!isHost() || L.status !== "lobby") return;
  const key = e.target.dataset.setting;
  if (key) { L.settings = { ...settings(), [key]: key === "private" ? e.target.checked : key === "lang" || key === "game" ? e.target.value : slideValue(e.target) }; sliding = false; commit(); }
  else if (e.target.dataset.num) {
    const o = SETTINGS.find(o => o.key === e.target.dataset.num), n = parseInt(e.target.value, 10);
    const v = n > 0 ? Math.min(o.cap, Math.max(o.min, n)) : o.none ? 0 : settings()[o.key];
    e.target.value = showSetting(o, v);
    L.settings = { ...settings(), [o.key]: v }; commit();
  }
  else if (e.target.dataset.pack) {
    const set = new Set(settings().packs);
    e.target.checked ? set.add(e.target.dataset.pack) : set.delete(e.target.dataset.pack);
    L.settings.packs = [...set]; commit();
  }
});
function slideValue(el) {
  const o = SETTINGS.find(o => o.key === el.dataset.setting);
  return o.none && +el.value > o.max ? 0 : +el.value;
}
// Sliders show their value while dragging; the setting is saved on release (the change event above)
document.addEventListener("input", e => {
  const o = e.target.type === "range" && SETTINGS.find(o => o.key === e.target.dataset.setting);
  if (!o) return;
  const v = slideValue(e.target);
  e.target.style.setProperty("--p", `${(e.target.value - e.target.min) / (e.target.max - e.target.min) * 100}%`);
  e.target.setAttribute("aria-valuetext", o.fmt(v));
  e.target.parentNode.querySelector("[data-num]").value = showSetting(o, v);
});
// The value boxes: Enter saves, and leaving the box lets the settings re-render (they hold still while you type)
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.dataset && e.target.dataset.num) { e.preventDefault(); e.target.blur(); } });
document.addEventListener("focusout", e => { if (e.target.dataset && e.target.dataset.num) setTimeout(render); });
document.addEventListener("pointerdown", e => { if (e.target.type === "range") sliding = true; });
document.addEventListener("pointerup", () => setTimeout(() => { sliding = false; }));
$("startForm").addEventListener("submit", e => { e.preventDefault(); createLobby(); });
$("codeInput").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); joinLobby($("codeInput").value); } });
$("accountForm").addEventListener("submit", connectAccount);
$("packForm").addEventListener("submit", savePack);
$("renameForm").addEventListener("submit", rename);
$("pfFile").addEventListener("change", e => { loadPicture(e.target.files[0]); e.target.value = ""; });
$("pfName").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); saveRuler(); } });


/* ---------- Firebase backend (used outside claude.ai, e.g. on GitHub Pages) ---------- */
/* Paste the web app config from the Firebase console here. These values identify the project; they are not secrets.
   Access is controlled by the security rules in firestore.rules and database.rules.json. */
const FIREBASE = {
  apiKey: "AIzaSyClc6pCnu7hYhCSJ8tAumHe2JZ_UGGYRTc",
  authDomain: "cardsagainsthumanity-9090e.firebaseapp.com",
  databaseURL: "https://cardsagainsthumanity-9090e-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "cardsagainsthumanity-9090e",
  appId: "1:536068500778:web:7adc2efe502d6c43da8253"
};
const FB_SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
const loadScript = src => new Promise((ok, no) => {
  const s = document.createElement("script");
  s.src = src; s.onload = ok; s.onerror = () => no(new Error("Couldn't load " + src));
  document.head.append(s);
});
/* Returns the same three capabilities claude.ai provides: Firestore stands in for db (same call shapes),
   the Realtime Database's presence list stands in for room, and an anonymous sign-in gives each browser its id. */
async function firebaseBackend() {
  for (const m of ["app", "auth", "firestore", "database"]) await loadScript(`${FB_SDK}firebase-${m}-compat.js`);
  firebase.initializeApp(FIREBASE);
  const { user: who } = await firebase.auth().signInAnonymously();
  firebaseAccountUser = who.uid;
  const rtdb = firebase.database(), mine = rtdb.ref("presence/" + rid(12));
  let peers = [], connected = false, last = null;
  const peerFns = [], connFns = [];
  rtdb.ref(".info/connected").on("value", s => {
    connected = !!s.val();
    if (connected) { mine.onDisconnect().remove(); if (last) mine.set(last); }
    connFns.forEach(f => f(connected));
  });
  rtdb.ref("presence").on("value", s => {
    peers = Object.entries(s.val() || {}).filter(([k]) => k !== mine.key).map(([, presence]) => ({ presence }));
    peerFns.forEach(f => f(peers));
  });
  const room = {
    presence: p => { last = JSON.parse(JSON.stringify({ ...p, uid: who.uid, t: Date.now() })); return mine.set(last); },
    peers: () => peers,
    connected: () => connected,
    onConnection: fn => { connFns.push(fn); fn(connected); return () => {}; },
    onPeers: fn => { peerFns.push(fn); fn(peers); return () => {}; },
    reconnect: () => { rtdb.goOffline(); rtdb.goOnline(); }
  };
  const user = { can: async () => true, id: async () => who.uid };
  const fs = firebase.firestore();
  /* set by checkLag on a device whose live stream keeps stalling */
  if (store.get("cah-longpoll", false)) fs.settings({ experimentalForceLongPolling: true, merge: true });
  return [fs, room, user];
}

/* ---------- boot ---------- */
async function boot() {
  dealHero();
  $("nameInput").value = myName;
  render();
  const use = name => window.claude && window.claude.use ? window.claude.use(name).catch(() => null) : Promise.resolve(null);
  let [d, r, u] = await Promise.all([use("db"), use("room"), use("user")]);
  if (!d && FIREBASE) {
    notice("Connecting to the game server…", { sticky: true });
    try { [d, r, u] = await firebaseBackend(); notice(""); }
    catch (e) { console.error(e); notice("Couldn't reach the game server. Check your connection and reload the page.", { error: true, sticky: true }); return render(); }
  }
  db = d;
  if (!db) {
    notice("This copy of the game has no game server set up, so it can't host lobbies. Play the published version on claude.ai instead.", { error: true, sticky: true });
    return render();
  }
  if (u && (await u.can("data.write")) === false) {
    canWrite = false;
    notice("You can look around, but to play you need edit access. Ask the person who shared this game to give it to you.", { error: true, sticky: true });
  }
  if (r) {
    room = r;
    room.onConnection(c => { if (c && !roomSince) roomSince = Date.now(); renderSync(); }, () => { room = null; });
    room.onPeers(() => { trackPresence(); if (code && L && L.game && L.game.phase === "judge") render(); }, () => { room = null; });
    setPresence({ look: null });
  }
  /* Anonymous device identity stays separate from the shared ruler identity. */
  uid = u ? await u.id().catch(() => null) : null;
  if (uid && !/^[\w-]{1,128}$/.test(uid)) uid = null;
  if (uid) {
    let accountId = uid;
    if (firebaseAccountUser) {
      try {
        const link = await db.doc("accountLinks/" + firebaseAccountUser).get();
        if (link.exists) { accountId = link.data().accountId; personalCode = link.data().code; }
      } catch (e) { if (e.code !== "permission-denied") console.error(e); }
    }
    try { await bindProfile(accountId); } catch (e) { dbErr(e); }
  }
  db.collection("profiles").orderBy("xp", "desc").limit(50).onSnapshot(s => {
    standings = s.docs.map(d => ({ id: d.id, ...cleanProfile(d.data(), d.id) }));
    for (const d of s.docs) people[d.id] = d.data();
    render();
  }, () => {});
  db.collection("packs").onSnapshot(s => {
    packs = {};
    for (const doc of s.docs) packs[doc.id] = doc.data();
    if (armedDelete && !packs[armedDelete]) armedDelete = null;
    render();
  }, dbErr);
  db.collection("directory").orderBy("updated", "desc").limit(30).onSnapshot(s => {
    directory = s.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    if (!code) render();
  }, dbErr);
  setInterval(() => { tick(); closeEmptyLobbies(); }, 1000);

  /* come back to the lobby this browser was in before a reload */
  const saved = tab.get("cah-lobby", null);
  if (saved && /^[A-Z]{4}$/.test(saved) && canWrite) {
    try {
      const [ls, ps] = await Promise.all([db.doc("lobbies/" + saved).get(), db.doc(`lobbies/${saved}/players/${ME}`).get()]);
      if (ls.exists && ps.exists) { if (!myName) myName = profile.name = cleanName(ps.data().name); await enterLobby(saved); return; }
    } catch {}
    tab.set("cah-lobby", null);
  }
  render();
}

function startCheck() {
  const players = Object.keys(P).filter(present).sort(byJoined), s = settings();
  if (players.length < curGame().min) return { ok: false, why: `Waiting for players: ${players.length} of ${curGame().min} needed.` };
  return curGame().check(players, s);
}
function startGame() {
  if (!isHost()) return;
  const chk = startCheck();
  if (!chk.ok) return notice(chk.why, { error: true });
  L.game = curGame().start(Object.keys(P).filter(present).sort(byJoined), settings(), chk.data);
  L.status = "playing";
  commit();
}
/* ---------- shared game table (Monkey Paw, Speed Date) ---------- */
/* Scoreboard, hall of shame and host buttons; `chip(pid)` gives the in-round state of a seated, present player. */
function tableSide(g, { chip, won, empty }) {
  const phase = g.phase, target = settings().target, host = isHost();
  const ids = uniq(g.seats.concat(Object.keys(P).sort(byJoined), Object.keys(g.scores).filter(pid => g.scores[pid] > 0)));
  fetchPeople(ids.map(pid => P[pid] && P[pid].uid));
  $("scores").innerHTML = ids.map(pid => {
    const score = g.scores[pid] || 0, left = !P[pid], away = !left && (gone(pid) || !online(pid)), w = won(pid);
    const c = w ? `<span class="chip won">${phase === "over" ? "winner" : "+1"}</span>` : left ? `<span class="chip">left</span>`
      : !g.seats.includes(pid) ? `<span class="chip">next round</span>` : away ? `<span class="chip">away</span>` : chip(pid);
    const cells = Array.from({ length: target }, (_, k) => `<span class="cell ${k < score ? "l" + Math.min(4, 1 + Math.floor(k * 4 / target)) : ""}"></span>`).join("");
    const tags = [pid === ME ? "you" : "", pid === L.host ? "host" : ""].filter(Boolean).join(", ");
    return `<li class="player ${w ? "is-winner" : ""} ${left || away ? "is-away" : ""}">${avHTML(lookOf(pid), "md")}
      <span class="pname">@${esc(nameOf(pid))}${tags ? ` <em>(${tags})</em>` : ""}</span><span class="pstate">${c}</span>
      <span class="graph" role="img" aria-label="${score} of ${target} points">${cells}</span><span class="pts">${score}/${target}</span></li>`;
  }).join("");
  $("log").innerHTML = g.log.length
    ? g.log.map(l => `<li><span class="h">${esc(l.h)}</span><span class="t">${l.who ? `<b>@${esc(nameOf(l.who))}</b> ` : ""}${esc(l.what)}</span></li>`).join("")
    : `<li class="empty">${empty}</li>`;
  $("hostTools").innerHTML = host
    ? (phase === "over" ? "" : `<button class="btn small icon" type="button" data-act="skip" data-tip="Skip round" aria-label="Skip round">${ICONS.skip}</button><button class="btn small danger icon" type="button" data-act="end" data-tip="End game" aria-label="End game">${ICONS.stop}</button>`)
    : !room ? `<button class="btn small" type="button" data-act="take-over">${ICONS.crown}Host not responding? Take over</button>` : "";
}
function tableOverStatus(g) {
  const champs = g.champions || [], pts = plural(champs.length ? g.scores[champs[0]] || 0 : 0, "point", "points");
  if (!champs.length) return "Game over. Nobody scored. Everyone loses.";
  if (champs.length === 1) return champs[0] === ME ? `You won the game with ${pts}. You monster.` : `${at(champs[0])} won the game with ${pts}.`;
  const names = champs.slice().sort((x, y) => (y === ME) - (x === ME)).map(pid => pid === ME ? "You" : at(pid));
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} tied for the win with ${pts}.`;
}
/* A writing box for the tray; the round's main button submits it with form="<id>". Enter sends, Shift+Enter breaks the line. */
function composer(id, key, lead, ph, max) {
  return `<form id="${id}" class="composer" autocomplete="off"><label for="${id}Text">${esc(lead)}</label>
    <textarea id="${id}Text" data-key="${esc(key)}" maxlength="${max}" rows="2" placeholder="${esc(ph)}" spellcheck="true"></textarea>
    <span class="composer-n" aria-hidden="true">0/${max}</span></form>`;
}
/* Redraws the tray without losing what the player was typing or where their cursor was. */
function keepDraft(draw) {
  const old = $("tray").querySelector("textarea"), focused = old && document.activeElement === old;
  const saved = old && { key: old.dataset.key, v: old.value, a: old.selectionStart, b: old.selectionEnd };
  draw();
  const now = $("tray").querySelector("textarea");
  if (!now || !saved || saved.key !== now.dataset.key) return;
  now.value = saved.v; now.dispatchEvent(new Event("input", { bubbles: true }));
  if (focused) { now.focus(); now.setSelectionRange(saved.a, saved.b); }
}
document.addEventListener("input", e => {
  const t = e.target.closest(".composer textarea");
  if (t) t.parentElement.querySelector(".composer-n").textContent = `${t.value.length}/${t.maxLength}`;
});
document.addEventListener("keydown", e => {
  const t = e.target.closest && e.target.closest(".composer textarea");
  if (t && e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); t.form.requestSubmit(); }
});
function renderGame() {
  const g = L && L.game;
  if (g) (GAMES[g.type || "cah"] || curGame()).render(g);
}
