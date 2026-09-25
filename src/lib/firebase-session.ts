import { FirebaseError, getApp, getApps, initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  connectAuthEmulator,
  deleteUser,
  getAuth,
  getRedirectResult,
  linkWithRedirect,
  onAuthStateChanged,
  reauthenticateWithRedirect,
  setPersistence,
  signInAnonymously,
  signInWithCredential,
  signInWithRedirect,
  signOut as firebaseSignOut,
  type Auth,
  type User,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  serverTimestamp,
  setDoc,
  type Firestore,
} from "firebase/firestore";
import { isCarrierId, isTrackingNumber } from "@/lib/carriers";
import { parseEmulatorHost, type FirebaseClientConfig } from "@/lib/firebase-config";
import { mergeSlips, sameSlipContent, type MergeResult } from "@/lib/wall-merge";
import { normalizeNumber, type Slip } from "@/lib/wall-codec";

const PENDING_SYNC = "waybill-pending-sync";
const PENDING_DELETE = "waybill-pending-delete";

export type WallUser = {
  uid: string;
  email: string | null;
  anonymous: boolean;
};

export type SessionStartup = {
  slips: Slip[] | null;
  notice: string | null;
  deleted: boolean;
  merged: boolean;
};

export type FirebaseSession = {
  startup: SessionStartup;
  current(): WallUser | null;
  subscribe(listener: (user: WallUser | null) => void): () => void;
  isCreatingUser(): boolean;
  push(readSlips: () => Slip[], createIdentity: boolean): Promise<void>;
  merge(mode: "local-wins" | "account-wins", localSlips: Slip[]): Promise<MergeResult | null>;
  linkGoogle(): Promise<void>;
  signOut(): Promise<void>;
  deleteAccount(): Promise<"deleted" | "reauth">;
};

const emptyStartup: SessionStartup = {
  slips: null,
  notice: null,
  deleted: false,
  merged: false,
};

let sessionPromise: Promise<FirebaseSession> | null = null;
let readLocal: () => Slip[] = () => [];

export function loadFirebaseSession(
  config: FirebaseClientConfig,
  readLocalSlips: () => Slip[],
): Promise<FirebaseSession> {
  readLocal = readLocalSlips;
  sessionPromise ??= createSession(config).catch((error: unknown) => {
    sessionPromise = null;
    throw error;
  });
  return sessionPromise;
}

/**
 * Google sign-in uses a full-page redirect, not a popup. Android Chrome and an
 * installed PWA often drop `window.open`, and third-party storage partitions
 * the default `firebaseapp.com` auth handler. The app domain proxies
 * `/__/auth/*` (see `src/lib/firebase-auth-proxy.ts`), so set
 * `VITE_FIREBASE_AUTH_DOMAIN` to this site (waybill-wall.vercel.app) and the
 * handler stays first-party.
 */
async function createSession(config: FirebaseClientConfig): Promise<FirebaseSession> {
  const app = getApps().length > 0 ? getApp() : initializeApp(config.web);
  const auth = getAuth(app);
  const authHost = parseEmulatorHost(config.authEmulatorHost);
  if (authHost) {
    try {
      connectAuthEmulator(auth, `http://${authHost.host}:${authHost.port}`, {
        disableWarnings: true,
      });
    } catch {
      /* already connected */
    }
  }
  const db = openFirestore(app, Boolean(config.firestoreEmulatorHost || config.authEmulatorHost));
  const firestoreHost = parseEmulatorHost(config.firestoreEmulatorHost);
  if (firestoreHost) {
    try {
      connectFirestoreEmulator(db, firestoreHost.host, firestoreHost.port);
    } catch {
      /* already connected */
    }
  }
  await setPersistence(auth, browserLocalPersistence);
  const startup = await settleRedirect(auth, db);
  return bindSession(auth, db, startup);
}

