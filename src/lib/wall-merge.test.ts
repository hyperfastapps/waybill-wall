import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Slip } from "./wall-codec.ts";
import { mergeSlips, sameSlipContent } from "./wall-merge.ts";

function slip(number: string, nickname = number, caption = ""): Slip {
  return { id: `id-${number}`, number, nickname, caption, carrier: "ups" };
}

describe("mergeSlips", () => {
  it("appends tracking numbers that are not already on the wall", () => {
    const merged = mergeSlips(
      [slip("1ZAAA", "Lamp")],
      [slip("1ZBBB", "Mugs"), slip("1ZCCC", "Books")],
    );
    assert.deepEqual(
      merged.slips.map((item) => item.nickname),
      ["Lamp", "Mugs", "Books"],
    );
    assert.equal(merged.dropped.length, 0);
    assert.equal(merged.duplicates.length, 0);
  });

  it("keeps the base slip when the tracking number already exists", () => {
    const merged = mergeSlips(
      [slip("1Z999AA10123456784", "From Google", "leave at desk")],
      [slip("1z999aa10123456784", "From this phone", "side door")],
    );
    assert.equal(merged.slips.length, 1);
    assert.equal(merged.slips[0]?.nickname, "From Google");
    assert.equal(merged.slips[0]?.caption, "leave at desk");
    assert.equal(merged.duplicates.length, 1);
    assert.equal(merged.dropped.length, 0);
  });

  it("treats spaces and dashes as the same tracking number", () => {
    const merged = mergeSlips([slip("1Z999-AA10 123456784", "Kept")], [slip("1Z999AA10123456784", "Dropped")]);
    assert.equal(merged.slips.length, 1);
    assert.equal(merged.slips[0]?.nickname, "Kept");
    assert.equal(merged.duplicates.length, 1);
  });

  it("fills remaining slots and drops incoming slips past 12", () => {
    const base = Array.from({ length: 10 }, (_, index) => slip(`BASE${index}XXXX`, `Base ${index}`));
    const incoming = Array.from({ length: 4 }, (_, index) => slip(`NEW${index}YYYY`, `New ${index}`));
    const merged = mergeSlips(base, incoming);
    assert.equal(merged.slips.length, 12);
    assert.deepEqual(
      merged.slips.slice(10).map((item) => item.nickname),
      ["New 0", "New 1"],
    );
    assert.deepEqual(
      merged.dropped.map((item) => item.nickname),
      ["New 2", "New 3"],
    );
  });

  it("keeps a full base wall and drops every new number", () => {
    const base = Array.from({ length: 12 }, (_, index) => slip(`FULL${index}XXXX`, `Full ${index}`));
    const merged = mergeSlips(base, [slip("EXTRA123456", "Extra")]);
    assert.equal(merged.slips.length, 12);
    assert.equal(merged.slips[0]?.nickname, "Full 0");
    assert.equal(merged.dropped.length, 1);
    assert.equal(merged.dropped[0]?.nickname, "Extra");
  });

  it("collapses duplicate numbers inside the base list", () => {
    const merged = mergeSlips(
      [slip("1ZSAME1234567890AB", "First"), slip("1ZSAME1234567890AB", "Second")],
      [],
    );
    assert.equal(merged.slips.length, 1);
    assert.equal(merged.slips[0]?.nickname, "First");
  });
});

describe("sameSlipContent", () => {
  it("ignores slip ids and tracking-number case", () => {
    const left: Slip[] = [{ id: "a", number: "1zabc12345", nickname: "Lamp", caption: "", carrier: "ups" }];
    const right: Slip[] = [{ id: "b", number: "1ZABC12345", nickname: "Lamp", caption: "", carrier: "ups" }];
    assert.equal(sameSlipContent(left, right), true);
  });
});
