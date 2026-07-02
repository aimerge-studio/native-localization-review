// Unit tests for the pure gate core. Run: bun test (from this dir or the skill root).
import { expect, test, describe } from "bun:test";
import {
  placeholders, flatten, bracesBalanced, eqSorted, makePlaceholderNormalizer,
  stripIcuQuoted, runGate, type Config, type LayerLike,
} from "./gate-core";

describe("placeholders() — ICU-aware SET extraction", () => {
  test("simple named args", () => {
    expect(placeholders("{name} — {label}: {value}")).toEqual(["label", "name", "value"]);
  });

  test("plain text has no args", () => {
    expect(placeholders("plain text, no vars")).toEqual([]);
  });

  test("whitespace inside braces is tolerated", () => {
    expect(placeholders("{ spaced }")).toEqual(["spaced"]);
  });

  test("plural case bodies are literal text, not args", () => {
    expect(placeholders("{gapAbs, plural, one {point} other {points}}")).toEqual(["gapAbs"]);
  });

  test("select case bodies are literal text, not args", () => {
    expect(
      placeholders("{valence, select, above {over target} below {under target} other {at target}}"),
    ).toEqual(["valence"]);
  });

  test("genuinely-nested args inside case bodies ARE captured", () => {
    expect(placeholders("{n, plural, one {{name} item} other {{name} items}}")).toEqual(["n", "name"]);
  });

  test("offset + explicit selectors are ignored", () => {
    expect(placeholders("{count, plural, offset:1 =0 {none} one {# thing} other {# things}}")).toEqual(["count"]);
  });

  // The regression that motivated the set-vs-multiset fix.
  test("REGRESSION: differing plural branch counts across locales are NOT drift", () => {
    // English: 2 branches; Slovak: 4 branches. A {unit} arg inside each branch appears a
    // different number of times per locale. Under a multiset it would look like drift; as a
    // SET both sides are {count, unit} and correctly match.
    const en = placeholders("{count, plural, one {{unit}} other {{unit}}}");
    const sk = placeholders("{count, plural, one {{unit}} few {{unit}} many {{unit}} other {{unit}}}");
    expect(en).toEqual(["count", "unit"]);
    expect(sk).toEqual(["count", "unit"]);
    expect(eqSorted(en, sk)).toBe(true); // no false-positive drift
  });

  test("real drift (a dropped arg) is still caught", () => {
    const en = placeholders("{label} ranges from {hi} to {lo}");
    const es = placeholders("{label} va desde {hi}"); // dropped {lo}
    expect(eqSorted(en, es)).toBe(false);
  });

  test("unicode argument names are read whole", () => {
    expect(placeholders("{país}: {tasa}")).toEqual(["país", "tasa"]);
  });

  test("apostrophe-quoted literal brace is not an argument", () => {
    expect(placeholders("Add '{' to open, then {name}")).toEqual(["name"]);
  });

  test("escaped apostrophe ('') does not disturb parsing", () => {
    expect(placeholders("l''inflazione è al {rate}")).toEqual(["rate"]);
  });
});

describe("placeholders() — { icu: false } plain-interpolation mode", () => {
  // The motivating regression: Maltese orthography contracts prepositions onto the next word
  // (f'{value} = "at {value}"). In a layer rendered by a plain regex fill, that apostrophe is
  // ordinary text — but ICU semantics read '{ as a quote-open and swallow every placeholder up
  // to the next apostrophe, reporting them as dropped.
  test("REGRESSION: Maltese f'{value} is a live placeholder in a plain layer", () => {
    const mt = "F'{value}, l-inflazzjoni ta' {name} tinsab f'{period}.";
    expect(placeholders(mt)).toEqual(["name"]); // ICU mode: '{ opens a quoted span — args swallowed
    expect(placeholders(mt, { icu: false })).toEqual(["name", "period", "value"]);
  });

  test("apostrophe before a non-syntax char never mattered — same result in both modes", () => {
    expect(placeholders("l'inflation {rate}")).toEqual(["rate"]);
    expect(placeholders("l'inflation {rate}", { icu: false })).toEqual(["rate"]);
  });

  test("plain mode matches exactly what a regex fill substitutes — ICU constructs are not parsed", () => {
    // A plain fill would only replace simple {tokens}; a stray ICU-looking string yields none.
    expect(placeholders("{gapAbs, plural, one {point} other {points}}", { icu: false })).toEqual(["point", "points"]);
    expect(placeholders("{ spaced }", { icu: false })).toEqual(["spaced"]);
    expect(placeholders("{país}: {tasa}", { icu: false })).toEqual(["país", "tasa"]);
  });

  test("bracesBalanced respects the flag: apostrophes are not quotes in plain mode", () => {
    expect(bracesBalanced("F'{value} ta' {name}", { icu: false })).toBe(true);
    // Flip side, documented: a literal-brace string that is legal ICU is unbalanced in plain mode.
    expect(bracesBalanced("Add '{' to open", { icu: false })).toBe(false);
    expect(bracesBalanced("Add '{' to open")).toBe(true);
  });
});

