import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from 'astro/zod'
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { stripDescriptionLinks, descriptionToHtml } from "./lib/description";
import { YARN_WEIGHTS } from "./lib/yarnWeight";

// Creation/pattern descriptions can reference other pages inline using
// markdown-style link syntax ([label](url)) — see lib/description.ts. Parsing
// that once here, at load time, means every consumer (list tiles, gallery
// cards, search index, meta descriptions, the detail page, ...) automatically
// gets safe plain text via `.text` — or real links via `.html` for the one
// place that renders them — without each call site having to remember to
// strip/render the syntax itself.
const richText = z.string().transform((text) => ({
  text: stripDescriptionLinks(text),
  html: descriptionToHtml(text),
}));

// Read the tag taxonomy synchronously so its ids can back a Zod enum below —
// this is what turns a typo'd tag in a creation/pattern file into a build error
// instead of a silently-ignored filter.
const tagsYamlPath = fileURLToPath(new URL("./content/tags.yaml", import.meta.url));
const tagsYaml = parseYaml(readFileSync(tagsYamlPath, "utf-8")) as {
  tags: { id: string; children?: { id: string }[] }[];
};
const TAG_IDS = tagsYaml.tags.flatMap((category) => [
  category.id,
  ...(category.children?.map((child) => child.id) ?? []),
]);
if (TAG_IDS.length === 0) {
  throw new Error("src/content/tags.yaml must define at least one tag");
}
const tagId = z.enum(TAG_IDS as [string, ...string[]]);

// Same idea as tags.yaml above, but for the crochet/embroidery type taxonomy —
// kept as a separate file so "type" (crochet vs. embroidery) stays distinct
// from subject-matter tags (animal, pokemon, ...) rather than living
// alongside them.
const typesYamlPath = fileURLToPath(new URL("./content/types.yaml", import.meta.url));
const typesYaml = parseYaml(readFileSync(typesYamlPath, "utf-8")) as {
  types: { id: string; children?: { id: string }[] }[];
};
const TYPE_IDS = typesYaml.types.map((type) => type.id);
if (TYPE_IDS.length === 0) {
  throw new Error("src/content/types.yaml must define at least one type");
}
const typeId = z.enum(TYPE_IDS as [string, ...string[]]);

const SUBTYPE_IDS = typesYaml.types.flatMap((type) => type.children?.map((child) => child.id) ?? []);
const subtypeId = z.enum(SUBTYPE_IDS as [string, ...string[]]);

// Which type a subtype belongs to, so a creation can't pair e.g. a
// "cross-stitch" subtype with the "crochet" type.
const SUBTYPE_PARENT = new Map<string, string>(
  typesYaml.types.flatMap((type) => (type.children ?? []).map((child) => [child.id, type.id] as const))
);

// General color categories a creation is made in (white/black/red/...) — a
// separate field from tags entirely (not shown as chips, just filterable
// data), so it's read the same way as tags/types above but backs its own
// enum rather than feeding into tagId.
const colorsYamlPath = fileURLToPath(new URL("./content/colors.yaml", import.meta.url));
const colorsYaml = parseYaml(readFileSync(colorsYamlPath, "utf-8")) as {
  colors: { id: string }[];
};
const COLOR_IDS = colorsYaml.colors.map((color) => color.id);
if (COLOR_IDS.length === 0) {
  throw new Error("src/content/colors.yaml must define at least one color");
}
const colorId = z.enum(COLOR_IDS as [string, ...string[]]);

// Which yarn material a creation was made with (chenille/cotton/acrylic/...) —
// filter-only data like colors above: read the same way, but never rendered
// as a chip on cards.
const yarnTypesYamlPath = fileURLToPath(new URL("./content/yarn-types.yaml", import.meta.url));
const yarnTypesYaml = parseYaml(readFileSync(yarnTypesYamlPath, "utf-8")) as {
  yarnTypes: { id: string }[];
};
const YARN_TYPE_IDS = yarnTypesYaml.yarnTypes.map((yarnType) => yarnType.id);
if (YARN_TYPE_IDS.length === 0) {
  throw new Error("src/content/yarn-types.yaml must define at least one yarn type");
}
const yarnTypeId = z.enum(YARN_TYPE_IDS as [string, ...string[]]);

