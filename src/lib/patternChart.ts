import { readFileSync } from "node:fs";
import { join } from "node:path";

// Build-time only — this module reads from disk, so it may only ever be
// imported from a component's frontmatter, never from a client <script>.
//
// Crochet charts are drawn in Inkscape, one layer per worked round/row, and
// exported as a plain SVG. Rather than asking Lili to hand-annotate that
// export (which any re-export from Inkscape would wipe out), this reads the
// file the drawing program actually produces and rewrites it into something
// the page can drive:
//
//   - top-level layers named step-1, step-2, ... become the chart's steps
//     (round-N/row-N are accepted too — that's how they're naturally named
//     while drawing a chart worked in rounds);
//   - every other top-level layer is left exactly as drawn (a hidden helper
//     grid stays hidden, a visible frame stays visible) and never becomes a
//     step;
//   - layers *inside* a step that are hidden in the source file (e.g. the
//     "direction" arrow layer) are un-hidden and handed to CSS instead, so
//     they show only on the copy of the chart belonging to that step;
//   - Inkscape's own bookkeeping (namedview, inkscape:/sodipodi: attributes)
//     is dropped, ids are namespaced so two charts on one page can't collide,
//     and greyscale ink is swapped for theme-aware colors so a black-on-white
//     chart is still readable in dark mode;
//   - a chart drawn in more than one yarn can name those yarns' hexes in its
//     yaml (see ChartYarnColor), which turns them into custom properties a
//     visitor's own color picks drive — the chart-format counterpart to a
//     written pattern's colored instruction text and recolor preview.
//
// The drawing is emitted ONCE, into a hidden <defs> (see LoadedChart.defs).
// Every place the page shows that chart — the full-pattern preview at the top
// of the card, plus a copy under each individual step — is a lightweight
// <use> of it. That matters: the page shows the drawing step-count-plus-one
// times over, and a 40-round chart inlined 41 times would be megabytes of
// duplicated path data.
//
// Which step a given copy emphasizes is decided entirely by CSS custom
// properties set on that <use> (see chartStepStyle) — custom properties
// inherit into a <use>'s shadow content, which is what lets one shared
// drawing render at a different emphasis in each copy. Every step layer gets
// `opacity: var(--chart-sN, 1)` and every hidden extra layer inside it
// `display: var(--chart-xN, none)`, so a copy that sets no variables at all
// falls back to the plain finished chart.

export type LoadedChart = {
  /**
   * The drawing, once, inside a hidden <defs>. Has to be rendered on the page
   * for any copy referencing it to resolve.
   */
  defs: string;
  /** Element id every copy points at with <use href="#..." />. */
  rootId: string;
  /** Goes on each copy's own <svg>, which carries no geometry itself. */
  viewBox: string;
  /**
   * The drawing's width ÷ height. Charts are square often enough to have
   * been assumed square, but a chart is whatever shape the thing is — an
   * eye mask is nearly twice as wide as it is tall — and the big view has
   * to know which of the viewport's two dimensions actually constrains it.
   */
  aspectRatio: number;
  /**
   * Root-scoped custom properties backing this chart's drawn-color defaults
   * (see buildYarnColors), or "" when it declares none. Has to reach the
   * page as a real stylesheet — the values switch on theme, which an inline
   * style attribute can't do.
   */
  colorCss: string;
  /** Step numbers found in the file, ascending — always 1..n. */
  steps: number[];
  /**
   * Part numbers within each step that has them, keyed by step number and
   * likewise always 1..n. Only steps whose yaml declared `parts` appear.
   */
  partsByStep: Record<number, number[]>;
};

// step-1 / round-1 / row 1 / Step_1 — the separator and case are whatever
// felt natural while drawing; only the word and the number carry meaning.
const STEP_LABEL_RE = /^\s*(?:step|round|row)[\s._-]*(\d+)\s*$/i;

