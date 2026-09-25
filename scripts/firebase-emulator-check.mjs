/**
 * Auth + Firestore emulator check.
 *
 *   npx firebase-tools emulators:exec --only auth,firestore --project demo-waybill -- \
 *     node scripts/firebase-emulator-check.mjs
 *
 * Expects the ports in firebase.json (auth 9099, firestore 8088).
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

function slip(number, nickname) {
  return {
    id: `slip-${number}`,
    number,
    nickname,
    caption: "emulator",
    carrier: "ups",
  };
}

function wall(slips) {
  return { slips, updatedAt: serverTimestamp() };
}

function openClient(name) {
  const app = initializeApp(web, name);
  const auth = initializeAuth(app, { persistence: inMemoryPersistence });
  const authEndpoint = authHost.startsWith("http") ? authHost : `http://${authHost}`;
  connectAuthEmulator(auth, authEndpoint, { disableWarnings: true });
  const db = initializeFirestore(app, {
    ignoreUndefinedProperties: true,
    localCache: memoryLocalCache(),
  });
  const parsed = hostPort(firestoreHost);
  connectFirestoreEmulator(db, parsed.host, parsed.port);
  return { auth, db };
}

function denied(error) {
  const code = error?.code ?? "";
  return code === "permission-denied" || String(error?.message ?? "").includes("permission");
}

async function expectDeny(promise) {
  try {
    await promise;
  } catch (error) {
    assert.ok(denied(error), `expected permission-denied, got ${error?.code || error}`);
    return;
  }
  throw new Error("expected Firestore rules to deny the request");
}

const owner = openClient("owner");
const other = openClient("other");

const ownerCred = await signInAnonymously(owner.auth);
const otherCred = await signInAnonymously(other.auth);
assert.equal(ownerCred.user.isAnonymous, true);
assert.notEqual(ownerCred.user.uid, otherCred.user.uid);

const ownerRef = doc(owner.db, "walls", ownerCred.user.uid);
const slips = [slip("1Z999AA10123456784", "Lamp")];
await setDoc(ownerRef, wall(slips));

const saved = await getDoc(ownerRef);
assert.equal(saved.exists(), true);
assert.equal(saved.data().slips[0].nickname, "Lamp");
assert.equal(saved.data().slips.length, 1);

const reloaded = await getDoc(doc(owner.db, "walls", ownerCred.user.uid));
assert.equal(reloaded.exists(), true);
assert.equal(reloaded.data().slips[0].number, "1Z999AA10123456784");

const full = Array.from({ length: 12 }, (_, index) =>
  slip(`9400111899223${String(index).padStart(5, "0")}`, `N${index}`),
);
await setDoc(ownerRef, wall(full));
const fullSaved = await getDoc(ownerRef);
assert.equal(fullSaved.data().slips.length, 12);
await setDoc(ownerRef, wall(slips));

await expectDeny(getDoc(doc(other.db, "walls", ownerCred.user.uid)));
await expectDeny(setDoc(doc(other.db, "walls", ownerCred.user.uid), wall(slips)));

await expectDeny(
  setDoc(
    ownerRef,
    wall([
      ...Array.from({ length: 13 }, (_, index) => slip(`1Z999AA1012345678${index}`, `N${index}`)),
    ]),
  ),
);
await expectDeny(
  setDoc(ownerRef, {
    slips: [{ ...slip("1Z999AA10123456784", "Lamp"), carrier: "pony" }],
    updatedAt: serverTimestamp(),
  }),
);
await expectDeny(
  setDoc(ownerRef, {
    slips,
    updatedAt: serverTimestamp(),
    extra: true,
  }),
);

await deleteDoc(ownerRef);
const afterDelete = await getDoc(ownerRef);
assert.equal(afterDelete.exists(), false);
await deleteUser(ownerCred.user);
await deleteUser(otherCred.user);

console.log(
  JSON.stringify({
    ok: true,
    projectId,
    ownerUid: ownerCred.user.uid,
    deniedOtherUid: true,
    deleted: true,
  }),
);
