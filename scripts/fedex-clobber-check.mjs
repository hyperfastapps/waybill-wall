/**
 * Reproduces the rejected-sync clobber: the phone's retry must not replace
 * the cloud wall with only its local slips.
 *
 *   npx firebase-tools --project demo-waybill emulators:exec --only auth,firestore \
 *     "node --experimental-strip-types scripts/fedex-clobber-check.mjs"
 */
import assert from "node:assert/strict";
import { initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  deleteUser,
  inMemoryPersistence,
  initializeAuth,
  signInAnonymously,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  initializeFirestore,
  memoryLocalCache,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { commitReconciledWall } from "../src/lib/commit-wall.ts";
import { slipTrackingKey } from "../src/lib/wall-merge.ts";

const projectId = process.env.FIREBASE_PROJECT_ID || "demo-waybill";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8088";

const web = {
  apiKey: "demo-key",
  authDomain: "localhost",
  projectId,
  storageBucket: `${projectId}.appspot.com`,
  messagingSenderId: "123456789",
  appId: "1:123456789:web:demo",
};

function hostPort(value) {
  const trimmed = value.replace(/^https?:\/\//, "");
  const [host, port] = trimmed.split(":");
  return { host, port: Number(port) };
}

const app = initializeApp(web, "fedex-clobber");
const auth = initializeAuth(app, { persistence: inMemoryPersistence });
const authEndpoint = authHost.startsWith("http") ? authHost : `http://${authHost}`;
connectAuthEmulator(auth, authEndpoint, { disableWarnings: true });
const db = initializeFirestore(app, {
  ignoreUndefinedProperties: true,
  localCache: memoryLocalCache(),
});
const parsed = hostPort(firestoreHost);
connectFirestoreEmulator(db, parsed.host, parsed.port);

const cred = await signInAnonymously(auth);
const ref = doc(db, "walls", cred.user.uid);
const ups = {
  id: "slip-ups",
  number: "1Z999AA10123456784",
  nickname: "Lamp",
  caption: "",
  carrier: "ups",
};
const amazon = {
  id: "slip-amazon",
  number: "TBA334894092403",
  nickname: "Parcel · 2403",
  caption: "",
  carrier: "amazon",
};
const fedex = {
  id: "slip-fedex",
  number: "123456789012",
  nickname: "Desk",
  caption: "",
  carrier: "fedex",
};

// Cloud has UPS. Another device adds FedEx while this phone's Amazon write is rejected.
await setDoc(ref, { slips: [ups, fedex], updatedAt: serverTimestamp() });

const local = [amazon, ups];
const merged = await commitReconciledWall(db, cred.user.uid, local, "local-wins", [
  slipTrackingKey(ups.number),
]);
const saved = await getDoc(ref);
const numbers = saved.data().slips.map((slip) => slip.number);

assert.deepEqual(
  merged.slips.map((slip) => slip.number),
  [amazon.number, ups.number, fedex.number],
);
assert.deepEqual(numbers, [amazon.number, ups.number, fedex.number]);

// A deliberate removal on this phone is not put back from the cloud copy.
const withoutFedex = await commitReconciledWall(db, cred.user.uid, local, "local-wins", [
  slipTrackingKey(amazon.number),
  slipTrackingKey(ups.number),
  slipTrackingKey(fedex.number),
]);
const afterRemoval = await getDoc(ref);
assert.deepEqual(
  withoutFedex.slips.map((slip) => slip.number),
  [amazon.number, ups.number],
);
assert.deepEqual(
  afterRemoval.data().slips.map((slip) => slip.number),
  [amazon.number, ups.number],
);

await deleteDoc(ref);
await deleteUser(cred.user);
console.log(JSON.stringify({ ok: true, kept: numbers }));
