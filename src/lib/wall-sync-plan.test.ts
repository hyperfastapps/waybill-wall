import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifySyncFailure,
  planInitialMerge,
  planWallWrite,
  syncFailureNotice,
  syncRetryDelayMs,
} from "./wall-sync-plan.ts";

const base = {
  configured: true,
  suspended: false,
  hasUser: false,
  createIdentity: false,
  revision: 1,
};

describe("planWallWrite", () => {
  it("does not sync a shared link or the first paint", () => {
    assert.equal(planWallWrite({ ...base, suspended: true, createIdentity: true }), "skip");
    assert.equal(planWallWrite({ ...base, revision: 0, createIdentity: true }), "skip");
  });

  it("creates an anonymous user only on an explicit first write", () => {
    assert.equal(planWallWrite({ ...base, createIdentity: true }), "create-and-push");
    assert.equal(planWallWrite(base), "local-only");
  });

  it("pushes later edits when a user already exists", () => {
    assert.equal(planWallWrite({ ...base, hasUser: true }), "push");
  });

  it("never creates a user when Firebase is not configured", () => {
    assert.equal(
      planWallWrite({ ...base, configured: false, createIdentity: true, hasUser: false }),
      "local-only",
    );
  });
});

describe("planInitialMerge", () => {
  it("merges a restored session and skips viewers", () => {
    assert.equal(
      planInitialMerge({
        configured: true,
        suspended: false,
        hasUser: true,
        alreadyMerged: false,
      }),
      "merge",
    );
    assert.equal(
      planInitialMerge({
        configured: true,
        suspended: true,
        hasUser: true,
        alreadyMerged: false,
      }),
      "skip",
    );
    assert.equal(
      planInitialMerge({
        configured: true,
        suspended: false,
        hasUser: false,
        alreadyMerged: false,
      }),
      "skip",
    );
    assert.equal(
      planInitialMerge({
        configured: true,
        suspended: false,
        hasUser: true,
        alreadyMerged: true,
      }),
      "skip",
    );
  });
});

describe("sync failure during a rules lag", () => {
  it("treats a rules rejection as a retryable sync, not an offline failure", () => {
    const rejected = classifySyncFailure({ code: "permission-denied" });
    assert.equal(rejected, "rejected");
    assert.match(syncFailureNotice(rejected), /Saved on this phone/);
    assert.match(syncFailureNotice(rejected), /retry/);
    assert.equal(
      classifySyncFailure(new Error("Missing or insufficient permissions.")),
      "rejected",
    );
    assert.equal(classifySyncFailure(new Error("Failed to fetch")), "transient");
    assert.match(syncFailureNotice("transient"), /back online/);
  });

  it("backs off instead of hammering a rejected write", () => {
    assert.equal(syncRetryDelayMs(1), 5_000);
    assert.equal(syncRetryDelayMs(2), 15_000);
    assert.equal(syncRetryDelayMs(3), 45_000);
    assert.equal(syncRetryDelayMs(4), 60_000);
    assert.equal(syncRetryDelayMs(9), 60_000);
  });
});
