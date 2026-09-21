const relativeTimeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "always" });

const RELATIVE_UNITS = [
  { limit: 60, divisor: 1, unit: "second" as const },
  { limit: 60, divisor: 60, unit: "minute" as const },
  { limit: 24, divisor: 60 * 60, unit: "hour" as const },
  { limit: 7, divisor: 60 * 60 * 24, unit: "day" as const },
  { limit: Infinity, divisor: 60 * 60 * 24 * 7, unit: "week" as const },
];

export function formatRelativeTime(value: string | null | undefined): string {
  if (!value) return "";

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 60) return "just now";

  const unit = RELATIVE_UNITS.find(({ limit, divisor }) => elapsedSeconds / divisor < limit)!;
  const amount = Math.floor(elapsedSeconds / unit.divisor);
  return relativeTimeFormatter.format(-amount, unit.unit);
}

export function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";

  const wholeSeconds = Math.floor(seconds);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainingSeconds = wholeSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}
