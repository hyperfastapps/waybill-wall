import { MAX_SLIPS, normalizeNumber, type Slip } from "./wall-codec.ts";

export type MergeResult = {
  slips: Slip[];
  /** Incoming slips whose tracking number was already kept. */
  duplicates: Slip[];
  /** Incoming slips that lost the 12-slip cap. */
  dropped: Slip[];
};

export function slipTrackingKey(number: string): string {
  return normalizeNumber(number).toUpperCase();
}

function trackingKey(number: string): string {
  return slipTrackingKey(number);
}

/**
 * Keep `base` in order, then append `incoming` slips whose tracking number is
 * not already present. The wall caps at 12. On a duplicate number, the base
 * slip wins (nickname and caption stay). Overflow is dropped from the incoming
 * side, never from the base list's first 12.
 *
 * Google-account adoption passes the existing account wall as `base` and the
 * anonymous wall as `incoming`. A same-account device sync passes this device
 * as `base` and the other device as `incoming`.
 */
export function mergeSlips(base: Slip[], incoming: Slip[]): MergeResult {
  const slips: Slip[] = [];
  const seen = new Set<string>();
  const duplicates: Slip[] = [];
  const dropped: Slip[] = [];

  for (const slip of base) {
    const key = trackingKey(slip.number);
    if (!key || seen.has(key)) continue;
    if (slips.length >= MAX_SLIPS) continue;
    seen.add(key);
    slips.push(slip);
  }

  for (const slip of incoming) {
    const key = trackingKey(slip.number);
    if (!key || seen.has(key)) {
      duplicates.push(slip);
      continue;
    }
    if (slips.length >= MAX_SLIPS) {
      dropped.push(slip);
      continue;
    }
    seen.add(key);
    slips.push(slip);
  }

  return { slips, dropped, duplicates };
}

/**
 * Build the next cloud wall from this device and the current server document.
 *
 * `syncedKeys` is the tracking-number set last written successfully from this
 * device. A key in that set and missing locally was removed here, so the server
 * copy is not put back. Keys we have never synced are not deletions: the server
 * slip is kept. `null` means there is no baseline yet (union, local wins on
 * duplicates). The result is still capped at 12, and local slips stay ahead of
 * server-only ones.
 */
export function reconcileWall(
  local: Slip[],
  remote: Slip[],
  syncedKeys: readonly string[] | null,
): MergeResult {
  if (!syncedKeys) return mergeSlips(local, remote);
  const localKeys = new Set<string>();
  for (const slip of local) {
    const key = trackingKey(slip.number);
    if (key) localKeys.add(key);
  }
  const removed = new Set<string>();
  for (const key of syncedKeys) {
    const normalized = trackingKey(key);
    if (normalized && !localKeys.has(normalized)) removed.add(normalized);
  }
  const incoming = remote.filter((slip) => {
    const key = trackingKey(slip.number);
    return Boolean(key) && !removed.has(key);
  });
  return mergeSlips(local, incoming);
}

/** Tracking numbers in the wall we just saved. This is the next deletion baseline. */
export function syncedTrackingKeys(slips: Slip[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const slip of slips) {
    const key = trackingKey(slip.number);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
    if (keys.length === MAX_SLIPS) break;
  }
  return keys;
}

/** Compare the fields that round-trip through the share hash, ignoring ids. */
export function sameSlipContent(left: Slip[], right: Slip[]): boolean {
  return encodeComparable(left) === encodeComparable(right);
}

function encodeComparable(slips: Slip[]): string {
  return JSON.stringify(
    slips.slice(0, MAX_SLIPS).map((slip) => ({
      n: normalizeNumber(slip.number).toUpperCase(),
      k: slip.nickname.slice(0, 40),
      c: slip.caption.slice(0, 140),
      s: slip.carrier,
    })),
  );
}
