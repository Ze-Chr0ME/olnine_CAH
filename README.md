# Crimes Against Humanity

A multiplayer party game that plays Cards Against Humanity with all 71 official card packs plus 11 unofficial NSFW packs, wrapped in a sci-fi interface.
It is a single `index.html` published as a claude.ai Artifact. The page uses the Artifact's shared database for lobbies, players and card packs, and its live room to see who is still connected.

## Play

- Open the game's claude.ai link while signed in. Everyone who plays needs edit access to the Artifact, so share it with your friends from the page's **Share** menu.
- Enter a name, then **Create a lobby** and send your friends the 4-letter code, or join one from **Open lobbies**.
- The host sets up the game in the lobby, then starts it once at least 3 players are in.

## Rulers, XP and standings

Each player has a ruler profile, saved per claude.ai account in `profiles/<account id>` (only you can write yours; everyone can read the standings).

- **Portrait**: pick one of 10 species (Mammalian, Reptilian, Avian, Arthropoid, Molluscoid, Fungoid, Lithoid, Machine, Plantoid, Humanoid) and colour the skin, eyes, uniform and backdrop, or upload a picture. Uploads are cropped to a 128 px square JPEG before saving.
- **XP** per round: 10 for playing, 50 when your card wins the round, 15 for judging as czar. Finishing a game adds 40 and winning it 150. Each player's own browser credits them once per round and once per game.
- **Levels and ranks**: level *n* needs 100 + 50 × (*n* − 1) more XP. Ranks go Cadet, Ensign, Lieutenant, Commander, Captain, Commodore, Admiral, Grand Admiral, Galactic Custodian and Galactic Emperor (level 40).
- **Galactic standings** on the home screen list the top 10 rulers by XP.

## Lobby settings

| Setting | Slider (typed limit) | What it does |
| --- | --- | --- |
| Points to win | 1–20 (up to 99) | The first player to reach it wins. |
| Round limit | 1–30 or none (up to 999) | After the last round, the top score wins (ties share the win). |
| Time to pick cards | 10–180 s or none (up to 3600 s) | When it runs out, the timer plays random cards for anyone who hasn't picked. |
| Time for the czar | 10–180 s or none (up to 3600 s) | When it runs out, a random submission wins the round. |
| Cards in hand | 3–12 (up to 30) | Hand size for the whole game. |
| Next round starts | 3–30 s or when the host clicks (up to 300 s) | Pause on the round result. |
| Max players | 3–10 (up to 20) | New players can't join a full lobby. |
| Private lobby | on / off | Hides the lobby from **Open lobbies**; friends join with the code. |
| Card language | English, German or French flag | Language of the built-in cards. |
| Card packs | any packs in the library | Which prompts and answers are shuffled into the deck. |

Each number setting is a slider. Click the number beside it to type a value past the slider's range; leave it empty for none.

Settings are locked while a game is running; the host can end the game to change them.

## Playing on GitHub Pages (Firebase backend)

Outside claude.ai the page uses a free Firebase project instead (Spark plan, no card needed): Firestore holds lobbies, packs and profiles, the Realtime Database tracks who is connected, and each browser signs in anonymously. Players don't need any account.

One-time setup:

1. Go to <https://console.firebase.google.com>, **Create a project** (Google Analytics can be off). It stays on the free Spark plan.
2. **Build > Authentication > Get started**, then under **Sign-in method** enable **Anonymous**. Under **Settings > Authorized domains**, add `ze-chr0me.github.io`.
3. **Build > Firestore Database > Create database**, pick a location, start in **production mode**. Open the **Rules** tab, paste [`firestore.rules`](firestore.rules) and **Publish**.
4. **Build > Realtime Database > Create database**, start in **locked mode**. Open **Rules**, paste [`database.rules.json`](database.rules.json) and **Publish**.
5. **Project settings** (gear icon) **> General > Your apps > Web (`</>`)**, register an app (no Hosting), and copy the `firebaseConfig` object. Make sure it includes `databaseURL`; if not, copy the URL from the Realtime Database page.
6. Paste that object as the value of `FIREBASE` in `index.html` (search for `const FIREBASE`) and push to `main`.

The config values are public identifiers, not secrets; the rules files decide what browsers may do. On claude.ai the page keeps using the artifact's own storage, and the Firebase code is never loaded.

Free-plan limits (per day: 50,000 Firestore reads, 20,000 writes; 100 simultaneous Realtime Database connections) cover many games a day. Progress starts with a profile for each browser. To share a profile across devices, open your ruler menu > **Connect devices**, choose **Get my code**, and enter that personal code in the profile editor on another device. Names, portraits, XP and stats then sync automatically. Codes have 24 letters/numbers, grouped for copying, and grant full access to the profile; keep them private. Connecting selects the existing profile and does not merge it with progress on the receiving device. Leave a lobby before switching profiles.

