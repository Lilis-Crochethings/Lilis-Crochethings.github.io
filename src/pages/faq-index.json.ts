import type { APIRoute } from "astro";
import { getFaqDocs } from "../lib/faq-data";

export const prerender = true;

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify(getFaqDocs()), {
    headers: { "Content-Type": "application/json" },
  });
};
