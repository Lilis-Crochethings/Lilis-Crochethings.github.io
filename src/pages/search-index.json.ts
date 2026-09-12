import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { getTagChipData } from "../lib/tags";
import type { SearchDoc } from "../lib/search";
import { listedPatterns } from "../lib/hiddenPatterns";

export const prerender = true;

export const GET: APIRoute = async () => {
  const [patterns, creations, taxonomyEntry, typesEntry] = await Promise.all([
    getCollection("patterns"),
    getCollection("creations"),
    getCollection("tags"),
    getCollection("types"),
  ]);
  const taxonomy = taxonomyEntry[0].data.tags;
  const typesTaxonomy = typesEntry[0].data.types;

  const patternDocs: SearchDoc[] = listedPatterns(patterns).map((pattern) => {
    const typeChips = [pattern.data.type, ...(pattern.data.subtypes ?? [])].map((id) => getTagChipData(id, typesTaxonomy));
    return {
      type: "pattern",
      href: `/patterns/${pattern.id}`,
      title: pattern.data.title,
      description: pattern.data.description?.text,
      tags: [...typeChips, ...(pattern.data.tags ?? []).map((id) => getTagChipData(id, taxonomy))],
      searchTerms: pattern.data.searchTerms,
      image: pattern.data.images[0],
      difficulty: pattern.data.difficulty,
    };
  });

  const creationDocs: SearchDoc[] = creations.map((creation) => {
    const patternGroups = creation.data.patterns ?? [];
    const typeChips = [creation.data.type, ...(creation.data.subtypes ?? [])].map((id) => getTagChipData(id, typesTaxonomy));
    return {
      type: "creation",
      href: `/creations/${creation.id}`,
      title: creation.data.title,
      description: creation.data.description.text,
      tags: [...typeChips, ...(creation.data.tags ?? []).map((id) => getTagChipData(id, taxonomy))],
      searchTerms: creation.data.searchTerms,
      designer: patternGroups.map((g) => g.creator).filter((c) => c).join(", ") || undefined,
      patternName: patternGroups.flatMap((g) => g.items.map((i) => i.name)).join(", ") || undefined,
      image: creation.data.images[0],
      difficulty: creation.data.difficulty,
    };
  });

  const docs: SearchDoc[] = [...patternDocs, ...creationDocs];

  return new Response(JSON.stringify(docs), {
    headers: { "Content-Type": "application/json" },
  });
};
