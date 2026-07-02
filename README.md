# native-localization-review

[![test](https://github.com/aimerge-studio/native-localization-review/actions/workflows/test.yml/badge.svg)](https://github.com/aimerge-studio/native-localization-review/actions/workflows/test.yml)
&nbsp;[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A [Claude Code](https://claude.com/claude-code) skill for **native-fluency review and fixes of already-translated content at scale** — across many locales and pages. It finds copy that reads *translated* (calques, stiff register, agreement errors, runtime placeholder-agreement bugs, SERP-overlong meta strings, terminology drift) and turns it into copy a local editor would have written — gated by your approval.

It complements, and does not replace, hreflang/international-SEO tooling: those handle language tags and regions; this handles **linguistic quality**.

## Why it exists

Bulk and AI translation is grammatical but reads translated. The subtle, high-value class a generic review misses: a word (article, adjective, participle, verb) that agrees with a `{placeholder}` whose gender/number/case changes at runtime — e.g. Spanish `{label} clasificada` breaks the moment `{label}` is masculine. This skill's per-language native-editor reviewers are built to catch exactly that — in page context, blind to the source first — and an independent skeptic verifies every fix before it reaches you.

## Requirements

- **[bun](https://bun.sh)** — the mechanical gate dynamic-imports your project's TypeScript adapter and runs the unit tests.
- **Claude Code** — the skill is invoked as `/native-localization-review`.

## Install

Clone into your Claude Code skills directory:

```bash
git clone https://github.com/aimerge-studio/native-localization-review \
  ~/.claude/skills/native-localization-review
```

## What's in the box

| File | Role |
|------|------|
| `SKILL.md` | The workflow (6 stages), output contract, gate config reference, red flags |
| `reviewer-persona.md` | Native-editor method (blind-first), issue taxonomy, per-language pitfalls, and the Stage-2 prompts (skeptic verify, spec resolver, diversified preference panel) |
| `scripts/gate-core.ts` | Pure, tested gate logic (ICU-aware placeholder extraction, flatten, normalizer) |
| `scripts/validate-locales.ts` | CLI runner for the mechanical gate |
| `scripts/gate-core.test.ts` | Unit tests (`bun test`) |
| `localization.config.example.json` | Policy: length budgets, allowlist, placeholder equivalents, live-check |
| `adapters/json-catalog.adapter.example.ts` | Adapter for per-locale JSON catalogs (next-intl / i18next / react-intl / vue-i18n) |
| `adapters/code-module.adapter.example.ts` | Adapter for TS/JS dictionary projects (multi-layer) |

## Quickstart

1. **Copy the two templates into your repo** and edit them:
   - an adapter from `adapters/` → `scripts/loc-review.adapter.ts`
   - `localization.config.example.json` → `localization.config.json`
2. **Run the mechanical gate** (deterministic, no LLM — narrows the surface first):
   ```bash
   bun run ~/.claude/skills/native-localization-review/scripts/validate-locales.ts \
     --config localization.config.json --json
   ```
3. **Invoke the skill** and name a scope:
   > `/native-localization-review` — "review the messages across all locales; fix over-length meta and anything that reads translated; diffs for approval."

## The adapter contract

Your adapter is a pure TypeScript module (no server-only/DB imports) that tells the gate how to load strings:

```ts
export const referenceLocale: string;
export const layers: Record<string, {
  locales: string[];
  load(locale: string): Record<string, unknown>; // nested ok; flattened to dotted keys
}>;
```

One layer per content type (UI strings, prose templates, long-form, ICU catalogs). Each layer's fix destination — including codegen'd files whose source-of-truth is elsewhere — is documented in `localization.config.json`'s `layers` block.

## The workflow

**0** mechanical gate → **1** per-locale native review → **2** verify & resolve (correctness → skeptic, default-reject; spec → decide against the corpus-inferred `styleSpec`; preference → native panel, ties keep-current) → **3** live spot-check → **4** review the resolved diff → **5** apply to source + re-verify.

Findings are structured rows, never prose: `locale | layer | key | category | class | before | after | placeholders_preserved | resolution | resolvedBy | rationale`. **Nothing is "human-only":** every finding resolves to `change` or `keep` — a genuine coin-flip breaks deterministically to *keep the current string*, never to an open question. The human reviews the diff, not a backlog.

## Gate configuration

The mechanical gate is fully deterministic and ICU-aware. Highlights (see `SKILL.md` → *Gate config reference*):

- **Length budgets** — regex → char cap (SERP defaults ~60 title / ~155–160 description); checked on the **reference locale too**.
- **Allowlist** — bare values are do-not-translate everywhere; `locale:value` entries whitelist a cognate in one locale only.
- **Placeholder equivalents** — collapse interchangeable runtime placeholders (e.g. pre-declined name forms) so a locale choosing its grammatical case isn't flagged as drift.
- **Coverage ignore patterns** — skip the coverage check for keys a locale legitimately lacks (i18next plural suffixes: `"_(zero|one|two|few|many)$"`).
- **ICU-aware** — `plural`/`select` case bodies aren't mistaken for variables, apostrophe-quoted literals (`'{'`, `''`) are respected, and argument **sets** (not counts) are compared, so differing plural branch counts across locales never false-positive.
- **styleSpec + decisions ledger** — per-locale style conventions (inferred from the corpus under a documented guard, overridable in `perLocale`) decide `spec`-class findings; every resolution appends to `.loc-review/decisions.jsonl`, making re-runs incremental and human overrides persistent. See `SKILL.md` → *Decision procedure*.
- **Exit codes** — `0` clean/warnings, `1` errors, `2` config/adapter problem or typo'd `--layer`/`--locale` (never a silent "clean").

## Development

```bash
bun test        # runs scripts/gate-core.test.ts
```

The gate's pure logic lives in `scripts/gate-core.ts` and is unit-tested independently of the CLI runner.

## License

MIT — see [`LICENSE`](./LICENSE).
