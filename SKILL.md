---
name: native-localization-review
description: Use when already-translated UI strings, message catalogs, or content across many locales/pages read stiff, machine-translated or "too programmatic" — wrong register/formality, calques, morphology or agreement errors, placeholder-agreement bugs, SERP-overlong meta strings, or inconsistent terminology. For multi-locale sites needing native-fluency review and fixes at scale (not hreflang/tag setup — that's seo-hreflang).
---

# Native Localization Review

## Overview

Machine-or-rushed translation is grammatical but reads *translated* — calques, stiff register, agreement errors, filler. This skill finds and fixes that across every locale and page at scale, producing **native-fluent** copy that a local editor would have written, gated by your approval.

**Core principle:** judge each language **as a native reader would, blind to the source first** — then check accuracy. "Is this good [language]?" is a different question from "is this faithful to English?", and only the blind-first order reliably catches unnatural copy.

**The non-obvious insight that generic review misses:** any string containing a `{placeholder}` can carry a **runtime agreement bug** — an adjective, article, or verb that agrees with a variable whose gender/number/case changes at substitution time. Example: Spanish `{label} clasificada` (feminine adjective agreeing with a variable `{label}`) → recast gender-neutral `Clasificación de {label}`. For **every** string with a placeholder, ask: *does any word grammatically agree with the variable, and what values can it take?*

## When to use

- A multi-locale site/app where translations exist but quality is uneven across languages.
- Symptoms: "sounds machine-translated", "too programmatic", "not how a native would say it", wrong formality, weird word order, meta descriptions truncated in SERPs.
- After bulk/AI translation, before shipping; or a periodic native-quality sweep over many pages.

**Not for:** hreflang/language-tag/region-code setup → use `seo-hreflang`. First-draft generation of brand-new content (this reviews/fixes existing strings).

## Workflow

Drive these stages. Stage 1 fans out **one subagent per locale**, Stage 2 **one skeptic per finding** (parallel) — read `dispatching-parallel-agents` when orchestrating many.

| # | Stage | What | Cost |
|---|-------|------|------|
| 0 | **Mechanical gate** | Run `scripts/validate-locales.ts`. Deterministic: missing keys (silent fallback), placeholder drift, identical-to-source (untranslated), length-budget overflow, malformed braces. Narrows the surface before any LLM tokens. | cheap, no LLM |
| 1 | **Native review** | One native-editor subagent **per locale**, using `reviewer-persona.md`. Reads strings **assembled into their page/section** (never key-by-key), blind-first, then accuracy. Returns structured diffs only. | the engine |
| 2 | **Adversarial verify** | For each `bug`-severity finding, an **independent skeptic subagent** confirms it's really wrong, the fix is correct, and meaning + the `{var}` set are preserved — **default to REJECT if uncertain**. Kills plausible-but-wrong fixes before they reach you. *(In one production run this rejected 16 of ~74 candidate bugs.)* | per finding |
| 3 | **Live spot-check** | For top-severity locales/pages, render the live page (local `bun dev` via `/browse`) and verify the fix in situ — catches interpolation breakage, overflow, truncation, fallback leaking through. | sampled |
| 4 | **Approval gate** | Present **verified** diffs **grouped by locale**, severity-sorted, **bugs separated from taste**. You approve per locale. | human |
| 5 | **Apply + verify** | Write approved edits to **source** files. For codegen'd files, edit the **JSON/source and regenerate** (never the generated file). Re-run Stage 0 + project tests (`bun test`). | cheap |

## Output contract (the discipline that makes it appliable)

Every finding from a reviewer subagent MUST be a structured row, never prose:

```text
locale | layer | key | category | severity | before | after | placeholders_preserved | rationale
```

- `category` ∈ {placeholder-agreement, calque, morphology, register, length, terminology, untranslated, filler}
- `severity` ∈ {bug, polish, taste} — **bug** = objectively wrong (grammar/meaning/agreement/placeholder/overflow); **polish** = correct but unnatural/stiff; **taste** = defensible preference (flag, don't auto-apply).
- `placeholders_preserved` = the set of `{vars}` is identical before→after. If a fix changes placeholders, it's a red flag — re-derive.

Taxonomy with calibrated real examples and per-language pitfalls live in `reviewer-persona.md`. Hand each reviewer that file + its locale's assembled strings.

## Setup

1. Copy `localization.config.example.json` → `localization.config.json` in the repo; fill in locales, length budgets, allowlist, live-URL pattern.
2. Copy an adapter from `adapters/` (e.g. `json-catalog.adapter.example.ts` for JSON message files, or `code-module.adapter.example.ts` for TS/JS dictionaries) into the repo and point `"adapter"` at it. The adapter exports `referenceLocale` + `layers` (each: `locales[]` + `load(locale) → flat string record`). Pure imports only (no server-only/DB) so the validator loads under bun.
3. Run the gate: `bun run ~/.claude/skills/native-localization-review/scripts/validate-locales.ts --config localization.config.json --json` (requires **bun** — it dynamic-imports your TS adapter). Pure logic is unit-tested in `scripts/gate-core.test.ts` (`bun test`).

## Gate config reference

Knobs in `localization.config.json` (see the example for a filled-in version):

- **`lengthBudgets`** — `[{ keyPattern, max, note }]`, regex → char cap. SERP defaults: ~60 title / ~155–160 description.
- **`identicalToReferenceAllowlist`** — suppresses false "untranslated" hits. A **bare value** (`"API"`, `"HTML"`) is do-not-translate in *every* locale; a **`"locale:value"`** entry (`"de:Newsletter"`, `"fr:Manager"`) is a cognate that's correct in *one* locale only — so it isn't flagged without masking a real gap elsewhere.
- **`placeholderEquivalents`** — `[[...names]]` groups of interchangeable runtime placeholders (e.g. pre-declined name forms `name_nominative/genitive/accusative/…`) collapse to one token, so a locale picking the grammatical case its language needs isn't reported as drift.
- The gate is **ICU-aware**: `plural`/`select` case bodies are not mistaken for variables, and it compares argument **sets** — so differing plural branch counts across locales (Slovak `one/few/many/other` vs English `one/other`) never false-positive.
- **Codegen'd layers** — set `generated` / `editSource` / `regen` in the `layers` block so Stage 5 edits the source + regenerates; wire the generator's `--check` mode into CI to gate staleness.

## Red flags — STOP

- Returning prose instead of structured diff rows → can't approve or apply cleanly. Re-emit as rows.
- A fix that **adds or drops a `{placeholder}`** → almost always wrong; re-derive.
- **Adding length** to a `*MetaDescription`/`*MetaTitle` key → check the length budget first; meta strings shrink, they don't grow.
- Reviewing strings **in isolation** (key-by-key) → register and cohesion are invisible without the page context. Assemble first.
- Editing a file with an `AUTO-GENERATED … Do NOT hand-edit` banner → edit the source + regenerate.
- Auto-applying `taste`-severity items → those are for the human only.

## Common mistakes

- **Side-by-side from the start** biases toward "faithful" over "natural". Read target-only first.
- **Skipping the mechanical gate** burns reviewer tokens on missing-key/placeholder noise a script catches for free.
- **One reviewer for all locales** — no single agent holds native fluency in 18 languages at once. One subagent per locale.
