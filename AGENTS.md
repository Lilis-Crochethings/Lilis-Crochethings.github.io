# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A static Astro site for Lili's Crochethings (a crochet hobby/business showcase), built with Astro 7 in static output mode and deployed to GitHub Pages.

## Commands

- `npm run dev` — start the dev server (localhost:4321)
- `npm run build` — build the production site to `./dist/`
- `npm run preview` — preview the production build locally
- `npm run astro -- check` — type-check `.astro` files against the strict Astro tsconfig
- `npm run astro -- <cmd>` — run any other Astro CLI command (e.g. `astro add`)

When starting the dev server, use background mode: `astro dev --background`. Manage it with `astro dev stop`, `astro dev status`, and `astro dev logs`.

There is no test suite or linter configured in this repo.

## Architecture

### Content collections

Content lives in `src/content/` and is defined/typed in `src/content.config.ts` using Astro's `glob` loader with Zod schemas:

- **`general`** — a singleton doc (`src/content/general.md`) with site-wide metadata (currently just `name`). Read by `Navbar.astro` for the logo/site name.
- **`creations`** — one Markdown file per finished project (`src/content/creations/*.md`), schema: `title`, `image`, `description`, `date?`. Listed at `/creations` and rendered individually at `/creations/[slug]` via `getStaticPaths`.
- **`patterns`** — one YAML file per pattern (`src/content/patterns/*.yaml`), schema: `title`, `images` (min 1), `type`, `subtypes?`, `format` (see below), `colors?`, `tags?`, `searchTerms?`, `description?`, `difficulty?`, `date?`, `lastModified?`, `hoursSpent?`, `materials?`, `symbols?`, `abbreviations?` (both from `stitches.yaml`), `pattern?` (the pattern itself). Listed at `/patterns` (mirrors `/creations`'s list/filter/sort UI, minus the yarn-type filter) and rendered individually at `/patterns/[slug]`, which also shows a materials card, the pattern itself (when `pattern` is set), and a "Creations" card listing every creation whose credited pattern links back to this page.

### One pattern, mixed sections

`pattern:` is a single ordered list of **sections**, each rendered as its own card in exactly the order written. A section is either a written part (it has `part:`, with round-by-round `instructions`) or a chart (it has `file:`, with `steps`), and the two mix freely. Both are titled the same way — `part: <name>` and `chart: <name>` — except that a chart's name is optional, since a pattern with a single chart needs no heading; `file` is what marks a section as a chart, not the presence of a name — chart, then a written "attach the strap" part with its own photos, then another chart, is just three entries in a row.

This replaced separate `pattern:` and `charts:` fields, which could only ever render every chart first and every written part after; there was no way to place a part *between* two charts, which is the normal shape of a pattern that's partly drawn and partly written. The two shapes can't be confused (`file` vs `part`, both `.strict()`), so `"file" in section` is the discriminator everywhere — schema validation, `PatternInstructions.astro`, and the `hasCharts` gate on the symbol key. A section's index namespaces its rows' line ids and its chart's SVG element ids, so everything in one pattern shares a single progress store without colliding.

### Referring to another round

Any numbered instruction — a chart step, a written line, a repeat block — can take an `id:`, and anything else in the same pattern can then point at it. The rendered reference is that row's **live label**, so inserting a round renumbers every reference to it instead of leaving "Round 1" written by hand somewhere going stale; clicking it scrolls there and flashes the row.

Two spellings, because their contexts differ. In `info` prose, `[#id]` borrows the target's label and `[words](#id)` keeps your own — the same brackets yarn references already use, with `#` telling the two apart (see `resolveInfoText`). In a `line`, it's a `{ ref: id }` segment instead: an instruction legitimately contains brackets already (`FLO: [1 SLST, 2 CH, 2 HDC]` is the `[]` abbreviation), so bracket-parsing a line would break real patterns.

`resolveStepReferences` (`lib/patternInstructions.ts`) fills them in as a second pass over every section's rows at once — references may point forwards, and labels only exist once rows are built, so nothing could resolve them mid-build. Taking the label off the built row is also what stops this file growing a second copy of the Round/Row numbering rules. Unknown targets and duplicate ids are build errors from `content.config.ts`.

### Unlisted patterns

`hidden: true` on a pattern (patterns only — a creation is a record of something finished) makes it *unlisted*, not unpublished: its page still builds and works at its own URL, but nothing leads anyone there. `src/lib/hiddenPatterns.ts` holds the one filter every listing surface goes through — `/patterns`, the home page highlights, the search index, and the "Similar patterns" card on every *other* pattern's page (that last one is the easy miss, since it reads the collection for a reason unrelated to listing). `astro.config.mjs` keeps it out of the sitemap with its own copy of the rule, since `astro:content` doesn't exist at config-eval time, and the page sends `noindex, follow` via `BaseLayout`'s `noindex` prop — being absent from the sitemap stops a crawler being *offered* the page, not indexing it if it arrives some other way. The detail page's `getStaticPaths` deliberately keeps building hidden patterns; that's the feature. A creation that credits a hidden pattern still links to it, on purpose — that link is hand-written in the creation's own yaml, so it's a decision, not an automatic listing.

### Pattern formats

`format` (`src/content/pattern-formats.yaml`) is how a pattern is *written down* — `written`, `chart`, or `pixel` — a separate axis from `type` (`crochet` vs. `embroidery`), and its own filter section on `/patterns`. It defaults to `written`, and the schema keeps it honest: a chart section may only appear on a `chart` pattern, and a `chart` pattern must have at least one.

A chart section points at an SVG (`file`) and lists that chart's `steps` — one written instruction per step, in the same `line`/`total`/`info`/`color` shape a written pattern's rounds use. Both kinds render through `PatternInstructions.astro`, which normalizes charts and written parts into one list of cards, so chart steps get the whole existing check-off/cascade/progress/confetti behaviour for free.

Every chart copy is clickable, opening big in its own lightbox (`#chart-lightbox` in `patterns/[slug].astro`) — separate from the photo lightbox, since a chart isn't a file to load but a live node: it's handed over as a `node` item (see `LightboxItem.node`), which skips the photo pipeline's fetch/decode/slide entirely, and the clone keeps the round it was emphasizing. That copy is always dark ink on white paper regardless of theme, because line art on the near-black backdrop would be invisible.

Every step gets **its own copy of the chart** under its instruction, emphasizing that round — so following a long chart never means scrolling back to a single shared drawing. `preview: true` (the default) also opens the card with the whole chart drawn plainly, uncheckable, so you can see what you're making first. The drawing is inlined only **once**, into a hidden `<defs>`; every copy is a `<use>` of it, and which round a copy emphasizes is set purely by CSS custom properties on that `<use>` (`--chart-sN` per step layer, `--chart-xN` for its hidden extras — see `chartStepStyle`). Custom properties inherit into a `<use>`'s shadow content, which is what makes one shared drawing render at a different emphasis in each copy. All of it is decided at build time — there is no runtime chart state.

**A chart's yarn colors:** a chart worked in more than one yarn can name each yarn's hex under `colors:` (`{ yarn, hex }`, where `hex` is one color or a list — Inkscape routinely leaves a symbol's fill and stroke a few digits apart). Those hexes become `var(--chart-yarn-<id>, <as drawn>)` in the drawing, and `PatternInstructions.astro`'s script sets `--chart-yarn-<id>` from the visitor's pick in the Settings card — the chart-format counterpart to a written pattern's colored instruction text and recolor preview. The fallback half is what an unpicked chart shows: left alone it's exactly what was drawn (greyscale still becoming theme-aware `--chart-ink`), so declaring a color changes nothing visually. An optional `default` replaces it — a light/dark pair (point it at the yarn's own `color:` anchor, `default: *pinkText`, to keep chart and instruction text one shade) for a chart drawn in a stand-in color, which belongs in the yaml precisely because a hand-corrected hex in the SVG is silently undone by the next Inkscape re-export. That pair can't live inside a `var()` fallback, so it becomes `--<idPrefix>-drawn-<yarn>`, declared by a generated root-scoped `<style is:inline>` mirroring global.css's own theme switch. Everything is set on the **document root**, not the card, because the lightbox clones a chart copy well outside it. `yarn` must be an id in `materials.yarns`, and every hex must really appear in the file — a typo or a re-export that shifts a color fails the build rather than leaving a swatch that repaints nothing. Undeclared colors are left alone, which is how a chart's own annotation ink (the coaster's direction arrows, the sleeping mask's magic-ring markers — both `#b7718d`) stays fixed while the yarn does move.

**A note between rounds:** an entry in `steps:` with only `info:` (and optionally `images:`) is a standalone note — the chart counterpart to a written part's own info entry. It draws nothing, so it claims no `step-N` layer and doesn't advance the numbering: a note between Rounds 3 and 4 leaves the next step as Round 4, still reading off `step-4`. It's still checkable, since "cut the yarn and weave in the end" is as much a thing you do as a round is. That's why `buildChartRows` runs a counter instead of using the array index, and why the loader is told `chartStepCount(chart)` rather than `steps.length` — both live in `patternInstructions.ts` so they can't drift apart.

**A step in parts:** a step that's too much to take in at once can list `parts:` — each with its own line, note and stitch count. It then renders as *the same collapsible tile a written pattern's repeat block uses*: the step's own line and info stay visible for anyone following the round straight through, and the parts fold away beneath, each checking off separately and showing its own copy of the chart with just that piece lit up (the worked/active/upcoming cascade, one level down — `--chart-sN-pM`, falling back to `1` rather than the step's own variable, since the step layer's opacity already multiplies over its children). This reuses `RenderBlockRow` rather than adding a third row kind, so expand/collapse, the parent's indeterminate state, progress counting and check-off all come for free; a block repeat's per-entry fields are optional and fall back to the block's own, which is exactly what "five rounds worked the same" means. In the drawing, the pieces are groups named `Part 1`, `Part 2`, … inside that `step-N` layer (plain groups, not layers, and z-order isn't part order). Steps are matched to parts **by position**, and only a step whose yaml declares `parts` is looked at — so a drawing that already groups things for its own convenience doesn't start failing the build, while a step that does declare them must match exactly.

**Drawing a chart:** `src/lib/patternChart.ts` reads the SVG Inkscape exports, so nothing has to be hand-annotated after an export. Top-level layers named `step-1`, `step-2`, … become the chart's steps (`round-N`/`row-N` also work); every other top-level layer is left exactly as drawn and never becomes a step. Layers *inside* a step that are hidden in the file (e.g. a `direction` arrow layer) show only on that step's own copy of the chart. Greyscale ink is rewritten to `--chart-ink`/`--chart-paper` so a black-on-white chart reads in dark mode, ids are namespaced, and the step layers must line up one-to-one with the yaml's `steps` or the build fails.

### SVGs among the photos

An `.svg` may sit in any `images:` array (a chart shown alongside the photos, say). Three things make that work, all outside the pattern code: `toThumb()` returns SVG paths untouched (there's no raster thumbnail to point at, and a `thumbs/` path would 404); `global.css` gives an `.svg` on a photo surface — gallery tile, list-tile carousel, lightbox — a white background and `object-fit: contain`, since line art disappears in dark mode and cropping to a square would cut the drawing in half; and `socialImage()` keeps `og:image` on the first real photo, because social-preview crawlers don't render SVG.

### Stitches

`src/content/stitches.yaml` is the single catalog behind both halves of a pattern's key (it replaces the former `abbreviations.yaml` + `symbols.yaml` — most stitches have both a shorthand and a drawn symbol, and two files meant one stitch split across two entries with two ids). `id` doubles as the abbreviation itself, shown uppercased; everything else is optional, since a stitch can legitimately have only one half — `()` is shorthand with nothing to draw.

- `image` — a monochrome SVG in `public/images/patterns/symbols/`, rendered as a CSS mask in `--primary` so it themes like every other icon.
- `size` — px, default 26. Symbols don't fill their canvas equally (a chain is a wide flat oval, a single crochet a compact cross), so one shared box would leave some tiny and others crowding their row. All symbols in a key sit in a shared column as wide as the largest, centred, so their labels line up.
- `info` — how the stitch is worked, revealed by an info icon beside it (`StitchInfo.astro`). A click-to-open disclosure rather than the hover tooltip used elsewhere on the site: the key sits in a ~300px sidebar on desktop and inside a scrolling drawer on mobile, where a positioned tooltip would be clipped and where there's no hover to begin with.

A pattern keeps `symbols` and `abbreviations` as **separate lists**, both referencing ids from this one catalog — a chart may want a stitch in its symbol key without repeating it in the abbreviation list, or the reverse. `symbols` takes a bare id, or `{ id, image?, size? }` to keep the catalog's id/label/info while overriding the drawing and/or its size; pattern-specific drawings live in that pattern's own folder, `public/images/patterns/<slug>/symbols/`. Listing an id under `symbols` when neither it nor the catalog has an `image` is a build error. The two lists share one card on the detail page (and one drawer on mobile): two ordinary `h2` sections, "Symbols" then "Abbreviations", so a written pattern's card is headed exactly as it always was and a chart pattern simply gains a section in front of it.

### Pages and layout

Routing is file-based under `src/pages/`. Every page wraps its content in `src/layouts/BaseLayout.astro`, which renders the shared `<html>` shell, imports `src/styles/global.css`, and includes `Navbar.astro`.

### Components

- `src/components/main/` — home page cards (`AboutCard`, `CreationsCard`, `PatternsCard`) that link out to `/about`, `/creations`, `/patterns`.
- `src/components/creations/CreationCard.astro` — a tile (image carousel + link) for a single creation, used by both the creations detail page's "See also" card and the pattern detail page's "Creations" card.
- `Navbar.astro` includes its own mobile hamburger toggle script and scoped styles.

### Styling

Plain CSS, no framework. Global theme variables (`--primary`, `--background`, `--text`, `--accent`) live in `src/styles/global.css`; individual components use Astro scoped `<style>` blocks.

## Deployment

`.github/workflows/deploy.yml` builds on every push to `main` — and nightly at 04:00 UTC — and deploys `dist/` to GitHub Pages via `actions/deploy-pages`. The `site` URL in `astro.config.mjs` must stay in sync with the GitHub Pages URL.

The nightly run exists because "now" on a static site is really "as of the last build": the `New` badge and the home page's highlight cards both compare `uploadDate` against build time (`src/lib/newBadge.ts`, `src/lib/homePreview.ts`), so without it a badge stays lit until someone happens to push.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
