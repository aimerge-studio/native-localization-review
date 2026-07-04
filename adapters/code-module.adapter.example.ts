/**
 * Example adapter — in-code message objects merged with a reference fallback.
 *
 * Fits projects that keep translations as TS/JS objects (per-locale dictionaries) rather than JSON,
 * and often have MULTIPLE content layers (UI chrome, long-form prose, ICU catalogs, codegen'd
 * strings). Copy into your repo, wire it to your real modules, point config "adapter" here.
 *
 * PURE imports only (no server-only / DB / React) so the gate can load it under bun without booting
 * your app. Contract: export `referenceLocale` + `layers` (each { locales, load(locale) → record }).
 */

// Replace these stubs with your real imports, e.g.:
//   import { LOCALES } from "../src/i18n/config";
//   import { getMessages } from "../src/i18n/get-messages"; // returns {...reference, ...localeOverride}
const LOCALES = ["en", "de", "fr", "es"];
const getMessages = (_locale: string): Record<string, unknown> => {
  // Left as a stub on purpose — wire it to your real message loader above. Throwing here means a
  // copied-but-unwired adapter fails loudly ("adapter error") instead of loading nothing and
  // reporting a misleading "✓ clean". Delete this line once `getMessages` returns real strings.
  throw new Error("code-module adapter: replace the getMessages() stub with your project's message loader.");
};

export const referenceLocale = "en";

export const layers = {
  // `load` returns the FULLY-RESOLVED strings a user sees. Where a locale omits a key and falls
  // back to the reference, the gate reports it as an identical-to-reference ("untranslated")
  // finding — which is exactly the silent-fallback you want surfaced.
  ui: {
    locales: LOCALES,
    load: (locale: string) => getMessages(locale),
  },

  // Add one layer per content type. For a codegen'd layer, keep loading the resolved strings here
  // and record the fix destination (source file + regen command) in localization.config.json
  // "layers" — Stage 5 edits the source and regenerates, never the generated file.
} as const;
