import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearsSelection } from "./hotkeys";

class FakeElement {
  isContentEditable = false;
  constructor(
    readonly tagName: string,
    private readonly attributes: Record<string, string> = {},
  ) {}
  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }
}

function escapeKey(over: Partial<KeyboardEvent> = {}, tag = "DIV") {
  return {
    key: "Escape",
    repeat: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    target: new FakeElement(tag),
    ...over,
  } as unknown as KeyboardEvent;
}

describe("clearsSelection", () => {
  beforeEach(() => vi.stubGlobal("HTMLElement", FakeElement));
  afterEach(() => vi.unstubAllGlobals());

  test("a plain Escape clears the selection", () => {
    expect(clearsSelection(escapeKey(), null)).toBe(true);
  });

  test("Escape inside a text field is left to the field", () => {
    expect(clearsSelection(escapeKey({}, "INPUT"), null)).toBe(false);
  });

  test("Escape that something already handled is left alone", () => {
    expect(clearsSelection(escapeKey({ defaultPrevented: true }), null)).toBe(
      false,
    );
  });

  test("Escape goes to an open menu or list first", () => {
    const open = new FakeElement("BUTTON", { "aria-expanded": "true" });
    expect(clearsSelection(escapeKey(), open as unknown as Element)).toBe(
      false,
    );
    const closed = new FakeElement("BUTTON", { "aria-expanded": "false" });
    expect(clearsSelection(escapeKey(), closed as unknown as Element)).toBe(
      true,
    );
  });

  test("other keys and modified Escape do nothing", () => {
    expect(clearsSelection(escapeKey({ key: "Enter" }), null)).toBe(false);
    expect(clearsSelection(escapeKey({ ctrlKey: true }), null)).toBe(false);
  });
});
