import { isCarrierId, isTrackingNumber } from "./carriers.ts";
import { mergeSlips, reconcileWall, sameSlipContent, type MergeResult } from "./wall-merge.ts";
import { normalizeNumber, type Slip } from "./wall-codec.ts";
import { doc, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore";

/**
 * Read `walls/{uid}` and write the merge in one transaction. A plain set of
 * the phone's slips drops anything another device added after the last read.
 * Local-wins keeps a removal that was in the last successful sync. Account-wins
 * (Google adoption) keeps the account wall and appends new numbers.
 */
export async function commitReconciledWall(
  db: Firestore,
  uid: string,
  local: Slip[],
  mode: "local-wins" | "account-wins",
  syncedKeys: readonly string[] | null,
): Promise<MergeResult> {
  const ref = doc(db, "walls", uid);
  return runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    const remote = snap.exists() ? parseStoredSlips(snap.data()?.slips) : [];
    const merged =
      mode === "local-wins" ? reconcileWall(local, remote, syncedKeys) : mergeSlips(remote, local);
    if (!sameSlipContent(merged.slips, remote)) {
      transaction.set(ref, {
        slips: toStored(merged.slips),
        updatedAt: serverTimestamp(),
      });
    }
    return merged;
  });
}

function toStored(slips: Slip[]) {
  const stored: Array<{
    id: string;
    number: string;
    nickname: string;
    caption: string;
    carrier: Slip["carrier"];
  }> = [];
  for (const slip of slips) {
    const number = normalizeNumber(slip.number);
    if (!isTrackingNumber(number) || !isCarrierId(slip.carrier)) continue;
    const id = slip.id.trim().slice(0, 80);
    if (!id) continue;
    stored.push({
      id,
      number,
      nickname: slip.nickname.slice(0, 40),
      caption: slip.caption.slice(0, 140),
      carrier: slip.carrier,
    });
    if (stored.length === 12) break;
  }
  return stored;
}

function parseStoredSlips(value: unknown): Slip[] {
  if (!Array.isArray(value)) return [];
  const slips: Slip[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const number = normalizeNumber(typeof record.number === "string" ? record.number : "");
    const carrier = typeof record.carrier === "string" ? record.carrier : "";
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id || !isTrackingNumber(number) || !isCarrierId(carrier)) continue;
    slips.push({
      id: id.slice(0, 80),
      number,
      nickname: typeof record.nickname === "string" ? record.nickname.slice(0, 40) : "",
      caption: typeof record.caption === "string" ? record.caption.slice(0, 140) : "",
      carrier,
    });
  }
  return slips;
}
