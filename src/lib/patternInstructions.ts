import type { CollectionEntry } from "astro:content";

export type PatternPart = NonNullable<CollectionEntry<"patterns">["data"]["pattern"]>[number];
export type PatternChart = NonNullable<CollectionEntry<"patterns">["data"]["charts"]>[number];
type InstructionEntry = NonNullable<PatternPart["instructions"]>[number];
type LineContent = Extract<InstructionEntry, { line: unknown }>["line"];
type RawSegment = Exclude<LineContent, string>[number];
type PatternMaterials = CollectionEntry<"patterns">["data"]["materials"];
export type PatternYarn = NonNullable<NonNullable<PatternMaterials>["yarns"]>[number];

type TextColor = PatternYarn["color"];

// A themed color pair, stringified, so it can key a Map/object the same way
// a plain hex could — two colors compare by value here, not identity.
function textColorKey(color: TextColor): string {
  return `${color.light}|${color.dark}`;
}

// Maps a yarn's color pair back to its id. Instruction colors are already
// resolved {light, dark} pairs by the time they reach this file (see the
// YAML anchor/alias convention in content.config.ts — a segment's
// `color: *bodyText` and the yarn's own `color: &bodyText {...}` are
// literally the same value), so this reverse lookup is exact-match, not
// fuzzy. It's what lets a segment carry its originating yarn id
// (`RenderSegment.yarnId`) for the client script to re-resolve against a
// visitor's saved color override (see the "Yours" toggle in the materials
// card on patterns/[slug].astro) without needing a build-time id on every
// color field.
function buildTextColorToYarnId(yarns: PatternYarn[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const yarn of yarns) {
    const key = textColorKey(yarn.color);
    if (!map.has(key)) map.set(key, yarn.id);
  }
  return map;
}

// isYarnName: true when `text` is standing in for a yarn's own name (an
// info-text reference with no custom label, e.g. `[body]` rather than
// `[color 1](body)`) — the client script uses this to also swap the text
// itself, not just the color, if a visitor renames that yarn via
// PatternSettingsCard.astro. Custom labels are never touched.
export type RenderSegment = { text: string; color?: TextColor; yarnId?: string; isYarnName?: boolean };

// A standalone info entry is now checkable too (see PatternInstructions.astro),
// so it carries a lineId the same way a line/block repeat does — same
// `${partIndex}:${entryIndex}` scheme, safe from collision since entryIndex
// is unique across every entry in a part regardless of kind.
export type RenderInfoRow = { kind: "info"; lineId: string; info: RenderSegment[]; images?: string[] };

export type RenderLineRow = {
  kind: "line";
  lineId: string;
  label?: string;
  segments: RenderSegment[];
  total?: number;
  info?: RenderSegment[];
  images?: string[];
  // Only set for a chart's rows: which `step-N` layer of that chart's SVG
  // this row drives (see buildChartRows below). Written-pattern rows leave
  // it undefined, so one row template renders both without branching.
  step?: number;
};

// A block collapses to a single tile (lineIds/labelRange/segments describe
// it as one unit) but also carries every individual repeat it stands for
// (`repeats`), rendered — just visually hidden until expanded — so the page
// always has a `data-line-id` for each one from first paint. That's what
// lets the progress bar count done/total by querying the DOM rather than
// needing a server-computed total kept in sync by hand.
export type RenderBlockRow = {
  kind: "block";
  lineIds: string[];
  labelRange?: string;
  segments: RenderSegment[];
  total?: number;
  info?: RenderSegment[];
  images?: string[];
  repeats: { lineId: string; label?: string }[];
};

export type RenderRow = RenderInfoRow | RenderLineRow | RenderBlockRow;

// A chart's steps are already a flat, numbered list — one row per `step-N`
// layer in the drawing — so unlike a written part (buildRenderRows below)
// there's no counter to run, no blocks to expand, and no un-numbered info
// entries to skip past: row i is always step i + 1, which is what keeps a
// row labelled "Round 3" pointing at the layer named "step-3" no matter
// what else the chart contains. Everything else (segment colors, yarn
// references inside `info`) is resolved by the same helpers a written line
// uses, so a chart's instructions read and behave identically to a written
// pattern's.
export function buildChartRows(chart: PatternChart, chartIndex: number, yarns: PatternYarn[]): RenderLineRow[] {
  const textColorToYarnId = buildTextColorToYarnId(yarns);

  return chart.steps.map((step, stepIndex) => {
    const workedIn = step["worked-in"] ?? chart["worked-in"];
    return {
      kind: "line",
      // Namespaced away from a written part's own `${partIndex}:${entryIndex}`
      // ids, so a pattern with both charts and written parts can share one
      // progress store without the two colliding.
      lineId: `chart${chartIndex}:${stepIndex}`,
      label: step.label ?? roundLabel(workedIn, stepIndex + 1),
      segments: resolveSegments(step.line, step.color, undefined, textColorToYarnId),
      total: step.total,
      info: step.info ? resolveInfoText(step.info, yarns) : undefined,
      images: step.images,
      step: stepIndex + 1,
    };
  });
}

function roundLabel(workedIn: PatternPart["worked-in"], n: number): string | undefined {
  if (!workedIn) return undefined;
  return workedIn === "rounds" ? `Round ${n}` : `Row ${n}`;
}

