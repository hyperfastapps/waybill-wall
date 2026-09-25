import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planInitialMerge, planWallWrite } from "./wall-sync-plan.ts";

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
