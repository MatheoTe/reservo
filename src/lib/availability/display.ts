import { Temporal } from "temporal-polyfill";

/**
 * Presentation helpers. The engine works in instants; humans read wall-clock
 * time in *their* zone. A slot at 09:00 in Buenos Aires is 21:00 on the same
 * day in Tokyo... or the next day, which is why grouping must happen in the
 * viewer's zone and never in the server's.
 */
export interface DayGroup<T> {
  /** "YYYY-MM-DD" in the viewer's zone. */
  date: string;
  items: T[];
}

export function groupByLocalDate<T extends { start: number }>(
  items: readonly T[],
  timeZone: string,
): DayGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = localDate(item.start, timeZone);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, groupItems]) => ({ date, items: groupItems }));
}

export function localDate(epochMs: number, timeZone: string): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMs)
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()
    .toString();
}

/** "14:30" in the given zone. Deterministic (no locale data needed). */
export function localTime(epochMs: number, timeZone: string): string {
  const z = Temporal.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO(timeZone);
  return `${String(z.hour).padStart(2, "0")}:${String(z.minute).padStart(2, "0")}`;
}

/** "-03:00" style offset of the zone at that instant (changes across DST). */
export function utcOffset(epochMs: number, timeZone: string): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO(timeZone).offset;
}