describe("stripIcuQuoted()", () => {
  test("'' collapses to a literal apostrophe", () => {
    expect(stripIcuQuoted("don''t")).toBe("don't");
  });
  test("quoted syntax chars are removed", () => {
    expect(stripIcuQuoted("Add '{' to open")).toBe("Add  to open");
    expect(stripIcuQuoted("'{'x'}'")).toBe("x");
  });
  test("unterminated quote runs to end of string", () => {
    expect(stripIcuQuoted("abc '{def {x}")).toBe("abc ");
  });
  test("lone apostrophe before non-syntax char is literal", () => {
    expect(stripIcuQuoted("l'inflation {rate}")).toBe("l'inflation {rate}");
  });
});

describe("bracesBalanced() — ICU-quote-aware", () => {
  test("balanced", () => expect(bracesBalanced("{a} and {b, plural, one {x} other {y}}")).toBe(true));
  test("missing close", () => expect(bracesBalanced("{label} von {hi bis {lo}")).toBe(false));
  test("stray close", () => expect(bracesBalanced("a} b")).toBe(false));
  test("REGRESSION: legal ICU quoted brace is NOT malformed", () => {
    expect(bracesBalanced("Fuegen Sie '{' hinzu")).toBe(true);
  });
});

describe("flatten()", () => {
  test("nested objects → dotted keys, string leaves only", () => {
    expect(flatten({ economy: { lead: "hi", nested: { q: "x" } }, n: 3 })).toEqual({
      "economy.lead": "hi",
      "economy.nested.q": "x",
    });
  });
  test("REGRESSION: arrays index as key.0/key.1 instead of vanishing", () => {
    expect(flatten({ features: ["Fast", "Cheap"], faq: [{ q: "Why?", a: "Because." }] })).toEqual({
      "features.0": "Fast",
      "features.1": "Cheap",
      "faq.0.q": "Why?",
      "faq.0.a": "Because.",
    });
  });
});

describe("makePlaceholderNormalizer()", () => {
  const norm = makePlaceholderNormalizer([["name_nominative", "name_genitive", "name_dative"]]);
  test("case-form swap collapses to one group token (no drift)", () => {
    expect(eqSorted(norm(placeholders("{name_nominative}: {rate}")), norm(placeholders("{name_genitive}: {rate}")))).toBe(true);
  });
  test("non-grouped args pass through unchanged", () => {
    expect(norm(["rate", "name_nominative"])).toEqual(["rate", "§0"].sort());
  });
  test("no groups configured → identity", () => {
    const id = makePlaceholderNormalizer(undefined);
    expect(id(["b", "a"])).toEqual(["b", "a"]);
  });
});

// ---------------------------------------------------------------------------

