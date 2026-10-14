import { describe, expect, it } from "vitest";

import { contains, intersect, normalize, overlaps, overlapsAny, subtract } from "./intervals";

const i = (start: number, end: number) => ({ start, end });

describe("overlaps (half-open)", () => {
  it.each([
    [i(0, 10), i(5, 15), true],
    [i(0, 10), i(10, 20), false], // touching is not overlapping
    [i(10, 20), i(0, 10), false],
    [i(0, 10), i(2, 3), true],
    [i(0, 10), i(10, 10), false],
  ])("%o vs %o -> %s", (a, b, expected) => {
    expect(overlaps(a, b)).toBe(expected);
  });

  it("overlapsAny scans an unsorted set", () => {
    expect(overlapsAny([i(50, 60), i(0, 5)], i(4, 6))).toBe(true);
    expect(overlapsAny([i(50, 60), i(0, 5)], i(5, 50))).toBe(false);
  });
});

describe("contains", () => {
  it("accepts equal bounds and rejects spill-over", () => {
    expect(contains(i(0, 10), i(0, 10))).toBe(true);
    expect(contains(i(0, 10), i(0, 11))).toBe(false);
    expect(contains(i(0, 10), i(-1, 5))).toBe(false);
  });
});

describe("normalize", () => {
  it("sorts, merges overlapping and touching ranges, drops empties", () => {
    expect(normalize([i(20, 30), i(0, 10), i(10, 15), i(25, 40), i(50, 50)])).toEqual([i(0, 15), i(20, 40)]);
  });

  it("does not mutate the input", () => {
    const input = [i(5, 6), i(1, 2)];
    normalize(input);
    expect(input).toEqual([i(5, 6), i(1, 2)]);
  });
});

describe("subtract", () => {
  it("cuts holes in the middle", () => {
    expect(subtract([i(0, 100)], [i(10, 20), i(50, 60)])).toEqual([i(0, 10), i(20, 50), i(60, 100)]);
  });

  it("handles cuts on the edges and beyond", () => {
    expect(subtract([i(0, 100)], [i(-10, 5), i(90, 200)])).toEqual([i(5, 90)]);
  });

  it("removes everything when fully covered", () => {
    expect(subtract([i(10, 20)], [i(0, 30)])).toEqual([]);
  });

  it("works across multiple base ranges and unsorted cuts", () => {
    expect(subtract([i(0, 10), i(20, 30)], [i(25, 26), i(5, 22)])).toEqual([i(0, 5), i(22, 25), i(26, 30)]);
  });

  it("returns the base untouched with no cuts", () => {
    expect(subtract([i(0, 10)], [])).toEqual([i(0, 10)]);
  });
});

describe("intersect", () => {
  it("keeps only shared parts", () => {
    expect(intersect([i(0, 10), i(20, 30)], [i(5, 25)])).toEqual([i(5, 10), i(20, 25)]);
  });

  it("is empty for disjoint sets", () => {
    expect(intersect([i(0, 10)], [i(10, 20)])).toEqual([]);
  });
});
