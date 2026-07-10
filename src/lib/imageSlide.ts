// Shared "push" slide transition for swapping one image for another inside
// an overflow:hidden viewport — the outgoing image slides out one side while
// the incoming image slides in from the other, instead of an instant swap.
// Used by both the creation-tile carousels and the gallery lightbox.

export const SLIDE_MS = 280;

export function slideImage(
  viewport: HTMLElement,
  outgoing: HTMLImageElement,
  newSrc: string,
  newAlt: string,
  direction: 1 | -1,
  onSettled: (incoming: HTMLImageElement) => void,
): void {
  const incoming = outgoing.cloneNode() as HTMLImageElement;
  incoming.src = newSrc;
  incoming.alt = newAlt;

  Object.assign(incoming.style, {
    position: "absolute",
    inset: "0",
    transform: `translateX(${direction * 100}%)`,
    transition: "none",
  });
  outgoing.style.position = "absolute";
  outgoing.style.inset = "0";
  viewport.appendChild(incoming);

  // Commit the starting transform above before switching to the animated
  // end state below, or the browser collapses both into a single frame and
  // the "incoming" image never visibly starts off to the side.
  incoming.getBoundingClientRect();

  outgoing.style.transition = `transform ${SLIDE_MS}ms ease`;
  incoming.style.transition = `transform ${SLIDE_MS}ms ease`;
  outgoing.style.transform = `translateX(${-direction * 100}%)`;
  incoming.style.transform = "translateX(0)";

  incoming.addEventListener(
    "transitionend",
    () => {
      outgoing.remove();
      incoming.style.position = "";
      incoming.style.inset = "";
      incoming.style.transform = "";
      incoming.style.transition = "";
      onSettled(incoming);
    },
    { once: true },
  );
}
