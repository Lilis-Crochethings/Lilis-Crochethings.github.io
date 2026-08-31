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
- **`patterns`** — one YAML file per pattern (`src/content/patterns/*.yaml`), schema: `title`, `images` (min 1), `type`, `subtypes?`, `format` (see below), `colors?`, `tags?`, `searchTerms?`, `description?`, `difficulty?`, `date?`, `lastModified?`, `hoursSpent?`, `materials?`, `symbols?`, `abbreviations?` (both from `stitches.yaml`), `pattern?` (round-by-round written instructions), `charts?` (chart drawings). Listed at `/patterns` (mirrors `/creations`'s list/filter/sort UI, minus the yarn-type filter) and rendered individually at `/patterns/[slug]`, which also shows a materials card, the pattern itself (when `pattern` and/or `charts` is set), and a "Creations" card listing every creation whose credited pattern links back to this page.

### Pattern formats

`format` (`src/content/pattern-formats.yaml`) is how a pattern is *written down* — `written`, `chart`, or `pixel` — a separate axis from `type` (`crochet` vs. `embroidery`), and its own filter section on `/patterns`. It defaults to `written`, and the schema keeps it honest: `charts` may only be set on a `chart` pattern, and a `chart` pattern must have at least one.

A chart pattern's `charts` entries each point at an SVG (`file`) and list that chart's `steps` — one written instruction per step, in the same `line`/`total`/`info`/`color` shape a written pattern's rounds use. Both kinds render through `PatternInstructions.astro`, which normalizes charts and written parts into one list of cards, so chart steps get the whole existing check-off/cascade/progress/confetti behaviour for free.

Every chart copy is clickable, opening big in its own lightbox (`#chart-lightbox` in `patterns/[slug].astro`) — separate from the photo lightbox, since a chart isn't a file to load but a live node: it's handed over as a `node` item (see `LightboxItem.node`), which skips the photo pipeline's fetch/decode/slide entirely, and the clone keeps the round it was emphasizing. That copy is always dark ink on white paper regardless of theme, because line art on the near-black backdrop would be invisible.

Every step gets **its own copy of the chart** under its instruction, emphasizing that round — so following a long chart never means scrolling back to a single shared drawing. `preview: true` (the default) also opens the card with the whole chart drawn plainly, uncheckable, so you can see what you're making first. The drawing is inlined only **once**, into a hidden `<defs>`; every copy is a `<use>` of it, and which round a copy emphasizes is set purely by CSS custom properties on that `<use>` (`--chart-sN` per step layer, `--chart-xN` for its hidden extras — see `chartStepStyle`). Custom properties inherit into a `<use>`'s shadow content, which is what makes one shared drawing render at a different emphasis in each copy. All of it is decided at build time — there is no runtime chart state.

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
