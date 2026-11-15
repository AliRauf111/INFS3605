import { Noto_Sans_Bengali, Noto_Sans_Devanagari, Noto_Sans_Tamil, Noto_Sans_Telugu } from "next/font/google";

// Fonts for the Indian scripts. Many computers have no Tamil, Telugu or Bengali font, and
// the ones that do differ a lot in size, so these keep text even and readable. They are
// served from this site (Next downloads them at build time) and each one only covers its
// own script, so a browser downloads a font only when a page shows that script. Latin text
// keeps the existing Inter and system font stack. Devanagari covers Marathi and Hindi.

// next/font reads these options at build time, so each call spells them out in full.
const tamil = Noto_Sans_Tamil({ subsets: ["tamil"], weight: "variable", display: "swap", preload: false, variable: "--font-tamil" });
const telugu = Noto_Sans_Telugu({ subsets: ["telugu"], weight: "variable", display: "swap", preload: false, variable: "--font-telugu" });
const devanagari = Noto_Sans_Devanagari({ subsets: ["devanagari"], weight: "variable", display: "swap", preload: false, variable: "--font-devanagari" });
const bengali = Noto_Sans_Bengali({ subsets: ["bengali"], weight: "variable", display: "swap", preload: false, variable: "--font-bengali" });

/** Class names that define the --font-* variables used in i18n.css. */
export const scriptFonts = [tamil, telugu, devanagari, bengali].map((f) => f.variable).join(" ");
