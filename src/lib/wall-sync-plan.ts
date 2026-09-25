export type WallWritePlan = "skip" | "local-only" | "create-and-push" | "push";

export type WallWriteInput = {
  configured: boolean;
  /** True while a shared `#w=` link is on screen. That view never syncs. */
  suspended: boolean;
  hasUser: boolean;
  /** True only for a pin, adopting a share, or an explicit Google sign-in. */
  createIdentity: boolean;
  revision: number;
};

/**
 * Local storage is written by the page either way. This plan only decides
 * whether Firestore runs, and whether that may create an anonymous user.
 * Viewing a wall, including a shared link, never creates one.
 */
export function planWallWrite(input: WallWriteInput): WallWritePlan {
  if (!input.configured) return "local-only";
  if (input.suspended || input.revision <= 0) return "skip";
  if (input.hasUser) return "push";
  if (input.createIdentity) return "create-and-push";
  return "local-only";
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
