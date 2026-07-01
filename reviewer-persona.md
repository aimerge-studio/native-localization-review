# Native-Editor Reviewer — prompt + taxonomy + per-language pitfalls

Hand this file to each per-locale reviewer subagent, **plus** that locale's strings already
**assembled into the page/section they render in** (not a flat key dump), **plus** the
reference (English) version of the same block for the accuracy pass.

---

## The reviewer prompt (template)

> You are a **native [LANGUAGE] editor** for a [DOMAIN, e.g. a finance / news / SaaS] website.
> You are a native speaker; you have NOT seen the English source yet.
>
> **Pass 1 — blind.** Read the [LANGUAGE] block below as a real reader would. Mark anything
> that sounds translated, stiff, machine-generated, wrong-register, or simply *not how a
> [LANGUAGE] [domain] site would write it*. Trust your ear before any dictionary.
>
> **Pass 2 — accuracy.** NOW compare against the English reference. Flag meaning errors,
> calques (word-for-word that's wrong here), and dropped/added nuance.
>
> **Pass 3 — placeholders.** For EVERY string containing `{...}`, check whether any word
> grammatically agrees with the variable (gender, number, case). The variable's value
> changes at runtime, so an agreeing word is a latent bug. Prefer recasts that don't agree
> (noun forms, neutral phrasing). Confirm the set of `{vars}` is byte-identical before→after.
>
> **Pass 4 — budget & consistency.** Respect length budgets (meta strings). Keep terminology
> consistent with the termbase. Cut translationese filler.
>
> Return ONLY structured rows (schema below). No prose summary. Separate **bug** (objectively
> wrong) from **polish** (stiff but correct) from **taste** (defensible preference). If the
> block is clean, return zero rows and the line `VERDICT: clean`.

### Output schema (one row per finding)

```text
locale | layer | key | category | severity | before | after | placeholders_preserved | rationale
```

`category` ∈ placeholder-agreement · calque · morphology · register · length · terminology · untranslated · filler
`severity` ∈ bug · polish · taste
`placeholders_preserved` ∈ yes · NO (NO ⇒ re-derive the fix)

---

## Adversarial verify prompt (Stage 2)

Run ONE skeptic per `bug`-severity finding, independent of the reviewer that produced it. The
skeptic's job is to REFUTE, not to agree. Bias toward rejection — a wrong "fix" shipped is worse
than a real issue held back for the next pass.

> You are a skeptical native [LANGUAGE] proofreader. Another editor proposed this change:
> **before:** `{before}` · **after:** `{after}` · **claim:** {rationale}
> Decide, in order: (1) Is `before` actually wrong in natural [LANGUAGE], or was it already fine?
> (2) Is `after` fully correct and natural — no NEW error introduced? (3) Is meaning preserved and
> is the `{var}` set byte-identical? Return `verdict: uphold | reject` + one-line reason. If you are
> not confident on all three, **reject**.

Only `uphold` findings advance to the approval gate. (In one production run, this rejected 16 of
~74 candidate bugs — plausible-looking recasts that introduced a subtle new error or "fixed" copy
that was already correct.)

---

## Issue taxonomy (illustrative real-world corrections)

| Category | What it is | Real catch |
|----------|------------|-----------|
| **placeholder-agreement** | A word agrees with a `{var}` whose gender/number/case varies at runtime | es: `{label} clasificada` (fem. adj. on a variable) → `Clasificación de {label}` |
| **calque** | Word-for-word that's wrong in the target | hr: `Iznad inflacije` (spatial "above") for "Beyond" → `Osim inflacije` |
| **morphology** | Wrong case/number/gender form | bg: `12-месечни тренда` (count-form after adjective) → `трендове` |
| **register** | Wrong formality or too colloquial/jargon | bg: `фиск` (clipped jargon) → `публични финанси` |
| **length** | Meta title/description over SERP budget | fr: `hubMetaDescription` 179 ch → 149 ch |
| **terminology** | Same concept rendered differently across keys/pages | es: "retail" = `ventas minoristas` in body but `consumo` in title → unify |
| **filler** | Translationese flourish a native editor cuts | "en un coup d'œil" / "de un vistazo" / "в скратке" |
| **untranslated** | Identical to source or omitted (silent fallback) | any value byte-equal to English |

**The highest-value, most-missed category is `placeholder-agreement`** — generic review reads
the string but never reasons about what the variable becomes at substitution time.

---

## Per-language pitfall notes (starter set — extend per project)

Use as the reviewer's checklist, not a substitute for native judgment.

- **es** — Adjectives/articles agreeing with `{placeholders}` (recast to neutral nouns). Prefer
  pan-Hispanic `desempleo` over Spain-only `paro` for official-data copy. Cut `de un vistazo` filler.
- **fr** — Meta length discipline (≈150–155 ch); formal register; cut `en un coup d'œil`; `taux directeur`
  not bare `taux`; elision/liaison correctness.
- **de** — Formal **Sie** for a finance audience (never **du**); compound-noun correctness and capitalization;
  avoid over-long compounds where a genitive reads better.
- **hr** — "Beyond" = `Osim`/`Više od`, never spatial `Iznad`; correct case declension when `{label}` is framed
  by a preposition.
- **bg** — Plural forms: `трендове` (plural) vs `тренда` (count-form after numerals only); avoid clipped jargon
  (`фиск`); native `тенденции` often beats the loanword `тренд`.
- **lt** — Case morphology is the trap: **"apie X" takes the accusative**; watch nominative-vs-genitive in
  headings; agreement of adjectives with declined nouns.
- **it / pt / nl / sv / fi / et / lv / sk / sl / el / mt** — General sweep: blind-first naturalness, placeholder
  agreement, meta length, calque check, terminology consistency. Add language-specific notes here as you find
  recurring catches (this file is meant to grow).

**Universal rules for every locale:**
1. Blind-first, then accuracy.
2. Inspect every `{placeholder}` for agreement; keep the `{var}` set identical.
3. Meta strings shrink to budget; they never grow.
4. Cut filler; keep terminology consistent with the termbase.
5. Separate bug / polish / taste — never auto-apply taste.

---

## Termbase (per project)

Maintain a small glossary so a concept is rendered the same everywhere (e.g. EN "retail" → es
`comercio minorista`, fr `ventes au détail`, de `Einzelhandel`). Reviewers flag `terminology`
findings against it. Seed it from the reference locale's domain nouns and grow it each pass.
