// Shared hover/swipe image-carousel behavior for creation tiles (the "See
// also" grid cards and the /creations list-item thumbnails) — lets users
// flip through a creation's photos without leaving the tile, with a
// sliding "push" transition between images instead of an instant swap.
// Tiles with only one photo still respond to a swipe attempt with a small
// elastic bounce, so it reads as "there's nothing more here" rather than
// the gesture silently doing nothing.
import { slideImage } from "./imageSlide";

export interface TileCarouselRefs {
  root: HTMLElement;
  viewport: HTMLElement;
  img: HTMLImageElement;
  swipeTarget: HTMLElement;
  link: HTMLAnchorElement | null;
  prevBtn: HTMLButtonElement | null;
  nextBtn: HTMLButtonElement | null;
}

const SWIPE_THRESHOLD = 30;
const BOUNCE_NUDGE_PX = 16;
const BOUNCE_OUT_MS = 130;
const BOUNCE_BACK_MS = 380;
// Overshoots past 0 before settling, which is what reads as "elastic" rather
// than just a plain snap-back.
const BOUNCE_EASE = "cubic-bezier(0.34, 1.56, 0.64, 1)";

export function initTileCarousel(refs: TileCarouselRefs): void {
  const images: string[] = JSON.parse(refs.root.dataset.images ?? "[]");
  const hasMultiple = images.length > 1;

  let index = 0;
  let current = refs.img;
  let animating = false;

  function slide(direction: 1 | -1) {
    if (animating) return;
    const nextIndex = (index + direction + images.length) % images.length;
    animating = true;
    slideImage(refs.viewport, current, images[nextIndex], current.alt, direction, (incoming) => {
      current = incoming;
      index = nextIndex;
      animating = false;
    });
  }

  // Nudges the (single, static) image a few px in the swipe's own direction
  // and springs it back with an overshoot — visual feedback that the swipe
  // registered even though there's nowhere to go.
  function bounce(direction: 1 | -1) {
    if (animating) return;
    animating = true;
    const img = current;
    img.style.transition = `transform ${BOUNCE_OUT_MS}ms ease-out`;
    img.style.transform = `translateX(${direction * BOUNCE_NUDGE_PX}px)`;

    img.addEventListener(
      "transitionend",
      () => {
        img.style.transition = `transform ${BOUNCE_BACK_MS}ms ${BOUNCE_EASE}`;
        img.style.transform = "translateX(0)";
        img.addEventListener(
          "transitionend",
          () => {
            img.style.transition = "";
            animating = false;
          },
          { once: true },
        );
      },
      { once: true },
    );
  }

  if (hasMultiple) {
    refs.prevBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      slide(-1);
    });

    refs.nextBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      slide(1);
    });

    // Jump back to the first image once the tile is no longer being
    // interacted with, so the next hover/swipe always starts from the cover
    // image — instant, not animated, since the tile is no longer focal.
    refs.root.addEventListener("mouseleave", () => {
      if (index === 0 || animating) return;
      index = 0;
      current.src = images[0];
    });
  }

  // Swipe support for touch devices, where the hover-revealed buttons never
  // appear — a horizontal swipe plays the same push animation instead of
  // following the tile's link, which a plain tap still does. Single-image
  // tiles get the elastic bounce instead, since there's nothing to slide to.
  let touchStartX = 0;
  let touchStartY = 0;
  let swiped = false;

  refs.swipeTarget.addEventListener(
    "touchstart",
    (e) => {
      const touch = e.changedTouches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      swiped = false;
    },
    { passive: true },
  );

  refs.swipeTarget.addEventListener(
    "touchmove",
    (e) => {
      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - touchStartX;
      const deltaY = touch.clientY - touchStartY;
      if (!swiped && Math.abs(deltaX) > SWIPE_THRESHOLD && Math.abs(deltaX) > Math.abs(deltaY)) {
        swiped = true;
        if (hasMultiple) {
          slide(deltaX < 0 ? 1 : -1);
        } else {
          bounce(deltaX < 0 ? -1 : 1);
        }
      }
    },
    { passive: true },
  );

  refs.link?.addEventListener("click", (e) => {
    if (swiped) e.preventDefault();
  });
}
