/**
 * Pure, testable core for the native-localization-review mechanical gate.
 *
 * Split out from validate-locales.ts (the CLI runner) so all gate logic can be unit-tested
 * without executing the runner's top-level config/adapter load + process.exit. See gate-core.test.ts.
 */

export type Severity = "error" | "warn";

export type Finding = {
  locale: string;
  layer: string;
  key: string;
  type: "coverage" | "placeholder" | "malformed" | "untranslated" | "length" | "adapter-error";
  severity: Severity;
  detail: string;
};

export type LengthBudget = { keyPattern: string; max: number; note?: string };

export type Config = {
  adapter: string;
  referenceLocale?: string;
  lengthBudgets?: LengthBudget[];
  identicalToReferenceAllowlist?: string[];
  /**
   * Groups of placeholder names the runtime supplies interchangeably, so a locale referencing a
   * different member than the reference is NOT drift. Canonical case: pre-declined name variants
   * (name_nominative/genitive/…) — the generator supplies all; each locale picks the grammatically
   * correct one. Each group collapses to a single token before comparison.
   */
  placeholderEquivalents?: string[][];
  /**
   * Regexes (matched against the flattened dotted key) whose COVERAGE check is skipped — for keys
   * a locale may legitimately lack. Canonical case: i18next plural-suffix keys — Japanese has no
   * `greeting_one`, only `greeting_other`; pattern "_(zero|one|two|few|many)$" stops the false
   * "missing → falls back" warning while `_other` and every other check stay enforced.
   */
  coverageIgnoreKeyPatterns?: string[];
};

export type LayerLike = {
  locales: string[];
  load: (locale: string) => Record<string, unknown>;
  /**
   * Whether this layer's strings are ICU MessageFormat (default true). Set `icu: false` for layers
   * whose runtime is plain `{token}` interpolation (a regex fill), where an apostrophe is ordinary
   * orthography — NOT ICU quote syntax. Canonical case: Maltese `f'{value}` in a regex-filled layer
   * is a live placeholder; ICU semantics would treat everything after `'{` as quoted literal text
   * and report the placeholder as dropped. Match this flag to how the app actually renders.
   */
  icu?: boolean;
};

/** Flatten nested objects AND arrays to dotted keys; keep only string leaves.
 *  Arrays index as `key.0`, `key.1`, … so list content (i18next/vue-i18n) is checked, not dropped. */
export function flatten(obj: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => {
      const key = prefix ? `${prefix}.${i}` : String(i);
      if (typeof v === "string") out[key] = v;
      else if (v && typeof v === "object") flatten(v, key, out);
    });
  } else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (typeof v === "string") out[key] = v;
      else if (v && typeof v === "object") flatten(v, key, out);
    }
  }
  return out;
}

/**
 * Remove ICU MessageFormat apostrophe-quoted literal text before structural analysis.
 *
 * ICU quoting: `''` is a literal apostrophe (everywhere); `'` immediately followed by a syntax
 * char ({ } # |) starts quoted literal text that runs to the next lone `'` (unterminated ⇒ to end
 * of string); any other `'` is a plain literal apostrophe. Quoted text is DISPLAY text — braces
 * inside it are not syntax — so `"Add '{' to open"` is valid ICU with zero placeholders, and
 * `"l''inflazione è al {rate}"` has exactly one. Stripping quoted spans (and collapsing `''`)
 * lets bracesBalanced()/placeholders() see only real syntax.
 */
export function stripIcuQuoted(s: string): string {
  let out = "";
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === "'") {
      if (s[i + 1] === "'") { out += "'"; i += 2; continue; }        // '' → literal apostrophe
      if (s[i + 1] === "{" || s[i + 1] === "}" || s[i + 1] === "#" || s[i + 1] === "|") {
        i += 2;                                                       // consume quote-open + first quoted char
        while (i < n) {
          if (s[i] === "'") {
            if (s[i + 1] === "'") { i += 2; continue; }              // escaped apostrophe inside quoted text
            i += 1; break;                                            // quote-close
          }
          i += 1;
        }
        continue;                                                     // quoted span dropped entirely
      }
      out += "'"; i += 1; continue;                                   // lone ' before non-syntax = literal
    }
    out += c; i += 1;
  }
  return out;
}

