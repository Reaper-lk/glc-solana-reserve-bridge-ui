#!/usr/bin/env node
/**
 * Vendor the IBM Plex woff2 files into the repository (design spec H2).
 *
 * Fonts are self-hosted rather than loaded from a CDN for three reasons stated
 * in the design docs: a financial app should have no third-party dependency in
 * its critical path, `font-src 'self'` must stay enforceable in the CSP, and a
 * blocked font swap changes the width of a number, which on this product is a
 * correctness problem rather than a cosmetic one.
 *
 * The @fontsource packages are a devDependency used only as the source of these
 * files. The committed woff2 files are what actually ship, so the runtime has no
 * font dependency at all.
 *
 * Run: node scripts/vendor-fonts.mjs
 */

import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const DESTINATION = join(ROOT, "app", "fonts");

/** Only the weights used above the fold (E3 type scale). */
const FONTS = [
  {
    package: "@fontsource/ibm-plex-sans",
    file: "ibm-plex-sans-latin-400-normal.woff2",
  },
  {
    package: "@fontsource/ibm-plex-sans",
    file: "ibm-plex-sans-latin-600-normal.woff2",
  },
  {
    package: "@fontsource/ibm-plex-mono",
    file: "ibm-plex-mono-latin-400-normal.woff2",
  },
  {
    package: "@fontsource/ibm-plex-mono",
    file: "ibm-plex-mono-latin-500-normal.woff2",
  },
];

mkdirSync(DESTINATION, { recursive: true });

for (const font of FONTS) {
  const source = join(ROOT, "node_modules", font.package, "files", font.file);
  if (!existsSync(source)) {
    console.error(`Missing ${source}. Run \`npm install\` first.`);
    process.exit(1);
  }
  copyFileSync(source, join(DESTINATION, font.file));
  console.log(`vendored ${font.file}`);
}

console.log(`\n${FONTS.length} font files vendored into app/fonts.`);
