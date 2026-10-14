/**
 * Human-readable date/time formatting with an explicit zone. Never relies on
 * the server's TZ environment variable.
 */
export function formatDateTime(date: Date, timeZone: string, locale = "en-US"): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).format(date);
}

export function formatTime(date: Date, timeZone: string, locale = "en-US"): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function formatMoney(cents: number, currency: string, locale = "en-US"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}
