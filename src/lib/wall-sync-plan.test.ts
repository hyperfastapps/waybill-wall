import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifySyncFailure,
  haltSync,
  inFlightMayWrite,
  mayCreateIdentity,
  planInitialMerge,
  planWallWrite,
  resumeSyncOnRevision,
  rollbackStaleWrite,
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

describe("delete while a sync retry is pending", () => {
  it("does not create an account when the pending retry fires", () => {
    const halted = haltSync({
      generation: 4,
      allowCreate: true,
      retryAttempt: 2,
      halted: false,
    });
    assert.equal(halted.generation, 5);
    assert.equal(halted.allowCreate, false);
    assert.equal(halted.retryAttempt, 0);
    assert.equal(halted.halted, true);
    // The page can still be holding createIdentity from the pin that was rejected.
    // The retry used to coerce revision to 1 and call signInAnonymously.
    assert.equal(
      planWallWrite({
        ...base,
        hasUser: false,
        createIdentity: mayCreateIdentity(true, halted.allowCreate),
        revision: 1,
        halted: halted.halted,
      }),
      "local-only",
    );
    assert.equal(
      planWallWrite({
        ...base,
        hasUser: true,
        createIdentity: true,
        revision: 1,
        halted: true,
      }),
      "local-only",
    );
  });

  it("ignores a save that started before delete and rolls a recreated wall back", () => {
    const started = 4;
    const halted = haltSync({
      generation: started,
      allowCreate: true,
      retryAttempt: 1,
      halted: false,
    });
    assert.equal(inFlightMayWrite(started, halted.generation), false);
    const rollback = rollbackStaleWrite({
      reason: "delete",
      createdUserHere: false,
      wrote: true,
    });
    assert.equal(rollback.undoWall, true);
    assert.equal(rollback.undoUser, false);
    assert.equal(rollback.noteSynced, false);
    assert.equal(rollback.scheduleRetry, false);

    const createdDuringDelete = rollbackStaleWrite({
      reason: "delete",
      createdUserHere: true,
      wrote: true,
    });
    assert.equal(createdDuringDelete.undoWall, true);
    assert.equal(createdDuringDelete.undoUser, true);
    assert.equal(createdDuringDelete.scheduleRetry, false);
  });

  it("cancels the same in-flight save on sign-out without deleting an existing wall", () => {
    const started = 2;
    const halted = haltSync({
      generation: started,
      allowCreate: true,
      retryAttempt: 1,
      halted: false,
    });
    assert.equal(inFlightMayWrite(started, halted.generation), false);
    const rollback = rollbackStaleWrite({
      reason: "sign-out",
      createdUserHere: false,
      wrote: true,
    });
    assert.equal(rollback.undoWall, false);
    assert.equal(rollback.undoUser, false);
    assert.equal(rollback.noteSynced, false);
    assert.equal(rollback.scheduleRetry, false);
  });

  it("creates an account again only after a fresh pin", () => {
    const halted = haltSync({
      generation: 1,
      allowCreate: true,
      retryAttempt: 3,
      halted: false,
    });
    const afterPin = resumeSyncOnRevision(halted, true);
    assert.equal(afterPin.halted, false);
    assert.equal(afterPin.allowCreate, true);
    assert.equal(afterPin.generation, halted.generation);
    assert.equal(
      planWallWrite({
        ...base,
        hasUser: false,
        createIdentity: mayCreateIdentity(true, afterPin.allowCreate),
        revision: 2,
        halted: afterPin.halted,
      }),
      "create-and-push",
    );
    assert.equal(inFlightMayWrite(afterPin.generation, afterPin.generation), true);
  });
});
