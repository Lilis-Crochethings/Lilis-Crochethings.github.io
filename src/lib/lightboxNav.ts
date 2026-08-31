// Shared prev/next + swipe navigation for a single-image "lightbox" viewer —
// used by both the gallery page's modal and the creation detail page's
// image lightbox. Handles index tracking, the sliding push transition
// (instant on the very first show, since there's nothing to slide from),
// button clicks, and touch swipe. Anything else the caller needs to sync
// per navigation (e.g. the gallery modal's info card) goes through onChange.

import { slideImage } from "./imageSlide";

export interface LightboxItem {
  src: string;
  alt: string;
  /**
   * An already-rendered element to show instead of loading `src` — used for
   * the pattern pages' inline stitch charts, which aren't files at all (see
   * lib/patternChart.ts: one shared drawing, referenced by every copy, with
   * the round it emphasizes carried in inline custom properties). Returns a
   * fresh node per call so the lightbox's copy is independent of the one on
   * the page. Items in a single lightbox are all-node or all-image; a mixed
   * list isn't supported, and nothing needs it.
   */
  node?: () => Node;
}

export interface LightboxNavRefs {
  swipeTarget: HTMLElement;
  stage: HTMLElement;
  frame: HTMLElement;
  img: HTMLImageElement;
  prevBtn: HTMLElement | null;
  nextBtn: HTMLElement | null;
  items: LightboxItem[];
  // The gallery's tiles are all a fixed square, so the frame never needs
  // resizing. The detail page's photos vary in aspect ratio, so its frame
  // normally shrink-wraps each image — freezing it to the outgoing image's
  // current size for the slide gives the pair a stable shared box to
  // animate within, then it's released to reflow once the slide settles.
  freezeFrameSize?: boolean;
  onChange?: (index: number) => void;
}

export interface LightboxNavController {
  show: (index: number, direction?: 1 | -1) => void;
  next: () => void;
  prev: () => void;
  getIndex: () => number;
}

const SWIPE_THRESHOLD = 40;

export function initLightboxNav(refs: LightboxNavRefs): LightboxNavController {
  let index = 0;
  let img = refs.img;
  let navigating = false;

  // Tracks every src that's been requested (shown or merely prefetched as a
  // neighbor), keyed by src so repeats reuse the same element instead of
  // re-requesting — and so each Image stays strongly referenced for its
  // fetch, since an Image with nothing holding onto it is fair game to be
  // evicted from the browser's cache mid-download or shortly after,
  // silently forcing a real network re-fetch (with its own round-trip) the
  // next time that src is needed.
  const cache = new Map<string, HTMLImageElement>();
  function ensureCached(src: string): HTMLImageElement {
    let cached = cache.get(src);
    if (!cached) {
      cached = new Image();
      cached.src = src;
      cache.set(src, cached);
    }
    return cached;
  }

  function prefetch(i: number) {
    const item = refs.items[(i + refs.items.length) % refs.items.length];
    if (item) ensureCached(item.src);
  }

  function show(newIndex: number, direction?: 1 | -1) {
    const nextIndex = (newIndex + refs.items.length) % refs.items.length;
    const item = refs.items[nextIndex];
    if (!item) return;

    // Nothing to fetch, decode, cache or wait for — so none of the machinery
    // below (which exists entirely to hide network latency behind a spinner
    // and a slide) has anything to do. Swapping the node straight in is both
    // simpler and, with no load to cover, indistinguishable from it.
    if (item.node) {
      refs.frame.replaceChildren(item.node());
      index = nextIndex;
      refs.onChange?.(index);
      return;
    }

    const cached = ensureCached(item.src);
    // A prior prefetch (or an earlier visit to this same photo) may already
    // have it fully downloaded — decode() below still resolves near-
    // instantly in that case, but toggling the spinner class around even a
    // near-instant wait still reads as a flash on screen. Only show it when
    // there's an actual wait ahead.
    const alreadyLoaded = cached.complete && cached.naturalWidth > 0;

    prefetch(nextIndex - 1);
    prefetch(nextIndex + 1);

    if (direction) {
      if (navigating) return;
      navigating = true;

      let restoreFrame: (() => void) | null = null;
      if (refs.freezeFrameSize) {
        const rect = refs.frame.getBoundingClientRect();
        refs.frame.style.width = `${rect.width}px`;
        refs.frame.style.height = `${rect.height}px`;
        restoreFrame = () => {
          refs.frame.style.width = "";
          refs.frame.style.height = "";
        };
      }

      if (!alreadyLoaded) refs.stage.classList.add("lb-loading");
      slideImage(
        refs.frame,
        img,
        item.src,
        item.alt,
        direction,
        (incoming) => {
          img = incoming;
          restoreFrame?.();
          navigating = false;
        },
        () => refs.stage.classList.remove("lb-loading"),
      );
    } else {
      // Unlike the slide path above, there's no outgoing image to keep
      // visible on purpose — reusing the same <img> means the browser just
      // keeps painting whatever it last showed until the new source decodes,
      // which reads as "the wrong photo is open" rather than "loading".
      // Decode off-DOM first (covering the stale frame with the spinner
      // meanwhile) so the swap only happens once the new image is ready.
      if (!alreadyLoaded) refs.stage.classList.add("lb-loading");
      cached
        .decode()
        .catch(() => {})
        .finally(() => {
          img.src = item.src;
          img.alt = item.alt;
          refs.stage.classList.remove("lb-loading");
        });
    }

    index = nextIndex;
    refs.onChange?.(index);
  }

  refs.prevBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    show(index - 1, -1);
  });

  refs.nextBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    show(index + 1, 1);
  });

  let touchStartX = 0;
  let touchStartY = 0;

  refs.swipeTarget.addEventListener(
    "touchstart",
    (e) => {
      const touch = e.changedTouches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
    },
    { passive: true },
  );

  refs.swipeTarget.addEventListener(
    "touchend",
    (e) => {
      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - touchStartX;
      const deltaY = touch.clientY - touchStartY;
      if (Math.abs(deltaX) < SWIPE_THRESHOLD || Math.abs(deltaX) < Math.abs(deltaY)) return;
      show(deltaX < 0 ? index + 1 : index - 1, deltaX < 0 ? 1 : -1);
    },
    { passive: true },
  );

  return {
    show,
    next: () => show(index + 1, 1),
    prev: () => show(index - 1, -1),
    getIndex: () => index,
  };
}
