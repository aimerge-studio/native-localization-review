/**
 * Pure, testable core for the native-localization-review mechanical gate.
 *
 * Split out from validate-locales.ts (the CLI runner) so these functions can be unit-tested
 * without executing the runner's top-level config/adapter load + process.exit. See gate-core.test.ts.
 */

export type Severity = "error" | "warn";

export type Finding = {
  locale: string;
  layer: string;
  key: string;
  type: "coverage" | "placeholder" | "malformed" | "untranslated" | "length";
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
   * different member than the reference is NOT drift. Canonical case: pre-declined country-name
   * variants (country_nom/gen/acc/dat/loc + prep) — the generator supplies all; each locale picks
   * the grammatically correct one. Each group collapses to a single token before comparison.
   */
  placeholderEquivalents?: string[][];
};

/** Flatten nested objects to dotted keys; keep only string leaves. */
export function flatten(obj: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (typeof v === "string") out[key] = v;
      else if (v && typeof v === "object") flatten(v, key, out);
    }
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
 *
 * Known limitation: ICU apostrophe-quoting (`'{'` literal brace, `''` literal apostrophe) is not
 * unquoted before parsing; content using quoted literal braces may misparse. `''` (escaped
 * apostrophe, no brace) is harmless. Documented for adopters.
 */
export function placeholders(s: string): string[] {
  const args: string[] = [];
  let i = 0;
  const n = s.length;
  const isIdent = (c: string) => /[A-Za-z0-9_]/.test(c);
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

export function bracesBalanced(s: string): boolean {
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
 * so a reference→locale case-form swap (country_nom → country_dat) isn't reported as drift.
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
