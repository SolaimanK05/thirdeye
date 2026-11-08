import { describe, expect, test } from "vitest";
import type { ModuleInfo } from "@/api/client";
import { moversFromKey, moversKey } from "./movers";

function module(id: string, extra: Partial<ModuleInfo> = {}): ModuleInfo {
  return {
    id,
    enabled: true,
    render_delay_seconds: null,
    ...extra,
  } as ModuleInfo;
}

function health(count: number): ModuleInfo["health"] {
  return {
    state: "fresh",
    fetched_at: "2026-10-28T12:00:00Z",
    record_count: count,
    reason: null,
    stale_after_seconds: null,
    cooldown_until: null,
  };
}

describe("which modules move", () => {
  test("lists enabled modules with a render delay", () => {
    const key = moversKey([
      module("aircraft", { render_delay_seconds: 105 }),
      module("vessels", { render_delay_seconds: 180 }),
      module("ports"),
      module("satellites", { enabled: false, render_delay_seconds: 5 }),
    ]);
    expect([...moversFromKey(key)]).toEqual([
      ["aircraft", 105],
      ["vessels", 180],
    ]);
  });

  test("no modules, no movers", () => {
    expect(moversKey(undefined)).toBe("[]");
    expect(moversFromKey(moversKey([])).size).toBe(0);
  });

  test("the key ignores everything but id and delay", () => {
    const before = moversKey([
      module("vessels", {
        render_delay_seconds: 180,
        health: health(100),
      }),
    ]);
    const after = moversKey([
      module("vessels", {
        render_delay_seconds: 180,
        health: health(120),
      }),
    ]);
    expect(after).toBe(before);
  });

  test("the key changes when a module is switched off or its delay changes", () => {
    const on = moversKey([module("aircraft", { render_delay_seconds: 105 })]);
    expect(
      moversKey([
        module("aircraft", { enabled: false, render_delay_seconds: 105 }),
      ]),
    ).not.toBe(on);
    expect(
      moversKey([module("aircraft", { render_delay_seconds: 90 })]),
    ).not.toBe(on);
  });
});
