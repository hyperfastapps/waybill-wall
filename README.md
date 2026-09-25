# Waybill Wall

Pin a tracking number, guess the shipper, and share the slip. The app does not sign into a carrier.

Carriers: USPS, UPS, FedEx, DHL, HDX, OnTrac.

Without Firebase configured, the wall stays in this browser (`localStorage`) and in the share link (`#w=`). It keeps the numbers, shipper, and captions you type.

With the Firebase env vars below, pinning also creates an anonymous Firebase user and syncs that wall to Firestore. “Save my wall to Google” links the same user to a Google account so the wall follows you. A shared `#w=` link is still only the slips in the URL. Opening one does not create an account.

## Firebase (optional)

Set these `VITE_` variables for the client. If any of them is missing, the app stays local-only: no auth UI, no Firebase calls.

| Variable                            | Required     | Purpose                                                                    |
| ----------------------------------- | ------------ | -------------------------------------------------------------------------- |
| `VITE_FIREBASE_API_KEY`             | for Firebase | Web API key                                                                |
| `VITE_FIREBASE_AUTH_DOMAIN`         | for Firebase | Use the site host, `waybill-wall.vercel.app`, not `*.firebaseapp.com`      |
| `VITE_FIREBASE_PROJECT_ID`          | for Firebase | Firebase project id                                                        |
| `VITE_FIREBASE_STORAGE_BUCKET`      | for Firebase | Storage bucket (required by the web config; the wall does not use Storage) |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | for Firebase | Sender id                                                                  |
| `VITE_FIREBASE_APP_ID`              | for Firebase | Web app id                                                                 |

Copy [`.env.example`](.env.example) to `.env.local` for local work. Vite inlines `VITE_*` at build time, so change them in the Vercel project and redeploy.

Local emulators only (do not set these on Vercel):

| Variable                                | Example          |
| --------------------------------------- | ---------------- |
| `VITE_FIREBASE_AUTH_EMULATOR_HOST`      | `127.0.0.1:9099` |
| `VITE_FIREBASE_FIRESTORE_EMULATOR_HOST` | `127.0.0.1:8088` |

### What is stored

`walls/{uid}` is readable and writable only by that Firebase user (`request.auth.uid`). Each document is `{ slips, updatedAt }`. A slip is `id`, `number` (8–40 letters or digits), `nickname` (≤ 40), `caption` (≤ 140), and `carrier` (`usps`, `ups`, `fedex`, `dhl`, `hdx`, `ontrac`). At most 12 slips.

Pinning is instant and writes `localStorage` first. Firestore updates in the background, including when the browser is offline (the Firestore SDK queues the write). An existing local wall is uploaded on the first sync, which happens on the first pin or when you choose “Save my wall to Google”.

Google sign-in uses a redirect, not a popup, so it can finish in Android Chrome and in the installed PWA. The app serves Firebase’s `/__/auth/*` and `/__/firebase/*` handler from its own domain (a reverse proxy to `https://<project-id>.firebaseapp.com`). That only works when `VITE_FIREBASE_AUTH_DOMAIN` is the site itself.

If the Google account is already linked to another Firebase user, the app signs into that account and merges the slips: the Google wall stays, each tracking number is kept once, and new ones are added until the wall is full. Slips that do not fit are left off.

“Delete my data” deletes the Firestore document and the Firebase user, and clears the slips on this phone.

### Firebase console

1. Create or open the Firebase project. Add a web app and copy the config into the env vars above.
2. Authentication → Sign-in method: enable **Anonymous** and **Google**.
3. Authentication → Settings → Authorized domains: add `waybill-wall.vercel.app` and `localhost`.
4. Set `VITE_FIREBASE_AUTH_DOMAIN` to `waybill-wall.vercel.app`.
5. In Google Cloud → APIs & Services → Credentials, open the OAuth client Firebase created for the web app. Add authorized JavaScript origin `https://waybill-wall.vercel.app` and authorized redirect URI `https://waybill-wall.vercel.app/__/auth/handler` (keep the existing `https://<project-id>.firebaseapp.com/__/auth/handler` URI as well).

### Deploy the rules

`firebase.json` points at `firestore.rules`. From the repo root, with the Firebase CLI logged in:

```bash
npx firebase-tools deploy --only firestore:rules --project YOUR_PROJECT_ID
```

### Emulator check

```bash
npx firebase-tools emulators:exec --only auth,firestore --project demo-waybill -- node scripts/firebase-emulator-check.mjs
```

That signs in two anonymous users, writes `walls/{uid}`, checks a reload read, checks the rules reject the other user (and an invalid wall), then deletes the document and the users.

## FedEx live status (optional)

FedEx blocks anonymous tracking calls from the app host, so a FedEx slip links out to [FedEx tracking](https://www.fedex.com/fedextrack/) for that number. The app runs with no FedEx credentials.

To show city-level status on the slip, set these on the server:

| Variable           | Required | Purpose                                                                         |
| ------------------ | -------- | ------------------------------------------------------------------------------- |
| `FEDEX_API_KEY`    | no       | Track API client id (API key)                                                   |
| `FEDEX_SECRET_KEY` | no       | Track API secret key                                                            |
| `FEDEX_API_BASE`   | no       | Defaults to `https://apis.fedex.com`. Sandbox: `https://apis-sandbox.fedex.com` |

If either key is missing, or the Track API does not answer, the slip falls back to the FedEx link.
