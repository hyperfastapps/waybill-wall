type FirebaseWebEnvKey =
  | "VITE_FIREBASE_API_KEY"
  | "VITE_FIREBASE_AUTH_DOMAIN"
  | "VITE_FIREBASE_PROJECT_ID"
  | "VITE_FIREBASE_STORAGE_BUCKET"
  | "VITE_FIREBASE_MESSAGING_SENDER_ID"
  | "VITE_FIREBASE_APP_ID";

export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
};

export type FirebaseClientConfig = {
  web: FirebaseWebConfig;
  /** `host:port`, no scheme. Local emulator only. */
  authEmulatorHost: string | null;
  /** `host:port`, no scheme. Local emulator only. */
  firestoreEmulatorHost: string | null;
};

export type FirebaseEnv = Partial<
  Record<
    | FirebaseWebEnvKey
    | "VITE_FIREBASE_AUTH_EMULATOR_HOST"
    | "VITE_FIREBASE_FIRESTORE_EMULATOR_HOST",
    string | undefined
  >
>;

function filled(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Firebase is off unless every web config value is present. A partial or blank
 * set stays local-only so a missing variable cannot half-initialize Auth.
 */
export function readFirebaseConfig(env: FirebaseEnv): FirebaseClientConfig | null {
  const apiKey = filled(env.VITE_FIREBASE_API_KEY);
  const authDomain = filled(env.VITE_FIREBASE_AUTH_DOMAIN);
  const projectId = filled(env.VITE_FIREBASE_PROJECT_ID);
  const storageBucket = filled(env.VITE_FIREBASE_STORAGE_BUCKET);
  const messagingSenderId = filled(env.VITE_FIREBASE_MESSAGING_SENDER_ID);
  const appId = filled(env.VITE_FIREBASE_APP_ID);
  if (!apiKey || !authDomain || !projectId || !storageBucket || !messagingSenderId || !appId) {
    return null;
  }
  return {
    web: { apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId },
    authEmulatorHost: filled(env.VITE_FIREBASE_AUTH_EMULATOR_HOST),
    firestoreEmulatorHost: filled(env.VITE_FIREBASE_FIRESTORE_EMULATOR_HOST),
  };
}

export function parseEmulatorHost(value: string | null): { host: string; port: number } | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/^https?:\/\//, "");
  const match = /^([^:]+):(\d+)$/.exec(trimmed);
  if (!match) return null;
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { host: match[1] ?? "", port };
}