// A group *inside* a step layer, drawing one distinguishable piece of that
// round — the two straps and two joins of an eye mask's attachment round,
// say. Only looked for in a step whose yaml actually lists `parts`, so a
// drawing that happens to group things this way for its own convenience
// isn't suddenly making promises the instructions don't keep.
const PART_LABEL_RE = /^\s*part[\s._-]*(\d+)\s*$/i;

// Matches one attribute of an SVG start tag. Values are always quoted in
// Inkscape's output (and in any conforming XML), so this doesn't need to
// handle bare values.
const ATTR_RE = /([\w:.-]+)\s*=\s*"([^"]*)"|([\w:.-]+)\s*=\s*'([^']*)'/g;

// One start/end tag. The attribute part deliberately allows quoted runs to
// contain ">" (a style or path value legitimately can), which a naive
// /<[^>]*>/ would split in the middle of.
const TAG_RE = /<(\/)?([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

type Attr = { name: string; value: string };

function parseAttrs(raw: string): Attr[] {
  const attrs: Attr[] = [];
  ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR_RE.exec(raw))) {
    attrs.push({ name: match[1] ?? match[3], value: match[2] ?? match[4] });
  }
  return attrs;
}

function getAttr(attrs: Attr[], name: string): string | undefined {
  return attrs.find((attr) => attr.name === name)?.value;
}

function setAttr(attrs: Attr[], name: string, value: string) {
  const existing = attrs.find((attr) => attr.name === name);
  if (existing) existing.value = value;
  else attrs.push({ name, value });
}

function dropAttr(attrs: Attr[], name: string) {
  const index = attrs.findIndex((attr) => attr.name === name);
  if (index !== -1) attrs.splice(index, 1);
}

function serializeTag(name: string, attrs: Attr[], selfClosing: boolean): string {
  const body = attrs.map((attr) => ` ${attr.name}="${attr.value.replace(/"/g, "&quot;")}"`).join("");
  return `<${name}${body}${selfClosing ? " /" : ""}>`;
}

// "#ABC" / "#AABBCC" / stray whitespace all collapse to one canonical
// "#aabbcc", so a hex named in the yaml matches the same hex in the drawing
// regardless of which case either happened to be written in.
function normalizeHex(value: string): string | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value.trim().toLowerCase());
  if (!match) return null;
  const full = match[1].length === 3 ? match[1].split("").map((c) => c + c).join("") : match[1];
  return `#${full}`;
}

// A greyscale ink color, expressed so it reads correctly against both
// themes' card surface. Pure black is the chart's main line color; lighter
// greys (Inkscape's usual way of drawing a secondary/"already worked" line)
// keep their relative weight by becoming the same ink at proportionally
// lower alpha, rather than all collapsing into one flat tone. Anything that
// isn't greyscale is a deliberate color choice and is left exactly as drawn.
// Takes an already-normalized hex (see normalizeHex above).
function themeColor(hex: string): string | null {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  if (r !== g || g !== b) return null;

  // White is never ink — it's a knockout (a symbol punching a hole through
  // the lines behind it), so it has to follow the card's own surface color
  // rather than fade to nothing in dark mode.
  if (r === 255) return "var(--chart-paper)";
  if (r === 0) return "var(--chart-ink)";
  const strength = Math.round(((255 - r) / 255) * 100);
  return `color-mix(in srgb, var(--chart-ink) ${strength}%, transparent)`;
}

// How one drawn color is rewritten: null leaves it exactly as drawn.
type ColorResolver = (value: string) => string | null;

// Rewrites the fill/stroke colors inside a `style` attribute (or a bare
// presentation attribute) in place, leaving every other declaration alone.
function themeStyle(style: string, resolve: ColorResolver): string {
  return style.replace(/(^|;)\s*(fill|stroke)\s*:\s*([^;]+)/g, (whole, sep, prop, value) => {
    const themed = resolve(value);
    return themed ? `${sep}${prop}:${themed}` : whole;
  });
}

