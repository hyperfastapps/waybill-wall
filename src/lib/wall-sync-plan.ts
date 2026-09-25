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
