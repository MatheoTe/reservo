/**
 * Half-open intervals `[start, end)` over epoch milliseconds.
 *
 * Every function here is pure and allocation-light; the availability engine
 * calls them in tight loops. Inputs are never mutated.
 */
export interface Interval {
  readonly start: number;
  readonly end: number;
}

export function isEmpty(i: Interval): boolean {
  return i.end <= i.start;
}

/** True when the two half-open intervals share at least one instant. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/** True when `outer` fully contains `inner`. */
export function contains(outer: Interval, inner: Interval): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}

/** Sorts and merges overlapping *or touching* intervals; drops empty ones. */
export function normalize(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals.filter((i) => !isEmpty(i)).toSorted((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  for (const cur of sorted) {
    const last = out.at(-1);
    if (last && cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push({ start: cur.start, end: cur.end });
    }
  }
  return out;
}

/** `base` minus every interval in `cuts`. Result is normalized. */
export function subtract(base: readonly Interval[], cuts: readonly Interval[]): Interval[] {
  const holes = normalize(cuts);
  const result: Interval[] = [];
  for (const b of normalize(base)) {
    let cursor = b.start;
    for (const h of holes) {
      if (h.end <= cursor) continue;
      if (h.start >= b.end) break;
      if (h.start > cursor) result.push({ start: cursor, end: h.start });
      cursor = Math.max(cursor, h.end);
      if (cursor >= b.end) break;
    }
    if (cursor < b.end) result.push({ start: cursor, end: b.end });
  }
  return result;
}

/** Pairwise intersection of two interval sets. Result is normalized. */
export function intersect(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const left = normalize(a);
  const right = normalize(b);
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const l = left[i]!;
    const r = right[j]!;
    const start = Math.max(l.start, r.start);
    const end = Math.min(l.end, r.end);
    if (start < end) out.push({ start, end });
    if (l.end < r.end) i++;
    else j++;
  }
  return out;
}

/** True when any interval of the (unsorted) set overlaps `target`. */
export function overlapsAny(set: readonly Interval[], target: Interval): boolean {
  return set.some((i) => overlaps(i, target));
}