Publish the current `firestore.rules` before using personal codes (Firebase Console > Firestore > Rules, or after signing in with `npx firebase-tools login`, run `npx firebase-tools deploy --only firestore:rules --project cardsagainsthumanity-9090e`). The anonymous Firebase identity remains per browser; a private `accountLinks/<device uid>` record selects the shared profile. `accountKeys/<random code>` can only be retrieved by exact code, never listed, and codes are never stored in public standings. The first code uses the existing profile so its progress is preserved. Shared-profile rewards are applied in Firestore transactions to preserve progress when devices save at the same time.

## Rules

- Each round one player is the **Card Czar** and the role rotates.
- Everyone else picks a white card (or two or three, on "Pick 2"/"Pick 3" prompts) to complete the black prompt card.
- The czar reads the anonymous submissions and awards the point to the funniest one.
- First player to the target score wins.

## How it works

- The host's browser runs the rules and is the only writer of the lobby document (`lobbies/<CODE>`). Each player writes only their own document (`lobbies/<CODE>/players/<id>`): name, submitted cards and, for the czar, the winning pick.
- A player whose page has been closed for 20 seconds is skipped. If the czar leaves, the round is skipped. If the host leaves, the longest-seated player still connected takes over.
- Players who join mid-game are dealt in at the next round.
- Your player id and current lobby are kept per browser tab, so a reload keeps your seat.

## Card packs

The host picks packs in the lobby. They are grouped, and each group has **All** / **None** buttons:

| Group | Packs |
| --- | --- |
| Base game | CAH Base Set (on by default) |
| Expansions | First to Sixth Expansion, the Red, Blue, Green and Absurd boxes, Box Expansion, Main Deck, Human, Ass and A.I. packs, Procedurally-Generated Cards |
| Themed packs | 23 small packs (90s and 2000s Nostalgia, Fantasy, Sci-Fi, Science, Food, Weed, Period, Dad, Pride, College, Theatre, Reject packs and others) |
| Other editions | UK and Canadian conversion kits, Family Edition (public beta) |
| Promos and specials | 28 holiday, convention (PAX, Gen Con), election and retail packs |
| Made by players | Every pack in the game's shared library |

Cards that appear in more than one selected pack are dealt only once. If the selected packs are too big for one lobby document, the deck is trimmed at random before the game starts. The bundled packs are `BUILTIN_PACKS` near the top of the `<script>` in `index.html`, and `kind` sets the group they're listed under.

Use **Manage card packs** on the home screen to create, edit, copy or delete packs. Packs are shared with everyone who plays this game; only the person who made a pack can edit or delete it, from the same browser.

- One card per line.
- Write `____` (or any run of 3+ underscores) for each blank in a black card, up to 3 blanks. A black card with no blank is a question answered with one card.
- Up to 400 cards of each colour per pack, 150 characters per card.

## Credits and licence

The official card text is from [JSON Against Humanity](https://github.com/crhallberg/json-against-humanity) by Chris Hallberg, which collects the Cards Against Humanity cards (partly from Pretend You're Xyzzy). Cards Against Humanity LLC releases the cards under the [Creative Commons BY-NC-SA](https://creativecommons.org/licenses/by-nc-sa/4.0/) licence. Line breaks were joined, blanks were rewritten as `____`, and 5 cards longer than 150 characters were left out.

The German and French card text in [`i18n/cards.de.json`](i18n/cards.de.json) and [`i18n/cards.fr.json`](i18n/cards.fr.json) is a translation of the 71 official packs and the 11 unofficial packs below, made for this game and shared under the same licence. The host picks the language with **Card language** in the lobby settings. Each pack's `black` and `white` arrays line up one to one with the English ones. A `null` entry is a card left untranslated, so the English text is dealt instead; 20 official cards with sexual content involving minors are left out this way. The untranslated unofficial cards are listed in [`i18n/UNTRANSLATED.md`](i18n/UNTRANSLATED.md).

The **Unofficial / NSFW** group holds third-party packs from the same collection: Crabs Adjust Humidity, Cats Abiding Horribly, Cocks Abreast Hostility, Words Against Morality, Pigs Against Profanity, Evil Apples, Guards Against Insanity, Depravity, Hilarious!, Skewered And Roasted and Personally Incorrect. Each game's volumes are merged into one pack, duplicates were removed, and so were cards over 150 characters or with more than 3 blanks. These packs are on by default, next to the base set. In Personally Incorrect prompts, `"Insert Name"` became `[player]`, which is filled with a random player's name when the prompt is dealt.

Under that licence this game is non-commercial and is shared under the same terms. It is not affiliated with or endorsed by Cards Against Humanity LLC.
