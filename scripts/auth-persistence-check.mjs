/**
 * Confirms a user saved with the old localStorage auth persistence is still
 * signed in after switching to IndexedDB, and that the localStorage copy is removed.
 *
 *   npx firebase-tools --project demo-waybill emulators:exec --only auth -- \
 *     node scripts/auth-persistence-check.mjs
 *
 * The extra `--` is not used: pass the script as one argument.
 *   npx firebase-tools --project demo-waybill emulators:exec --only auth \
 *     "node scripts/auth-persistence-check.mjs"
 */
import { chromium } from "playwright";

const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const emulatorUrl = emulatorHost.startsWith("http") ? emulatorHost : `http://${emulatorHost}`;
const apiKey = "demo-persistence-key";
const userKey = `firebase:authUser:${apiKey}:[DEFAULT]`;

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || "/opt/google/chrome/chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded" });

const signedIn = await page.evaluate(
  async ({ emulatorUrl, apiKey, userKey }) => {
    const { initializeApp } =
      await import("https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js");
    const auth = await import("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js");
    const app = initializeApp({
      apiKey,
      authDomain: "localhost",
      projectId: "demo-waybill",
      storageBucket: "demo-waybill.appspot.com",
      messagingSenderId: "123",
      appId: "1:123:web:demo",
    });
    const legacy = auth.initializeAuth(app, { persistence: auth.browserLocalPersistence });
    auth.connectAuthEmulator(legacy, emulatorUrl, { disableWarnings: true });
    const cred = await auth.signInAnonymously(legacy);
    return { uid: cred.user.uid, local: window.localStorage.getItem(userKey) };
  },
  { emulatorUrl, apiKey, userKey },
);

if (!signedIn.uid || !signedIn.local) {
  throw new Error(`legacy sign-in did not land in localStorage: ${JSON.stringify(signedIn)}`);
}

await page.reload();

const migrated = await page.evaluate(
  async ({ emulatorUrl, apiKey, userKey, legacyUid }) => {
    const { initializeApp } =
      await import("https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js");
    const auth = await import("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js");
    const app = initializeApp({
      apiKey,
      authDomain: "localhost",
      projectId: "demo-waybill",
      storageBucket: "demo-waybill.appspot.com",
      messagingSenderId: "123",
      appId: "1:123:web:demo",
    });
    const next = auth.initializeAuth(app, {
      persistence: [auth.indexedDBLocalPersistence, auth.browserLocalPersistence],
      popupRedirectResolver: auth.browserPopupRedirectResolver,
    });
    auth.connectAuthEmulator(next, emulatorUrl, { disableWarnings: true });
    await next.authStateReady();
    const record = await new Promise((resolve, reject) => {
      const open = indexedDB.open("firebaseLocalStorageDb");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("firebaseLocalStorage", "readonly");
        const get = tx.objectStore("firebaseLocalStorage").get(userKey);
        get.onerror = () => reject(get.error);
        get.onsuccess = () => resolve(get.result ?? null);
      };
    });
    return {
      uid: next.currentUser?.uid ?? null,
      legacyUid,
      localLeft: window.localStorage.getItem(userKey),
      idbUid: record?.value?.uid ?? null,
    };
  },
  { emulatorUrl, apiKey, userKey, legacyUid: signedIn.uid },
);

if (migrated.uid !== signedIn.uid) {
  throw new Error(`signed-in uid changed: ${JSON.stringify(migrated)}`);
}
if (migrated.localLeft) {
  throw new Error("localStorage auth user was not removed after migration");
}
if (migrated.idbUid !== signedIn.uid) {
  throw new Error(`IndexedDB does not hold the migrated user: ${JSON.stringify(migrated)}`);
}

const redirectPage = await browser.newPage();
await redirectPage.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded" });
const missingResolver = await redirectPage.evaluate(
  async ({ emulatorUrl, apiKey }) => {
    const { initializeApp } =
      await import("https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js");
    const auth = await import("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js");
    const missing = initializeApp({
      apiKey,
      authDomain: "localhost",
      projectId: "demo-waybill",
      appId: "1:123:web:demo",
    });
    const without = auth.initializeAuth(missing, { persistence: auth.inMemoryPersistence });
    auth.connectAuthEmulator(without, emulatorUrl, { disableWarnings: true });
    try {
      await auth.signInWithRedirect(without, new auth.GoogleAuthProvider());
      return "navigated";
    } catch (error) {
      return error?.code || String(error);
    }
  },
  { emulatorUrl, apiKey },
);

let redirectStarted = "started";
try {
  redirectStarted = await redirectPage.evaluate(
    async ({ emulatorUrl, apiKey }) => {
      const { initializeApp } =
        await import("https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js");
      const auth = await import("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js");
      const present = initializeApp(
        {
          apiKey,
          authDomain: "127.0.0.1",
          projectId: "demo-waybill",
          appId: "1:123:web:demo",
        },
        "with-resolver",
      );
      const withResolver = auth.initializeAuth(present, {
        persistence: auth.inMemoryPersistence,
        popupRedirectResolver: auth.browserPopupRedirectResolver,
      });
      auth.connectAuthEmulator(withResolver, emulatorUrl, { disableWarnings: true });
      try {
        await auth.signInWithRedirect(withResolver, new auth.GoogleAuthProvider());
        return "navigated";
      } catch (error) {
        return error?.code || String(error);
      }
    },
    { emulatorUrl, apiKey },
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!/context was destroyed|navigation/i.test(message)) throw error;
}

await browser.close();

if (missingResolver !== "auth/argument-error") {
  throw new Error(`expected a missing resolver to fail closed: ${missingResolver}`);
}
if (redirectStarted === "auth/argument-error") {
  throw new Error("Google redirect resolver is missing");
}

console.log(
  JSON.stringify({
    ok: true,
    uid: signedIn.uid,
    migratedToIndexedDb: true,
    localStorageCleared: true,
    redirectStarted,
  }),
);
