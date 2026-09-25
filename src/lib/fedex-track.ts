import { createServerFn } from "@tanstack/react-start";
import { carrierById, isCarrierId, isTrackingNumber, trackUrl, type CarrierId } from "@/lib/carriers";
import { normalizeNumber } from "@/lib/wall-codec";

export type TrackEvent = {
  when: string;
  where: string;
  what: string;
};

export type PublicTrack = {
  number: string;
  outcome: "live" | "blocked" | "not_found" | "handoff";
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

function blocked(number: string, carrier: CarrierId): PublicTrack {
  const name = carrierById(carrier).name;
  return {
    number,
    outcome: "blocked",
    headline: `${name} didn’t answer from here`,
    detail: `Their site blocks automated lookups. Open ${name} for the live status. This app never signs into an account.`,
    service: null,
    fromLabel: null,
    toLabel: null,
    eta: null,
    events: [],
    officialUrl: officialUrl(number, carrier),
  };
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
  if (/\d/.test(text) && /\b(st|street|ave|avenue|rd|road|blvd|dr|drive|ln|lane|way|ct|court|apt|suite)\b/i.test(text)) {
    return null;
  }
  return text;
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
      placeOnly(row.scanLocation) ??
      placeOnly(
        [asText(row.city), asText(row.stateOrProvinceCode ?? row.state)].filter(Boolean).join(", "),
      ) ??
      "";
    const when = [asText(row.date), asText(row.time)].filter(Boolean).join(" ") || asText(row.dateAndTime);
    events.push({ when, where, what: what.slice(0, 140) });
    if (events.length >= 6) break;
  }
  return events;
}

function fromPackage(number: string, carrier: CarrierId, pkg: Record<string, unknown>): PublicTrack | null {
  const headline =
    asText(pkg.keyStatus) ||
    asText(pkg.displayKeyStatus) ||
    asText(asRecord(pkg.latestStatusDetail)?.statusByLocale) ||
    asText(asRecord(pkg.latestStatusDetail)?.description) ||
    asText(pkg.status);
  if (!headline) return null;

  const scanList = pkg.scanEventList ?? pkg.scanEvents ?? asRecord(pkg.scanEventList);
  const events = readEvents(scanList);

  const origin =
    placeOnly(pkg.displayShipFrom) ??
    placeOnly(asRecord(pkg.shipperAddress)?.city) ??
    placeOnly(pkg.originCity);
  const dest =
    placeOnly(pkg.displayShipTo) ??
    placeOnly(asRecord(pkg.recipientAddress)?.city) ??
    placeOnly(pkg.destinationCity);
  const eta =
    asText(pkg.displayEstDeliveryDateTime) ||
    asText(pkg.displayActDeliveryDateTime) ||
    asText(pkg.estimatedDeliveryTimeWindow) ||
    null;

  return {
    number,
    outcome: "live",
    headline: headline.slice(0, 80),
    detail: "Public tracking only — city level, no street address, no signature name.",
    service: asText(pkg.serviceDesc) || asText(pkg.serviceType) || null,
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

function looksBlocked(status: number, text: string): boolean {
  if (status === 401 || status === 403 || status === 429 || status === 503) return true;
  const sample = text.slice(0, 1500).toLowerCase();
  return (
    sample.includes("access denied") ||
    sample.includes("system down") ||
    sample.includes("edgesuite") ||
    sample.includes("incapsula") ||
    sample.includes("just a moment")
  );
}

async function pull(url: string, init?: RequestInit): Promise<{ status: number; text: string }> {
  const response = await fetch(url, {
    ...init,
    redirect: "follow",
    signal: AbortSignal.timeout(8000),
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  return { status: response.status, text: text.slice(0, 180000) };
}

async function lookupNumber(number: string, carrier: CarrierId): Promise<PublicTrack> {
  if (carrier !== "fedex") return handoff(number, carrier);

  const body = new URLSearchParams({
    data: JSON.stringify({
      TrackPackagesRequest: {
        appType: "WTRK",
        appDeviceType: "DESKTOP",
        supportHTML: true,
        supportCurrentLocation: true,
        uniqueKey: "",
        processingParameters: {},
        trackingInfoList: [
          { trackNumberInfo: { trackingNumber: number, trackingQualifier: "", trackingCarrier: "" } },
        ],
      },
    }),
    action: "trackpackages",
    locale: "en_US",
    version: "1",
    format: "json",
  });

  const attempts: Array<() => Promise<{ status: number; text: string }>> = [
    () =>
      pull("https://www.fedex.com/wtrk/track/", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: "https://www.fedex.com",
          Referer: "https://www.fedex.com/fedextrack/",
        },
        body,
      }),
  ];

  let sawBlock = false;
  for (const attempt of attempts) {
    try {
      const result = await attempt();
      const parsed = parsePayload(number, carrier, result.text);
      if (parsed) return parsed;
      if (looksBlocked(result.status, result.text)) sawBlock = true;
    } catch {
      sawBlock = true;
    }
  }

  return sawBlock ? blocked(number, carrier) : notFound(number, carrier);
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
