import { escapeHtml, highlight } from "./search";

export type FaqQuestion = { question: string; answer: string };
export type FaqCategory = { id: string; title: string; questions: FaqQuestion[] };

export function getFaqQuestionId(categoryId: string, index: number): string {
  return `faq-q-${categoryId}-${index}`;
}

export type FaqDoc = {
  id: string;
  href: string;
  category: string;
  question: string;
  answer: string;
};

// Supports inline links in FAQ answers using markdown-style `[text](url)` syntax.
// Pass `query` to also wrap case-insensitive matches in <mark> (both in link text and plain text).
export function renderFaqAnswer(answer: string, query = ""): string {
  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  let result = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(answer))) {
    result += highlight(answer.slice(lastIndex, match.index), query);
    const [full, text, url] = match;
    const isExternal = /^https?:\/\//.test(url);
    const attrs = isExternal ? ' target="_blank" rel="noopener noreferrer"' : "";
    result += `<a href="${escapeHtml(url)}"${attrs}>${highlight(text, query)}</a>`;
    lastIndex = match.index + full.length;
  }
  result += highlight(answer.slice(lastIndex), query);

  return result;
}

export function matchesFaqQuery(doc: FaqDoc, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return doc.question.toLowerCase().includes(q) || doc.answer.toLowerCase().includes(q);
}

export function searchFaq(docs: FaqDoc[], query: string): FaqDoc[] {
  return docs.filter((doc) => matchesFaqQuery(doc, query)).sort((a, b) => a.question.localeCompare(b.question));
}

// Renders a FaqDoc as the shared ".faq-result-card" markup (see global.css),
// with `query` highlighted. Used by both the navbar's live dropdown and the
// dedicated /search results page.
//
// This is NOT an <a> — the answer can itself contain a real <a> (via
// renderFaqAnswer's markdown-link support), and nested anchors are invalid
// HTML (the browser silently closes the outer one early, breaking the card's
// box exactly at the inner link). Instead it's a clickable div; see
// bindFaqResultCardClicks for the navigation behavior.
export function renderFaqResultTile(doc: FaqDoc, query: string): string {
  return `
    <div class="faq-result-card" data-href="${escapeHtml(doc.href)}" role="link" tabindex="0">
      <p class="faq-result-question">${highlight(doc.question, query)}</p>
      <p class="faq-result-answer">${renderFaqAnswer(doc.answer, query)}</p>
    </div>
  `;
}

// Makes .faq-result-card elements inside `container` navigate to their
// data-href on click/Enter/Space, unless the click landed on a real inner
// <a> (e.g. a link inside the answer text), which should navigate itself.
export function bindFaqResultCardClicks(container: HTMLElement): void {
  container.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest("a")) return;
    const card = target.closest<HTMLElement>(".faq-result-card");
    if (card?.dataset.href) window.location.href = card.dataset.href;
  });

  container.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const target = e.target as HTMLElement;
    const card = target.closest<HTMLElement>(".faq-result-card");
    if (!card?.dataset.href) return;
    e.preventDefault();
    window.location.href = card.dataset.href;
  });
}
