import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { CountHint, countHint } from "./count-hint";

describe("the count hint", () => {
  test("says the number is what is in view while the layer is drawn", () => {
    const text = countHint("Aircraft", 120);
    expect(text).toContain("in view now");
    expect(text).toContain("filters");
    expect(text).toContain("full total");
  });

  test("says the number is the whole total while the layer is not drawn", () => {
    const text = countHint("Aircraft", undefined);
    expect(text).toContain("Everything the server holds");
    expect(text).not.toContain("in view now");
  });

  test("is a named button, so a keyboard or screen reader can reach it", () => {
    const markup = renderToStaticMarkup(
      <CountHint name="Aircraft" inView={5} />,
    );
    expect(markup).toContain('aria-label="What the aircraft number means"');
    expect(markup).toContain("<button");
  });
});
