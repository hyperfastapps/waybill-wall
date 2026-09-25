import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEmulatorHost, readFirebaseConfig, type FirebaseEnv } from "./firebase-config.ts";
import { planInitialMerge, planWallWrite } from "./wall-sync-plan.ts";

const complete: FirebaseEnv = {
  VITE_FIREBASE_API_KEY: "key",
  VITE_FIREBASE_AUTH_DOMAIN: "waybill-wall.vercel.app",
  VITE_FIREBASE_PROJECT_ID: "waybill-wall",
  VITE_FIREBASE_STORAGE_BUCKET: "waybill-wall.appspot.com",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "123",
  VITE_FIREBASE_APP_ID: "1:123:web:abc",
};

describe("readFirebaseConfig", () => {
  it("stays off when no Firebase env is set", () => {
    assert.equal(readFirebaseConfig({}), null);
    assert.equal(
      planWallWrite({
        configured: false,
        suspended: false,
        hasUser: false,
        createIdentity: true,
        revision: 1,
      }),
      "local-only",
    );
    assert.equal(
      planInitialMerge({
        configured: false,
        suspended: false,
        hasUser: true,
        alreadyMerged: false,
      }),
      "skip",
    );
  });

  it("stays off when any required value is missing or blank", () => {
    assert.equal(readFirebaseConfig({ VITE_FIREBASE_API_KEY: "key" }), null);
    assert.equal(
      readFirebaseConfig({
        ...complete,
        VITE_FIREBASE_APP_ID: "   ",
      }),
      null,
    );
    assert.equal(
      readFirebaseConfig({
        VITE_FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
        VITE_FIREBASE_FIRESTORE_EMULATOR_HOST: "127.0.0.1:8088",
      }),
      null,
    );
  });

  it("turns on only with the full web config", () => {
    const config = readFirebaseConfig({
      ...complete,
      VITE_FIREBASE_AUTH_EMULATOR_HOST: " 127.0.0.1:9099 ",
    });
    assert.equal(config?.web.projectId, "waybill-wall");
    assert.equal(config?.web.authDomain, "waybill-wall.vercel.app");
    assert.equal(config?.authEmulatorHost, "127.0.0.1:9099");
    assert.equal(config?.firestoreEmulatorHost, null);
  });
});

describe("parseEmulatorHost", () => {
  it("accepts host:port and rejects anything else", () => {
    assert.deepEqual(parseEmulatorHost("127.0.0.1:8088"), { host: "127.0.0.1", port: 8088 });
    assert.deepEqual(parseEmulatorHost("http://127.0.0.1:9099"), { host: "127.0.0.1", port: 9099 });
    assert.equal(parseEmulatorHost("127.0.0.1"), null);
    assert.equal(parseEmulatorHost(null), null);
  });
});