/**
 * ICU-aware extraction of the SET of argument names referenced by a message.
 *
 * Returns UNIQUE, sorted argument names — a *set*, not a multiset. Drift detection only cares
 * about *which* runtime arguments a string references, never how many times: a variable that is
 * supplied is supplied regardless of how often it appears. Comparing sets also avoids a
 * false-positive class — a locale whose plural has a different branch count than the reference
 * (e.g. Slovak `one/few/many/other` vs English `one/other`) with a `{var}` inside each branch
 * would, under multiset comparison, look like drift when it is perfectly correct.
 *
 * ICU select/plural *case bodies* are sub-messages (literal text), NOT arguments:
 * `{gapAbs, plural, one {point} other {points}}` yields `["gapAbs"]`, not `point`/`points`.
 * The walker recurses INTO each case message to catch genuinely-nested args (e.g.
 * `{n, plural, one {{name} item} other {{name} items}}` → `["n","name"]`) while ignoring the
 * selector tokens. Plain `{var}` interpolation (non-ICU) is just a simple argument.
 * Apostrophe-quoted literal text is stripped first (see stripIcuQuoted), and identifiers may
 * use any Unicode letter/digit ({país} is a valid argument name).
 *
 * `{ icu: false }` switches to PLAIN-interpolation extraction for layers rendered by a regex fill
 * (`tpl.replace(/\{token\}/g, …)`): no apostrophe-quote stripping, no plural/select parsing — the
 * extractor matches exactly what such a fill would substitute. Token names may include dots and
 * hyphens (`{user.name}`, `{cta-label}`) as those fills commonly do. Keeps Maltese-style `f'{value}`
 * (apostrophe as orthography) from being read as ICU quoting. See LayerLike.icu.
 */
export function placeholders(raw: string, opts?: { icu?: boolean }): string[] {
  if (opts?.icu === false) {
    // Plain `{token}` fill: allow dotted/hyphenated names ({user.name}) as such fills do.
    const args = [...raw.matchAll(/\{\s*([\p{L}\p{N}_.-]+)\s*\}/gu)].map((m) => m[1]);
    return [...new Set(args)].sort();
  }
  const s = stripIcuQuoted(raw);
  const args: string[] = [];
  let i = 0;
  const n = s.length;
  const isIdent = (c: string) => /[\p{L}\p{N}_]/u.test(c);
  const skipWs = () => { while (i < n && /\s/.test(s[i])) i++; };
  const readIdent = () => { const j = i; while (i < n && isIdent(s[i])) i++; return s.slice(j, i); };

  function parseMessage(): void {
    // Consume message text until the closing `}` of THIS message (left for the caller), or EOF.
    while (i < n) {
      const c = s[i];
      if (c === "}") return;
      if (c === "{") { i++; parseArg(); }
      else i++;
    }
  }

  function parseArg(): void {
    skipWs();
    const name = readIdent();
    if (name) args.push(name);
    skipWs();
    if (s[i] === ",") {
      i++; skipWs();
      const type = readIdent();
      skipWs();
      if (type === "plural" || type === "select" || type === "selectordinal") {
        // `[offset:N] (selector {message})*` — selectors are bare tokens; messages are in braces.
        while (i < n && s[i] !== "}") {
          while (i < n && s[i] !== "{" && s[i] !== "}") i++; // skip the selector token
          if (s[i] === "{") { i++; parseMessage(); if (s[i] === "}") i++; }
        }
        if (s[i] === "}") i++; // close the plural/select arg
      } else {
        // simple format (number/date/time/custom): skip to the matching close brace
        let depth = 1;
        while (i < n && depth > 0) {
          if (s[i] === "{") depth++;
          else if (s[i] === "}") depth--;
          if (depth > 0) i++;
        }
        if (s[i] === "}") i++;
      }
    } else if (s[i] === "}") {
      i++; // simple `{name}` close
    }
  }

  parseMessage();
  return [...new Set(args)].sort();
}

/** Balance check on the quote-stripped string, so ICU-quoted literal braces don't false-positive.
 *  `{ icu: false }` skips the quote-stripping for plain-interpolation layers (see LayerLike.icu). */
