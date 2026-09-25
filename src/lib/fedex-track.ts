import { createServerFn } from "@tanstack/react-start";
import {
  carrierById,
  isCarrierId,
  isTrackingNumber,
  trackUrl,
  type CarrierId,
} from "@/lib/carriers";
import { normalizeNumber } from "@/lib/wall-codec";

export type TrackEvent = {
  when: string;
  where: string;
  what: string;
};

export type PublicTrack = {
  number: string;
  outcome: "live" | "not_found" | "handoff";
  headline: string;
  detail: string;
  service: string | null;
  fromLabel: string | null;
  toLabel: string | null;
  eta: string | null;
  events: TrackEvent[];
  officialUrl: string;
};

function officialUrl(number: string, carrier: CarrierId): string {
  return trackUrl(carrier, number);
}

function handoff(number: string, carrier: CarrierId): PublicTrack {
  const name = carrierById(carrier).name;
  return {
    number,
    outcome: "handoff",
    headline: `Status lives on ${name}`,
    detail: `Open ${name} for the scan history. The wall keeps the number and your caption, not an account login.`,
    service: null,
    fromLabel: null,
    toLabel: null,
    eta: null,
    events: [],
    officialUrl: officialUrl(number, carrier),
  };
}

function notFound(number: string, carrier: CarrierId): PublicTrack {
  const name = carrierById(carrier).name;
  return {
    number,
    outcome: "not_found",
    headline: "No public record",
    detail: `${name} didn’t return a shipment for this number. Check it, or open their tracker.`,
    service: null,
    fromLabel: null,
    toLabel: null,
    eta: null,
    events: [],
    officialUrl: officialUrl(number, carrier),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asText(value: unknown): string {
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  if (typeof value === "number") return String(value);
  return "";
}

/** City-level only. Drop anything that looks like a street, name line, phone, or email. */
function placeOnly(value: unknown): string | null {
  const text = asText(value);
  if (!text || text.length > 48) return null;
  if (/@/.test(text) || /\+?\d[\d\s().-]{7,}/.test(text)) return null;
  if (
    /\d/.test(text) &&
    /\b(st|street|ave|avenue|rd|road|blvd|dr|drive|ln|lane|way|ct|court|apt|suite)\b/i.test(text)
  ) {
    return null;
  }
  return text;
}

function locationLabel(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") return placeOnly(value);
  const row = asRecord(value);
  if (!row) return null;
  const city = asText(row.city);
  const state = asText(row.stateOrProvinceCode ?? row.state ?? row.stateOrProvince);
  return placeOnly([city, state].filter(Boolean).join(", ")) ?? placeOnly(city);
}

function readEvents(list: unknown): TrackEvent[] {
  if (!Array.isArray(list)) return [];
  const events: TrackEvent[] = [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const what = asText(row.status ?? row.eventDescription ?? row.scanDetails ?? row.derivedStatus);
    if (!what) continue;
    const where =
      locationLabel(row.scanLocation) ??
      locationLabel(
        [asText(row.city), asText(row.stateOrProvinceCode ?? row.state)].filter(Boolean).join(", "),
      ) ??
      "";
    const when =
      [asText(row.date), asText(row.time)].filter(Boolean).join(" ") || asText(row.dateAndTime);
    events.push({ when, where, what: what.slice(0, 140) });
    if (events.length >= 6) break;
  }
  return events;
}

function fromPackage(
  number: string,
  carrier: CarrierId,
  pkg: Record<string, unknown>,
): PublicTrack | null {
  const headline =
    asText(pkg.keyStatus) ||
    asText(pkg.displayKeyStatus) ||
    asText(asRecord(pkg.latestStatusDetail)?.statusByLocale) ||
    asText(asRecord(pkg.latestStatusDetail)?.description) ||
    asText(pkg.status);
  if (!headline) return null;

  const scanList = pkg.scanEventList ?? pkg.scanEvents ?? asRecord(pkg.scanEventList);
  const events = readEvents(scanList);

  const serviceDetail = asRecord(pkg.serviceDetail);
  const shipperAddress = asRecord(asRecord(pkg.shipperInformation)?.address);
  const recipientAddress = asRecord(asRecord(pkg.recipientInformation)?.address);
  const deliveryWindow = asRecord(pkg.estimatedDeliveryTimeWindow);
  const windowBounds = asRecord(deliveryWindow?.window);

  const origin =
    placeOnly(pkg.displayShipFrom) ??
    placeOnly(asRecord(pkg.shipperAddress)?.city) ??
    placeOnly(shipperAddress?.city) ??
    placeOnly(pkg.originCity);
  const dest =
    placeOnly(pkg.displayShipTo) ??
    placeOnly(asRecord(pkg.recipientAddress)?.city) ??
    placeOnly(recipientAddress?.city) ??
    placeOnly(pkg.destinationCity);
  const eta =
    asText(pkg.displayEstDeliveryDateTime) ||
    asText(pkg.displayActDeliveryDateTime) ||
    asText(windowBounds?.ends) ||
    asText(deliveryWindow?.description) ||
    asText(pkg.estimatedDeliveryTimeWindow) ||
    null;

  return {
    number,
    outcome: "live",
    headline: headline.slice(0, 80),
    detail: "Public tracking only — city level, no street address, no signature name.",
    service:
      asText(pkg.serviceDesc) ||
      asText(serviceDetail?.description) ||
      asText(pkg.serviceType) ||
      null,
    fromLabel: origin,
    toLabel: dest,
    eta: eta ? eta.slice(0, 80) : null,
    events,
    officialUrl: officialUrl(number, carrier),
  };
}

function parsePayload(number: string, carrier: CarrierId, text: string): PublicTrack | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const root = asRecord(data);
  if (!root) return null;

  const response = asRecord(root.TrackPackagesResponse) ?? root;
  const output = asRecord(response.output);
  const complete = output?.completeTrackResults;
  if (Array.isArray(complete) && complete.length > 0) {
    const first = asRecord(complete[0]);
    const trackResults = first?.trackResults;
    if (Array.isArray(trackResults) && trackResults[0]) {
      const parsed = fromPackage(number, carrier, asRecord(trackResults[0]) ?? {});
      if (parsed) return parsed;
    }
    const error = asRecord(first?.error);
    if (error && asText(error.code)) return notFound(number, carrier);
  }

  const list =
    (Array.isArray(response.packageList) && response.packageList) ||
    (Array.isArray(root.packageList) && root.packageList) ||
    null;
  if (list && list.length > 0) {
    const parsed = fromPackage(number, carrier, asRecord(list[0]) ?? {});
    if (parsed) return parsed;
  }

  const errorList = response.errorList ?? root.errorList;
  if (Array.isArray(errorList) && errorList.length > 0) return notFound(number, carrier);
  return null;
}

/** Dynamic lookup so Vite does not inline secrets into the client bundle. */
function serverEnv(name: string): string {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function fedexCredentials(): { key: string; secret: string; base: string } | null {
  const key = serverEnv("FEDEX_API_KEY");
  const secret = serverEnv("FEDEX_SECRET_KEY");
  if (!key || !secret) return null;
  const base = (serverEnv("FEDEX_API_BASE") || "https://apis.fedex.com").replace(/\/+$/, "");
  return { key, secret, base };
}

let fedexTokenCache: { token: string; expiresAt: number } | null = null;

async function fedexAccessToken(creds: {
  key: string;
  secret: string;
  base: string;
}): Promise<string> {
  if (fedexTokenCache && fedexTokenCache.expiresAt > Date.now() + 15_000) {
    return fedexTokenCache.token;
  }
  const response = await fetch(`${creds.base}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: creds.key,
      client_secret: creds.secret,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("FedEx authorization failed");
  const payload = asRecord(await response.json());
  const token = asText(payload?.access_token);
  if (!token) throw new Error("FedEx authorization failed");
  const expiresIn = Number(payload?.expires_in);
  const ttl = Number.isFinite(expiresIn) && expiresIn > 60 ? expiresIn : 3600;
  fedexTokenCache = { token, expiresAt: Date.now() + ttl * 1000 };
  return token;
}

/** Official Track API. Returns null when the call cannot be trusted, so the slip can link out. */
async function lookupFedexApi(number: string): Promise<PublicTrack | null> {
  const creds = fedexCredentials();
  if (!creds) return null;
  const token = await fedexAccessToken(creds);
  const response = await fetch(`${creds.base}/track/v1/trackingnumbers`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-locale": "en_US",
    },
    body: JSON.stringify({
      includeDetailedScans: true,
      trackingInfo: [{ trackingNumberInfo: { trackingNumber: number } }],
    }),
    signal: AbortSignal.timeout(8000),
  });
  const text = await response.text();
  if (!response.ok) return null;
  return parsePayload(number, "fedex", text.slice(0, 180000));
}

async function lookupNumber(number: string, carrier: CarrierId): Promise<PublicTrack> {
  if (carrier !== "fedex") return handoff(number, carrier);
  // FedEx refuses the public tracker from this host. Without optional API keys, link out.
  if (!fedexCredentials()) return handoff(number, carrier);
  try {
    const live = await lookupFedexApi(number);
    if (live) return live;
  } catch {
    /* fall through to the carrier page */
  }
  return handoff(number, carrier);
}

export const lookupShipment = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const record = asRecord(input);
    const number = normalizeNumber(asText(record?.number));
    const carrierRaw = asText(record?.carrier);
    if (!isTrackingNumber(number)) {
      throw new Error("Use 8 to 40 letters or digits.");
    }
    if (!isCarrierId(carrierRaw)) {
      throw new Error("Pick a shipper.");
    }
    return { number, carrier: carrierRaw };
  })
  .handler(async ({ data }) => lookupNumber(data.number, data.carrier));