// Generic (non-yarn) tools a pattern's materials card can list — scissors,
// a yarn needle, a measuring tape, ... — read the same way as colors/yarn
// types above so a typo'd id is a build error rather than a silently-blank
// tile.
const materialsYamlPath = fileURLToPath(new URL("./content/materials.yaml", import.meta.url));
const materialsYaml = parseYaml(readFileSync(materialsYamlPath, "utf-8")) as {
  materials: { id: string }[];
};
const MATERIAL_IDS = materialsYaml.materials.map((material) => material.id);
if (MATERIAL_IDS.length === 0) {
  throw new Error("src/content/materials.yaml must define at least one material");
}
const materialId = z.enum(MATERIAL_IDS as [string, ...string[]]);

// The stitch catalog (sc, mr, dc, ...) both of a pattern's own key lists
// reference by id — read the same way as materials/colors/tags above so a
// typo'd stitch is a build error instead of a silently-dropped entry.
// STITCHES_WITH_IMAGE additionally backs the check that nothing is listed as
// a symbol without having a drawing (see the patterns superRefine below).
const stitchesYamlPath = fileURLToPath(new URL("./content/stitches.yaml", import.meta.url));
const stitchesYaml = parseYaml(readFileSync(stitchesYamlPath, "utf-8")) as {
  stitches: { id: string; image?: string }[];
};
const STITCH_IDS = stitchesYaml.stitches.map((stitch) => stitch.id);
if (STITCH_IDS.length === 0) {
  throw new Error("src/content/stitches.yaml must define at least one stitch");
}
const stitchId = z.enum(STITCH_IDS as [string, ...string[]]);
const STITCHES_WITH_IMAGE = new Set(
  stitchesYaml.stitches.filter((stitch) => stitch.image).map((stitch) => stitch.id)
);

// How a pattern is written down (written / chart / pixel) — read the same
// way as tags/types/colors above so a typo'd format is a build error. This
// is deliberately a separate axis from `type` (crochet vs. embroidery):
// the same chart can be worked in either craft, and the same craft can be
// written up in any of these formats.
const patternFormatsYamlPath = fileURLToPath(new URL("./content/pattern-formats.yaml", import.meta.url));
const patternFormatsYaml = parseYaml(readFileSync(patternFormatsYamlPath, "utf-8")) as {
  patternFormats: { id: string }[];
};
const PATTERN_FORMAT_IDS = patternFormatsYaml.patternFormats.map((format) => format.id);
if (PATTERN_FORMAT_IDS.length === 0) {
  throw new Error("src/content/pattern-formats.yaml must define at least one format");
}
const patternFormatId = z.enum(PATTERN_FORMAT_IDS as [string, ...string[]]);

const general = defineCollection({
  loader: glob({ pattern: "general.md", base: "./src/content" }),
  schema: z.object({
    name: z.string(),
    foundedYear: z.number(),
  }),
});

const pageMeta = z.object({
  title: z.string().optional(),
  description: z.string(),
});

// Every page's <title>/description that isn't auto-generated from other
// content (the creation detail page's description IS auto-generated — see
// pageDescription in [slug].astro — so it deliberately has no entry here).
const pages = defineCollection({
  loader: glob({ pattern: "pages.yaml", base: "./src/content" }),
  schema: z.object({
    // Hand-picked creation ids shown on the home page's Creations preview
    // card when there aren't enough "New" items to fill it — same
    // fixed-list convention as about.yaml's firstProjects, just scoped to
    // the home page instead.
    home: pageMeta.extend({ highlightedCreations: z.array(z.string()).default([]) }),
    about: pageMeta,
    patterns: pageMeta,
    gallery: pageMeta,
    creations: pageMeta,
    faq: pageMeta,
    socials: pageMeta,
    contact: pageMeta,
    contactThanks: pageMeta,
    privacy: pageMeta,
  }),
});

const about = defineCollection({
  loader: glob({ pattern: "about.yaml", base: "./src/content" }),
  schema: z.object({
    // Same block-scalar-with-blank-lines convention as a creation's
    // description (see richText above) — blank lines in the YAML become
    // paragraph breaks via the same white-space: pre-line rendering, so bio
    // updates don't need to be split into a YAML list by hand.
    bio: richText,
    // Short version shown on the home page card and behind the About page's
    // TL;DR toggle — hand-written rather than derived from `bio`, since a
    // good summary highlights different things than a truncated excerpt
    // would.
    summaryBio: richText,
    // A fixed, hand-picked list of creation ids — not the 4 most recent —
    // so "first projects ever made" stays true regardless of what gets
    // added to the creations collection later.
    firstProjects: z.array(z.string()),
    favoriteYarns: z.array(z.object({
      name: z.string(),
      icon: z.string(),
      aspectRatio: z.number(),
      rowBox: z.number(),
      link: z.string(),
      hookSize: z.string(),
      type: z.string(),
    })),
  }),
});

