// Server/build-time only: parses the FAQ yaml source. Kept separate from
// ./faq so that client-side bundles (Navbar's search dropdown, /search page)
// importing the pure rendering helpers there don't drag the "yaml" parser
// and the raw FAQ text along for the ride.
import { parse } from "yaml";
import faqRaw from "../data/faq.yaml?raw";
import { getFaqQuestionId, type FaqCategory, type FaqDoc } from "./faq";

type FaqConfig = { categories: FaqCategory[] };

export const faqCategories: FaqCategory[] = (parse(faqRaw) as FaqConfig).categories;

export function getFaqDocs(): FaqDoc[] {
  return faqCategories.flatMap((category) =>
    category.questions.map((q, index) => {
      const id = getFaqQuestionId(category.id, index);
      return {
        id,
        href: `/faq#${id}`,
        category: category.title,
        question: q.question,
        answer: q.answer,
      };
    })
  );
}
