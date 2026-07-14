/** Base classes shared by every badge/pill for consistent sizing and rounding. */
export const BADGE_BASE = "px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap";

/** Mapping of supported hues to their light + dark Tailwind classes. */
const HUE_MAP: Record<string, string> = {
  purple:  "bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300",
  blue:    "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
  green:   "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300",
  amber:   "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  red:     "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
  teal:    "bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300",
  indigo:  "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300",
  pink:    "bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-300",
  orange:  "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300",
  cyan:    "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  slate:   "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
  gray:    "bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300",
};

/** Semantic aliases that resolve to a concrete hue. */
const ALIAS_MAP: Record<string, string> = {
  success: "green",
  error:   "red",
  warning: "amber",
  info:    "blue",
  muted:   "gray",
};

/** Default classes used when the requested hue is unknown. */
const DEFAULT_TONES = "bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300";

/**
 * Return a Tailwind class string for a badge using the given hue.
 *
 * Supports direct hue names (`purple`, `blue`, …), semantic aliases
 * (`success`→`green`, `error`→`red`, `warning`→`amber`,
 * `info`→`blue`, `muted`→`gray`), and falls back to a neutral gray
 * for unrecognised inputs.
 *
 * Every entry includes `dark:` variants so badges are legible in both
 * light and dark themes.
 *
 * @example
 * badgeTones("purple")
 * // "bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300"
 *
 * badgeTones("success")
 * // "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300"
 */
export function badgeTones(hue: string): string {
  const resolved = ALIAS_MAP[hue] ?? hue;
  return HUE_MAP[resolved] ?? DEFAULT_TONES;
}
