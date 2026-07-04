<h1 align="center">native-localization-review</h1>

<p align="center">
  <strong>Find the translation bugs a spell-checker and a human reviewer both miss — across every locale, at scale, gated by your approval.</strong>
</p>

<p align="center">
  A <a href="https://claude.com/claude-code">Claude Code</a> skill for native-fluency review and fixes of already-translated content: UI strings, message catalogs, and marketing copy in any number of languages.
</p>

<p align="center">
  <a href="https://github.com/aimerge-studio/native-localization-review/actions/workflows/test.yml"><img src="https://github.com/aimerge-studio/native-localization-review/actions/workflows/test.yml/badge.svg" alt="tests"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/Claude%20Code-skill-8A63D2" alt="Claude Code skill">
  <img src="https://img.shields.io/badge/runtime-bun-000" alt="bun">
  <img src="https://img.shields.io/badge/i18n-next--intl%20%C2%B7%20i18next%20%C2%B7%20react--intl%20%C2%B7%20vue--i18n-1f6feb" alt="i18n frameworks">
</p>

---

## The bug nobody else catches

Bulk and AI translation is *grammatical* — so it sails past QA — but it reads translated, and worse, it hides a class of bug that only appears at runtime: **a word that grammatically agrees with a `{placeholder}` whose gender, number, or case changes on every render.**

Spanish `{label} clasificada` is flawless until `{label}` becomes a masculine noun — then your production page shows `el PIB clasificada`. No test, no linter, and no side-by-side human review reliably catches it, because the string is *correct in isolation*. This skill is built to catch exactly that, and the rest of the translationese around it.

| Lang | Before (machine) | After (native) | What was wrong |
|:----:|------------------|----------------|----------------|
| es | `{label} clasificada` | `Clasificación de {label}` | feminine adjective agreeing with a runtime variable |
| hr | `Iznad inflacije` | `Osim inflacije` | spatial "above" mistranslating "beyond" (calque) |
| bg | `12-месечни тренда` | `12-месечни трендове` | wrong plural form after an adjective |
| fr | *…179-char meta description* | *…trimmed to 149* | truncated in search results |

## What it does

- **Deterministic gate, then native editors.** A fast, LLM-free mechanical gate (`bun`) catches missing keys, placeholder drift, untranslated strings, and over-budget meta *before* spending a single token — then one native-editor reviewer per locale judges fluency, blind to the source first.
- **Catches runtime placeholder-agreement bugs** — the gendered-article / participle / verb class above, which generic review misses.
- **Nothing is "human-only."** Every finding resolves to **change** or **keep** through a decision procedure (verify → style spec → panel → deterministic tie-break). You review a clean diff, not a backlog of open questions.
- **Scales.** Parallel per-locale review over hundreds of pages; a decisions ledger makes re-runs incremental.
- **Framework-agnostic.** Works with per-locale JSON (next-intl, i18next, react-intl, vue-i18n) or in-code TS/JS dictionaries, via a tiny adapter you write once.
- **ICU MessageFormat-aware.** Plural/select bodies, apostrophe quoting, and Unicode argument names are handled correctly — and it's [unit-tested](./scripts/gate-core.test.ts).

## Example: the mechanical gate

```console
$ bun run validate-locales.ts --config localization.config.json

de  (2)
  [ERR ] messages.stats.rose · placeholder: placeholders differ: reference {label,value} vs locale {value}
  [warn] messages.hub.metaDescription · length: 187 > 160 chars (SERP)

2 findings · 1 errors. Errors gate the build; warnings feed Stage 1 review.
```

Exit `0` clean/warnings, `1` errors (wire it into CI), `2` config problem. Deterministic — same input, same output, every run.

## How it works

**0** mechanical gate → **1** per-locale native review → **2** verify & resolve (correctness → skeptic, default-reject · style → decide against the corpus-inferred `styleSpec` · preference → native panel, ties keep-current) → **3** live spot-check → **4** review the resolved diff → **5** apply to source + re-verify.

