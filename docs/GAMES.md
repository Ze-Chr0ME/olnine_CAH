# Party Games: multi-game contract

The site is one static page (GitHub Pages, no build step) that hosts four games in one shared room:
Cards Against Humanity (`cah`), Monkey Paw (`mp`), Speed Date (`sd`) and GIF Me (`gm`). One room code. The host picks the
game in the lobby and can switch between games without anyone rejoining. Scores are per game, because
`L.game` is rebuilt every time a game starts.

## Files
- `index.html`: HTML shell, markup and `<script src>` tags (plain classic scripts sharing globals, loaded in order).
- `shared/style.css`: all CSS.
- `shared/core.js`: helpers, Firebase, profiles/accounts, lobby, presence, sync, `commit()`, `render()` dispatch.
- `cah/packs.js`: `KINDS`, `BUILTIN_PACKS` data. `cah/cah.js`: CAH logic and CAH render.
- `monkey-paw/wishes.js`: `MP_WISHES = { en: [...], de: [...], fr: [...] }`. `monkey-paw/mp.js`: logic.
- `speed-date/traits.js`: `SD_TRAITS = { en: {category: [...]}, de: {...}, fr: {...} }`. `speed-date/sd.js`: logic.
- `gif-me/situations.js`: `GM_SITUATIONS = { en: [...], de: [...], fr: [...] }` (aligned strings). `gif-me/gm.js`: logic, Klipy client and photo helpers. `gif-me/gm-ui.js`: table UI.
- `i18n/cards.<lang>.json`: CAH card translations (unchanged path).

## Game registry (shared/core.js)
```js
const GAMES = {};               // filled by each game file: GAMES.cah = {...}
function gameId() { return (L && L.settings && L.settings.game) || "cah"; }
function curGame() { return GAMES[gameId()] || GAMES.cah; }
```
Each game registers:
```js
GAMES.xx = {
  id: "xx", name: "Display name", min: 3,      // min present players to start
  defaults: { ... },                          // its own lobby settings keys (prefixed: mp*, sd*); merged into DEFAULTS
  check(players, s) -> { ok, why, data },     // can the host start? players = present pids sorted by join
  start(players, s, data) -> g,               // new game object; must set g.type = "xx", g.gid, g.round, g.scores, g.names, g.faces
  tick(g) -> boolean,                         // host only, called from hostTick() while playing; return true if g changed (core commits)
  render(g),                                  // fills #viewGame (UI is written separately)
};
```
Core dispatch: `startCheck/startGame/hostTick/renderGame` call `curGame()`. If `L.game.type` differs from
`gameId()` while playing, core renders `GAMES[L.game.type]`. `backToLobby()` sets `L.game = null`.
Shared settings that every game reads: `target` (points to win), `maxPlayers`, `private`, `lang` (en|de|fr), `next` (seconds on the result screen).

## Player actions
Players never write the lobby document. Each player writes only their own seat (`myRef().update({...})`).
Every action is stamped `{ gid, round, ... }` so stale actions are ignored. The host reads seats in `P` inside `tick()`
and commits `L`. Free text is trimmed, capped at 200 characters, and always escaped with `esc()` when rendered.

### Monkey Paw (`mp`), min 3
Rotating wisher (same rotation as the CAH czar: the next present seat by `joined`).
Phases: `wish` (the wisher types a wish or takes one of 3 dealt deck wishes `g.wishCards`; seat `wish: {gid, round, text}`)
then `twist` (the other players write "Granted, but..."; seat `twist: {gid, round, text}`) then `judge` (twists shuffled
anonymously into `g.order = [{pid, text}]`; wisher seat `pick: {gid, round, k}`) then `result` (winner +1, `g.winner = k`)
and after `next` seconds a new round. Timer: `mpTime` seconds (0 = no limit, default 60) applies to the wish and twist phases.
On a wish timeout a random dealt wish is used. On a twist timeout the phase moves to judging with whatever arrived, or the round is skipped if nothing did.
If the wisher leaves, the round is skipped. First to `target` wins.

