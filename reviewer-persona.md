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
> **Pass 4 — spec & consistency.** Check register/formality, terminology, punctuation, number
> format, and length against the **styleSpec for this locale** (supplied below — it was inferred
> from your locale's existing corpus). Flag any string that deviates from the spec, and any term
> rendered inconsistently across keys. Cut translationese filler.
>
> Return ONLY structured rows (schema below). No prose summary. Tag each finding's **class**:
> `correctness` (objectively wrong), `spec` (deviates from the styleSpec — register/term/
> punctuation/length/consistency/**filler**), or `preference` (a genuine coin-flip once spec is
> satisfied). **Filler/naturalness routing:** if you can NAME the rule the string violates — a
> filler phrase on the spec's blocklist or in the per-language pitfall notes, a documented calque
> pattern, a register convention — it is `spec`. If it merely "reads stiff" and you cannot cite a
> rule, it is `preference` (the panel decides; do not silently drop it). Do **not** self-adjudicate
> a `preference` and do **not** drop it as "taste" — emit it; a panel resolves it, ties keep the
> current string. If the block is clean, return zero rows and `VERDICT: clean`.

### Output schema (one row per finding)

```text
locale | layer | key | category | class | before | after | placeholders_preserved | rationale
```

`category` ∈ placeholder-agreement · meaning · calque · morphology · register · length · terminology · consistency · untranslated · filler
`class` ∈ correctness · spec · preference   (drives which resolver runs — see SKILL.md → Decision procedure)
`placeholders_preserved` ∈ yes · NO (NO ⇒ re-derive the fix)

---

## Adversarial verify prompt (Stage 2)

Run ONE skeptic per `correctness`-class finding, independent of the reviewer that produced it.
(Routing is by `class`, never by the optional severity hint.) The skeptic's job is to REFUTE, not
to agree. Bias toward rejection — a wrong "fix" shipped is worse than a real issue held back for
the next pass.

> You are a skeptical native [LANGUAGE] proofreader. Another editor proposed this change:
> **before:** `{before}` · **after:** `{after}` · **claim:** {rationale}
> Decide, in order: (1) Is `before` actually wrong in natural [LANGUAGE], or was it already fine?
> (2) Is `after` fully correct and natural — no NEW error introduced? (3) Is meaning preserved and
> is the `{var}` set byte-identical? Return `verdict: uphold | reject` + one-line reason. If you are
> not confident on all three, **reject**.

Only `uphold` findings advance. (In one production run, this rejected 16 of ~74 candidate bugs —
plausible-looking recasts that introduced a subtle new error or "fixed" copy that was already correct.)

---

## Resolve `spec` & `preference` findings (Stage 2 — nothing is human-only)

`correctness` findings use the skeptic above. `spec` and `preference` findings resolve WITHOUT a human:

**`spec` — decide against the styleSpec.** The reviewer already compared to the (corpus-inferred)
styleSpec, so the resolution is mechanical: value deviates from spec ⇒ `resolution: change`, `resolvedBy: spec`
(or `consistency` when the rule is "match the majority in-locale rendering / termbase"); value conforms ⇒
`resolution: keep`. No vote needed.

**`preference` — panel vote, then tie-break.** For a genuine coin-flip (both native, both on-spec), run a
small odd panel of native [LANGUAGE] judges. Two rules make the panel worth its cost: **each judge sees the
string IN its assembled section** (the same assemble-first rule as Stage 1 — naturalness out of context is
noise), and **each judge gets a different lens** — identical prompts to the same model produce correlated
votes, i.e. one opinion at three times the price. Standard lenses:

> *(all three receive the assembled section with A or B in place, not the bare pair)*
> **Judge 1 — first-time reader:** You are a native [LANGUAGE] reader seeing this page for the first
> time. Which version reads more natural in context — A or B — or are they truly equivalent?
> **Judge 2 — site editor:** You are the site's [LANGUAGE] copy editor. Which version fits the
> surrounding strings' rhythm and register better — A, B, or equivalent?
> **Judge 3 — back-translator:** Translate both back to [REFERENCE LANGUAGE] mentally. Which one
> preserves the intended meaning with the least translationese residue — A, B, or equivalent?
> Each: answer `A` · `B` · `equivalent` + one-line reason. Judge naturalness only — do not invent
> correctness objections.

Tally — three distinct outcomes, two of them decisions, one a tie:
- **majority for B** ⇒ `change`, `resolvedBy: panel` — the panel decided.
- **majority for A** ⇒ `keep`, `resolvedBy: panel` — also a decision, NOT a tie; no `tie` flag.
- **split or majority `equivalent`** ⇒ `keep`, `resolvedBy: tiebreak-keep`, ledger line gets `"tie": true` —
  the only outcome that counts toward promoting a recurring rule into the `styleSpec`.

Never churn shipped copy on a wash, and never escalate. **Budget note:** when a run has many `preference`
findings, batch them — one panel call can judge all preference pairs for a locale's section at once; don't
spawn 3 agents per string.

---

## Issue taxonomy (illustrative real-world corrections)

| Category | What it is | Real catch |
|----------|------------|-----------|
| **placeholder-agreement** | A word agrees with a `{var}` whose gender/number/case varies at runtime | es: `{label} clasificada` (fem. adj. on a variable) → `Clasificación de {label}` |
| **meaning** | Inverted/wrong sense, or content added/dropped vs the reference | de: `Er stieg` ("it rose") translating "It was unchanged" → `blieb unverändert` |
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
5. Tag each finding's `class` (correctness / spec / preference) and let the resolver decide — every finding ends as `change` or `keep`, never as an open question. A genuine tie keeps the current string.

---

## Termbase (per project)

Maintain a small glossary so a concept is rendered the same everywhere (e.g. EN "retail" → es
`comercio minorista`, fr `ventes au détail`, de `Einzelhandel`). Reviewers flag `terminology`
findings against it. Seed it from the reference locale's domain nouns and grow it each pass.
