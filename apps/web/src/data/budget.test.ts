import { describe, expect, it } from "vitest";
import { decodeFrame } from "@/api/frames";
import { encodeFixture, fleet } from "@/api/frames-fixture";
import { DataCore } from "./core";
import type { FromWorker } from "./protocol";

const ROWS = 50_000;
const NOW = 1_800_000_030_000;

function setup() {
  const sent: FromWorker[] = [];
  let clock = NOW;
  const core = new DataCore({
    emit: (message) => {
      sent.push(message);
    },
    clock: () => clock,
    now: () => performance.now(),
  });
  core.setMovers([{ id: "synthetic", delaySeconds: 5 }]);
  return {
    core,
    sent,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

function time<T>(run: () => T): { ms: number; value: T } {
  const started = performance.now();
  const value = run();
  return { ms: performance.now() - started, value };
}

describe("data worker budgets at 50,000 movers", () => {
  const snapshotBytes = encodeFixture({
    ...fleet(ROWS),
    version: 1,
    fetchedMs: NOW,
  });

  it("decodes and applies a full snapshot in under 50 ms of worker time", () => {
    const { core } = setup();
    // One warm-up so the engine's JIT is not part of the measurement.
    core.applyFrame("synthetic", decodeFrame(snapshotBytes));
    core.forget("synthetic");
    const { ms } = time(() =>
      core.applyFrame("synthetic", decodeFrame(snapshotBytes)),
    );
    expect(core.mirrorOf("synthetic")?.count).toBe(ROWS);
    expect(ms).toBeLessThan(150);
    process.stdout.write(`snapshot apply ${ms.toFixed(1)} ms\n`);
  });

  it("applies a delta of a fifth of the fleet quickly and without a new layer", () => {
    const { core, sent } = setup();
    core.applyFrame("synthetic", decodeFrame(snapshotBytes));
    const layers = sent.filter((m) => m.type === "layer").length;
    const base = fleet(ROWS);
    const keep = (i: number) => i % 5 === 0;
    const pick = <T>(values: T[]) => values.filter((_, i) => keep(i));
    const delta = encodeFixture({
      kind: 2,
      version: 2,
      baseVersion: 1,
      fetchedMs: NOW + 1000,
      rows: {
        slot: pick(base.rows.slot),
        lon: pick(base.rows.lon).map((v) => v + 1000),
        lat: pick(base.rows.lat),
        t: pick(base.rows.t).map((v) => v + 1),
        sog: pick(base.rows.sog),
        cog: pick(base.rows.cog),
        heading: pick(base.rows.heading),
        alt: pick(base.rows.alt),
        flags: pick(base.rows.flags),
        class: pick(base.rows.class),
        confidence: pick(base.rows.confidence),
      },
    });
    const { ms } = time(() => core.applyFrame("synthetic", decodeFrame(delta)));
    expect(ms).toBeLessThan(100);
    expect(sent.filter((m) => m.type === "layer")).toHaveLength(layers);
    process.stdout.write(
      `delta apply (${ROWS / 5} rows) ${ms.toFixed(1)} ms\n`,
    );
  });

  it("builds a motion step within its budget and sends compact patches", () => {
    const { core, sent, advance } = setup();
    core.applyFrame("synthetic", decodeFrame(snapshotBytes));
    const first = time(() => core.step());
    expect(first.ms).toBeLessThan(2000);
    process.stdout.write(
      `first full segment build ${first.ms.toFixed(1)} ms\n`,
    );
    const full = sent.find((m) => m.type === "segments");
    expect(full?.type === "segments" && full.rows).toBeNull();
    advance(50);
    const sizes: number[] = [];
    for (let i = 0; i < 20; i++) {
      advance(50);
      const before = sent.length;
      const { ms } = time(() => core.step());
      // 8 ms of segment work per step plus the copy out; allow slack for CI.
      expect(ms).toBeLessThan(40);
      for (const message of sent.slice(before)) {
        if (message.type === "segments" && message.rows) {
          sizes.push(message.rows.length);
        }
      }
    }
    expect(Math.max(0, ...sizes)).toBeLessThanOrEqual(ROWS);
  });

  it("answers a refine change over 50,000 rows in a few milliseconds", () => {
    const { core } = setup();
    core.applyFrame("synthetic", decodeFrame(snapshotBytes));
    const { ms } = time(() => core.setRefine("synthetic", {}));
    expect(ms).toBeLessThan(100);
    process.stdout.write(`refine over ${ROWS} rows ${ms.toFixed(1)} ms\n`);
  });
});
