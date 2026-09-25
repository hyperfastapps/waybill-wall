import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CARRIERS,
  guessCarrier,
  isAmazonNumber,
  isCarrierId,
  trackUrl,
  type CarrierId,
} from "./carriers.ts";

const samples: Array<[string, CarrierId]> = [
  ["9400111899223344556677", "usps"],
  ["42090210940011189922334455", "usps"],
  ["EA123456789US", "usps"],
  ["1Z999AA10123456784", "ups"],
  ["T1234567890", "ups"],
  ["123456789012", "fedex"],
  ["123456789012345", "fedex"],
  ["9612345678901234567890", "fedex"],
  ["DT123456789012", "fedex"],
  ["74890987654321098765", "fedex"],
  ["01234567890123456789", "fedex"],
  ["1234567890", "dhl"],
  ["12345678901", "dhl"],
  ["JD014600006123456789", "dhl"],
  ["LX123456789012", "dhl"],
  ["HDX9A81C2201", "hdx"],
  ["C11031500001879", "ontrac"],
  ["D10011354453707", "ontrac"],
  ["00000007481127656487", "ontrac"],
  ["1LSCZM300293DG8", "ontrac"],
  ["BN123456789012", "ontrac"],
  ["LS1234567890", "ontrac"],
  ["TBA334894092403", "amazon"],
  ["TBC123456789012", "amazon"],
  ["TBM123456789012", "amazon"],
];

describe("guessCarrier", () => {
  for (const [number, carrier] of samples) {
    it(`reads ${number} as ${carrier}`, () => {
      assert.equal(guessCarrier(number), carrier);
    });
  }

  it("ignores spaces and letter case on classic OnTrac numbers", () => {
    assert.equal(guessCarrier("c 1103-1500 001879"), "ontrac");
  });

  it("reads the owner’s Amazon number with spaces, dashes, or lowercase", () => {
    assert.equal(guessCarrier("tba334894092403"), "amazon");
    assert.equal(guessCarrier("TBA 3348-9409 2403"), "amazon");
    assert.equal(isAmazonNumber("TBA334894092403"), true);
  });

  it("does not treat a short TBA string as Amazon", () => {
    assert.equal(isAmazonNumber("TBA12345678901"), false);
    assert.notEqual(guessCarrier("TBA12345678901"), "amazon");
    assert.equal(guessCarrier("T1234567890"), "ups");
  });
});

describe("trackUrl", () => {
  it("links HDX to the waybill page for that number", () => {
    const url = new URL(trackUrl("hdx", "HDX9A81C2201"));
    assert.equal(url.hostname, "www.hdxcn.com");
    assert.equal(url.pathname, "/cgi-bin/GInfo.dll");
    assert.equal(url.searchParams.get("EmmisTrack"), "");
    assert.equal(url.searchParams.get("w"), "qdhuandao");
    assert.equal(url.searchParams.get("cno"), "HDX9A81C2201");
  });

  it("links OnTrac to the tracking page for that number", () => {
    const url = new URL(trackUrl("ontrac", "00000007481127656487"));
    assert.equal(url.origin + url.pathname, "https://www.ontrac.com/tracking/");
    assert.equal(url.searchParams.get("number"), "00000007481127656487");
  });

  it("links FedEx to the public tracking page for that number", () => {
    const url = new URL(trackUrl("fedex", "123456789012"));
    assert.equal(url.hostname, "www.fedex.com");
    assert.equal(url.searchParams.get("trknbr"), "123456789012");
  });

  it("links Amazon to the public tracking page for that number", () => {
    const url = new URL(trackUrl("amazon", "TBA334894092403"));
    assert.equal(url.origin + url.pathname, "https://track.amazon.com/tracking/TBA334894092403");
  });
});

describe("shipper list", () => {
  it("includes OnTrac", () => {
    assert.equal(isCarrierId("ontrac"), true);
    assert.ok(CARRIERS.some((carrier) => carrier.id === "ontrac" && carrier.name === "OnTrac"));
  });

  it("includes Amazon", () => {
    assert.equal(isCarrierId("amazon"), true);
    assert.ok(CARRIERS.some((carrier) => carrier.id === "amazon" && carrier.name === "Amazon"));
  });
});
