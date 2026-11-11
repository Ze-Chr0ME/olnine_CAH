# Party Games

Three party games in one shared room: Cards Against Humanity, Monkey Paw and Speed Date. The CAH game is available now; the other two plug into the shared game registry described in [docs/GAMES.md](docs/GAMES.md).

Play at https://ze-chr0me.github.io/party-games/. Source: [Ze-Chr0ME/party-games](https://github.com/Ze-Chr0ME/party-games). GitHub Pages serves these static files directly; there is no build step.

Enter a name, create a lobby and share its code, or join an open lobby. The host configures the rules and starts the game. Profiles, portraits, XP and personal account codes are shared across devices through Firebase.

## Deploy

Enable Firebase Anonymous Authentication and authorize `ze-chr0me.github.io`. Create Firestore and Realtime Database, then set the public `FIREBASE` configuration in `shared/core.js` (including `databaseURL`). Keep the existing Firebase project when updating this deployment.

Publish [firestore.rules](firestore.rules) and [database.rules.json](database.rules.json) in their respective Firebase Console Rules tabs. Alternatively, after `npx firebase-tools login`, deploy Firestore rules with:

```sh
npx firebase-tools deploy --only firestore:rules --project cardsagainsthumanity-9090e
```

Enable GitHub Pages for the repository and publish the root directory. Publish the current Firestore rules before using personal account codes. Codes grant access to a shared profile; keep them private.

## Files and tests

`index.html` is the HTML shell; `shared/` contains styles and the common backend, profiles and lobby code. `cah/packs.js` holds the bundled cards and `cah/cah.js` registers the CAH game. Card translations remain in `i18n/`. See [docs/GAMES.md](docs/GAMES.md) for the registry contract and [tests/README.md](tests/README.md) for account-code integration tests.

## Credits and licence

Official and unofficial card text comes from [JSON Against Humanity](https://github.com/crhallberg/json-against-humanity) by Chris Hallberg. Cards Against Humanity LLC releases its cards under [CC BY-NC-SA](https://creativecommons.org/licenses/by-nc-sa/4.0/). German and French translations in `i18n/` are shared under the same licence; see [i18n/UNTRANSLATED.md](i18n/UNTRANSLATED.md). This game is non-commercial, shared under the same terms, and is not affiliated with or endorsed by Cards Against Humanity LLC.