const contact = defineCollection({
  loader: glob({ pattern: "contact.yaml", base: "./src/content" }),
  schema: z.object({
    intro: z.array(richText),
    // The actual selectable categories — content that can change (a new
    // category added) — unlike the form's field labels/messages, which are
    // fixed UI chrome and just live directly in contact.astro.
    categoryOptions: z.array(z.string()),
  }),
});

const privacy = defineCollection({
  loader: glob({ pattern: "privacy.yaml", base: "./src/content" }),
  schema: z.object({
    lastUpdated: z.string(),
    intro: richText,
    sections: z.array(z.object({
      heading: z.string(),
      body: richText,
    })),
  }),
});

// A hex string strict enough for a native <input type="color"> — that input
// requires exactly "#rrggbb" (no shorthand, no named colors), and a
// malformed value silently resets to black in most browsers instead of
// erroring, so this is validated at build time rather than at first paint.
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be a 6-digit hex color like #a8c8e8");

// A color that needs to read legibly against both the light and dark theme's
// card surface — a single hex can't do that (a yarn pale enough to read on
// the light surface usually disappears on the dark one, and vice versa), so
// anywhere a color is used as *text* (not a swatch chip, which just shows
// the yarn's real color regardless of theme) asks for both variants.
const themedColor = z.object({ light: hexColor, dark: hexColor }).strict();

// Matches an inline yarn reference inside free-flowing info text — `[body]`
// (shows that yarn's own name) or `[color 1](body)` (shows custom text
// instead). Must stay in sync with the identical regex in
// resolveInfoText() (src/lib/patternInstructions.ts), which does the actual
// rendering; this copy only exists to validate the referenced id at build
// time, the same way tags/types/materials/abbreviations ids already are.
const INFO_COLOR_REF_RE = /\[([^\]]*)\](?:\(([^)]+)\))?/g;

function checkInfoColorRefs(
  text: string | undefined,
  yarnIds: Set<string>,
  path: (string | number)[],
  ctx: z.RefinementCtx,
) {
  if (!text) return;
  for (const match of text.matchAll(INFO_COLOR_REF_RE)) {
    const yarnId = match[2] ?? match[1];
    if (!yarnIds.has(yarnId)) {
      ctx.addIssue({
        code: "custom",
        path,
        message: `"${yarnId}" is not a yarn id defined in materials.yarns`,
      });
    }
  }
}

// A single suggested yarn slot in a pattern's materials card. `id` is not
// shown anywhere itself — it's the stable key a visitor's saved color/name
// override is stored under (see the materials card's client script). A
// pattern's own instructions (see `pattern` below) reference this same
// `color` pair via a YAML anchor, not this id — one color, shown both on
// the swatch chip and (when referenced) in the instructions, so the two
// can never drift apart the way a separate "real" swatch hex and a
// separate "legible in instructions" color could.
const yarnWeight = z.enum(YARN_WEIGHTS as [string, ...string[]]);

// A single yarn actually used to make a pattern's own pictured sample —
// either a reference into yarns.yaml's catalog (resolved the same way, and
// by the same helper, as a creation's own `yarn` field — see resolveYarn()
// in lib/yarn.ts) or a one-off inline yarn not worth cataloguing. Shared by
// `creations.yarn` below and by a pattern yarn slot's own `yarn` field
// (see `patternYarn` below) — moved up here so the latter can reference it.
const inlineYarn = z.object({
  hex: z.string(),
  name: z.string(),
  type: z.string().optional(),
  description: z.string().optional(),
});

const patternYarn = z.object({
  id: z.string(),
  name: z.string(),
  // Shown as this yarn's label in the Pattern Settings color-override card
  // (e.g. "Color that is used for the body") — free text since it's meant
  // to read as a short sentence, not a chip label.
  info: z.string().optional(),
  // What was actually used for the pictured sample — a "Line - Color"
  // reference into yarns.yaml (resolved via resolveYarn()) or a one-off
  // inline yarn. Optional: a slot can stay a plain suggested name/color
  // with nothing more specific to link/credit.
  yarn: z.union([z.string(), inlineYarn]).optional(),
  // Light/dark pair so the swatch (and any instruction text referencing it)
  // stays legible against both themes' card surface — required, since every
  // yarn tile needs a swatch color regardless of whether any instruction
  // ends up referencing it.
  color: themedColor,
  // Free text (like a creation's hookSize) rather than a strict number+unit
  // pair — "1 skein", "50g", and "100m" are all real ways this gets written,
  // and forcing one shape would just fight whichever a given yarn's own
  // label uses.
  amount: z.string().optional(),
  weight: yarnWeight.optional(),
  // The alpha-channel silhouette of this yarn's region on
  // `materials.colorPreviewBase` (e.g. the body vs. the beak) — a visitor's
  // color pick for this yarn (PatternSettingsCard.astro) is tinted onto the
  // base photo through this mask, live, as the "Settings" card's preview.
  // Only meaningful alongside colorPreviewBase; see the superRefine check
  // below.
  mask: z.string().optional(),
});

