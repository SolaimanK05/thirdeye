import { describe, expect, test } from "vitest";
import { element, FALLING_OMM, GEO_OMM, ISS_EPOCH_MS } from "./fixtures";
import { POSITION_STRIDE } from "./propagator";
import type { WorkerResponse } from "./protocol";
import { SatelliteService } from "./service";

type Frame = Extract<WorkerResponse, { type: "frame" }>;

function rig() {
  const sent: { message: WorkerResponse; transfer: Transferable[] }[] = [];
  const service = new SatelliteService((message, transfer) =>
    sent.push({ message, transfer }),
  );
  const frames = (): Frame[] =>
    sent.flatMap(({ message }) => (message.type === "frame" ? [message] : []));
  return { service, sent, frames };
}

const tick = (
  atMs: number,
  extra: { selected?: string; resend?: boolean } = {},
) =>
  ({
    type: "tick",
    atMs,
    selected: extra.selected ?? null,
    recycle: null,
  }) as const;

describe("the satellite service", () => {
  test("reports how many element sets it could use", () => {
    const { service, sent } = rig();
    service.handle({
      type: "load",
      elements: [element("a"), { id: "b", name: null, omm: {} }],
    });
    expect(sent[0].message).toEqual({ type: "loaded", loaded: 1, rejected: 1 });
  });

  test("answers a tick with positions, naming the satellites only the first time", () => {
    const { service, frames } = rig();
    service.handle({
      type: "load",
      elements: [element("a"), element("b", GEO_OMM)],
    });
    service.handle(tick(ISS_EPOCH_MS));
    service.handle(tick(ISS_EPOCH_MS + 1000));
    const [first, second] = frames();
    expect(first.ids).toEqual(["a", "b"]);
    expect(first.count).toBe(2);
    expect(first.positions.length).toBeGreaterThanOrEqual(2 * POSITION_STRIDE);
    expect(second.ids).toBeNull();
  });

  test("names them again after a new load", () => {
    const { service, frames } = rig();
    service.handle({ type: "load", elements: [element("a")] });
    service.handle(tick(ISS_EPOCH_MS));
    service.handle({ type: "load", elements: [element("c", GEO_OMM)] });
    service.handle(tick(ISS_EPOCH_MS + 1000));
    expect(frames()[1].ids).toEqual(["c"]);
  });

  test("names them again when one has decayed", () => {
    const { service, frames } = rig();
    service.handle({
      type: "load",
      elements: [element("a"), element("falling", FALLING_OMM)],
    });
    service.handle(tick(ISS_EPOCH_MS));
    service.handle(tick(ISS_EPOCH_MS + 400 * 24 * 3_600_000));
    const late = frames()[1];
    expect(late.ids).toEqual(["a"]);
    expect(late.count).toBe(1);
  });

  test("describes the selected satellite and nothing else", () => {
    const { service, frames } = rig();
    service.handle({
      type: "load",
      elements: [element("a"), element("b", GEO_OMM)],
    });
    service.handle(tick(ISS_EPOCH_MS, { selected: "a" }));
    service.handle(tick(ISS_EPOCH_MS, { selected: "gone" }));
    service.handle(tick(ISS_EPOCH_MS));
    const [chosen, missing, none] = frames();
    expect(chosen.sample?.id).toBe("a");
    expect(chosen.sample?.altKm).toBeCloseTo(417, 0);
    expect(missing.sample).toBeNull();
    expect(none.sample).toBeNull();
  });

  test("sends an empty set as a frame with room for no one", () => {
    const { service, frames } = rig();
    service.handle(tick(ISS_EPOCH_MS));
    expect(frames()[0].count).toBe(0);
    expect(frames()[0].ids).toEqual([]);
  });

  test("reuses a buffer handed back to it", () => {
    const { service, frames } = rig();
    service.handle({ type: "load", elements: [element("a")] });
    service.handle(tick(ISS_EPOCH_MS));
    const spare = frames()[0].positions;
    service.handle({ ...tick(ISS_EPOCH_MS + 1000), recycle: spare });
    expect(frames()[1].positions).toBe(spare);
  });

  test("does not reuse a buffer that is too small", () => {
    const { service, frames } = rig();
    service.handle({ type: "load", elements: [element("a"), element("b")] });
    const small = new Float64Array(POSITION_STRIDE);
    service.handle({ ...tick(ISS_EPOCH_MS), recycle: small });
    expect(frames()[0].positions).not.toBe(small);
    expect(frames()[0].positions.length).toBeGreaterThanOrEqual(8);
  });

  test("forgets its satellites on clear", () => {
    const { service, frames } = rig();
    service.handle({ type: "load", elements: [element("a")] });
    service.handle({ type: "clear" });
    service.handle(tick(ISS_EPOCH_MS));
    expect(frames()[0].count).toBe(0);
  });

  test("hands the position buffer over as a transferable", () => {
    const { service, sent } = rig();
    service.handle({ type: "load", elements: [element("a")] });
    service.handle(tick(ISS_EPOCH_MS));
    const frame = sent.find(({ message }) => message.type === "frame");
    if (frame?.message.type !== "frame") throw new Error("no frame");
    expect(frame.transfer).toEqual([frame.message.positions.buffer]);
  });

  test("leaves the sender's buffer empty once it is transferred", () => {
    const { service, sent } = rig();
    service.handle({ type: "load", elements: [element("a")] });
    service.handle(tick(ISS_EPOCH_MS));
    const frame = sent.find(({ message }) => message.type === "frame");
    if (frame?.message.type !== "frame") throw new Error("no frame");
    const { positions } = frame.message;
    const size = positions.byteLength;
    expect(size).toBeGreaterThan(0);
    const received = structuredClone(frame.message, {
      transfer: frame.transfer,
    });
    expect(positions.byteLength).toBe(0);
    expect(received.type === "frame" && received.positions.byteLength).toBe(
      size,
    );
  });

  test("reports a failure instead of throwing", () => {
    const { service, sent } = rig();
    service.handle({ type: "load", elements: null as never });
    expect(sent[0].message.type).toBe("failed");
  });
});
