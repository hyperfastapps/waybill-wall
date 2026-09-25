import { FirebaseError, getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  GoogleAuthProvider,
  connectAuthEmulator,
  deleteUser,
  getAuth,
  getRedirectResult,
  initializeAuth,
  linkWithRedirect,
  onAuthStateChanged,
  reauthenticateWithRedirect,
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
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";
import { commitReconciledWall } from "@/lib/commit-wall";
import { wallAuthInitOptions } from "@/lib/firebase-auth-persistence";
import { parseEmulatorHost, type FirebaseClientConfig } from "@/lib/firebase-config";
import { syncedTrackingKeys, type MergeResult } from "@/lib/wall-merge";
import { type Slip } from "@/lib/wall-codec";
import {
  inFlightMayWrite,
  rollbackStaleWrite,
  type AbandonReason,
} from "@/lib/wall-sync-plan";

export function openWallAuth(app: FirebaseApp): Auth {
  try {
    return initializeAuth(app, wallAuthInitOptions());
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    if (code === "auth/already-initialized") return getAuth(app);
    throw error;
  }
}

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
  /** Cancel lazy sign-up and any save already running. Clears the pending-sync flag. */
  abandonWrites(reason: AbandonReason): void;
  push(readSlips: () => Slip[], createIdentity: boolean): Promise<MergeResult | null>;
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
  const auth = openWallAuth(app);
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
  let writeGeneration = 0;
  let creatingUser = false;
  let anonInflight: Promise<User> | null = null;
  const haltedReasons = new Map<number, AbandonReason>();

  function ensureAnonymous(): Promise<User> {
    if (auth.currentUser) return Promise.resolve(auth.currentUser);
    anonInflight ??= signInAnonymously(auth)
      .then((cred) => cred.user)
      .finally(() => {
        anonInflight = null;
      });
    return anonInflight;
  }

  function abandonWrites(reason: AbandonReason) {
    haltedReasons.set(writeGeneration, reason);
    writeGeneration += 1;
    epoch += 1;
    creatingUser = false;
    storageRemove(PENDING_SYNC);
  }

  function stillCurrent(token: number, generation: number) {
    return token === epoch && inFlightMayWrite(generation, writeGeneration);
  }

  async function undoStaleWrite(
    user: User,
    generation: number,
    createdUserHere: boolean,
    wrote: boolean,
  ) {
    const decision = rollbackStaleWrite({
      reason: haltedReasons.get(generation) ?? null,
      createdUserHere,
      wrote,
    });
    if (decision.undoWall || decision.undoUser) {
      try {
        await deleteDoc(doc(db, "walls", user.uid));
      } catch {
        /* already gone, or the auth user is already deleted */
      }
    }
    if (decision.undoUser) {
      try {
        await deleteUser(user);
      } catch {
        /* delete already removed this account */
      }
    }
  }

  return {
    startup,
    current: () => snapshot(auth.currentUser),
    subscribe(listener) {
      return onAuthStateChanged(auth, (user) => listener(snapshot(user)));
    },
    isCreatingUser: () => creatingUser,
    abandonWrites,
    async push(readSlips, createIdentity) {
      const generation = writeGeneration;
      if (!inFlightMayWrite(generation, writeGeneration)) return null;
      if (createIdentity) creatingUser = true;
      const token = ++epoch;
      let createdHere = false;
      let wrote = false;
      let user = auth.currentUser;
      try {
        if (!stillCurrent(token, generation)) return null;
        if (!user && (createIdentity || creatingUser)) {
          user = await ensureAnonymous();
          createdHere = true;
        }
        if (!user || !stillCurrent(token, generation)) {
          if (createdHere && user) await undoStaleWrite(user, generation, true, false);
          return null;
        }
        const merged = await commitReconciledWall(
          db,
          user.uid,
          readSlips(),
          "local-wins",
          readSyncedKeys(),
        );
        wrote = true;
        if (!stillCurrent(token, generation)) {
          await undoStaleWrite(user, generation, createdHere, true);
          return null;
        }
        noteSynced(merged.slips);
        creatingUser = false;
        return merged;
      } catch (error) {
        if (stillCurrent(token, generation)) {
          creatingUser = false;
          throw error;
        }
        if (user && (createdHere || wrote)) {
          await undoStaleWrite(user, generation, createdHere, wrote);
        }
        return null;
      }
    },
    async merge(mode, localSlips) {
      const generation = writeGeneration;
      const token = epoch;
      const user = auth.currentUser;
      if (!user || !inFlightMayWrite(generation, writeGeneration)) return null;
      const merged = await commitReconciledWall(
        db,
        user.uid,
        localSlips,
        mode,
        mode === "local-wins" ? readSyncedKeys() : null,
      );
      if (!stillCurrent(token, generation)) {
        await undoStaleWrite(user, generation, false, true);
        return null;
      }
      noteSynced(merged.slips);
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
      abandonWrites("sign-out");
      await firebaseSignOut(auth);
    },
    async deleteAccount() {
      abandonWrites("delete");
      const user = auth.currentUser;
      if (!user) {
        clearSyncedKeys();
        return "deleted";
      }
      await deleteDoc(doc(db, "walls", user.uid));
      clearSyncedKeys();
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
      clearSyncedKeys();
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
      const merged = await commitReconciledWall(
        db,
        auth.currentUser.uid,
        readLocal(),
        "account-wins",
        null,
      );
      noteSynced(merged.slips);
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
  const merged = await commitReconciledWall(db, signed.user.uid, anonSlips, "account-wins", null);
  noteSynced(merged.slips);
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

const SYNCED_KEYS = "waybill-wall-synced-v1";

function readSyncedKeys(): string[] | null {
  try {
    const raw = localStorage.getItem(SYNCED_KEYS);
    if (raw == null) return null;
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return null;
    return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  } catch {
    return null;
  }
}

function noteSynced(slips: Slip[]) {
  try {
    localStorage.setItem(SYNCED_KEYS, JSON.stringify(syncedTrackingKeys(slips)));
  } catch {
    /* private mode */
  }
}

function clearSyncedKeys() {
  try {
    localStorage.removeItem(SYNCED_KEYS);
  } catch {
    /* private mode */
  }
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
