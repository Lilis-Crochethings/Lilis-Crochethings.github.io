import type { CollectionEntry } from "astro:content";

// `pattern` is one ordered list whose entries are either kind of section —
// a chart has `file`, a written part has `part`, and nothing has both (see
// patternSection in content.config.ts), so these two narrow cleanly.
export type PatternSection = NonNullable<CollectionEntry<"patterns">["data"]["pattern"]>[number];
export type PatternChart = Extract<PatternSection, { file: unknown }>;
export type PatternPart = Extract<PatternSection, { part: unknown }>;
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
export type RenderSegment = {
  text: string;
  color?: TextColor;
  yarnId?: string;
  isYarnName?: boolean;
  // A cross-reference to another numbered instruction in this same pattern
  // ("worked exactly like [#eye-1]"). `targetId` is the author's own id from
  // the yaml; `href` is filled in later by resolveStepReferences(), which
  // also supplies `text` when the author didn't write their own.
  //
  // The point of referring rather than writing "Round 1" by hand is that the
  // rendered text is the target's *live* label — insert a round above it and
  // every reference to it renumbers itself instead of quietly going stale.
  targetId?: string;
  href?: string;
};

// The id of the rendered row, for linking to. lineIds contain colons, which
// are legal in an HTML id but need escaping in a CSS selector — swapped for
// dashes so the same string works as a fragment, a selector and a
// querySelector argument without anyone having to remember which.
export function rowDomId(lineId: string): string {
  return `row-${lineId.replace(/:/g, "-")}`;
}

// A standalone info entry is now checkable too (see PatternInstructions.astro),
// so it carries a lineId the same way a line/block repeat does — same
// `${partIndex}:${entryIndex}` scheme, safe from collision since entryIndex
// is unique across every entry in a part regardless of kind.
export type RenderInfoRow = { kind: "info"; lineId: string; info: RenderSegment[]; images?: string[] };

export type RenderLineRow = {
  kind: "line";
  lineId: string;
  /** The author's own `id:`, if this row is one others can refer to. */
  anchorId?: string;
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
  /** As RenderLineRow.anchorId — a reference points at the block as a whole. */
  anchorId?: string;
  labelRange?: string;
  segments: RenderSegment[];
  total?: number;
  info?: RenderSegment[];
  images?: string[];
  /** As RenderLineRow.step — set when this block is a chart step with parts. */
  step?: number;
  // Two different things collapse into this same tile, because they're the
  // same tile: a written pattern's repeated rounds, where every entry below
  // says exactly what the summary says, and a chart step broken into parts,
  // where each entry has its own instruction, note and piece of the drawing.
  //
  // Each entry carries its own `segments`/`total` outright rather than
  // falling back to the block's — a repeated round is handed the block's
  // (they genuinely are that same round again, ending on that same count),
  // while a part is handed its own. A shared fallback in the template got
  // this wrong for parts, which would inherit the whole step's stitch count
  // and claim each quarter of a round ends on it.
  repeats: {
    lineId: string;
    label?: string;
    segments: RenderSegment[];
    total?: number;
    info?: RenderSegment[];
    images?: string[];
    step?: number;
    /** Which `Part N` group of that step this entry emphasizes. */
    part?: number;
  }[];
};

export type RenderRow = RenderInfoRow | RenderLineRow | RenderBlockRow;

