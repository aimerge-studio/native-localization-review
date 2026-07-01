---
name: native-localization-review
description: Use when already-translated UI strings, message catalogs, or content across many locales/pages read stiff, machine-translated or "too programmatic" — wrong register/formality, calques, morphology or agreement errors, placeholder-agreement bugs, SERP-overlong meta strings, or inconsistent terminology. For multi-locale sites needing native-fluency review and fixes at scale (not hreflang/tag setup — that's seo-hreflang).
---

# Native Localization Review

## Overview

Machine-or-rushed translation is grammatical but reads *translated* — calques, stiff register, agreement errors, filler. This skill finds and fixes that across every locale and page at scale, producing **native-fluent** copy that a local editor would have written, gated by your approval.

**Core principle:** judge each language **as a native reader would, blind to the source first** — then check accuracy. "Is this good [language]?" is a different question from "is this faithful to English?", and only the blind-first order reliably catches unnatural copy.

**The non-obvious insight that generic review misses:** any string containing a `{placeholder}` can carry a **runtime agreement bug** — an adjective, article, or verb that agrees with a variable whose gender/number/case changes at substitution time. Example: Spanish `{label} clasificada` (feminine adjective agreeing with a variable `{label}`) → recast gender-neutral `Clasificación de {label}`. For **every** string with a placeholder, ask: *does any word grammatically agree with the variable, and what values can it take?*

**Nothing is "human-only."** A finding a naive reviewer punts as "taste" is not inherently undecidable — it's a decision the system wasn't yet *equipped* to make (missing criteria, or a misfiled consistency issue). Every finding **resolves to `change` or `keep`** through the [decision procedure](#decision-procedure--nothing-is-human-only): correctness is verified, style/formality/terminology is decided against a `styleSpec` inferred from the corpus, and a genuine coin-flip breaks deterministically to *keep the current string*. The human reviews the resulting diff — not a backlog of open questions.

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
| 2 | **Verify & resolve** | Every finding is *resolved to change/keep*, never escalated. **Correctness** (bug): an independent skeptic subagent confirms it's really wrong, the fix correct, meaning + `{var}` set preserved — **default REJECT if uncertain** *(one run rejected 16 of ~74)*. **Spec-governed** (register/formality/terminology/punctuation/length/consistency): decided against the `styleSpec` — deviates ⇒ change, conforms ⇒ keep. **Preference** (the old "taste"): a small native panel votes — converge ⇒ change, split ⇒ tie-break to **keep-current**. See [Decision procedure](#decision-procedure--nothing-is-human-only). | per finding |
| 3 | **Live spot-check** | For top-severity locales/pages, render the live page (local `bun dev` via `/browse`) and verify the fix in situ — catches interpolation breakage, overflow, truncation, fallback leaking through. | sampled |
| 4 | **Review the diff** | Present the **resolved** diff grouped by locale — each row marked `change`/`keep` with the rule that decided it (verify / spec / consistency / panel / tie-break). The human reviews *changes*, not open questions; overriding a call updates the `styleSpec`, not this row. | human |
| 5 | **Apply + verify** | Write `change` edits to **source** files. For codegen'd files, edit the **JSON/source and regenerate** (never the generated file). Re-run Stage 0 + project tests (`bun test`). | cheap |

## Output contract (the discipline that makes it appliable)

Every finding from a reviewer subagent MUST be a structured row, never prose:

```text
locale | layer | key | category | class | before | after | placeholders_preserved | resolution | resolvedBy | rationale
```

- `category` ∈ {placeholder-agreement, calque, morphology, register, length, terminology, consistency, untranslated, filler}
- `class` ∈ {correctness, spec, preference} — **how the finding gets resolved** (see Decision procedure). `correctness` = objectively wrong (grammar/meaning/agreement/placeholder/overflow); `spec` = decided against the `styleSpec` (register/formality/terminology/punctuation/length/consistency); `preference` = a genuine coin-flip after spec. *(An optional `severity` ∈ {bug, polish} may ride along as an impact hint — it is not a gate and never routes to a human.)*
- `placeholders_preserved` = the set of `{vars}` is identical before→after. If a fix changes placeholders, it's a red flag — re-derive.
- `resolution` ∈ {change, keep} + `resolvedBy` ∈ {verify, spec, consistency, panel, tiebreak-keep} — **every** row carries exactly one resolution. There is no "escalate" value.

Taxonomy with calibrated real examples and per-language pitfalls live in `reviewer-persona.md`. Hand each reviewer that file + its locale's assembled strings.

## Decision procedure — nothing is human-only

"Taste" is not a category; it is an unfinished decision. Route **every** finding through this ladder — the first rung that resolves it wins, and the last rung always resolves:

1. **Correctness → verify → change.** Grammar/meaning/agreement/placeholder/overflow errors. An independent skeptic confirms (Stage 2, default-reject). Upheld ⇒ `change`.
2. **Spec-governed → decide against the `styleSpec` → change | keep.** Register/formality, terminology, punctuation, number format, length, and **internal consistency** all have an objective answer once the target is written down. Deviates from spec ⇒ `change`; conforms ⇒ `keep`. The spec is **inferred from the corpus** (see below), so this needs no human.
   - *Consistency is not taste.* "This string says `Euroraum`, eleven siblings say `Eurozone`" resolves by **majority in-locale usage / termbase** → `change` toward the dominant form. Detect it mechanically where you can.
3. **Genuine preference → panel → change | keep.** Only what survives 1–2: two options both native, both on-spec, both consistent. Run a **small panel of independent native reviewers**. Converge on one ⇒ `change`. **Split ⇒ tie-break to `keep-current`** — never churn shipped copy on a wash, and never ask. Log the tie; if it recurs, promote the rule into the `styleSpec` so the system gets *more* decisive over time.

**The `styleSpec` (per locale).** The few genuine brand choices — formality register, preferred terms, quote/number/percent conventions, sentence-length norms — are decided **once** here, not re-litigated per string every run. With `"infer": true`, the pipeline **bootstraps the spec from the existing (shipped, presumed-approved) corpus**: it detects the dominant register (e.g. formal *Sie* / *vous*), the majority rendering of each termbase concept, and the punctuation/number conventions actually in use, then enforces them. A human's role shrinks to *optionally overriding an inferred value* in `styleSpec.perLocale` — one decision that then resolves hundreds of downstream findings. Everything else is automatic.

The output is a two-way outcome (`change` / `keep`) with a logged `resolvedBy` and rationale — accountability comes from the reason + a trivial `git` revert, not from a human gate. A system that commits to a decision and can explain and undo it beats one that hands you a backlog.

## Setup

1. Copy `localization.config.example.json` → `localization.config.json` in the repo; fill in locales, length budgets, allowlist, live-URL pattern.
2. Copy an adapter from `adapters/` (e.g. `json-catalog.adapter.example.ts` for JSON message files, or `code-module.adapter.example.ts` for TS/JS dictionaries) into the repo and point `"adapter"` at it. The adapter exports `referenceLocale` + `layers` (each: `locales[]` + `load(locale) → flat string record`). Pure imports only (no server-only/DB) so the validator loads under bun.
3. Run the gate: `bun run ~/.claude/skills/native-localization-review/scripts/validate-locales.ts --config localization.config.json --json` (requires **bun** — it dynamic-imports your TS adapter). Pure logic is unit-tested in `scripts/gate-core.test.ts` (`bun test`).

## Gate config reference

Knobs in `localization.config.json` (see the example for a filled-in version):

- **`lengthBudgets`** — `[{ keyPattern, max, note }]`, regex → char cap. SERP defaults: ~60 title / ~155–160 description.
- **`identicalToReferenceAllowlist`** — suppresses false "untranslated" hits. A **bare value** (`"API"`, `"HTML"`) is do-not-translate in *every* locale; a **`"locale:value"`** entry (`"de:Newsletter"`, `"fr:Manager"`) is a cognate that's correct in *one* locale only — so it isn't flagged without masking a real gap elsewhere.
- **`placeholderEquivalents`** — `[[...names]]` groups of interchangeable runtime placeholders (e.g. pre-declined name forms `name_nominative/genitive/accusative/…`) collapse to one token, so a locale picking the grammatical case its language needs isn't reported as drift.
- **`styleSpec`** — `{ infer, tieBreak, perLocale }`. With `"infer": true` the pipeline bootstraps each locale's register/termbase/punctuation/number/length conventions from the shipped corpus, so `spec`-class findings resolve without a human. `"tieBreak"` is the genuine-preference default (`"keep-current"` recommended — no churn on a wash). `perLocale` holds the few hand-set brand overrides (e.g. `{ "de": { "formality": "formal" } }`) that take precedence over inference.
- The gate is **ICU-aware**: `plural`/`select` case bodies are not mistaken for variables, and it compares argument **sets** — so differing plural branch counts across locales (Slovak `one/few/many/other` vs English `one/other`) never false-positive.
- **Codegen'd layers** — set `generated` / `editSource` / `regen` in the `layers` block so Stage 5 edits the source + regenerates; wire the generator's `--check` mode into CI to gate staleness.

## Red flags — STOP

- Returning prose instead of structured diff rows → can't approve or apply cleanly. Re-emit as rows.
- A fix that **adds or drops a `{placeholder}`** → almost always wrong; re-derive.
- **Adding length** to a `*MetaDescription`/`*MetaTitle` key → check the length budget first; meta strings shrink, they don't grow.
- Reviewing strings **in isolation** (key-by-key) → register and cohesion are invisible without the page context. Assemble first.
- Editing a file with an `AUTO-GENERATED … Do NOT hand-edit` banner → edit the source + regenerate.
- **Escalating a finding to the human instead of resolving it** → there is no "human-only" bucket. Route it through the [decision procedure](#decision-procedure--nothing-is-human-only); a genuine tie resolves to `keep-current`, not to a question.
- **Churning shipped copy on a wash** → if two options are equally native, on-spec, and consistent, `keep-current`. A `change` must beat the original on a stated rule, not just differ from it.

## Common mistakes

- **Side-by-side from the start** biases toward "faithful" over "natural". Read target-only first.
- **Skipping the mechanical gate** burns reviewer tokens on missing-key/placeholder noise a script catches for free.
- **One reviewer for all locales** — no single agent holds native fluency in 18 languages at once. One subagent per locale.
