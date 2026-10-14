"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * The visitor's IANA zone. On the server (and during hydration) it returns
 * `fallback`, then the real value after mount - without a setState-in-effect
 * double render and without hydration mismatches.
 */
export function useBrowserTimeZone(fallback: string): string {
  return useSyncExternalStore(
    subscribe,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => fallback,
  );
}

let zonesCache: string[] | undefined;
const allZones = () =>
  (zonesCache ??= typeof Intl.supportedValuesOf === "function" ? ["UTC", ...Intl.supportedValuesOf("timeZone").filter((z) => z !== "UTC")] : ["UTC"]);

export function useTimeZoneList(): string[] {
  return useSyncExternalStore(subscribe, allZones, () => ["UTC"]);
}
