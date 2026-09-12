import type { CollectionEntry } from "astro:content";

// A pattern with `hidden: true` in its yaml is *unlisted*, not unpublished:
// its page is built and works exactly as normal for anyone holding the URL,
// but nothing on the site leads them there.
//
// "Nothing" has to mean every surface, or the flag is just decoration — one
// missed listing and a draft is public after all. As of now that's:
//
//   - /patterns, the overview itself (pages/patterns/index.astro);
//   - the home page's highlight cards (pages/index.astro);
//   - the search index (pages/search-index.json.ts), which is a discovery
//     surface like any other, so an unlisted pattern stays out of it;
//   - the "Similar patterns" card on every *other* pattern's detail page
//     (pages/patterns/[slug].astro) — easy to forget, since it reads the
//     collection for a reason that has nothing to do with listing;
//   - sitemap-index.xml (astro.config.mjs, which can't use this helper —
//     astro:content isn't available at config-eval time, so it reads the
//     yaml directly and has its own copy of this rule).
//
// The detail page's own getStaticPaths is the deliberate exception: it keeps
// building every pattern, hidden ones included. That *is* the feature.
//
// Not covered, on purpose: a creation that credits a hidden pattern still
// links to it. That link is something Lili wrote by hand in that creation's
// own yaml, so it's an explicit decision to point at the page, not an
// automatic listing — silently dropping it would leave a credit with a
// missing pattern instead.
export function listedPatterns(
  patterns: CollectionEntry<"patterns">[],
): CollectionEntry<"patterns">[] {
  return patterns.filter((pattern) => !pattern.data.hidden);
}
