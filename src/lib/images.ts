// Cover images live at full detail-page resolution (~1600px) directly under
// their collection's folder (public/images/creations/, public/images/patterns/,
// ...). Small tiles (homepage marquee, list/grid views) should use the
// pre-generated small variant in that folder's own thumbs/ subdirectory
// instead — see scripts/generate-thumbnails.mjs.
// The image to hand to og:image/twitter:image. Almost always just the first
// one — but a pattern is free to lead with its chart (an .svg), and the
// social-preview crawlers behind those tags don't render SVG at all: the
// card comes out blank rather than falling back. So this picks the first
// real photo, and only settles for the first image if there is no photo.
export function socialImage(images: string[]): string | undefined {
  return images.find((image) => !image.toLowerCase().endsWith(".svg")) ?? images[0];
}

// An SVG among those images (a chart shown alongside the photos, say) is
// returned untouched: it's resolution-independent already, so a smaller
// variant would save nothing, and generate-thumbnails.mjs doesn't produce
// one — a thumbs/ path here would simply 404 and the tile would render
// blank.
export function toThumb(imagePath: string): string {
  if (imagePath.toLowerCase().endsWith(".svg")) return imagePath;
  const lastSlash = imagePath.lastIndexOf("/");
  return `${imagePath.slice(0, lastSlash)}/thumbs/${imagePath.slice(lastSlash + 1)}`;
}
