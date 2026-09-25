import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  indexedDBLocalPersistence,
} from "firebase/auth";
import { wallAuthInitOptions } from "./firebase-auth-persistence.ts";

describe("wallAuthInitOptions", () => {
  it("prefers IndexedDB and keeps localStorage as the fallback", () => {
    const options = wallAuthInitOptions();
    assert.deepEqual(options.persistence, [indexedDBLocalPersistence, browserLocalPersistence]);
  });

  it("keeps the redirect resolver required by Google sign-in", () => {
    assert.equal(wallAuthInitOptions().popupRedirectResolver, browserPopupRedirectResolver);
  });
});
