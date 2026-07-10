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
}

export interface LightboxNavRefs {
  swipeTarget: HTMLElement;
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

  function show(newIndex: number, direction?: 1 | -1) {
    const nextIndex = (newIndex + refs.items.length) % refs.items.length;
    const item = refs.items[nextIndex];
    if (!item) return;

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

      slideImage(refs.frame, img, item.src, item.alt, direction, (incoming) => {
        img = incoming;
        restoreFrame?.();
        navigating = false;
      });
    } else {
      img.src = item.src;
      img.alt = item.alt;
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