function openFirestore(app: ReturnType<typeof getApp>, emulator: boolean): Firestore {
  try {
    return initializeFirestore(app, {
      ignoreUndefinedProperties: true,
      localCache: emulator
        ? memoryLocalCache()
        : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    return getFirestore(app);
  }
}

function bindSession(auth: Auth, db: Firestore, startup: SessionStartup): FirebaseSession {
  let epoch = 0;
  let creatingUser = false;
  let anonInflight: Promise<User> | null = null;

  function ensureAnonymous(): Promise<User> {
    if (auth.currentUser) return Promise.resolve(auth.currentUser);
    anonInflight ??= signInAnonymously(auth)
      .then((cred) => cred.user)
      .finally(() => {
        anonInflight = null;
      });
    return anonInflight;
  }

  async function readWall(uid: string): Promise<Slip[]> {
    const snap = await getDoc(doc(db, "walls", uid));
    if (!snap.exists()) return [];
    return parseStoredSlips(snap.data()?.slips);
  }

  async function writeWall(uid: string, slips: Slip[]): Promise<void> {
    await setDoc(doc(db, "walls", uid), {
      slips: toStored(slips),
      updatedAt: serverTimestamp(),
    });
  }

  return {
    startup,
    current: () => snapshot(auth.currentUser),
    subscribe(listener) {
      return onAuthStateChanged(auth, (user) => listener(snapshot(user)));
    },
    isCreatingUser: () => creatingUser,
    async push(readSlips, createIdentity) {
      if (createIdentity) creatingUser = true;
      const token = ++epoch;
      try {
        let user = auth.currentUser;
        if (!user && (createIdentity || creatingUser)) {
          user = await ensureAnonymous();
        }
        if (!user || token !== epoch) return;
        await writeWall(user.uid, readSlips());
        if (token === epoch) creatingUser = false;
      } catch (error) {
        if (token === epoch) creatingUser = false;
        throw error;
      }
    },
    async merge(mode, localSlips) {
      const token = epoch;
      const user = auth.currentUser;
      if (!user) return null;
      const remote = await readWall(user.uid);
      if (token !== epoch) return null;
      const merged =
        mode === "local-wins" ? mergeSlips(localSlips, remote) : mergeSlips(remote, localSlips);
      if (!sameSlipContent(merged.slips, remote)) {
        if (token !== epoch) return null;
        await writeWall(user.uid, merged.slips);
      }
      if (token !== epoch) return null;
      return merged;
    },
    async linkGoogle() {
      const provider = googleProvider();
      storageSet(PENDING_SYNC, "1");
      const user = auth.currentUser;
      if (user?.isAnonymous) {
        await linkWithRedirect(user, provider);
        return;
      }
      if (!user) {
        await signInWithRedirect(auth, provider);
        return;
      }
      storageRemove(PENDING_SYNC);
    },
    async signOut() {
      await firebaseSignOut(auth);
    },
    async deleteAccount() {
      const user = auth.currentUser;
      if (!user) return "deleted";
      await deleteDoc(doc(db, "walls", user.uid));
      try {
        await deleteUser(user);
        return "deleted";
      } catch (error) {
        const fb = asFirebaseError(error);
        if (fb?.code === "auth/requires-recent-login" && !user.isAnonymous) {
          storageSet(PENDING_DELETE, "1");
          await reauthenticateWithRedirect(user, googleProvider());
          return "reauth";
        }
        throw error;
      }
    },
  };
}

async function settleRedirect(auth: Auth, db: Firestore): Promise<SessionStartup> {
  try {
    const result = await getRedirectResult(auth);
    if (storageGet(PENDING_DELETE) === "1" && auth.currentUser) {
      storageRemove(PENDING_DELETE);
      storageRemove(PENDING_SYNC);
      await deleteDoc(doc(db, "walls", auth.currentUser.uid));
      await deleteUser(auth.currentUser);
      return {
        slips: [],
        notice: "Deleted the saved wall and the Firebase account.",
        deleted: true,
        merged: true,
      };
    }
    const pending = storageGet(PENDING_SYNC) === "1";
    storageRemove(PENDING_SYNC);
    if ((result?.user || pending) && auth.currentUser) {
      const remote = await readWallDoc(db, auth.currentUser.uid);
      const merged = mergeSlips(remote, readLocal());
      if (!sameSlipContent(merged.slips, remote)) {
        await writeWallDoc(db, auth.currentUser.uid, merged.slips);
      }
      return {
        slips: merged.slips,
        notice: merged.dropped.length
          ? "Saved to your Google account. Some slips didn’t fit on the 12-slip wall."
          : null,
        deleted: false,
        merged: true,
      };
    }
    return emptyStartup;
  } catch (error) {
    storageRemove(PENDING_SYNC);
    const fb = asFirebaseError(error);
    if (fb?.code === "auth/credential-already-in-use") {
      return adoptExistingGoogle(auth, db, fb, readLocal());
    }
    throw error;
  }
}

async function adoptExistingGoogle(
  auth: Auth,
  db: Firestore,
  error: FirebaseError,
  anonSlips: Slip[],
): Promise<SessionStartup> {
  const credential = GoogleAuthProvider.credentialFromError(error);
  if (!credential) throw error;
  const anon = auth.currentUser;
  if (anon) {
    try {
      await deleteDoc(doc(db, "walls", anon.uid));
    } catch {
      /* no anonymous wall yet */
    }
    try {
      await deleteUser(anon);
    } catch {
      /* still sign into the existing Google account */
    }
  }
  const signed = await signInWithCredential(auth, credential);
  const remote = await readWallDoc(db, signed.user.uid);
  const merged = mergeSlips(remote, anonSlips);
  await writeWallDoc(db, signed.user.uid, merged.slips);
  return {
    slips: merged.slips,
    notice: merged.dropped.length
      ? "That Google account already had a wall. Its slips stayed, new tracking numbers were added, and some didn’t fit in the 12."
      : "That Google account already had a wall. Its slips stayed, and new tracking numbers were added.",
    deleted: false,
    merged: true,
  };
}

function googleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return provider;
}

async function readWallDoc(db: Firestore, uid: string): Promise<Slip[]> {
  const snap = await getDoc(doc(db, "walls", uid));
  if (!snap.exists()) return [];
  return parseStoredSlips(snap.data()?.slips);
}

async function writeWallDoc(db: Firestore, uid: string, slips: Slip[]): Promise<void> {
  await setDoc(doc(db, "walls", uid), {
    slips: toStored(slips),
    updatedAt: serverTimestamp(),
  });
}

function toStored(slips: Slip[]) {
  const stored: Array<{
    id: string;
    number: string;
    nickname: string;
    caption: string;
    carrier: Slip["carrier"];
  }> = [];
  for (const slip of slips) {
    const number = normalizeNumber(slip.number);
    if (!isTrackingNumber(number) || !isCarrierId(slip.carrier)) continue;
    const id = slip.id.trim().slice(0, 80);
    if (!id) continue;
    stored.push({
      id,
      number,
      nickname: slip.nickname.slice(0, 40),
      caption: slip.caption.slice(0, 140),
      carrier: slip.carrier,
    });
    if (stored.length === 12) break;
  }
  return stored;
}

function parseStoredSlips(value: unknown): Slip[] {
  if (!Array.isArray(value)) return [];
  const slips: Slip[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const number = normalizeNumber(typeof record.number === "string" ? record.number : "");
    const carrier = typeof record.carrier === "string" ? record.carrier : "";
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id || !isTrackingNumber(number) || !isCarrierId(carrier)) continue;
    slips.push({
      id: id.slice(0, 80),
      number,
      nickname: typeof record.nickname === "string" ? record.nickname.slice(0, 40) : "",
      caption: typeof record.caption === "string" ? record.caption.slice(0, 140) : "",
      carrier,
    });
  }
  return slips;
}

function snapshot(user: User | null): WallUser | null {
  if (!user) return null;
  return { uid: user.uid, email: user.email, anonymous: user.isAnonymous };
}

function asFirebaseError(error: unknown): FirebaseError | null {
  return error instanceof FirebaseError ? error : null;
}

function storageGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

function storageRemove(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* private mode */
  }
}
