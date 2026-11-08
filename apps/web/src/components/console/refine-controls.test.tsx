import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { ChoicesControl } from "@/modules/refine";
import type { PickOption } from "@/state/refine-options";
import {
  BULK_CHOICES_FROM,
  ChoicesField,
  matchOptions,
  PICK_ROWS,
  PickField,
} from "./refine-controls";

const control = (count: number): ChoicesControl => ({
  kind: "choices",
  id: "x",
  label: "FLEET",
  short: "FLT",
  options: Array.from({ length: count }, (_, i) => ({
    value: `v${i}`,
    label: `V${i}`,
  })),
  initial: [],
});

const html = (spec: ChoicesControl, value: readonly string[]) =>
  renderToStaticMarkup(
    <ChoicesField control={spec} value={value} onChange={() => undefined} />,
  ).replaceAll("<!-- -->", "");

describe("a choices field", () => {
  test("a short list has no bulk buttons", () => {
    expect(html(control(BULK_CHOICES_FROM - 1), [])).not.toContain(">NONE<");
  });

  test("a long list can be switched all on or all off in one press", () => {
    const markup = html(control(BULK_CHOICES_FROM), ["v0"]);
    expect(markup).toContain(">ALL<");
    expect(markup).toContain(">NONE<");
  });

  test("the all button rests while everything is chosen", () => {
    const spec = control(BULK_CHOICES_FROM);
    const everything = spec.options.map((o) => o.value);
    const markup = html(spec, everything);
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>ALL</);
    expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*>NONE</);
  });
});

describe("a pick field", () => {
  const options: PickOption[] = Array.from({ length: 100 }, (_, i) => ({
    value: `S${i}`,
    label: `Sat ${i}`,
    count: 100 - i,
  }));
  const spec = {
    kind: "pick" as const,
    id: "p",
    label: "OWNER",
    short: "OWN",
    noun: "owner",
    initial: [],
  };

  test("matching ignores case and finds a value by label or code", () => {
    expect(matchOptions(options, "SAT 70").shown.map((o) => o.value)).toEqual([
      "S70",
    ]);
    expect(matchOptions(options, "sat 4 1").shown.map((o) => o.value)).toEqual([
      "S14",
      "S41",
    ]);
    expect(matchOptions(options, "s99").shown).toHaveLength(1);
  });

  test("a long list is cut and says how many were left out", () => {
    const { shown, hidden } = matchOptions(options, "");
    expect(shown).toHaveLength(PICK_ROWS);
    expect(hidden).toBe(100 - PICK_ROWS);
  });

  test("shows every picked value as a removable chip with its count in the list", () => {
    const markup = renderToStaticMarkup(
      <PickField
        control={spec}
        value={["S3"]}
        options={options}
        onChange={() => undefined}
      />,
    ).replaceAll("<!-- -->", "");
    expect(markup).toContain('aria-label="Remove S3"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain(">CLEAR<");
    expect(markup).toContain("60 more, type to narrow");
  });

  test("says so while the list has not loaded", () => {
    const markup = renderToStaticMarkup(
      <PickField
        control={spec}
        value={[]}
        options={[]}
        onChange={() => undefined}
      />,
    );
    expect(markup).toContain("Loading the list");
  });
});
