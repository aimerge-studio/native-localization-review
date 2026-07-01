/**
 * Example adapter — per-locale JSON message catalogs.
 *
 * Fits next-intl / i18next / react-intl / vue-i18n and most file-based i18n setups where each
 * locale is a JSON file (e.g. messages/en.json, messages/de.json).
 *
 * Copy into your repo (e.g. scripts/loc-review.adapter.ts), set MESSAGES_DIR + referenceLocale,
 * and point localization.config.json "adapter" at this file. Requires bun.
 *
 * Contract consumed by scripts/validate-locales.ts:
 *   export const referenceLocale: string
 *   export const layers: Record<string, { locales: string[]; load(locale): Record<string, unknown> }>
 * `load` may return nested objects; the gate flattens them to dotted keys.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const MESSAGES_DIR = resolve(import.meta.dir, "../messages"); // ← adjust to your catalog directory
export const referenceLocale = "en";

const load = (locale: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(MESSAGES_DIR, `${locale}.json`), "utf8"));

export const layers = {
  messages: {
    locales: readdirSync(MESSAGES_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -".json".length)),
    load,
  },
} as const;