// A safety-eyes slot in a pattern's materials card — a size (e.g. "6mm")
// and how many, shown as its own tile with the shared eye icon. A pattern
// needing two different eye sizes (body + a smaller accent) lists two of
// these.
const patternSafetyEyes = z.object({
  size: z.string(),
  amount: z.number().optional(),
});

// A colored run of text within a single instruction line (e.g. "8 SC" in a
// round that switches yarn mid-row). `color` is a light/dark pair, not a
// yarn id — authors set it via a YAML anchor/alias pointing at the same
// node as the yarn's own `color` (e.g. `color: &bodyText { light: "...",
// dark: "..." }` on the yarn, `color: *bodyText` here), so a color can
// never drift from the yarn it's meant to match (or from that yarn's own
// swatch, which resolves the same pair) and a typo'd alias is already a
// YAML parse error before this schema ever runs.
const instructionSegment = z.object({
  text: z.string(),
  color: themedColor.optional(),
}).strict();

// A line's content is either a single plain string (the common case) or an
// array of segments when the color changes mid-line — kept as a union
// rather than always requiring segments so most authored lines can stay a
// plain one-liner.
const instructionLineContent = z.union([z.string(), z.array(instructionSegment).min(1)]);

// Shared by both a plain line and a block (a line repeated `block` times) —
// `.strict()` on all three instruction-entry shapes below is what lets the
// z.union tell them apart: an object carrying an unrecognized extra key
// (e.g. `block` on what's meant to be a plain line) fails that branch and
// falls through to the next.
const instructionLineFields = {
  line: instructionLineContent,
  // Falls back to the line's own instruction-entry-level color, and below
  // that to the part's color, when a segment doesn't set its own — see
  // buildRenderRows() in src/lib/patternInstructions.ts.
  color: themedColor.optional(),
  // The running stitch count shown at the end of the round/row.
  total: z.number().optional(),
  // An extra note attached to this specific line (e.g. "worked in front
  // loops only"), distinct from a standalone info entry between lines.
  info: z.string().optional(),
  images: z.array(z.string()).optional(),
};

const instructionLineEntry = z.object(instructionLineFields).strict();

// A block is `block` identical consecutive rounds/rows — e.g. `block: 5`
// with `line: "36 SC"` means 5 rounds all worked as "36 SC". Rendered as a
// single collapsible tile that still expands to reveal (and let a visitor
// check off) each repeat individually.
const instructionBlockEntry = z.object({
  block: z.number().int().positive(),
  ...instructionLineFields,
}).strict();

// A standalone note inserted between rounds/rows (e.g. "start stuffing the
// body") — not counted toward round/row numbering and not checkable.
const instructionInfoEntry = z.object({
  info: z.string(),
  images: z.array(z.string()).optional(),
}).strict();

// Order doesn't matter for correctness here (each branch's own `.strict()`
// already rejects the others' distinguishing keys), but block is checked
// first since it's the most specific shape.
const instructionEntry = z.union([instructionBlockEntry, instructionLineEntry, instructionInfoEntry]);

const patternPart = z.object({
  part: z.string(),
  // Omitted entirely when a part isn't worked in rounds/rows (e.g. an
  // "Assembly" part) — its instructions are then just a general list, with
  // no "Round N"/"Row N" label prefix.
  "worked-in": z.enum(["rounds", "rows"]).optional(),
  // Shown under the part's title, above its instructions — not itself part
  // of the instructions.
  info: z.string().optional(),
  // Shown alongside that part-level info, same as this file's own images —
  // for a part that's just a plain announcement/photo (e.g. a "Done!" part
  // showing the finished piece) rather than round-by-round instructions.
  images: z.array(z.string()).optional(),
  // Default color for every line/segment in this part that doesn't set its
  // own — see the segment/line color comments above.
  color: themedColor.optional(),
  // Optional: a part can be just the info/images above, with nothing to
  // check off (see "Done!" in chunky-ducky.yaml).
  instructions: z.array(instructionEntry).min(1).optional(),
}).strict();

