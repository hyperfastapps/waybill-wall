# Waybill Wall

Pin a tracking number, guess the shipper, and share the slip. The app does not sign into a carrier.

Carriers: USPS, UPS, FedEx, DHL, HDX, OnTrac.

Without Firebase configured, the wall stays in this browser (`localStorage`) and in the share link (`#w=`). It keeps the numbers, shipper, and captions you type.

With the Firebase env vars below, pinning also creates an anonymous Firebase user and syncs that wall to Firestore. “Save my wall to Google” links the same user to a Google account so the wall follows you. A shared `#w=` link is still only the slips in the URL. Opening one does not create an account.

## Firebase (optional)

Set these `VITE_` variables for the client. If any of them is missing, the app stays local-only: no auth UI, no Firebase calls.

| Variable                            | Required     | Production value                                      |
| ----------------------------------- | ------------ | ----------------------------------------------------- |
| `VITE_FIREBASE_API_KEY`             | for Firebase | Already set on Vercel. Leave it.                      |
| `VITE_FIREBASE_AUTH_DOMAIN`         | for Firebase | **Change to** `waybill-wall.vercel.app`               |
| `VITE_FIREBASE_PROJECT_ID`          | for Firebase | `waybill-wall`                                        |
| `VITE_FIREBASE_STORAGE_BUCKET`      | for Firebase | `waybill-wall.firebasestorage.app` (wall does not use Storage) |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | for Firebase | `475380620738`                                        |
| `VITE_FIREBASE_APP_ID`              | for Firebase | `1:475380620738:web:e080a1baef35c700e18a5b`           |

Copy [`.env.example`](.env.example) to `.env.local` for local work. Vite inlines `VITE_*` at build time, so change them in the Vercel project and redeploy.

Local emulators only (do not set these on Vercel):

| Variable                                | Example          |
| --------------------------------------- | ---------------- |
| `VITE_FIREBASE_AUTH_EMULATOR_HOST`      | `127.0.0.1:9099` |
| `VITE_FIREBASE_FIRESTORE_EMULATOR_HOST` | `127.0.0.1:8088` |

### What is stored

`walls/{uid}` is readable and writable only by that Firebase user (`request.auth.uid`). Each document is `{ slips, updatedAt }`. A slip is `id`, `number` (8–40 letters or digits), `nickname` (≤ 40), `caption` (≤ 140), and `carrier` (`usps`, `ups`, `fedex`, `dhl`, `hdx`, `ontrac`). At most 12 slips. The rules check the owner, the 12-slip cap, those lengths, and the carrier id. Tracking-number characters are checked in the app: a second pattern on every slip exceeds Firestore’s 1000-expression limit.

Pinning is instant and writes `localStorage` first. Firestore updates in the background, including when the browser is offline (the Firestore SDK queues the write). An existing local wall is uploaded on the first sync, which happens on the first pin or when you choose “Save my wall to Google”.

Google sign-in uses a redirect, not a popup, so it can finish in Android Chrome and in the installed PWA. The app serves Firebase’s `/__/auth/*` and `/__/firebase/*` handler from its own domain (a reverse proxy to `https://waybill-wall.firebaseapp.com`). That only works when `VITE_FIREBASE_AUTH_DOMAIN` is the site itself, `waybill-wall.vercel.app`.

The value currently set on Vercel is `waybill-wall.firebaseapp.com`. Change it to `waybill-wall.vercel.app` for Production, Preview, and Development, then redeploy. Leaving `waybill-wall.firebaseapp.com` sends the Google redirect to Firebase’s domain, which Android Chrome and an installed PWA treat as third-party storage and often drop.

If the Google account is already linked to another Firebase user, the app signs into that account and merges the slips: the Google wall stays, each tracking number is kept once, and new ones are added until the wall is full. Slips that do not fit are left off.

“Delete my data” deletes the Firestore document and the Firebase user, and clears the slips on this phone.

### Firebase project

Project id `waybill-wall` (number `475380620738`, Spark). `.firebaserc` sets that as the CLI default. Firestore is in `eur3`, production mode. Anonymous and Google sign-in are enabled, and `waybill-wall.vercel.app` is an authorized domain. The database still has the default deny-all rules until the command below is run.

### Auth domain change (required for Google linking)

1. In Vercel → waybill-wall → Settings → Environment Variables, set `VITE_FIREBASE_AUTH_DOMAIN` to `waybill-wall.vercel.app` for Production, Preview, and Development. It is currently `waybill-wall.firebaseapp.com`. Redeploy after the change. Vite inlines the value at build time.
2. In Google Cloud → APIs & Services → Credentials, open the OAuth client Firebase created for this web app. Add:
   - Authorized JavaScript origin: `https://waybill-wall.vercel.app`
   - Authorized redirect URI: `https://waybill-wall.vercel.app/__/auth/handler`
3. Keep the existing redirect URI `https://waybill-wall.firebaseapp.com/__/auth/handler`.

Preview URLs other than `waybill-wall.vercel.app` are not authorized for that redirect. Google linking is for the production host.

### Deploy the rules

`firebase.json` points at `firestore.rules`. These rules are not deployed yet. From a checkout of this branch (the rules file is not on `main` until this merges), at the repo root, log in once and deploy only the rules:

```bash
npx firebase-tools login
npx firebase-tools deploy --only firestore:rules --project waybill-wall
```

`--project waybill-wall` matches `.firebaserc`. That replaces the deny-all rules in the existing `eur3` database. It does not create a database, enable auth providers, or change env vars.

### Emulator check

Tests stay on the local emulator and the demo project `demo-waybill`. Do not point this command at `waybill-wall`.

```bash
npx firebase-tools emulators:exec --only auth,firestore --project demo-waybill -- node scripts/firebase-emulator-check.mjs
```

That signs in two anonymous users, writes `walls/{uid}`, checks a reload read, writes a full 12-slip wall, checks the rules reject the other user (and an invalid wall), then deletes the document and the users.

## FedEx live status (optional)

FedEx blocks anonymous tracking calls from the app host, so a FedEx slip links out to [FedEx tracking](https://www.fedex.com/fedextrack/) for that number. The app runs with no FedEx credentials.

To show city-level status on the slip, set these on the server:

| Variable           | Required | Purpose                                                                         |
| ------------------ | -------- | ------------------------------------------------------------------------------- |
| `FEDEX_API_KEY`    | no       | Track API client id (API key)                                                   |
| `FEDEX_SECRET_KEY` | no       | Track API secret key                                                            |
| `FEDEX_API_BASE`   | no       | Defaults to `https://apis.fedex.com`. Sandbox: `https://apis-sandbox.fedex.com` |

If either key is missing, or the Track API does not answer, the slip falls back to the FedEx link.