describe("runGate()", () => {
  const CONFIG: Config = {
    adapter: "n/a",
    lengthBudgets: [{ keyPattern: "[Mm]etaDescription$", max: 40, note: "SERP" }],
    identicalToReferenceAllowlist: ["API"],
  };

  const mkLayers = (data: Record<string, Record<string, unknown>>): Record<string, LayerLike> => ({
    messages: { locales: Object.keys(data), load: (l) => data[l] },
  });

  test("REGRESSION: unknown --layer throws instead of reporting clean", () => {
    const layers = mkLayers({ en: { a: "x" }, de: { a: "y" } });
    expect(() => runGate(layers, CONFIG, { refLocale: "en", onlyLayer: "typo" })).toThrow(/unknown --layer/);
  });

  test("REGRESSION: unknown --locale throws instead of reporting clean", () => {
    const layers = mkLayers({ en: { a: "x" }, de: { a: "y" } });
    expect(() => runGate(layers, CONFIG, { refLocale: "en", onlyLocale: "xx" })).toThrow(/unknown --locale/);
  });

  test("REGRESSION: reference locale gets length + malformed checks", () => {
    const layers = mkLayers({
      en: { metaDescription: "This reference description is far too long for the budget.", bad: "{oops" },
      de: { metaDescription: "Kurz.", bad: "{oops}" },
    });
    const f = runGate(layers, CONFIG, { refLocale: "en" });
    expect(f.some((x) => x.locale === "en" && x.type === "length")).toBe(true);
    expect(f.some((x) => x.locale === "en" && x.type === "malformed")).toBe(true);
  });

  test("REGRESSION: a missing array element is a coverage finding, not invisible", () => {
    const layers = mkLayers({
      en: { features: ["Fast", "Cheap"] },
      de: { features: ["Schnell"] },
    });
    const f = runGate(layers, CONFIG, { refLocale: "en" });
    expect(f.some((x) => x.locale === "de" && x.key === "features.1" && x.type === "coverage")).toBe(true);
  });

  test("one locale's load() failure is an adapter-error finding; the run continues", () => {
    const layers: Record<string, LayerLike> = {
      messages: {
        locales: ["en", "de", "fr"],
        load: (l) => { if (l === "de") throw new Error("boom"); return { a: l === "en" ? "hello" : "bonjour" }; },
      },
    };
    const f = runGate(layers, CONFIG, { refLocale: "en" });
    expect(f.some((x) => x.locale === "de" && x.type === "adapter-error" && x.severity === "error")).toBe(true);
    expect(f.some((x) => x.locale === "fr")).toBe(false); // fr translated fine → no findings
  });

  test("coverageIgnoreKeyPatterns: i18next plural suffixes don't false-positive", () => {
    const layers = mkLayers({
      en: { greeting_one: "One item", greeting_other: "Many items" },
      ja: { greeting_other: "アイテム" }, // Japanese legitimately has no _one form
    });
    const cfg: Config = { ...CONFIG, coverageIgnoreKeyPatterns: ["_(zero|one|two|few|many)$"] };
    const f = runGate(layers, cfg, { refLocale: "en" });
    expect(f.filter((x) => x.type === "coverage")).toEqual([]); // _one ignored, _other present
  });

  test("allowlisted identical value is not flagged untranslated; others are", () => {
    const layers = mkLayers({ en: { k1: "API", k2: "Welcome" }, de: { k1: "API", k2: "Welcome" } });
    const f = runGate(layers, CONFIG, { refLocale: "en" });
    expect(f.some((x) => x.key === "k1" && x.type === "untranslated")).toBe(false);
    expect(f.some((x) => x.key === "k2" && x.type === "untranslated")).toBe(true);
  });

  test("placeholder drift across locales is an error finding", () => {
    const layers = mkLayers({ en: { k: "{a} to {b}" }, de: { k: "{a} nur" } });
    const f = runGate(layers, CONFIG, { refLocale: "en" });
    expect(f.some((x) => x.type === "placeholder" && x.severity === "error")).toBe(true);
  });

  test("REGRESSION: icu:false layer — Maltese apostrophes are not drift; default ICU layer flags them", () => {
    const data = {
      en: { a2on: "At {value}, {name} is exactly on target." },
      mt: { a2on: "F'{value}, {name} tinsab eżattament fil-mira." }, // same {value}{name} set at runtime
    };
    const mkWith = (icu?: boolean): Record<string, LayerLike> => ({
      answer: { locales: Object.keys(data), load: (l) => data[l as keyof typeof data], ...(icu === undefined ? {} : { icu }) },
    });
    // Plain-interpolation layer: no drift — the runtime regex fill sees both placeholders.
    expect(runGate(mkWith(false), CONFIG, { refLocale: "en" }).filter((x) => x.type === "placeholder")).toEqual([]);
    // Default (ICU) layer: '{ swallows {value} → drift error, as ICU semantics demand.
    expect(runGate(mkWith(), CONFIG, { refLocale: "en" }).some((x) => x.type === "placeholder" && x.severity === "error")).toBe(true);
  });
});
