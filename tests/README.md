# Account-code integration tests

These tests load the profile and account functions from `shared/core.js`, connect independent device contexts to the Firestore emulator, and enforce the real `firestore.rules`. They cover existing progress, code creation, connecting and reloading another device, live profile changes, concurrent reward transactions, replayed rewards, invalid input and unauthorized reads/writes. They do not test browser layout.

From the repository root, with Node.js and Java 21 installed, run in PowerShell:

```powershell
$accountTestDeps = Join-Path $env:TEMP 'cah-account-tests'
npm install --prefix $accountTestDeps --no-audit --no-fund @firebase/rules-unit-testing firebase
$env:NODE_PATH = Join-Path $accountTestDeps 'node_modules'
npx --yes firebase-tools emulators:exec --only firestore --project demo-cah-accounts "node tests/account-codes.cjs"
```

The `demo-` project is local; no production Firebase credentials are needed. Expected denied operations can print `PERMISSION_DENIED` messages; the script must finish with `PASS` and exit code 0.

## GIF Me rules tests

`gif-me-rules.cjs` tests media authorization and JPEG limits, seat action phases/roles and locks, clearing and seat refreshes, other games' actions, and atomic host media cleanup against the real rules. After installing the dependencies and setting `NODE_PATH` above, run from the repository root:

```powershell
npx --yes firebase-tools emulators:exec --only firestore --project demo-cah-accounts "node tests/gif-me-rules.cjs"
```

Re-run the account-code command above for regression coverage. Both scripts must print `PASS` and exit code 0.
