// Cover images live in public/images/creations/ at full detail-page
// resolution (~1600px). Small tiles (homepage marquee, /creations grid +
// list) should use the pre-generated small variant in thumbs/ instead —
// see scripts/generate-thumbnails.mjs.
export function toThumb(imagePath: string): string {
  return imagePath.replace("/images/creations/", "/images/creations/thumbs/");
}
