#!/usr/bin/env node
// Converts images dropped in images-to-convert/ to .webp and writes them
// into the matching subfolder under public/images/, preserving the
// relative path (images-to-convert/creations/x.jpg -> public/images/creations/x.webp).
import { readdir, mkdir, stat, copyFile } from "node:fs/promises";
import { join, relative, dirname, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(rootDir, "images-to-convert");
const destDir = join(rootDir, "public", "images");

const CONVERTIBLE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".tif", ".tiff", ".avif", ".bmp"]);
const WEBP_QUALITY = 82;
const MAX_DIMENSION = 1600;

const force = process.argv.includes("--force");

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

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
  const files = await walk(srcDir).catch(() => []);
  if (files.length === 0) {
    console.log(`No images found in ${relative(rootDir, srcDir)}/`);
    return;
  }

  let converted = 0;
  let skipped = 0;
  let copied = 0;
  const failed = [];

  for (const srcPath of files) {
    const ext = extname(srcPath).toLowerCase();
    const relPath = relative(srcDir, srcPath);
    const isWebp = ext === ".webp";

    if (!isWebp && !CONVERTIBLE_EXT.has(ext)) {
      console.warn(`Skipping unsupported file: ${relPath}`);
      continue;
    }

    const destName = basename(srcPath, extname(srcPath)) + ".webp";
    const destPath = join(destDir, dirname(relPath), destName);

    if (!(await needsConversion(srcPath, destPath))) {
      skipped++;
      continue;
    }

    try {
      await mkdir(dirname(destPath), { recursive: true });

      if (isWebp) {
        await copyFile(srcPath, destPath);
        copied++;
        console.log(`Copied:    ${relPath} -> ${relative(rootDir, destPath)}`);
      } else {
        // .rotate() with no args bakes in the EXIF Orientation tag (common on
        // phone photos) as an actual pixel rotation before encoding — webp
        // doesn't reliably preserve/honor that tag otherwise.
        await sharp(srcPath)
          .rotate()
          .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
          .webp({ quality: WEBP_QUALITY })
          .toFile(destPath);
        converted++;
        console.log(`Converted: ${relPath} -> ${relative(rootDir, destPath)}`);
      }
    } catch (err) {
      // One unreadable/corrupt source file shouldn't block every other file
      // in the batch — report it and keep going.
      failed.push(relPath);
      console.error(`Failed:    ${relPath} (${err.message.split("\n")[0]})`);
    }
  }

  console.log(`\nDone. ${converted} converted, ${copied} copied, ${skipped} already up to date, ${failed.length} failed.`);
  if (failed.length > 0) {
    console.log(`Failed files:\n${failed.map((f) => `  - ${f}`).join("\n")}`);
  }
}

main();
