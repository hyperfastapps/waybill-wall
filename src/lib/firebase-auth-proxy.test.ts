import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { FirebaseEnv } from "./firebase-config.ts";
import { firebaseInitJson, respondToFirebaseReservedPath } from "./firebase-auth-proxy.ts";

const env: FirebaseEnv = {
  VITE_FIREBASE_API_KEY: "test-api-key",
  VITE_FIREBASE_AUTH_DOMAIN: "waybill-wall.vercel.app",
  VITE_FIREBASE_PROJECT_ID: "waybill-wall",
  VITE_FIREBASE_STORAGE_BUCKET: "waybill-wall.firebasestorage.app",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "475380620738",
  VITE_FIREBASE_APP_ID: "1:475380620738:web:abc",
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("firebaseInitJson", () => {
  it("matches the web config the auth handler compares", () => {
    const parsed = JSON.parse(firebaseInitJson(env) ?? "null") as Record<string, string>;
    assert.equal(parsed.apiKey, "test-api-key");
    assert.equal(parsed.authDomain, "waybill-wall.vercel.app");
    assert.equal(parsed.projectId, "waybill-wall");
    assert.equal(parsed.storageBucket, "waybill-wall.firebasestorage.app");
    assert.equal(parsed.messagingSenderId, "475380620738");
    assert.equal(parsed.appId, "1:475380620738:web:abc");
  });

  it("stays empty when the web config is incomplete", () => {
    assert.equal(firebaseInitJson({}), null);
  });
});

describe("respondToFirebaseReservedPath", () => {
  it("serves init.json without calling Firebase Hosting", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("nope", { status: 500 });
    }) as typeof fetch;
    const response = await respondToFirebaseReservedPath(
      new Request("https://waybill-wall.vercel.app/__/firebase/init.json"),
      env,
    );
    assert.equal(called, false);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    const body = (await response.json()) as { apiKey: string };
    assert.equal(body.apiKey, "test-api-key");
  });

  it("does not proxy other firebase hosting paths to Site Not Found", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("Site Not Found", { status: 404 });
    }) as typeof fetch;
    const response = await respondToFirebaseReservedPath(
      new Request("https://waybill-wall.vercel.app/__/firebase/init.js"),
      env,
    );
    assert.equal(called, false);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "Not found");
  });

  it("still proxies the Google redirect handler", async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response("<html>handler</html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }) as typeof fetch;
    const response = await respondToFirebaseReservedPath(
      new Request("https://waybill-wall.vercel.app/__/auth/handler?apiKey=test-api-key"),
      env,
    );
    assert.equal(response.status, 200);
    assert.equal(seen.length, 1);
    assert.equal(
      seen[0],
      "https://waybill-wall.firebaseapp.com/__/auth/handler?apiKey=test-api-key",
    );
    assert.match(await response.text(), /handler/);
  });
});
