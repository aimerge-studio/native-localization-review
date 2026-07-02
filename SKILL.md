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
| 4 | **Review the diff** | Present the **resolved** diff grouped by locale — headed by the ~10-line **inferred styleSpec** for a one-time eyeball (see inference guard), each row marked `change`/`keep` with the rule that decided it (verify / spec / consistency / panel / tie-break). The human reviews *changes*, not open questions; an override writes the generalized rule to `styleSpec.perLocale` **and** the decisions ledger — never just this row. | human |
| 5 | **Apply + verify** | Write `change` edits to **source** files. For codegen'd files, edit the **JSON/source and regenerate** (never the generated file). Re-run Stage 0 + project tests (`bun test`). | cheap |

## Output contract (the discipline that makes it appliable)

Every finding from a reviewer subagent MUST be a structured row, never prose:

```text
locale | layer | key | category | class | before | after | placeholders_preserved | resolution | resolvedBy | rationale
```

- `category` ∈ {placeholder-agreement, meaning, calque, morphology, register, length, terminology, consistency, untranslated, filler} — `meaning` covers inverted/wrong sense and content added or dropped relative to the reference (what Pass 2 exists to catch).
- `class` ∈ {correctness, spec, preference} — **how the finding gets resolved** (see Decision procedure). `correctness` = objectively wrong (grammar/meaning/agreement/placeholder/overflow); `spec` = decided against the `styleSpec` (register/formality/terminology/punctuation/length/consistency/filler); `preference` = a genuine coin-flip after spec. **The routing test for stiffness/filler: can you NAME the rule?** A violation of a nameable rule (spec blocklist, per-language pitfall note, documented calque) is `spec`; unnameable "reads stiff" is `preference`. *(An optional `severity` ∈ {bug, polish} may ride along as an impact hint — it is not a gate and never routes anything.)*
- `placeholders_preserved` = the set of `{vars}` is identical before→after. If a fix changes placeholders, it's a red flag — re-derive.
- `resolution` ∈ {change, keep} + `resolvedBy` ∈ {verify, spec, consistency, panel, tiebreak-keep} — appended by the Stage-2 **resolver** (reviewers emit rows *without* these two columns; the resolver completes them). **Every** final row carries exactly one resolution. There is no "escalate" value.
- **One key, one `after`.** Multiple findings on the same key (e.g. a meaning fix + a register fix) keep their own rows for audit, but **compose into a single `after`** shared by all of them — the string is applied once. The ledger gets **one line per (locale, layer, key, beforeHash)**, `resolvedBy` set to the highest rung that fired (verify > spec/consistency > panel), rationale summarizing all composed findings.
- A `keep`-resolved row **retains the rejected `after`** — that's the audit trail for *why* the skeptic/panel said no, and what not to re-propose next run.

Taxonomy with calibrated real examples and per-language pitfalls live in `reviewer-persona.md`. Hand each reviewer that file + its locale's assembled strings.

## Decision procedure — nothing is human-only

"Taste" is not a category; it is an unfinished decision. Route **every** finding through this ladder — the first rung that resolves it wins, and the last rung always resolves:

1. **Correctness → verify → change.** Grammar/meaning/agreement/placeholder/overflow errors. An independent skeptic confirms (Stage 2, default-reject). Upheld ⇒ `change`.
2. **Spec-governed → decide against the `styleSpec` → change | keep.** Register/formality, terminology, punctuation, number format, length, **filler with a nameable rule** (spec blocklist / per-language pitfall / documented calque pattern), and **internal consistency** all have an objective answer once the target is written down. Deviates from spec ⇒ `change`; conforms ⇒ `keep`. The spec is inferred from the corpus (see below, incl. the guard), so this needs no human.
   - *Consistency is not taste.* "This string says `Euroraum`, eleven siblings say `Eurozone`" resolves by **majority in-locale usage / termbase** → `change` toward the dominant form. Detect it mechanically where you can.
3. **Genuine preference → panel → change | keep.** Only what survives 1–2: two options both native, both on-spec, both consistent — including "reads stiff" with **no nameable rule**. Run a small panel of native judges with **diverse lenses, each seeing the assembled section** (see `reviewer-persona.md` — identical context-free prompts are one opinion at 3× the price). Converge on one ⇒ `change`. **Split ⇒ tie-break to `keep-current`** — never churn shipped copy on a wash, and never ask. Record the tie in the decisions ledger; if it recurs, promote the rule into the `styleSpec` so the system gets *more* decisive over time.

**The `styleSpec` (per locale).** The few genuine brand choices — formality register, preferred terms, quote/number/percent conventions, sentence-length norms, filler blocklist — are decided **once** here, not re-litigated per string every run. With `"infer": true`, the pipeline **bootstraps the spec from the existing corpus**: it detects the dominant register (e.g. formal *Sie* / *vous*), the majority rendering of each termbase concept, and the punctuation/number conventions actually in use, then enforces them. A human's role shrinks to *optionally overriding an inferred value* in `styleSpec.perLocale` — one decision that then resolves hundreds of downstream findings.

