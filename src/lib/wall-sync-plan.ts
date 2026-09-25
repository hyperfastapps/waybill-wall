export type WallWritePlan = "skip" | "local-only" | "create-and-push" | "push";

export type WallWriteInput = {
  configured: boolean;
  /** True while a shared `#w=` link is on screen. That view never syncs. */
  suspended: boolean;
  hasUser: boolean;
  /** True only for a pin, adopting a share, or an explicit Google sign-in. */
  createIdentity: boolean;
  revision: number;
  /**
   * Set by delete and sign-out until the next local edit. A pending retry must
   * not upload or create an account while this is set, even if a user object
   * is still in memory.
   */
  halted?: boolean;
};

/**
 * Local storage is written by the page either way. This plan only decides
 * whether Firestore runs, and whether that may create an anonymous user.
 * Viewing a wall, including a shared link, never creates one.
 */
export function planWallWrite(input: WallWriteInput): WallWritePlan {
  if (!input.configured) return "local-only";
  if (input.suspended || input.revision <= 0) return "skip";
  if (input.halted) return "local-only";
  if (input.hasUser) return "push";
  if (input.createIdentity) return "create-and-push";
  return "local-only";
}

export type AbandonReason = "delete" | "sign-out";

export type SyncHaltState = {
  generation: number;
  allowCreate: boolean;
  retryAttempt: number;
  halted: boolean;
};

/**
 * Delete and sign-out share this. The generation bump makes a save that already
 * started stale. allowCreate stays false until a later pin (a revision change)
 * sets it again, so a pending retry cannot call signInAnonymously.
 */
export function haltSync(state: SyncHaltState): SyncHaltState {
  return {
    generation: state.generation + 1,
    allowCreate: false,
    retryAttempt: 0,
    halted: true,
  };
}

/** A fresh pin or other local edit may sync again. Generation is left alone. */
export function resumeSyncOnRevision(state: SyncHaltState, createIdentity: boolean): SyncHaltState {
  return {
    generation: state.generation,
    retryAttempt: state.retryAttempt,
    allowCreate: createIdentity,
    halted: false,
  };
}

export function mayCreateIdentity(createIdentity: boolean, allowCreate: boolean): boolean {
  return createIdentity && allowCreate;
}

/** A write started at `startedGeneration` may land only while that generation is current. */
export function inFlightMayWrite(startedGeneration: number, currentGeneration: number): boolean {
  return startedGeneration === currentGeneration;
}

export type StaleWriteRollback = {
  undoWall: boolean;
  undoUser: boolean;
  noteSynced: boolean;
  scheduleRetry: boolean;
};

/**
 * A save that started before delete or sign-out must not count as synced and
 * must not schedule another retry. Delete also removes a wall doc that
 * transaction already recreated. Sign-out leaves an existing account's wall
 * in place, and deletes a user only when this attempt created it.
 */
export function rollbackStaleWrite(input: {
  reason: AbandonReason | null;
  createdUserHere: boolean;
  wrote: boolean;
}): StaleWriteRollback {
  const undoUser = input.createdUserHere;
  return {
    undoUser,
    undoWall: input.reason === "delete" ? input.wrote || undoUser : undoUser,
    noteSynced: false,
    scheduleRetry: false,
  };
}

export function planInitialMerge(input: {
  configured: boolean;
  suspended: boolean;
  hasUser: boolean;
  /** A redirect return already merged. Don't merge again over that result. */
  alreadyMerged: boolean;
}): "merge" | "skip" {
  if (!input.configured || input.suspended || !input.hasUser || input.alreadyMerged) return "skip";
  return "merge";
}

export type SyncFailureKind = "rejected" | "transient";

/**
 * A rules rejection (new shipper before `firestore.rules` is published) is not
 * an offline failure. The local wall stays as it is; the write is retried.
 */
export function classifySyncFailure(error: unknown): SyncFailureKind {
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  if (code === "permission-denied" || code === "permission_denied") return "rejected";
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/insufficient permissions/i.test(message)) return "rejected";
  return "transient";
}

export function syncFailureNotice(kind: SyncFailureKind): string {
  if (kind === "rejected") {
    return "Saved on this phone. Cloud sync will retry until the saved wall accepts this shipper.";
  }
  return "Saved on this phone. It will sync when you’re back online.";
}

/** Backoff while a rejected or dropped write is still waiting to land. */
export function syncRetryDelayMs(attempt: number): number {
  const steps = [5_000, 15_000, 45_000, 60_000];
  const index = Math.min(Math.max(attempt, 1), steps.length) - 1;
  return steps[index] ?? 60_000;
}
