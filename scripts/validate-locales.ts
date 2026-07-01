#!/usr/bin/env bun
/**
 * Mechanical gate for native-localization-review (Stage 0). CLI runner.
 *
 * Deterministic, no LLM. Catches what a script catches better than a model:
 *   - coverage      : keys present in the reference but missing in a locale (silent fallback)
 *   - placeholder   : the {arg} SET drifts between reference and locale (dropped/added/renamed)
 *   - malformed     : unbalanced braces in a value
 *   - untranslated  : value byte-identical to the reference (and not allow-listed)
 *   - length        : value exceeds a configured budget for keys matching a pattern
 *
 * Run BEFORE spending reviewer tokens, so Stage 1 reviews only real prose, not key noise.
 * Pure logic lives in gate-core.ts (unit-tested in gate-core.test.ts).
 *
 * Requires bun (dynamic-imports the project's TypeScript adapter).
 *
 * Usage:
 *   bun run validate-locales.ts --config localization.config.json [--layer chrome] [--locale de] [--json]
 *
 * The config's "adapter" is a project module exporting:
 *   export const referenceLocale: string
 *   export const layers: Record<string, { locales: string[]; load(locale: string): Record<string, unknown> }>
 * (`load` may return nested objects; the gate flattens them to dotted keys.)
 */

import { resolve, dirname, isAbsolute } from "node:path";
import { readFileSync } from "node:fs";
import {
  type Config,
  type Finding,
  flatten,
  placeholders,
  bracesBalanced,
  eqSorted,
  makePlaceholderNormalizer,
} from "./gate-core";

// ---- arg parsing -----------------------------------------------------------
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const asJson = process.argv.includes("--json");
const configPath = resolve(arg("config") ?? "localization.config.json");
const onlyLayer = arg("layer");
const onlyLocale = arg("locale");

// ---- load config + adapter -------------------------------------------------
let config: Config;
try {
  config = JSON.parse(readFileSync(configPath, "utf8"));
} catch (e) {
  console.error(`Could not read config at ${configPath}: ${(e as Error).message}`);
  process.exit(2);
}

const adapterPath = isAbsolute(config.adapter)
  ? config.adapter
  : resolve(dirname(configPath), config.adapter);

const adapter = (await import(adapterPath).catch((e) => {
  console.error(`Could not import adapter at ${adapterPath}: ${e.message}`);
  process.exit(2);
})) as {
  referenceLocale?: string;
  layers: Record<string, { locales: string[]; load: (locale: string) => Record<string, unknown> }>;
};

const refLocale = config.referenceLocale ?? adapter.referenceLocale ?? "en";
const allowlist = new Set(config.identicalToReferenceAllowlist ?? []);
const budgets = (config.lengthBudgets ?? []).map((b) => ({ ...b, re: new RegExp(b.keyPattern) }));
const normPlaceholders = makePlaceholderNormalizer(config.placeholderEquivalents);

// ---- run checks ------------------------------------------------------------
const findings: Finding[] = [];

for (const [layerName, layer] of Object.entries(adapter.layers)) {
  if (onlyLayer && layerName !== onlyLayer) continue;
  const ref = flatten(layer.load(refLocale));
  const refKeys = Object.keys(ref);

  for (const locale of layer.locales) {
    if (locale === refLocale) continue;
    if (onlyLocale && locale !== onlyLocale) continue;
    const loc = flatten(layer.load(locale));

    for (const key of refKeys) {
      const refVal = ref[key];
      const locVal = loc[key];

      // coverage — present in reference, absent in locale (silently falls back)
      if (locVal === undefined) {
        if (/\p{L}/u.test(refVal))
          findings.push({ locale, layer: layerName, key, type: "coverage", severity: "warn",
            detail: "missing → falls back to reference (untranslated)" });
        continue;
      }

      // malformed braces
      if (!bracesBalanced(locVal))
        findings.push({ locale, layer: layerName, key, type: "malformed", severity: "error",
          detail: `unbalanced braces: ${JSON.stringify(locVal)}` });

      // placeholder drift (ICU-aware SET comparison; case-form equivalents collapsed)
      const rp = normPlaceholders(placeholders(refVal)), lp = normPlaceholders(placeholders(locVal));
      if (!eqSorted(rp, lp))
        findings.push({ locale, layer: layerName, key, type: "placeholder", severity: "error",
          detail: `placeholders differ: reference {${rp.join(",")}} vs locale {${lp.join(",")}}` });

      // untranslated (identical to reference). Allowlist entries are either a bare value (a
      // do-not-translate token for every locale, e.g. "API") or a `locale:value` pair (a value
      // that is a legitimate cognate in ONE locale only, e.g. "de:Newsletter") — the scoped form
      // suppresses the cognate without masking a real gap in other locales.
      const v = refVal.trim();
      if (locVal.trim() === v && /\p{L}/u.test(refVal) && !allowlist.has(v) && !allowlist.has(`${locale}:${v}`))
        findings.push({ locale, layer: layerName, key, type: "untranslated", severity: "warn",
          detail: "identical to reference (possibly untranslated)" });

      // length budget
      for (const b of budgets)
        if (b.re.test(key) && locVal.length > b.max)
          findings.push({ locale, layer: layerName, key, type: "length", severity: "warn",
            detail: `${locVal.length} > ${b.max} chars${b.note ? ` (${b.note})` : ""}` });
    }
  }
}

// ---- report ----------------------------------------------------------------
const errors = findings.filter((f) => f.severity === "error").length;

if (asJson) {
  console.log(JSON.stringify({ referenceLocale: refLocale, errors, total: findings.length, findings }, null, 2));
} else if (findings.length === 0) {
  console.log(`✓ clean — no mechanical issues (reference: ${refLocale})`);
} else {
  const byLocale = new Map<string, Finding[]>();
  for (const f of findings) (byLocale.get(f.locale) ?? byLocale.set(f.locale, []).get(f.locale)!).push(f);
  for (const [locale, fs] of [...byLocale].sort()) {
    console.log(`\n${locale}  (${fs.length})`);
    for (const f of fs.sort((a, b) => (a.severity < b.severity ? -1 : 1)))
      console.log(`  [${f.severity === "error" ? "ERR " : "warn"}] ${f.layer}.${f.key} · ${f.type}: ${f.detail}`);
  }
  console.log(`\n${findings.length} findings · ${errors} errors. Errors gate the build; warnings feed Stage 1 review.`);
}

process.exit(errors > 0 ? 1 : 0);