// One yarn's share of a chart's ink: every hex the drawing works that yarn
// in. Two hexes are routinely the same yarn — Inkscape happily ends up with
// a fill and a stroke a couple of digits apart on the same symbol — so this
// is a list, not a single color, and both collapse onto one swatch a
// visitor can repaint.
export type ChartYarnColor = {
  /** Yarn id from the pattern's own materials.yarns. */
  yarn: string;
  /** Every hex in the drawing worked in that yarn, normalized or not. */
  hex: string[];
  /** Overrides what those hexes are drawn as, before any visitor pick. */
  default?: { light: string; dark: string };
};

// Turns the yaml's hex→yarn declarations into the substitutions the drawing
// actually gets: `var(--chart-yarn-<id>, <what it should be drawn as>)`.
//
// The fallback half is what an un-picked chart shows. Left to itself it's
// simply what the file was drawn in (a greyscale ink still becoming
// theme-aware --chart-ink), so declaring a color changes nothing about how
// the chart looks; a `default` replaces it with the yarn's real shade, for a
// chart drawn in a stand-in color. Only when a visitor picks a color in the
// Settings card does --chart-yarn-<id> get set (on the document root, by
// PatternInstructions.astro's script, so the lightbox's cloned copy of the
// chart follows along too) and win over either.
function buildYarnColors(colors: ChartYarnColor[], file: string, idPrefix: string): {
  substitutions: Map<string, string>;
  /** Defines this chart's --<idPrefix>-drawn-* defaults, per theme. */
  css: string;
} {
  const yarnByHex = new Map<string, string>();
  const defaults = new Map<string, { light: string; dark: string }>();
  for (const { yarn, hex, default: fallback } of colors) {
    if (fallback) defaults.set(yarn, fallback);
    for (const raw of hex) {
      const normalized = normalizeHex(raw);
      if (!normalized) {
        throw new Error(`Chart "${file}" declares "${raw}" as yarn "${yarn}"'s color, which isn't a hex color like "#ff0082".`);
      }
      const claimedBy = yarnByHex.get(normalized);
      if (claimedBy && claimedBy !== yarn) {
        throw new Error(`Chart "${file}" gives "${normalized}" to two different yarns — one drawn color can only belong to one of them.`);
      }
      yarnByHex.set(normalized, yarn);
    }
  }

  // A default is a light/dark pair, but a var() fallback can only be one
  // value — so the pair becomes a custom property of its own that the CSS
  // below switches, and the fallback just points at it. Namespaced by
  // idPrefix so two charts on a page can give the same yarn id different
  // drawn defaults without one quietly winning.
  const drawnProperty = (yarn: string) => `--${idPrefix}-drawn-${yarn}`;

  const substitutions = new Map(
    Array.from(yarnByHex, ([hex, yarn]): [string, string] => {
      const fallback = defaults.has(yarn) ? `var(${drawnProperty(yarn)})` : themeColor(hex) ?? hex;
      return [hex, `var(--chart-yarn-${yarn}, ${fallback})`];
    }),
  );

  // Declared on :root (not the chart's own card) for the same reason the
  // visitor's picks are: the lightbox clones a copy of the chart well
  // outside that card, and a property set on it wouldn't inherit that far.
  // The two selectors below mirror global.css's own theme switch exactly —
  // html[data-theme="dark"] for an explicit choice, html:not([data-theme])
  // under the media query for the no-JS/OS-preference case.
  const declarations = (theme: "light" | "dark") =>
    Array.from(defaults, ([yarn, color]) => `${drawnProperty(yarn)}:${color[theme]}`).join(";");
  const css =
    defaults.size === 0
      ? ""
      : `:root{${declarations("light")}}` +
        `html[data-theme="dark"]{${declarations("dark")}}` +
        `@media (prefers-color-scheme: dark){html:not([data-theme]){${declarations("dark")}}}`;

  return { substitutions, css };
}

