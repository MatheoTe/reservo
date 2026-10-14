import { describe, expect, it } from "vitest";

import { layoutLanes } from "./calendar-layout";

const ev = (id: string, start: number, end: number) => ({ id, start, end });
const summary = (items: ReturnType<typeof layoutLanes<ReturnType<typeof ev>>>) =>
  Object.fromEntries(items.map((l) => [l.item.id, `${l.lane}/${l.lanes}`]));

describe("layoutLanes", () => {
  it("gives non-overlapping events the full width", () => {
    expect(summary(layoutLanes([ev("a", 540, 600), ev("b", 600, 660)]))).toEqual({ a: "0/1", b: "0/1" });
  });

  it("splits overlapping events into lanes only within their cluster", () => {
    const result = summary(layoutLanes([ev("a", 540, 660), ev("b", 570, 630), ev("c", 900, 960)]));
    expect(result).toEqual({ a: "0/2", b: "1/2", c: "0/1" });
  });

  it("reuses a lane once it frees up inside the same cluster", () => {
    const result = summary(layoutLanes([ev("long", 540, 720), ev("x", 550, 600), ev("y", 610, 660)]));
    expect(result).toEqual({ long: "0/2", x: "1/2", y: "1/2" });
  });

  it("treats transitive overlaps as one cluster", () => {
    const result = summary(layoutLanes([ev("a", 0, 60), ev("b", 30, 90), ev("c", 70, 120)]));
    expect(result).toEqual({ a: "0/2", b: "1/2", c: "0/2" });
  });
});