// One entry in a pattern's optional `outro` (see below) — a paragraph of
// custom "you're done!" text, or a row of finished-piece photos, shown in
// the order given. `.strict()` on both branches is what lets the z.union
// tell them apart (same technique as the instruction-entry shapes above).
const outroEntry = z.union([
  z.object({ text: z.string() }).strict(),
  z.object({ images: z.array(z.string()).min(1) }).strict(),
]);

// One numbered step of a chart — the same written line a round/row gets in
// a written pattern (`line`/`color`/`total`/`info`, reusing the exact same
// shapes so a chart's instructions read and render identically), paired
// implicitly with the `step-N` layer of the same number inside the chart's
// SVG. Steps are matched to layers by position, so the Nth step here is the
// Nth step layer in the file — see loadPatternChart() in lib/patternChart.ts,
// which fails the build if the two counts don't line up.
const chartStep = z.object({
  line: instructionLineContent,
  color: themedColor.optional(),
  total: z.number().optional(),
  info: z.string().optional(),
  // Overrides the chart's own `worked-in` for just this step — e.g. a chart
  // worked in rounds whose first step is really a foundation row.
  "worked-in": z.enum(["rounds", "rows"]).optional(),
  // Replaces the auto "Round N"/"Row N" label outright, for a step that
  // isn't numbered at all (e.g. "Foundation" or "Edging").
  label: z.string().optional(),
  images: z.array(z.string()).optional(),
}).strict();

// One chart drawing. `file` is a public/ path to an SVG whose top-level
// Inkscape layers are named step-1, step-2, ... (round-N/row-N are accepted
// too, since that's how they're naturally named while drawing); every other
// top-level layer is left alone and never becomes a step. Layers *inside* a
// step that are hidden in the source file (e.g. a "direction" arrow layer)
// are revealed only while that step is the active one.
const patternChart = z.object({
  // Shown as the card's heading. Optional — a pattern with a single chart
  // doesn't need one, since the card is already unambiguous on its own.
  name: z.string().optional(),
  file: z.string(),
  // Whether this chart's steps are rounds or rows. Omitted entirely for a
  // chart whose steps aren't numbered at all (each step then needs its own
  // `label`), same convention as a written part's own `worked-in`.
  "worked-in": z.enum(["rounds", "rows"]).optional(),
  info: z.string().optional(),
  // Whether to open the card with the whole chart drawn plainly — every
  // round at full strength, nothing to check off — so a visitor can see what
  // they're about to make before working through it step by step. On by
  // default; set false for a chart where the finished drawing says nothing
  // the first step doesn't already.
  preview: z.boolean().default(true),
  steps: z.array(chartStep).min(1),
}).strict();

