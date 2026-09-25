export const CARRIER_IDS = ["usps", "ups", "fedex", "dhl", "hdx", "ontrac", "amazon"] as const;

export type CarrierId = (typeof CARRIER_IDS)[number];

export type Carrier = {
  id: CarrierId;
  name: string;
  /** Shown in the menu. Blank when we don't have a comparable daily figure. */
  perDay: string;
};

/**
 * Order is 2025 US parcel volume (ShipMatrix), divided by 365:
 * USPS 6.6bn, UPS 4.4bn, FedEx 3.6bn. DHL and HDX are not in that US ranking.
 */
export const CARRIERS: Carrier[] = [
  { id: "usps", name: "USPS", perDay: "18.1M/day" },
  { id: "ups", name: "UPS", perDay: "12.1M/day" },
  { id: "fedex", name: "FedEx", perDay: "9.9M/day" },
  { id: "dhl", name: "DHL", perDay: "" },
  { id: "hdx", name: "HDX", perDay: "" },
  { id: "ontrac", name: "OnTrac", perDay: "" },
  { id: "amazon", name: "Amazon", perDay: "" },
];

export function isCarrierId(value: string): value is CarrierId {
  return (CARRIER_IDS as readonly string[]).includes(value);
}

export function carrierById(id: CarrierId): Carrier {
  const found = CARRIERS.find((carrier) => carrier.id === id);
  return found ?? CARRIERS[0];
}

export function trackUrl(id: CarrierId, number: string): string {
  const encoded = encodeURIComponent(number);
  switch (id) {
    case "usps":
      return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encoded}`;
    case "ups":
      return `https://www.ups.com/track?tracknum=${encoded}`;
    case "fedex":
      return `https://www.fedex.com/fedextrack/?trknbr=${encoded}`;
    case "dhl":
      return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${encoded}`;
    case "hdx":
      // EmmisTrack on the carrier site. GET with cno opens that waybill, not the homepage.
      return `http://www.hdxcn.com/cgi-bin/GInfo.dll?EmmisTrack&w=qdhuandao&cno=${encoded}`;
    case "ontrac":
      return `https://www.ontrac.com/tracking/?number=${encoded}`;
    case "amazon":
      // Amazon Shipping's public tracker. The path is the tracking id; no account login.
      return `https://track.amazon.com/tracking/${encoded}`;
  }
}

/**
 * Amazon Logistics / Amazon Shipping. TBA is the common Transportation Booking
 * id (TBA + 12 digits). TBC and TBM are the same family on some routes.
 */
export function isAmazonNumber(raw: string): boolean {
  const number = raw.replace(/[\s-]/g, "").toUpperCase();
  return /^(TBA|TBC|TBM)\d{12}$/.test(number);
}

export function isTrackingNumber(number: string): boolean {
  return /^[A-Za-z0-9]{8,40}$/.test(number);
}

/** Highest pattern score wins. A tie goes to the carrier earlier in CARRIERS. */
export function guessCarrier(raw: string): CarrierId {
  const number = raw.replace(/[\s-]/g, "").toUpperCase();
  const scores = new Map<CarrierId, number>(CARRIERS.map((carrier) => [carrier.id, 0]));
  const add = (id: CarrierId, score: number) => {
    scores.set(id, Math.max(scores.get(id) ?? 0, score));
  };

  if (/^1Z[A-Z0-9]{16}$/.test(number)) add("ups", 100);
  else if (/^1Z/.test(number)) add("ups", 70);
  if (/^T\d{10}$/.test(number)) add("ups", 92);

  if (/^420\d{5}9\d{15,22}$/.test(number)) add("usps", 98);
  if (/^(94|93|92|91|95)\d{16,26}$/.test(number)) add("usps", 96);
  if (/^[A-Z]{2}\d{9}US$/.test(number)) add("usps", 97);
  if (/^\d{20,22}$/.test(number)) add("usps", number.startsWith("9") ? 90 : 28);
  if (/^\d{26,34}$/.test(number)) add("usps", 50);

  if (/^DT\d{12}$/.test(number)) add("fedex", 94);
  if (/^96\d{18,22}$/.test(number)) add("fedex", 91);
  if (/^\d{12}$/.test(number)) add("fedex", 82);
  if (/^\d{15}$/.test(number)) add("fedex", 86);
  if (/^\d{20}$/.test(number) && !number.startsWith("9")) add("fedex", 78);
  if (/^\d{22}$/.test(number) && !number.startsWith("9")) add("fedex", 64);

  if (/^(JD|JJD|JVGL|3S)/.test(number)) add("dhl", 96);
  if (/^(GM|LX|RX)[A-Z0-9]{8,}$/.test(number)) add("dhl", 88);
  if (/^\d{10}$/.test(number)) add("dhl", 84);
  if (/^\d{11}$/.test(number)) add("dhl", 72);
  if (/^[A-Z]{2}\d{9}DE$/.test(number)) add("dhl", 70);

  if (/^HDX[A-Z0-9]+/.test(number)) add("hdx", 96);

  // Classic OnTrac is C or D plus 14 digits. LaserShip prefixes still track on
  // OnTrac (1LS, LS, BN). LX stays with DHL — that prefix is already theirs.
  if (/^[CD]\d{14}$/.test(number)) add("ontrac", 100);
  if (/^1LS[A-Z0-9]{5,}$/.test(number)) add("ontrac", 97);
  if (/^BN[A-Z0-9]{6,}$/.test(number)) add("ontrac", 93);
  if (/^LS[A-Z0-9]{6,}$/.test(number)) add("ontrac", 90);
  // Newer numeric barcodes are 20 digits and zero-padded (at least four leading zeros).
  // FedEx door tags of the same length do not lead with zeros, so they keep their score.
  if (/^0{4}\d{16}$/.test(number)) add("ontrac", 92);

  if (isAmazonNumber(number)) add("amazon", 100);

  let best: CarrierId = "usps";
  let bestScore = 0;
  for (const carrier of CARRIERS) {
    const score = scores.get(carrier.id) ?? 0;
    if (score > bestScore) {
      best = carrier.id;
      bestScore = score;
    }
  }
  return best;
}