// A chart's steps are a flat list of entries, most of which draw something.
// The Nth *drawing* entry is the layer named step-N — which is why the
// counter below skips standalone notes rather than using the array index:
// a "finish off and weave in the end" note between rounds must not shift
// every round after it onto the wrong layer. Blocks (a step broken into
// parts) don't shift it either; they're still one step, one layer.
//
// Everything else (segment colors, yarn references inside `info`, cross-
// references) is resolved by the same helpers a written line uses, so a
// chart's instructions read and behave identically to a written pattern's.
export function buildChartRows(chart: PatternChart, chartIndex: number, yarns: PatternYarn[]): RenderRow[] {
  const textColorToYarnId = buildTextColorToYarnId(yarns);
  // Which `step-N` layer the next drawn step claims. Separate from the array
  // index because a standalone note sits in this same list without drawing
  // anything — see chartStepCount()/chartPartCounts() below.
  let stepNumber = 0;

  return chart.steps.map((step, stepIndex): RenderRow => {
    // A note between rounds, exactly as a written part has (see the info
    // branch of buildRenderRows): checkable, but not numbered and not tied to
    // anything in the drawing.
    if (!("line" in step)) {
      return {
        kind: "info",
        lineId: `chart${chartIndex}:${stepIndex}`,
        info: resolveInfoText(step.info, yarns),
        images: step.images,
      };
    }

    stepNumber += 1;
    const workedIn = step["worked-in"] ?? chart["worked-in"];
    const label = step.label ?? roundLabel(workedIn, stepNumber);

    // A step broken into parts renders as the same collapsible tile a
    // written pattern's repeat block does — its own line and note stay
    // visible at the top for anyone reading straight through, the parts fold
    // away beneath. Reusing that shape rather than inventing a third kind of
    // row is what hands it the whole expand/collapse, per-entry check-off,
    // parent indeterminate-state and progress-counting behaviour already
    // built for blocks, with nothing new to keep in step.
    if (step.parts?.length) {
      const repeats = step.parts.map((part, partIndex) => ({
        lineId: `chart${chartIndex}:${stepIndex}:${partIndex}`,
        label: part.label ?? `Part ${partIndex + 1}`,
        segments: resolveSegments(part.line, part.color, step.color, textColorToYarnId),
        total: part.total,
        info: part.info ? resolveInfoText(part.info, yarns) : undefined,
        images: part.images,
        step: stepNumber,
        part: partIndex + 1,
      }));
      return {
        kind: "block",
        lineIds: repeats.map((repeat) => repeat.lineId),
        anchorId: step.id,
        labelRange: label,
        segments: resolveSegments(step.line, step.color, undefined, textColorToYarnId),
        total: step.total,
        info: step.info ? resolveInfoText(step.info, yarns) : undefined,
        images: step.images,
        step: stepNumber,
        repeats,
      };
    }

    return {
      kind: "line",
      // Namespaced away from a written part's own `${partIndex}:${entryIndex}`
      // ids, so a pattern with both charts and written parts can share one
      // progress store without the two colliding.
      lineId: `chart${chartIndex}:${stepIndex}`,
      anchorId: step.id,
      label,
      segments: resolveSegments(step.line, step.color, undefined, textColorToYarnId),
      total: step.total,
      info: step.info ? resolveInfoText(step.info, yarns) : undefined,
      images: step.images,
      step: stepNumber,
    };
  });
}

// Which step number each drawn step in a chart ends up as, and how many
// parts it declares — the same count buildChartRows above runs, exposed so
// the SVG loader can be told which `step-N` layer is expected to contain
// parts. Kept here, beside that counter, so the two can't drift: a note
// added between rounds shifts every step after it, and a part count keyed
// off the array index instead would silently start pointing at the wrong
// layer.
export function chartPartCounts(chart: PatternChart): Record<number, number> {
  const counts: Record<number, number> = {};
  let stepNumber = 0;
  for (const step of chart.steps) {
    if (!("line" in step)) continue;
    stepNumber += 1;
    if (step.parts?.length) counts[stepNumber] = step.parts.length;
  }
  return counts;
}

