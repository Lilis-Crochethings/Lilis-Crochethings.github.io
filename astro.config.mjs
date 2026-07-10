import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://lilis-crochethings.github.io',
  output: 'static',
  integrations: [sitemap()],
  build: {
    // The per-page CSS bundles are only 1-2KB — inlining them into <head>
    // avoids two extra render-blocking network round-trips per page.
    inlineStylesheets: 'always',
  },
});