// Drops a `display:` declaration so this file, rather than Inkscape's own
// editor state, decides whether an element shows.
function stripDisplay(style: string): string {
  return style
    .split(";")
    .filter((declaration) => !/^\s*display\s*:/.test(declaration))
    .join(";")
    .replace(/^;+|;+$/g, "");
}

function appendDeclaration(style: string, declaration: string): string {
  return style ? `${style};${declaration}` : declaration;
}

function isHidden(style: string | undefined): boolean {
  return /(^|;)\s*display\s*:\s*none/.test(style ?? "");
}

function addClass(attrs: Attr[], className: string) {
  const existing = getAttr(attrs, "class");
  setAttr(attrs, "class", existing ? `${existing} ${className}` : className);
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// How much of the drawing one copy of the chart shows. A step's own copy puts
// that round at full strength, holds the rounds already worked back a little
// (they're the fabric this one is built on, and need to stay readable enough
// to count stitches against), and holds what's still to come back further, so
// it reads as context rather than as part of the round in hand.
//
// Both held-back tiers sit well back: with a copy of the chart under every
// single step, the round being worked has to be findable at a glance, and
// anything close to full strength on the others turns each copy into the
// same busy drawing repeated down the page. They stay faint enough to read
// as background and no more. Passing null sets nothing at all, which is how
// the full-pattern copy falls back to every layer at full strength with no
// extra detail layers showing.
const ACTIVE_STEP_OPACITY = "1";
const WORKED_STEP_OPACITY = "0.35";
const UPCOMING_STEP_OPACITY = "0.15";

function tierOpacity(n: number, active: number): string {
  return n === active ? ACTIVE_STEP_OPACITY : n < active ? WORKED_STEP_OPACITY : UPCOMING_STEP_OPACITY;
}

export function chartStepStyle(
  steps: number[],
  activeStep: number | null,
  // Set only for a copy belonging to one *part* of a step: every part number
  // in that step, and which of them this copy is for. The step itself is
  // still the active one, so the drawing reads as "this round, and within it
  // this piece" — the same worked/upcoming cascade, one level down.
  stepParts?: number[],
  activePart?: number,
): string | undefined {
  if (activeStep === null) return undefined;
  const declarations = steps.map((step) => `--chart-s${step}:${tierOpacity(step, activeStep)}`);
  if (stepParts && activePart !== undefined) {
    for (const part of stepParts) {
      declarations.push(`--chart-s${activeStep}-p${part}:${tierOpacity(part, activePart)}`);
    }
  }
  // Reveals whatever the drawing keeps hidden inside this one step — a
  // working-direction arrow, a stitch-count callout — which would be clutter
  // on every other copy.
  declarations.push(`--chart-x${activeStep}:inline`);
  return declarations.join(";");
}

export type ChartSource = {
  /** Public path as authored in the yaml, e.g. "/images/patterns/x.svg". */
  file: string;
  /** Namespace for this chart's ids, unique within the page. */
  idPrefix: string;
  /** How many steps the yaml describes — must match the file. */
  expectedSteps: number;
  /**
   * How many `parts` each step's yaml declares, keyed by step number. A step
   * missing from this is read exactly as before, part groups or not — the
   * yaml opts in, so an existing drawing can't start failing the build over
   * grouping it already had.
   */
  expectedParts?: Record<number, number>;
  /** Which drawn colors a visitor can repaint, and as which yarn. */
  colors?: ChartYarnColor[];
};

export function loadPatternChart({ file, idPrefix, expectedSteps, expectedParts = {}, colors = [] }: ChartSource): LoadedChart {
  // Resolved from the project root rather than relative to this module:
  // Astro bundles lib code into dist/.prerender/ before running it, so
  // import.meta.url no longer points anywhere near src/lib/ by the time a
  // page actually renders. Both `astro dev` and `astro build` run with the
  // project root as cwd, which public/ is always a direct child of.
  const path = join(process.cwd(), "public", file);
  let source: string;
  try {
    source = readFileSync(path, "utf-8");
  } catch {
    throw new Error(`Chart file "${file}" not found (looked in public${file}).`);
  }

  // Everything here is either XML plumbing with no rendered output, Inkscape
  // editor state, or — in the case of <script> — something that has no
  // business being inlined into the page at all. The paired namedview form is
  // stripped before the self-closing one: namedview contains a self-closing
  // <inkscape:grid/>, so a single alternation ending in "/>" would stop there
  // and leave a stray </sodipodi:namedview> behind.
  source = source
    .replace(/<\?xml[\s\S]*?\?>/g, "")
    .replace(/<!DOCTYPE[\s\S]*?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<sodipodi:namedview[\s\S]*?<\/sodipodi:namedview>/g, "")
    .replace(/<sodipodi:namedview[^>]*\/>/g, "")
    .replace(/<metadata[\s\S]*?<\/metadata>/g, "")
    .replace(/<script[\s\S]*?<\/script>/g, "");

  const { substitutions: yarnColors, css: colorCss } = buildYarnColors(colors, file, idPrefix);
  // Which declared hexes the drawing actually turned out to use — a hex
  // nobody draws in is almost always a typo or a re-export that changed the
  // color, and would otherwise just quietly give the visitor a swatch that
  // repaints nothing. Checked after the walk below.
  const matchedHexes = new Set<string>();

  // Yarn colors are looked up before themeColor(), so a chart worked in
  // black yarn hands its black lines to that yarn's swatch rather than
  // silently swallowing them into --chart-ink — the fallback inside the
  // var() is still --chart-ink, so nothing about how it *looks* changes
  // until someone picks a color.
  const resolveColor: ColorResolver = (value) => {
    const hex = normalizeHex(value);
    if (!hex) return null;
    const mapped = yarnColors.get(hex);
    if (mapped) {
      matchedHexes.add(hex);
      return mapped;
    }
    return themeColor(hex);
  };

  const rootId = `${idPrefix}-root`;
  type Replacement = { start: number; end: number; text: string };
  const replacements: Replacement[] = [];
  const ids: string[] = [];
  const steps: number[] = [];
  let viewBox = "";

  // Tracks element nesting so "top-level layer" means "a layer no other group
  // encloses", and so a hidden layer can be tied to the step it actually
  // belongs to rather than to whichever step it happens to follow.
  const stack: { name: string; step: number | null; part: number | null; isRoot: boolean }[] = [];
  // Deliberately "has no <g> ancestor" rather than "sits directly in the root
  // <svg>": an exporter is free to wrap the drawing in a plain container, and
  // being one level deeper doesn't make a step layer any less of a step.
  const isTopLevelGroup = () => !stack.some((entry) => entry.name === "g");
  const enclosingStep = () => stack.findLast((entry) => entry.step !== null)?.step ?? null;
  const insidePart = () => stack.some((entry) => entry.part !== null);
  // Part numbers seen per step, in document order — Inkscape writes groups in
  // z-order, so "Part 1" is routinely not the first one in the file.
  const partsByStep: Record<number, number[]> = {};

  TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_RE.exec(source))) {
    const [whole, closing, name, rawAttrs] = match;

    if (closing) {
      const popped = stack.pop();
      // The drawing's own </svg> closes the <defs>/<g> wrapper opened below.
      if (popped?.isRoot) {
        replacements.push({ start: match.index, end: match.index + whole.length, text: "</g></defs>" });
      }
      continue;
    }

    const selfClosing = /\/\s*$/.test(rawAttrs);
    const attrs = parseAttrs(rawAttrs);
    const style = getAttr(attrs, "style");
    const isLayer = getAttr(attrs, "inkscape:groupmode") === "layer";
    const layerLabel = getAttr(attrs, "inkscape:label") ?? "";
    const isRoot = name === "svg" && stack.length === 0;

    let step: number | null = null;
    let part: number | null = null;

    // Checked before the step/extra branches below so a part that happens to
    // be drawn as a hidden layer is still read as a part.
    const enclosing = enclosingStep();
    if (name === "g" && enclosing !== null && !insidePart() && expectedParts[enclosing]) {
      const partMatch = PART_LABEL_RE.exec(layerLabel);
      if (partMatch) {
        part = Number(partMatch[1]);
        (partsByStep[enclosing] ??= []).push(part);
        addClass(attrs, "chart-part");
        setAttr(attrs, "data-part", String(part));
        // Falls back to 1, not to the step's own variable: this group is
        // already *inside* the step layer, so the step's opacity multiplies
        // over whatever is set here. Anything else would square it, and a
        // dimmed step would go from faint to invisible.
        setAttr(attrs, "style", appendDeclaration(stripDisplay(style ?? ""), `opacity:var(--chart-s${enclosing}-p${part},1)`));
      }
    }

    if (part !== null) {
      // Already handled.
    } else if (name === "g" && isLayer && isTopLevelGroup()) {
      const stepMatch = STEP_LABEL_RE.exec(layerLabel);
      if (stepMatch) {
        step = Number(stepMatch[1]);
        steps.push(step);
        addClass(attrs, "chart-step");
        setAttr(attrs, "data-step", String(step));
        // Whether a step layer happened to be left hidden in Inkscape is
        // editor state, not intent — every step is always drawn, and how
        // strongly is left to whichever copy is rendering it.
        setAttr(attrs, "style", appendDeclaration(stripDisplay(style ?? ""), `opacity:var(--chart-s${step},1)`));
      }
    } else if (name === "g" && isLayer && isHidden(style) && enclosing !== null) {
      // A hidden sub-layer of a step (the "direction" arrows, a stitch-count
      // callout, ...): clutter on the finished chart, but exactly what's
      // wanted on the copy belonging to that one round — so it follows its
      // own step's variable rather than being shown or hidden everywhere.
      addClass(attrs, "chart-step-extra");
      setAttr(attrs, "style", appendDeclaration(stripDisplay(style ?? ""), `display:var(--chart-x${enclosing},none)`));
    }

    if (isRoot) {
      // The only thing worth keeping off the drawing's own root element: the
      // millimetre width/height Inkscape drew it at are replaced by whatever
      // each copy's container gives it, but every copy needs this to map the
      // drawing's coordinates onto that space.
      viewBox = getAttr(attrs, "viewBox") ?? "";
      if (!viewBox) {
        throw new Error(`Chart "${file}" has no viewBox on its root <svg>, so it can't be scaled to fit the page.`);
      }
    }

    for (const attr of [...attrs]) {
      if (/^(inkscape|sodipodi):/.test(attr.name)) dropAttr(attrs, attr.name);
      else if (attr.name === "xmlns:inkscape" || attr.name === "xmlns:sodipodi" || attr.name === "xmlns:svg") dropAttr(attrs, attr.name);
    }

    const id = getAttr(attrs, "id");
    if (id) {
      ids.push(id);
      setAttr(attrs, "id", `${idPrefix}-${id}`);
    }

    // Re-read style: the step/extra branches above may have rewritten it.
    const currentStyle = getAttr(attrs, "style");
    if (currentStyle !== undefined) {
      const themed = themeStyle(currentStyle, resolveColor);
      if (themed) setAttr(attrs, "style", themed);
      else dropAttr(attrs, "style");
    }
    for (const presentation of ["fill", "stroke"]) {
      const value = getAttr(attrs, presentation);
      const themed = value ? resolveColor(value) : null;
      if (themed) setAttr(attrs, presentation, themed);
    }

    // The drawing's root <svg> becomes the referenceable group rather than a
    // second nested <svg>: <use> can target either, but a plain <g> leaves
    // the sizing decision entirely with each copy's own <svg>.
    replacements.push({
      start: match.index,
      end: match.index + whole.length,
      text: isRoot ? `<defs><g id="${rootId}">` : serializeTag(name, attrs, selfClosing),
    });
    if (!selfClosing) stack.push({ name, step, part, isRoot });
  }

  let out = "";
  let cursor = 0;
  for (const replacement of replacements) {
    out += source.slice(cursor, replacement.start) + replacement.text;
    cursor = replacement.end;
  }
  out += source.slice(cursor);

  // Internal references (url(#gradient), href="#use-target") have to follow
  // the ids they point at. Longest-first so "#path1" can't shadow "#path12",
  // and a trailing boundary so it can't match a longer id's prefix either.
  if (ids.length > 0) {
    const idPattern = ids.map(escapeForRegExp).sort((a, b) => b.length - a.length).join("|");
    out = out.replace(new RegExp(`#(${idPattern})(?![\\w.:-])`, "g"), `#${idPrefix}-$1`);
  }

  const ascending = [...steps].sort((a, b) => a - b);
  const expected = Array.from({ length: ascending.length }, (_, i) => i + 1);
  if (ascending.join(",") !== expected.join(",")) {
    throw new Error(
      `Chart "${file}" has step layers numbered ${ascending.join(", ") || "(none)"} — they must run 1 to ${ascending.length} with no gaps or duplicates. ` +
        `Top-level layers are read as steps only when named "step-1", "step-2", ... (or "round-N"/"row-N"); every other top-level layer is ignored.`
    );
  }
  // Same one-to-one guarantee steps get, one level down: a step whose yaml
  // lists parts has to find exactly those parts in the drawing, numbered
  // without gaps — otherwise an expanded part would highlight the wrong
  // piece of the chart, or nothing at all.
  for (const [step, expected] of Object.entries(expectedParts)) {
    const found = [...(partsByStep[Number(step)] ?? [])].sort((a, b) => a - b);
    const wanted = Array.from({ length: expected }, (_, i) => i + 1);
    if (found.join(",") !== wanted.join(",")) {
      throw new Error(
        `Chart "${file}" step ${step}: its yaml lists ${expected} part(s), but the drawing's step-${step} layer contains ${found.length ? `parts numbered ${found.join(", ")}` : "no part groups"} — ` +
          `they must run 1 to ${expected} with no gaps or duplicates. Groups inside a step are read as parts only when named "Part 1", "Part 2", ... (any separator, any case).`
      );
    }
    partsByStep[Number(step)] = wanted;
  }

  const unused = Array.from(yarnColors.keys()).filter((hex) => !matchedHexes.has(hex));
  if (unused.length > 0) {
    throw new Error(
      `Chart "${file}" declares the color(s) ${unused.join(", ")} in its yaml, but nothing in the drawing is filled or stroked with them — ` +
        `check for a typo, or for an Inkscape re-export that changed the color. Only literal fill/stroke hexes count (a 3-digit "#f08" is fine, a named color or a gradient is not).`
    );
  }

  if (ascending.length !== expectedSteps) {
    throw new Error(
      `Chart "${file}" has ${ascending.length} step layer(s) but its yaml lists ${expectedSteps} step(s) — the two must line up one-to-one.`
    );
  }

  // Zero-sized and aria-hidden: this is the shared definition, never itself
  // seen. It does still have to be in the rendered tree (rather than
  // display:none) for every <use> on the page to resolve against it.
  const defs =
    `<svg class="chart-defs" aria-hidden="true" focusable="false" width="0" height="0" ` +
    `xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${out.trim()}</svg>`;

  // "min-x min-y width height" — the last two are the drawing's own
  // proportions, whatever units Inkscape drew it in.
  const [, , boxWidth, boxHeight] = viewBox.trim().split(/[\s,]+/).map(Number);
  if (!(boxWidth > 0) || !(boxHeight > 0)) {
    throw new Error(`Chart "${file}" has viewBox "${viewBox}", which has no usable width/height.`);
  }

  return { defs, rootId, viewBox, aspectRatio: boxWidth / boxHeight, colorCss, steps: ascending, partsByStep };
}