Findings are structured rows, never prose:
`locale | layer | key | category | class | before | after | placeholders_preserved | resolution | resolvedBy | rationale`.
Only verified `change` rows land; a genuine coin-flip deterministically **keeps the current string** — the skill never hands you a question. Full detail in [`SKILL.md`](./SKILL.md).

## Requirements

- **[bun](https://bun.sh)** — the gate dynamic-imports your TypeScript adapter and runs the tests.
- **[Claude Code](https://claude.com/claude-code)** — the skill is invoked as `/native-localization-review`.

## Install

```bash
git clone https://github.com/aimerge-studio/native-localization-review \
  ~/.claude/skills/native-localization-review
```

## Quickstart

1. **Copy two templates into your repo** and edit them:
   - an adapter from [`adapters/`](./adapters) → `scripts/loc-review.adapter.ts`
   - [`localization.config.example.json`](./localization.config.example.json) → `localization.config.json`
2. **Run the mechanical gate** (deterministic, no LLM — narrows the surface first):
   ```bash
   bun run ~/.claude/skills/native-localization-review/scripts/validate-locales.ts \
     --config localization.config.json --json
   ```
3. **Invoke the skill** and name a scope:
   > `/native-localization-review` — "review the messages across all locales; fix over-length meta and anything that reads translated; diffs for approval."

## The adapter contract

Your adapter is a small, pure TypeScript module (no server-only/DB imports) that tells the gate how to load strings:

```ts
export const referenceLocale: string;
export const layers: Record<string, {
  locales: string[];
  load(locale: string): Record<string, unknown>; // nested objects/arrays ok; flattened to dotted keys
  icu?: boolean;                                  // default true; false for plain {token} interpolation
}>;
```

One layer per content type (UI strings, prose templates, ICU catalogs, codegen'd strings). Two worked examples ship in [`adapters/`](./adapters): [`json-catalog`](./adapters/json-catalog.adapter.example.ts) for file-based i18n, and [`code-module`](./adapters/code-module.adapter.example.ts) for TS/JS dictionaries.

## Configuration

Everything the gate enforces lives in `localization.config.json` (see the [example](./localization.config.example.json)):

- **Length budgets** — regex → char cap; checked on the reference locale too (SERP defaults ~60 title / ~155–160 description).
- **Allowlist** — bare values are do-not-translate everywhere; `locale:value` entries whitelist a cognate in one locale only.
- **Placeholder equivalents** — collapse interchangeable runtime placeholders (e.g. pre-declined name forms) so a locale choosing its grammatical case isn't flagged as drift.
- **Coverage-ignore patterns** — skip coverage for keys a locale legitimately lacks (i18next plural suffixes: `"_(zero|one|two|few|many)$"`).
- **styleSpec + decisions ledger** — per-locale style conventions (inferred from the corpus under a documented guard, overridable per locale) resolve style findings; every resolution appends to `.loc-review/decisions.jsonl`, making re-runs incremental and human overrides persistent.

## Development

```bash
bun test        # runs scripts/gate-core.test.ts
```

The gate's pure logic lives in [`scripts/gate-core.ts`](./scripts/gate-core.ts) and is unit-tested independently of the CLI runner.

## How it compares

This is not a translation service and not an hreflang/`<link>` tool. Machine translation and TMS platforms *produce* strings; hreflang tooling wires up language tags. `native-localization-review` is the missing **quality** layer on top: it reads what shipped, in context, and fixes what reads translated — with a bias toward never touching copy that's already fine.

## Contributing

Issues and PRs welcome. The per-language pitfall notes in [`reviewer-persona.md`](./reviewer-persona.md) are meant to grow — additions for new languages are especially valued.

## License

MIT © [AI Merge Studio](https://github.com/aimerge-studio) — see [`LICENSE`](./LICENSE).

<p align="center"><sub>If this saved you from shipping <code>el PIB clasificada</code>, a ⭐ helps others find it.</sub></p>