const patterns = defineCollection({
  loader: glob({ pattern: "**/*.yaml", base: "./src/content/patterns" }),
  schema: z.object({
    title: z.string(),
    // Same purpose as a creation's searchTerms (see the creations schema
    // below): a pattern's own alternate name or a broader category word,
    // shown under the title on the detail page and folded into search.
    searchTerms: z.array(z.string()).optional(),
    images: z.array(z.string()).min(1),
    description: richText.optional(),
    difficulty: z.enum(["easy", "medium", "hard"]).optional(),
    type: typeId,
    subtypes: z.array(subtypeId).optional(),
    // How this pattern is written down — see pattern-formats.yaml. Defaults
    // to "written" so every pattern that predates chart support keeps
    // filtering correctly without needing the field added by hand.
    format: patternFormatId.default("written"),
    colors: z.array(colorId).optional(),
    tags: z.array(tagId).optional(),
    // Published date and, separately, when the pattern text/photos were last
    // revised — a pattern (unlike a one-off creation) can keep being edited
    // after it first goes up, so the two dates can diverge.
    date: z.date().optional(),
    lastModified: z.date().optional(),
    // When this pattern actually went live on the site — distinct from
    // `date` (which can be backdated to whenever the piece itself was
    // designed/finished) and `lastModified` (a content revision, not a
    // publish event). Drives the homepage/list "New" badge (see
    // lib/newBadge.ts): a pattern uploaded years ago but only just added to
    // the site should still read as new to a visitor, which `date` alone
    // can't express.
    uploadDate: z.date().optional(),
    hoursSpent: z.number().optional(),
    hookSize: z.string().optional(),
    materials: z.object({
      items: z.array(materialId).optional(),
      yarns: z.array(patternYarn).optional(),
      safetyEyes: z.array(patternSafetyEyes).optional(),
      // General hook sizes this pattern needs, shown as their own tile
      // (like safety eyes) — separate from a yarn's own optional `hook`
      // suggestion above, since a pattern often just needs one hook size
      // stated once rather than repeated per yarn.
      hooks: z.array(z.string()).optional(),
      // A desaturated photo of the actual made piece, recolored live in the
      // Settings card's preview as each masked yarn (see `patternYarn.mask`
      // above) gets a color pick — optional, since most patterns don't have
      // a base photo + region masks prepared for this.
      colorPreviewBase: z.string().optional(),
    }).optional(),
    // The chart's key — which stitches (from stitches.yaml) this pattern's
    // charts actually draw, in the order they should be listed. A bare id
    // uses the catalog's own picture; the object form keeps the same id and
    // label but swaps in this pattern's own drawing, for a chart that draws
    // a stitch differently than the catalog does (those live in
    // public/images/patterns/<slug>/symbols/). Same
    // shorthand-or-full-object convention as a creation's `yarn` field.
    //
    // Deliberately still a separate list from `abbreviations` below even
    // though both now point into the same catalog: a chart may want a stitch
    // in its symbol key without repeating it in the abbreviation list, or
    // the other way round.
    symbols: z.array(z.union([
      stitchId,
      z.object({
        id: stitchId,
        image: z.string().optional(),
        size: z.number().positive().optional(),
      }).strict(),
    ])).optional(),
    // Which stitches this pattern's written instructions actually spell out
    // in shorthand — shown as a reference list on the detail page, in the
    // order given here rather than the catalog's own order.
    abbreviations: z.array(stitchId).optional(),
    // The actual round-by-round/row-by-row instructions, split into named
    // parts (Body, Head, ...) — see src/content/patterns/chunky-ducky.yaml
    // for a fully worked example. Optional since most patterns currently
    // only have metadata ("full written instructions coming soon").
    pattern: z.array(patternPart).optional(),
    // Chart drawings, one card each — the chart-format counterpart to
    // `pattern` above, and renderable alongside it (a chart pattern can
    // still have a plain written "Assembly" part). See
    // src/content/patterns/puff-stitch-coaster.yaml for a worked example.
    charts: z.array(patternChart).optional(),
    // Optional custom "you're done!" content — shown inside CongratsCard.astro
    // between its "Congratulations!" title and the card's own default
    // text/socials, e.g. a pattern-specific tip or a finished-piece photo the
    // generic blurb can't reference. Falls back to just the default text
    // when omitted.
    outro: z.array(outroEntry).optional(),
  }).superRefine((data, ctx) => {
    for (const subtype of data.subtypes ?? []) {
      if (SUBTYPE_PARENT.get(subtype) !== data.type) {
        ctx.addIssue({
          code: "custom",
          path: ["subtypes"],
          message: `Subtype "${subtype}" belongs to type "${SUBTYPE_PARENT.get(subtype)}", not "${data.type}"`,
        });
      }
    }
    const yarnIds = (data.materials?.yarns ?? []).map((yarn) => yarn.id);
    const duplicateYarnIds = yarnIds.filter((id, i) => yarnIds.indexOf(id) !== i);
    for (const id of new Set(duplicateYarnIds)) {
      ctx.addIssue({
        code: "custom",
        path: ["materials", "yarns"],
        message: `Yarn id "${id}" is used more than once — ids must be unique within a pattern.`,
      });
    }

    // A yarn's mask is only meaningful layered onto colorPreviewBase — catch
    // either half being set without the other rather than silently rendering
    // no preview at all (a plain yarn.mask with no base image, or a base
    // image nobody's mask ever references).
    if (!data.materials?.colorPreviewBase) {
      (data.materials?.yarns ?? []).forEach((yarn, i) => {
        if (yarn.mask) {
          ctx.addIssue({
            code: "custom",
            path: ["materials", "yarns", i, "mask"],
            message: `Yarn "${yarn.id}" sets a mask, but materials.colorPreviewBase is not set.`,
          });
        }
      });
    } else if (!(data.materials?.yarns ?? []).some((yarn) => yarn.mask)) {
      ctx.addIssue({
        code: "custom",
        path: ["materials", "colorPreviewBase"],
        message: `materials.colorPreviewBase is set, but no yarn defines a mask to recolor onto it.`,
      });
    }

    // Info text can reference a yarn inline — `[body]` (shows that yarn's
    // own name) or `[color 1](body)` (shows custom text instead) — see
    // resolveInfoText() in src/lib/patternInstructions.ts, which this regex
    // must stay in sync with. Checked here, the same way tags/types/
    // materials/abbreviations ids are, so a typo'd yarn id is a build error
    // instead of silently rendering as plain unstyled text.
    const yarnIdSet = new Set(yarnIds);
    (data.pattern ?? []).forEach((part, partIndex) => {
      checkInfoColorRefs(part.info, yarnIdSet, ["pattern", partIndex, "info"], ctx);
      (part.instructions ?? []).forEach((entry, entryIndex) => {
        checkInfoColorRefs(entry.info, yarnIdSet, ["pattern", partIndex, "instructions", entryIndex, "info"], ctx);
      });
    });
    (data.charts ?? []).forEach((chart, chartIndex) => {
      checkInfoColorRefs(chart.info, yarnIdSet, ["charts", chartIndex, "info"], ctx);
      chart.steps.forEach((step, stepIndex) => {
        checkInfoColorRefs(step.info, yarnIdSet, ["charts", chartIndex, "steps", stepIndex, "info"], ctx);
        // A step that isn't numbered has nothing to call itself — caught
        // here rather than rendering an unlabelled row nobody can refer to.
        if (!step.label && !(step["worked-in"] ?? chart["worked-in"])) {
          ctx.addIssue({
            code: "custom",
            path: ["charts", chartIndex, "steps", stepIndex],
            message: `Step ${stepIndex + 1} has no label, and neither it nor its chart sets "worked-in", so it can't be numbered.`,
          });
        }
      });
    });

    // A stitch listed as a symbol has to have a drawing behind it — the
    // catalog's `image` is optional (shorthand like "()" has nothing to
    // draw), so this is what stops a pattern asking for a symbol that would
    // render as a blank tile in its key.
    for (const [index, entry] of (data.symbols ?? []).entries()) {
      const id = typeof entry === "string" ? entry : entry.id;
      const hasOwnImage = typeof entry !== "string" && Boolean(entry.image);
      if (!hasOwnImage && !STITCHES_WITH_IMAGE.has(id)) {
        ctx.addIssue({
          code: "custom",
          path: ["symbols", index],
          message: `Stitch "${id}" has no image in stitches.yaml, so it can't be listed as a symbol — give it one there, or set \`image\` on this entry.`,
        });
      }
    }

    // The format is what the /patterns filter and the Info card promise a
    // visitor they'll get, so it has to match what the file actually
    // carries — a "chart" pattern with no charts is a broken promise, and a
    // "written" one with charts would hide them from the format filter.
    if (data.format === "chart" && !(data.charts ?? []).length) {
      ctx.addIssue({
        code: "custom",
        path: ["charts"],
        message: `format is "chart" but no charts are defined.`,
      });
    }
    if (data.format !== "chart" && (data.charts ?? []).length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["format"],
        message: `charts are defined, so format must be "chart" (got "${data.format}").`,
      });
    }
  }),
});