// How many of a chart's entries actually draw something — what must line up
// one-to-one with the drawing's step-N layers. Notes don't count.
export function chartStepCount(chart: PatternChart): number {
  return chart.steps.filter((step) => "line" in step).length;
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
    // A cross-reference is written as its own segment here, rather than with
    // the [#id] syntax `info` prose uses, because a crochet instruction
    // legitimately contains square brackets already — "FLO: [1 SLST, 2 CH,
    // 2 HDC]" is the `[]` ("in the same stitch") abbreviation, not a
    // reference — so running that parser over a line would break real
    // patterns. An explicit key can't be mistaken for either.
    if (segment.ref) {
      return { text: segment.text ?? "", targetId: segment.ref };
    }
    const color = segment.color ?? entryColor ?? partColor;
    return { text: segment.text ?? "", color, yarnId: color ? textColorToYarnId.get(textColorKey(color)) : undefined };
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

    const target = parenTarget ?? bracketContent;
    const customLabel = parenTarget ? bracketContent : undefined;

    // A "#" marks the target as another instruction rather than a yarn —
    // the same distinction, and the same spelling, a URL fragment uses, and
    // what this reference ends up being. Yarn ids can't start with one, so
    // the two never collide. Text is left empty when the author wrote no
    // label of their own: resolveStepReferences() fills in the target's
    // live label once every row's number is known.
    if (target.startsWith("#")) {
      segments.push({ text: customLabel ?? "", targetId: target.slice(1) });
      lastIndex = match.index! + full.length;
      continue;
    }

    const yarn = yarns.find((y) => y.id === target);
    segments.push({
      text: customLabel || yarn?.name || target,
      color: yarn?.color,
      yarnId: yarn?.id,
      isYarnName: !customLabel && !!yarn,
    });

    lastIndex = match.index! + full.length;
  }
  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex) });

  return segments;
}

// Fills in every cross-reference, once every row in the pattern exists.
//
// Deliberately a second pass over the finished rows rather than something
// the builders do as they go. A reference can point forwards as easily as
// backwards ("worked as [#final-round]"), so no single-pass build could
// resolve them all; and taking the label off the *built row* means a
// reference always shows exactly what that row shows, instead of this file
// growing a second copy of the Round/Row numbering rules to consult.
//
// Runs across the whole pattern at once — charts and written parts together
// — so a written "Assembly" part can refer back to a chart's round, which is
// precisely the kind of reference a chart pattern needs.
export function resolveStepReferences(rows: RenderRow[]): void {
  const targets = new Map<string, { href: string; label: string }>();
  for (const row of rows) {
    if (row.kind === "info" || !row.anchorId) continue;
    if (targets.has(row.anchorId)) {
      throw new Error(`Two instructions in this pattern both use id "${row.anchorId}" — ids have to be unique, since a reference can only point at one of them.`);
    }
    const lineId = row.kind === "block" ? row.lineIds[0] : row.lineId;
    const label = row.kind === "block" ? row.labelRange : row.label;
    targets.set(row.anchorId, {
      href: `#${rowDomId(lineId)}`,
      // An un-numbered instruction (a part with no `worked-in`) has no label
      // to borrow, so a reference to it has to bring its own words.
      label: label ?? row.anchorId,
    });
  }

  for (const row of rows) {
    const repeatSegments = row.kind === "block"
      ? row.repeats.flatMap((repeat) => [...(repeat.segments ?? []), ...(repeat.info ?? [])])
      : [];
    for (const segment of [...(row.kind === "info" ? [] : row.segments), ...(row.info ?? []), ...repeatSegments]) {
      if (!segment.targetId) continue;
      const target = targets.get(segment.targetId);
      if (!target) {
        throw new Error(`An instruction refers to "${segment.targetId}", but no instruction in this pattern has that id.`);
      }
      segment.href = target.href;
      if (!segment.text) segment.text = target.label;
    }
  }
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
      // Every repeat *is* the block's one line, worked again — so they share
      // its segments (the same array, deliberately: resolving a reference
      // inside it should happen once, not once per repeat) and its count.
      const segments = resolveSegments(entry.line, entry.color, part.color, textColorToYarnId);
      const repeats = Array.from({ length: entry.block }, (_, i) => ({
        lineId: `${partIndex}:${entryIndex}:${i}`,
        label: roundLabel(workedIn, start + i),
        segments,
        total: entry.total,
      }));
      rows.push({
        kind: "block",
        lineIds: repeats.map((repeat) => repeat.lineId),
        anchorId: entry.id,
        labelRange: rangeLabel(workedIn, start, end),
        segments,
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
        anchorId: entry.id,
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