function rangeLabel(workedIn: PatternPart["worked-in"], start: number, end: number): string | undefined {
  if (!workedIn) return undefined;
  const word = workedIn === "rounds" ? "Round" : "Row";
  if (start === end) return `${word} ${start}`;
  // workedIn ("rounds" | "rows") is already the plural noun for the count.
  return `${word} ${start}–${end} (${end - start + 1} ${workedIn})`;
}

// Normalizes a line's `string | segment[]` content into a uniform segment
// array, cascading color as segment -> entry -> part (the first one that's
// actually set wins) — every color here is already a resolved {light, dark}
// pair (see the YAML anchor/alias convention in content.config.ts), so this
// is plain fallback logic, no id lookup involved for the *default* color.
// `yarnId` (via textColorToYarnId) is only for the client script to
// re-resolve a visitor's live color override.
function resolveSegments(
  content: LineContent,
  entryColor: TextColor | undefined,
  partColor: TextColor | undefined,
  textColorToYarnId: Map<string, string>,
): RenderSegment[] {
  const raw: RawSegment[] = typeof content === "string" ? [{ text: content }] : content;
  return raw.map((segment) => {
    const color = segment.color ?? entryColor ?? partColor;
    return { text: segment.text, color, yarnId: color ? textColorToYarnId.get(textColorKey(color)) : undefined };
  });
}

// Matches an inline yarn reference inside free-flowing info text — `[body]`
// (shows that yarn's own name) or `[color 1](body)` (shows custom text
// instead). Must stay in sync with the identical regex in
// content.config.ts's checkInfoColorRefs(), which validates the referenced
// id at build time — a typo here is a build error there, not a silently
// broken reference.
const INFO_COLOR_REF_RE = /\[([^\]]*)\](?:\(([^)]+)\))?/g;

// Splits a part/line/block's free-text `info` into plain-text and colored
// segments — unlike resolveSegments above (a structured array an author
// writes on purpose, with no embedded spacing), this is prose the reference
// syntax is cut out of, so the surrounding plain-text segments already carry
// whatever spacing was actually typed and must be rendered back-to-back,
// not re-spaced.
export function resolveInfoText(text: string, yarns: PatternYarn[]): RenderSegment[] {
  const segments: RenderSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(INFO_COLOR_REF_RE)) {
    const [full, bracketContent, parenTarget] = match;
    if (match.index! > lastIndex) segments.push({ text: text.slice(lastIndex, match.index) });

    const yarnId = parenTarget ?? bracketContent;
    const customLabel = parenTarget ? bracketContent : undefined;
    const yarn = yarns.find((y) => y.id === yarnId);
    segments.push({
      text: customLabel || yarn?.name || yarnId,
      color: yarn?.color,
      yarnId: yarn?.id,
      isYarnName: !customLabel && !!yarn,
    });

    lastIndex = match.index! + full.length;
  }
  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex) });

  return segments;
}

// Normalizes one part's `instructions` into render-ready rows: assigns
// stable ids (`${partIndex}:${entryIndex}` for a line, with a `:${repIndex}`
// suffix for each repeat inside a block), computes Round/Row labels (only
// when the part sets `worked-in`), and resolves colors. Only line/block
// entries advance the round/row counter — info entries don't. `instructions`
// itself is optional on a part (a plain info/images-only announcement, e.g.
// "Done!" in chunky-ducky.yaml, has nothing to check off), so this returns
// an empty list rather than requiring callers to guard first.
export function buildRenderRows(part: PatternPart, partIndex: number, yarns: PatternYarn[]): RenderRow[] {
  const workedIn = part["worked-in"];
  const textColorToYarnId = buildTextColorToYarnId(yarns);
  const rows: RenderRow[] = [];
  let counter = 1;

  (part.instructions ?? []).forEach((entry, entryIndex) => {
    if ("block" in entry) {
      const start = counter;
      const end = start + entry.block - 1;
      const repeats = Array.from({ length: entry.block }, (_, i) => ({
        lineId: `${partIndex}:${entryIndex}:${i}`,
        label: roundLabel(workedIn, start + i),
      }));
      rows.push({
        kind: "block",
        lineIds: repeats.map((repeat) => repeat.lineId),
        labelRange: rangeLabel(workedIn, start, end),
        segments: resolveSegments(entry.line, entry.color, part.color, textColorToYarnId),
        total: entry.total,
        info: entry.info ? resolveInfoText(entry.info, yarns) : undefined,
        images: entry.images,
        repeats,
      });
      counter = end + 1;
    } else if ("line" in entry) {
      rows.push({
        kind: "line",
        lineId: `${partIndex}:${entryIndex}`,
        label: roundLabel(workedIn, counter),
        segments: resolveSegments(entry.line, entry.color, part.color, textColorToYarnId),
        total: entry.total,
        info: entry.info ? resolveInfoText(entry.info, yarns) : undefined,
        images: entry.images,
      });
      counter += 1;
    } else {
      rows.push({ kind: "info", lineId: `${partIndex}:${entryIndex}`, info: resolveInfoText(entry.info, yarns), images: entry.images });
    }
  });

  return rows;
}