// Which brand icon to show next to a pattern link; falls back to a generic
// globe icon (via the "website" value) for designers' own sites.
const patternPlatform = z.enum(["etsy", "youtube", "instagram", "pinterest", "facebook", "website", "tiktok"]);

// A single named pattern (e.g. "Part 1", "Part 2", or a separate pattern
// used just for the eyes) belonging to one designer credit below.
const patternItem = z.object({
  name: z.string(),
  link: z.string().optional(),
  platform: patternPlatform.optional(),
});

// One designer credit, grouping every pattern/part sourced from them so the
// same creator never has to be repeated (e.g. a multi-part tutorial from a
// single designer, plus a separate designer credited for just the eyes).
const patternGroup = z.object({
  creator: z.string().optional(),
  creatorLink: z.string().optional(),
  items: z.array(patternItem).min(1),
});

const creations = defineCollection({
  loader: glob({ pattern: "**/*.yaml", base: "./src/content/creations" }),
  schema: z.object({
    title: z.string(),
    images: z.array(z.string()).min(1),
    description: richText,
    // Other terms people might search this creation by — a pattern's own
    // alternate name, a nickname, or a broader category word (e.g. "Plushie"
    // for an amigurumi) — that the hand-written description above doesn't
    // happen to mention. Folded into the page's meta description and JSON-LD
    // alternateName so those search terms are actually exposed, not just
    // known to Lili. Purely a per-creation, typed-by-hand list — unrelated
    // to tags.yaml/types.yaml, which are for the filter UI, not this.
    searchTerms: z.array(z.string()).optional(),
    difficulty: z.enum(["easy", "medium", "hard"]).optional(),
    type: typeId,
    subtypes: z.array(subtypeId).optional(),
    colors: z.array(colorId).optional(),
    yarnTypes: z.array(yarnTypeId).optional(),
    date: z.date().optional(),
    // When this creation actually went live on the site — distinct from
    // `date` (which can be backdated to whenever the piece was actually
    // made). Drives the homepage/list "New" badge (see lib/newBadge.ts): a
    // creation finished long ago but only just posted here should still
    // read as new to a visitor, which `date` alone can't express.
    uploadDate: z.date().optional(),
    instagramLink: z.string().optional(),
    facebookLink: z.string().optional(),
    pinterestLink: z.string().optional(),
    hoursSpent: z.number().optional(),
    hookSize: z.string().optional(),
    yarn: z.array(z.union([z.string(), inlineYarn])).optional(),
    patterns: z.array(patternGroup).optional(),
    tags: z.array(tagId).optional(),
  }).superRefine((data, ctx) => {
    for (const subtype of data.subtypes ?? []) {
      if (SUBTYPE_PARENT.get(subtype) !== data.type) {
        ctx.addIssue({
          code: "custom",
          path: ["subtypes"],
          message: `Subtype "${subtype}" belongs to type "${SUBTYPE_PARENT.get(subtype)}", not "${data.type}"`,
        });
      }
    }
  }),
});

