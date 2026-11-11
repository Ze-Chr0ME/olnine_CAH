# Party Games: multi-game contract

The site is one static page (GitHub Pages, no build step) that hosts three games in one shared room:
Cards Against Humanity (`cah`), Monkey Paw (`mp`) and Speed Date (`sd`). One room code. The host picks the
game in the lobby and can switch between games without anyone rejoining. Scores are per game, because
`L.game` is rebuilt every time a game starts.

## Files
- `index.html`: HTML shell, markup and `<script src>` tags (plain classic scripts sharing globals, loaded in order).
- `shared/style.css`: all CSS.
- `shared/core.js`: helpers, Firebase, profiles/accounts, lobby, presence, sync, `commit()`, `render()` dispatch.
- `cah/packs.js`: `KINDS`, `BUILTIN_PACKS` data. `cah/cah.js`: CAH logic and CAH render.
- `monkey-paw/wishes.js`: `MP_WISHES = { en: [...], de: [...], fr: [...] }`. `monkey-paw/mp.js`: logic.
- `speed-date/traits.js`: `SD_TRAITS = { en: {category: [...]}, de: {...}, fr: {...} }`. `speed-date/sd.js`: logic.
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
Rotating speaker. Settings: `sdCount` traits (default 8), `sdEvery` seconds per reveal (default 5), `sdWrite` seconds to write (default 40).
Phases: `write` (each listener writes one secret trait; seat `trait: {gid, round, text}`; moves on when all are in or at the deadline)
then `reveal` (`g.traits = [{text, cat, by}]`, `g.startAt` = now + 3000 ms, trait i shows at `startAt + i*sdEvery*1000`,
computed on every client from the clock, so the reveal costs no extra writes) then `rate` (listeners seat `rate: {gid, round, v}` with v 1..5, 30 s deadline)
then `result` (the speaker's average for that turn is stored in `g.turns`).
Traits: `cap = floor(sdCount/2)` player-written traits at most (a random subset if more were written). The rest come from
`SD_TRAITS[lang]`: slots 1-3 are `gender`, `age`, `height` when available, then random other categories without repeats.
Player-written traits are inserted at random positions after slot 3.
Cycle: once every seated player has spoken once, the speaker or speakers with the highest average that cycle get +1 point. First to `target` wins.
