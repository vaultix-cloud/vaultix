// Reads a duration token at runtime so behavior timings (tooltip delay, transitions) come from the
// tokens too, including the reduced-motion overrides in tokens.css.
export const durationMs = (cssVar: string, fallback: number): number => {
  if (typeof window === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  const value = Number.parseFloat(raw);
  if (Number.isNaN(value)) return fallback;
  return raw.endsWith("s") && !raw.endsWith("ms") ? value * 1000 : value;
};
