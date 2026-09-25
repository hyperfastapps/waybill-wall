import { guessCarrier, isCarrierId, isTrackingNumber, type CarrierId } from "./carriers.ts";

export type Slip = {
  id: string;
  number: string;
  nickname: string;
  caption: string;
  carrier: CarrierId;
};

export const MAX_SLIPS = 12;

type Packed = { n: string; k: string; c: string; s?: string };

export function normalizeNumber(raw: string): string {
  return raw.replace(/[\s-]/g, "");
}

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeWall(slips: Slip[]): string {
  const packed: Packed[] = slips.slice(0, MAX_SLIPS).map((slip) => ({
    n: slip.number,
    k: slip.nickname.slice(0, 40),
    c: slip.caption.slice(0, 140),
    s: slip.carrier,
  }));
  return toBase64Url(JSON.stringify(packed));
}

export function decodeWall(encoded: string): Slip[] | null {
  try {
    const parsed: unknown = JSON.parse(fromBase64Url(encoded));
    if (!Array.isArray(parsed)) return null;
    const slips: Slip[] = [];
    for (const item of parsed.slice(0, MAX_SLIPS)) {
      if (!item || typeof item !== "object") continue;
      const record = item as Partial<Packed>;
      const number = normalizeNumber(String(record.n ?? ""));
      if (!isTrackingNumber(number)) continue;
      const stored = String(record.s ?? "");
      slips.push({
        id: crypto.randomUUID(),
        number,
        nickname: String(record.k ?? "").slice(0, 40),
        caption: String(record.c ?? "").slice(0, 140),
        carrier: isCarrierId(stored) ? stored : guessCarrier(number),
      });
    }
    return slips;
  } catch {
    return null;
  }
}

export const WALL_STORAGE_KEY = "waybill-wall-v1";
export const WALL_HASH_PREFIX = "w=";
