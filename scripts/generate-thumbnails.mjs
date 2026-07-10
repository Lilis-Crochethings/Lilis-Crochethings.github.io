#!/usr/bin/env node
// Generates small thumbnail variants of public/images/creations/*.webp into
// public/images/creations/thumbs/, for use anywhere a creation's cover image
// is shown small (homepage marquee, /creations grid + list tiles) instead of
// serving the full ~1600px detail-page image at a 140-400px display size.
import { readdir, mkdir, stat } from "node:fs/promises";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(rootDir, "public", "images", "creations");
const destDir = join(srcDir, "thumbs");

// Largest real on-page display size is the creations grid tile
// (auto-fill, minmax(200px, 1fr) — can stretch a bit wider on wide screens),
// everything else (marquee, list view, patterns card) is smaller. 450px
// covers that comfortably even at 2x retina, well below the old 600px cap.
const MAX_DIMENSION = 450;
const WEBP_QUALITY = 78;

const force = process.argv.includes("--force");

async function needsConversion(srcPath, destPath) {
  if (force) return true;
  try {
    const [srcStat, destStat] = await Promise.all([stat(srcPath), stat(destPath)]);
    return srcStat.mtimeMs > destStat.mtimeMs;
  } catch {
    return true; // dest doesn't exist yet
  }
}

async function main() {
  const entries = await readdir(srcDir, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile() && extname(e.name).toLowerCase() === ".webp");

  if (files.length === 0) {
    console.log(`No .webp files found in ${srcDir}`);
    return;
  }

  await mkdir(destDir, { recursive: true });

  let converted = 0;
  let skipped = 0;

  for (const file of files) {
    const srcPath = join(srcDir, file.name);
    const destPath = join(destDir, file.name);

    if (!(await needsConversion(srcPath, destPath))) {
      skipped++;
      continue;
    }

    await sharp(srcPath)
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toFile(destPath);
    converted++;
    console.log(`Thumbnail: ${file.name}`);
  }

  console.log(`\nDone. ${converted} generated, ${skipped} already up to date.`);
}

main();
