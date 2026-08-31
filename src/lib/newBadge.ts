// Single source of truth for the "New" badge's time window (CreationTile/
// CreationListItem/PatternTile/PatternListItem all render it through
// NewBadge.astro, which calls this) — so the 14-day cutoff only ever needs
// changing in one place.
const NEW_BADGE_WINDOW_DAYS = 14;

// Astro pages render at build time, not per-visitor-request, so "now" here
// is really "as of the last deploy" — the site is static, there's no server
// to re-check this per visitor. Left alone on a quiet site a badge would
// stay lit until someone happened to push, so deploy.yml also rebuilds
// nightly; the window is therefore accurate to within a day, not a minute.
export function isRecentlyUploaded(uploadDate: Date | undefined, now: Date = new Date()): boolean {
  if (!uploadDate) return false;
  const daysSince = (now.getTime() - uploadDate.getTime()) / (24 * 60 * 60 * 1000);
  // Excludes a future-dated uploadDate (daysSince < 0) too — a typo'd date
  // shouldn't read as "new" indefinitely once it's finally in the past.
  return daysSince >= 0 && daysSince <= NEW_BADGE_WINDOW_DAYS;
}