**Inference guard — the corpus is guilty until sampled.** This skill's own trigger is a corpus that reads machine-translated, so majority vote over that corpus can enshrine the majority *error* (and the consistency rule would then "fix" correct minority renderings toward the dominant wrong one). Three rules keep inference honest: (1) **emit the inferred spec** as a compact per-locale artifact in the run output and show it in the Stage-4 diff header — the human eyeballs ~10 lines once, the cheapest high-leverage review in the whole run; (2) **cross-check inferred register/terminology against the per-language pitfall notes** (`reviewer-persona.md`) and the reference locale's intent — domain norms outrank corpus majority; (3) if Stage 1 flags a large share of a locale's strings (rule of thumb: >⅓), **suppress inference for that locale** and fall back to `perLocale` values + pitfall notes — a corpus that broken has no authority.

**The decisions ledger (persistence + incrementality).** Append every resolution to `.loc-review/decisions.jsonl` in the target repo — one line per finding: `{locale, layer, key, beforeHash, resolution, resolvedBy, rationale}` (plus `tie: true` on tie-breaks). It is the mechanism behind three promises that are otherwise hand-waving: **(a) re-runs are incremental** — skip any finding whose `(key, beforeHash)` already has a ledger entry, so a second sweep costs a fraction and never flip-flops a prior call; **(b) human overrides persist** — a Stage-4 override writes the generalized rule into `styleSpec.perLocale.<locale>` (config) *and* a ledger line, so the correction outlives the session; **(c) recurring ties get promoted** — 3+ ties on the same rule ⇒ add it to the spec. Commit the ledger with the fixes.

The output is a two-way outcome (`change` / `keep`) with a logged `resolvedBy` and rationale — accountability comes from the reason + the ledger + a trivial `git` revert, not from a human gate. A system that commits to a decision and can explain and undo it beats one that hands you a backlog.

## Setup

1. Copy `localization.config.example.json` → `localization.config.json` in the repo; fill in locales, length budgets, allowlist, live-URL pattern.
2. Copy an adapter from `adapters/` (e.g. `json-catalog.adapter.example.ts` for JSON message files, or `code-module.adapter.example.ts` for TS/JS dictionaries) into the repo and point `"adapter"` at it. The adapter exports `referenceLocale` + `layers` (each: `locales[]` + `load(locale) → flat string record` + optional `icu: false` for layers rendered by plain `{token}` interpolation rather than ICU MessageFormat — otherwise apostrophe-heavy orthographies like Maltese `f'{value}` are parsed as ICU quoting and false-positive as dropped placeholders). Pure imports only (no server-only/DB) so the validator loads under bun.
3. Run the gate: `bun run ~/.claude/skills/native-localization-review/scripts/validate-locales.ts --config localization.config.json --json` (requires **bun** — it dynamic-imports your TS adapter). Pure logic is unit-tested in `scripts/gate-core.test.ts` (`bun test`).

## Gate config reference

Knobs in `localization.config.json` (see the example for a filled-in version):

- **`lengthBudgets`** — `[{ keyPattern, max, note }]`, regex → char cap. SERP defaults: ~60 title / ~155–160 description.
- **`identicalToReferenceAllowlist`** — suppresses false "untranslated" hits. A **bare value** (`"API"`, `"HTML"`) is do-not-translate in *every* locale; a **`"locale:value"`** entry (`"de:Newsletter"`, `"fr:Manager"`) is a cognate that's correct in *one* locale only — so it isn't flagged without masking a real gap elsewhere.
- **`placeholderEquivalents`** — `[[...names]]` groups of interchangeable runtime placeholders (e.g. pre-declined name forms `name_nominative/genitive/accusative/…`) collapse to one token, so a locale picking the grammatical case its language needs isn't reported as drift.
- **`styleSpec`** — `{ infer, tieBreak, perLocale }`. With `"infer": true` the pipeline bootstraps each locale's register/termbase/punctuation/number/length/filler conventions from the shipped corpus **subject to the inference guard above**, so `spec`-class findings resolve without a human. `"tieBreak"` is the genuine-preference default (`"keep-current"` recommended — no churn on a wash). `perLocale` holds the hand-set brand overrides (e.g. `{ "de": { "formality": "formal", "rules": ["..."] } }`) that always outrank inference.
- **`coverageIgnoreKeyPatterns`** — regexes whose *coverage* check is skipped, for keys a locale may legitimately lack. The i18next preset: `"_(zero|one|two|few|many)$"` — Japanese has no `greeting_one`, and that's correct, not a gap. Every other check still runs on keys that exist.
- The gate is **ICU-aware**: `plural`/`select` case bodies are not mistaken for variables, apostrophe-quoted literals (`'{'`, `''`) are respected, argument names may be any Unicode word, and it compares argument **sets** — so differing plural branch counts across locales (Slovak `one/few/many/other` vs English `one/other`) never false-positive. The **reference locale** gets length + malformed checks too (an over-budget `en` meta truncates in the SERP all the same). One locale's `load()` failure is reported as an `adapter-error` finding; the run continues.
- **Exit codes**: `0` clean/warnings · `1` errors (gate the build on this) · `2` config/adapter problem or a **typo'd `--layer`/`--locale`** (an unknown filter is an error, never a silent "clean").
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