const tagNode = z.object({
  id: z.string(),
  label: z.string(),
  image: z.string().optional(),
  color: z.string().optional(),
  // Only meaningful on the types.yaml taxonomy — e.g. "Cross-stitched" for
  // cross-stitch — used to build image alt text like "Cross-stitched Bloom".
  adjective: z.string().optional(),
});

const tagCategory = z.object({
  id: z.string(),
  label: z.string(),
  image: z.string().optional(),
  color: z.string().optional(),
  adjective: z.string().optional(),
  children: z.array(tagNode).optional(),
});

const tags = defineCollection({
  loader: glob({ pattern: "tags.yaml", base: "./src/content" }),
  schema: z.object({
    tags: z.array(tagCategory),
  }),
});

// Same shape as tags.yaml (category + children) — reused here so the
// crochet/embroidery type taxonomy renders through the same TagChip/filter
// UI as regular tags, while staying data-separate from src/content/tags.yaml.
const types = defineCollection({
  loader: glob({ pattern: "types.yaml", base: "./src/content" }),
  schema: z.object({
    types: z.array(tagCategory),
  }),
});

const colorNode = z.object({
  id: z.string(),
  label: z.string(),
  hex: z.string(),
});

const colors = defineCollection({
  loader: glob({ pattern: "colors.yaml", base: "./src/content" }),
  schema: z.object({
    colors: z.array(colorNode),
  }),
});

const yarnTypeNode = z.object({
  id: z.string(),
  label: z.string(),
});

const yarnTypesCollection = defineCollection({
  loader: glob({ pattern: "yarn-types.yaml", base: "./src/content" }),
  schema: z.object({
    yarnTypes: z.array(yarnTypeNode),
  }),
});

const yarnLine = z.object({
  id: z.string().optional(),
  name: z.string(),
  type: z.string().optional(),
  link: z.string().optional(),
  hookSize: z.string().optional(),
  colors: z.array(z.object({
    number: z.string().optional(),
    name: z.string(),
    link: z.string().optional(),
    image: z.string().optional(),
    hex: z.string().optional(),
  })).optional(),
});

const yarns = defineCollection({
  loader: glob({ pattern: "yarns.yaml", base: "./src/content" }),
  schema: z.object({
    yarns: z.array(yarnLine),
  }),
});

const materialNode = z.object({
  id: z.string(),
  label: z.string(),
  icon: z.string(),
});

const materialsCollection = defineCollection({
  loader: glob({ pattern: "materials.yaml", base: "./src/content" }),
  schema: z.object({
    materials: z.array(materialNode),
  }),
});



const patternFormatsCollection = defineCollection({
  loader: glob({ pattern: "pattern-formats.yaml", base: "./src/content" }),
  schema: z.object({
    patternFormats: z.array(z.object({
      id: z.string(),
      label: z.string(),
      icon: z.string(),
      description: z.string(),
    })),
  }),
});

// One stitch, whichever halves of it exist — see stitches.yaml for what each
// field is for and why they're all optional but `id`/`label`.
const stitchNode = z.object({
  id: z.string(),
  label: z.string(),
  image: z.string().optional(),
  size: z.number().positive().optional(),
  info: z.string().optional(),
});

const stitchesCollection = defineCollection({
  loader: glob({ pattern: "stitches.yaml", base: "./src/content" }),
  schema: z.object({
    stitches: z.array(stitchNode),
  }),
});

export const collections = {
  patterns,
  creations,
  yarns,
  tags,
  types,
  colors,
  yarnTypes: yarnTypesCollection,
  materials: materialsCollection,
  stitches: stitchesCollection,
  patternFormats: patternFormatsCollection,
  general,
  pages,
  about,
  contact,
  privacy,
};