export function bracesBalanced(raw: string, opts?: { icu?: boolean }): boolean {
  const s = opts?.icu === false ? raw : stripIcuQuoted(raw);
  let depth = 0;
  for (const ch of s) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/** Equality of two already-sorted string arrays (used to compare placeholder sets). */
export const eqSorted = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Collapse interchangeable placeholders (config `placeholderEquivalents`) to one token per group
 * so a reference→locale case-form swap (name_nominative → name_dative) isn't reported as drift.
 * Non-grouped placeholders pass through unchanged and stay strictly compared.
 */
export function makePlaceholderNormalizer(groups: string[][] | undefined) {
  if (!groups?.length) return (p: string[]) => p;
  const groupOf = new Map<string, string>();
  groups.forEach((g, gi) => g.forEach((name) => groupOf.set(name, `§${gi}`)));
  return (p: string[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const name of p) {
      const g = groupOf.get(name);
      if (g) { if (!seen.has(g)) { seen.add(g); out.push(g); } }
      else out.push(name);
    }
    return out.sort();
  };
}

export type GateOptions = { refLocale: string; onlyLayer?: string; onlyLocale?: string };

/**
 * Run every mechanical check over the adapter's layers. Pure: no I/O beyond calling layer.load().
 *
 * Throws on an unknown --layer/--locale filter (a typo'd filter that silently matched nothing
 * used to report "clean" with exit 0 — the worst false negative for CI). Per-locale load()
 * failures become `adapter-error` findings instead of crashing the run; a reference-locale load
 * failure throws (the whole layer is unusable without it).
 */
export function runGate(layers: Record<string, LayerLike>, config: Config, opts: GateOptions): Finding[] {
  const { refLocale, onlyLayer, onlyLocale } = opts;
  const allowlist = new Set(config.identicalToReferenceAllowlist ?? []);
  const budgets = (config.lengthBudgets ?? []).map((b) => ({ ...b, re: new RegExp(b.keyPattern) }));
  const coverageIgnore = (config.coverageIgnoreKeyPatterns ?? []).map((p) => new RegExp(p));
  const normPlaceholders = makePlaceholderNormalizer(config.placeholderEquivalents);

  if (onlyLayer && !(onlyLayer in layers))
    throw new Error(`unknown --layer "${onlyLayer}" — adapter has: ${Object.keys(layers).join(", ")}`);
  if (onlyLocale) {
    const candidates = Object.entries(layers)
      .filter(([name]) => !onlyLayer || name === onlyLayer)
      .flatMap(([, l]) => l.locales);
    if (onlyLocale !== refLocale && !candidates.includes(onlyLocale))
      throw new Error(`unknown --locale "${onlyLocale}" — adapter has: ${[...new Set([refLocale, ...candidates])].join(", ")}`);
  }

  const findings: Finding[] = [];

  for (const [layerName, layer] of Object.entries(layers)) {
    if (onlyLayer && layerName !== onlyLayer) continue;
    const icu = { icu: layer.icu !== false }; // per-layer semantics (default ICU; see LayerLike.icu)
    const ref = flatten(layer.load(refLocale)); // ref load failure is fatal by design — let it throw
    const refKeys = Object.keys(ref);

    // The reference locale gets structural + length checks too (drift/coverage/untranslated are
    // meaningless against itself). An over-budget en meta is just as truncated in the SERP.
    if (!onlyLocale || onlyLocale === refLocale) {
      for (const key of refKeys) {
        const refVal = ref[key];
        if (!bracesBalanced(refVal, icu))
          findings.push({ locale: refLocale, layer: layerName, key, type: "malformed", severity: "error",
            detail: `unbalanced braces: ${JSON.stringify(refVal)}` });
        for (const b of budgets)
          if (b.re.test(key) && refVal.length > b.max)
            findings.push({ locale: refLocale, layer: layerName, key, type: "length", severity: "warn",
              detail: `${refVal.length} > ${b.max} chars${b.note ? ` (${b.note})` : ""}` });
      }
    }

    for (const locale of layer.locales) {
      if (locale === refLocale) continue;
      if (onlyLocale && locale !== onlyLocale) continue;

      let loc: Record<string, string>;
      try {
        loc = flatten(layer.load(locale));
      } catch (e) {
        findings.push({ locale, layer: layerName, key: "*", type: "adapter-error", severity: "error",
          detail: `load() failed: ${(e as Error).message}` });
        continue;
      }

      for (const key of refKeys) {
        const refVal = ref[key];
        const locVal = loc[key];

        // coverage — present in reference, absent in locale (silently falls back)
        if (locVal === undefined) {
          if (/\p{L}/u.test(refVal) && !coverageIgnore.some((re) => re.test(key)))
            findings.push({ locale, layer: layerName, key, type: "coverage", severity: "warn",
              detail: "missing → falls back to reference (untranslated)" });
          continue;
        }

        // malformed braces (ICU-quote-aware unless the layer opts out)
        if (!bracesBalanced(locVal, icu))
          findings.push({ locale, layer: layerName, key, type: "malformed", severity: "error",
            detail: `unbalanced braces: ${JSON.stringify(locVal)}` });

        // placeholder drift (SET comparison, per-layer ICU semantics; case-form equivalents collapsed)
        const rp = normPlaceholders(placeholders(refVal, icu)), lp = normPlaceholders(placeholders(locVal, icu));
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

  return findings;
}
