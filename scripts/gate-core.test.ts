// Unit tests for the pure gate core. Run: bun test (from this dir or the skill root).
import { expect, test, describe } from "bun:test";
import { placeholders, flatten, bracesBalanced, eqSorted, makePlaceholderNormalizer } from "./gate-core";

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
});

describe("bracesBalanced()", () => {
  test("balanced", () => expect(bracesBalanced("{a} and {b, plural, one {x} other {y}}")).toBe(true));
  test("missing close", () => expect(bracesBalanced("{label} von {hi bis {lo}")).toBe(false));
  test("stray close", () => expect(bracesBalanced("a} b")).toBe(false));
});

describe("flatten()", () => {
  test("nested objects → dotted keys, string leaves only", () => {
    expect(flatten({ economy: { lead: "hi", nested: { q: "x" } }, n: 3 })).toEqual({
      "economy.lead": "hi",
      "economy.nested.q": "x",
    });
  });
});

describe("makePlaceholderNormalizer()", () => {
  const norm = makePlaceholderNormalizer([["country_nom", "country_gen", "country_dat", "prep"]]);
  test("case-form swap collapses to one group token (no drift)", () => {
    // en uses nominative, lt uses genitive — same underlying supplied value.
    expect(eqSorted(norm(placeholders("{country_nom}: {rate}")), norm(placeholders("{country_gen}: {rate}")))).toBe(true);
  });
  test("non-grouped args pass through unchanged", () => {
    expect(norm(["rate", "country_nom"])).toEqual(["rate", "§0"].sort());
  });
  test("no groups configured → identity", () => {
    const id = makePlaceholderNormalizer(undefined);
    expect(id(["b", "a"])).toEqual(["b", "a"]);
  });
});
