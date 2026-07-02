#!/usr/bin/env bun
/**
 * Mechanical gate for native-localization-review (Stage 0). CLI runner.
 *
 * Deterministic, no LLM. Catches what a script catches better than a model:
 *   - coverage      : keys present in the reference but missing in a locale (silent fallback)
 *   - placeholder   : the {arg} SET drifts between reference and locale (dropped/added/renamed)
 *   - malformed     : unbalanced braces in a value (ICU apostrophe-quoting respected)
 *   - untranslated  : value byte-identical to the reference (and not allow-listed)
 *   - length        : value exceeds a configured budget — checked on the REFERENCE locale too
 *   - adapter-error : one locale's load() threw (reported, run continues)
 *
 * Run BEFORE spending reviewer tokens, so Stage 1 reviews only real prose, not key noise.
 * All gate logic lives in gate-core.ts (unit-tested in gate-core.test.ts); this file only
 * loads config + adapter, runs the gate, formats output, and sets the exit code.
 *
 * Requires bun (dynamic-imports the project's TypeScript adapter).
 *
 * Usage:
 *   bun run validate-locales.ts --config localization.config.json [--layer chrome] [--locale de] [--json]
 *
 * Exit codes: 0 clean/warnings only · 1 errors found · 2 config/adapter/filter problem.
 *
 * The config's "adapter" is a project module exporting:
 *   export const referenceLocale: string
 *   export const layers: Record<string, { locales: string[]; load(locale: string): Record<string, unknown>; icu?: boolean }>
 * (`load` may return nested objects/arrays; the gate flattens them to dotted keys. `icu` defaults
 *  to true; set `icu: false` on layers rendered by plain `{token}` interpolation so apostrophe-heavy
 *  orthographies — Maltese f'{value} — aren't parsed as ICU quoting. See LayerLike in gate-core.ts.)
 */

import { resolve, dirname, isAbsolute } from "node:path";
import { readFileSync } from "node:fs";
import { type Config, type Finding, type LayerLike, runGate } from "./gate-core";

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
})) as { referenceLocale?: string; layers: Record<string, LayerLike> };

const refLocale = config.referenceLocale ?? adapter.referenceLocale ?? "en";

// ---- run --------------------------------------------------------------------
let findings: Finding[];
try {
  findings = runGate(adapter.layers, config, { refLocale, onlyLayer, onlyLocale });
} catch (e) {
  console.error((e as Error).message); // unknown filter, bad keyPattern regex, ref load failure
  process.exit(2);
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