### Speed Date (`sd`), min 2
Rotating speaker. Settings: `sdCount` traits (default 8), `sdEvery` seconds per reveal (default 8), `sdWrite` seconds to write (default 40).
Phases: `write` (each listener writes one secret trait; seat `trait: {gid, round, text}`; moves on when all are in or at the deadline)
then `reveal` (`g.traits = [{text, cat, by}]`, `g.startAt` = now + 3000 ms, trait i shows at `startAt + i*sdEvery*1000`,
computed on every client from the clock, so the reveal costs no extra writes) then `rate` (listeners seat `rate: {gid, round, v}` with v 1..5, 30 s deadline)
then `result` (the speaker's average for that turn is stored in `g.turns`).
Traits: `cap = floor(sdCount/2)` player-written traits at most (a random subset if more were written). The rest come from
`SD_TRAITS[lang]`: slots 1-3 are `gender`, `age`, `height` when available, then random other categories without repeats.
Player-written traits are inserted at random positions after slot 3.
Cycle: once every seated player has spoken once, the speaker or speakers with the highest average that cycle get +1 point. First to `target` wins.

### GIF Me (`gm`), min 3
Rotating setter by joined seat, including pid tie breaks. Phases: `set` -> `search` -> `vote` -> `result` -> next round, or `over`.
The setter chooses one of three no-repeat dealt `g.sitCards`, types text (trimmed, max 200), or uploads a photo with an optional caption.
Seat `sit: {gid, round, text, photo}`; accepted situation is `g.sit = {text, photo}`. `gmSearch` seconds (default 90, 0 = no limit)
applies separately to set and search; a set timeout uses a random dealt card, including when a photo is missing. Non-setters submit
`gif: {gid, round, id, url, still, w, h}`; only HTTPS static.klipy.com, static1.klipy.com or static2.klipy.com URLs up to 300 chars,
ids up to 64 chars, and positive integer dimensions up to 2000 are accepted. Search ends all-in or at deadline:
zero GIFs skips; one wins +1 immediately; otherwise shuffled `g.order = [{pid, gif}]` stays anonymous until results.
Every present round seat, including the setter, votes with `vote: {gid, round, k}`; own-GIF votes are ignored.
Voting ends all-in or after `gmVote` seconds (default 30, 0 = no limit). `g.tally` counts each entry; `g.winners` holds
all indices tied for highest positive count among present authors, each earning +1. No votes means no points and a log entry.
Departed authors keep their indices but cannot win. Setter departure during set/search/vote skips the round.
`next` controls result advance (0 = host clicks). All players reaching `target` together are champions.
Fewer than three present players ends the game preserving scores and top-score champions (`ownsMin: true`).

Photos use no Storage: before the seat action the setter writes `lobbies/{code}/media/sit = {gid, round, pid, uid, data}`
using the Firebase auth uid and a JPEG data URL, at most 200000 chars. The write is a transaction that reads the lobby
and only writes for the same GIF Me gid/round in phase `set` with the same setter. Delayed uploads cannot recreate
media after game end or overwrite the next round. Before writing the seat action, the current local game is checked
again by gid/round/phase/setter and absence of an existing situation; snapshot object identity is irrelevant. `gmResizePhoto(file)` caps the longest edge at 720px,
then lowers JPEG quality and dimensions. Every client listens only while GIF Me is live; global `gmMedia` caches the document.
`gmPhoto(g)` returns data only for the matching gid/round/setter and a photo situation. The host accepts photo
situations only once that valid media is cached; media snapshots immediately re-evaluate the pending situation. Host cleanup deletes matching old media
on round advance, skip, game end and lobby return; room deletion removes the media doc after deleting the lobby, blocking late uploads. `commit()` calls
`gmCommitMedia()` inside the lobby transaction, deleting media atomically with the transition. Setter transactions
that race this write retry against the new lobby state and cannot recreate old media. Accepted photos remain through
search/vote/result; leaving `set` with a text situation also removes abandoned uploads. Text-round heartbeats and
unchanged `over` commits do not delete media. Rules require an existing lobby
in matching `set` phase, gid/round/setter, a seat whose `owner` equals the caller's Firebase auth uid, and a valid JPEG
data URL. Ownerless legacy seats cannot upload until claimed by the normal seat refresh.
GIF Me seat submissions (`sit`, `gif`, `vote`) require the matching live game and round, the correct phase and role (setter for `sit`, non-setter for `gif`); same-round submissions are locked, while clearing remains allowed. Emulator coverage: `tests/gif-me-rules.cjs`.
Klipy requires the owner to paste a public client key from the Partner Panel into `KLIPY_KEY` in gm.js.
Until configured, starting is blocked with `GIF search is not configured.`
`gmSearchGifs(q, cursor=1) -> Promise<{items: [{id,url,still,w,h,title}], next}>` loads search or trending;
`next` is the next integer page or null. `gmSendPhoto(dataUrl, caption)` retains its signature.

Provider contract (verified against [Klipy GIF API documentation](https://docs.klipy.com/gifs-api/gifs-view-trigger-api)):
- GET `https://api.klipy.com/api/v1/{app_key}/gifs/search` with `q`, or `/gifs/trending` without it. Key is in the path.
- Parameters: `page` (starts at 1), `per_page=50` (documented maximum), `locale` (selected en/de/fr language),
  `customer_id` (random 128-bit per-device identifier stored in localStorage, session fallback if storage is unavailable),
  `format_filter=gif,webp,jpg`, and `content_filter=low`.
- Safety choice: `low` rather than `off`, retaining adult humour. The docs list off/low/medium/high but do **not**
  explicitly map these API values to MPA ratings, so exact R equivalence cannot be verified. Configure the Partner Panel
  global/country cap at PG-13 to exclude strong sexual content while allowing strong profanity and suggestive humour
  per [Klipy's content tables](https://docs.klipy.com/content-filtering). This is deliberately stricter than R, which permits
  strong sexual content in those tables; the request parameter alone is not a documented guarantee against porn.
- Response: `{result, data: {data: [...], current_page, per_page, has_next}}`. Entries have numeric `id`, `title`,
  and `file[size][format] = {url,width,height,size}`. Prefer sm then xs/md/hd, animated webp with gif fallback,
  and jpg still from the same size. Ads and invalid entries are ignored; ids become strings.
- Media hosts from Klipy's Network Requirements: `static.klipy.com`, `static1.klipy.com`, `static2.klipy.com`.
  `gmUrl` accepts only `/^https:\/\/static[12]?\.klipy\.com\//` with length <= 300; host-side seat validation and
  Firestore rules enforce the same hosts. No other host, credentials or port is accepted.
- Search results use a 50-entry FIFO in-memory Map keyed by trimmed query, page and language.
  Requests time out after 10 seconds with `GIF search timed out` (including response body reads).
  Missing key: `GIF key missing`; HTTP 429: `GIF search busy`; other HTTP errors: `GIF search failed: <status>`.

UI handoff: call `gmSearchGifs` with page cursors, and use **Search KLIPY** as the default search placeholder (required
by [Klipy's attribution guidelines](https://docs.klipy.com/gifs-api/gifs-view-trigger-api)). Watermarks and a visible
Powered by KLIPY mark are optional. UI files are owned separately. Never render player text without `esc()`.
