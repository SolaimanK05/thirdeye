import { describe, expect, test } from "vitest";
import { SatelliteClient } from "./client";
import { element, ISS_EPOCH_MS } from "./fixtures";
import type { WorkerResponse } from "./protocol";
import { InProcessPort } from "./test-port";

function rig() {
  const port = new InProcessPort();
  const received: WorkerResponse[] = [];
  const client = new SatelliteClient(port, (message) => received.push(message));
  return { port, client, received };
}

const frames = (received: WorkerResponse[]) =>
  received.flatMap((m) => (m.type === "frame" ? [m] : []));

describe("the satellite client", () => {
  test("passes the answers on", () => {
    const { client, received } = rig();
    client.load([element("a")]);
    client.tick({ atMs: ISS_EPOCH_MS, selected: null });
    expect(received.map((m) => m.type)).toEqual(["loaded", "frame"]);
  });

  test("allows one tick at a time", () => {
    const { client, port, received } = rig();
    port.holdReplies = true;
    client.load([element("a")]);
    expect(client.tick({ atMs: ISS_EPOCH_MS, selected: null })).toBe(true);
    expect(client.busy).toBe(true);
    expect(client.tick({ atMs: ISS_EPOCH_MS + 1000, selected: null })).toBe(
      false,
    );
    port.flush();
    expect(client.busy).toBe(false);
    expect(client.tick({ atMs: ISS_EPOCH_MS + 2000, selected: null })).toBe(
      true,
    );
    expect(frames(received)).toHaveLength(1);
  });

  test("sends a released buffer back with the next tick, which detaches it", () => {
    const { client, port, received } = rig();
    client.load([element("a")]);
    client.tick({ atMs: ISS_EPOCH_MS, selected: null });
    const [first] = frames(received);
    client.release(first.positions);
    client.tick({ atMs: ISS_EPOCH_MS + 1000, selected: null });
    expect(first.positions.byteLength).toBe(0);
    expect(port.sentBuffers).toHaveLength(1);
    expect(frames(received)).toHaveLength(2);
  });

  test("does not keep a buffer that has already been sent away", () => {
    const { client, port, received } = rig();
    client.load([element("a")]);
    client.tick({ atMs: ISS_EPOCH_MS, selected: null });
    const [first] = frames(received);
    structuredClone(first.positions, { transfer: [first.positions.buffer] });
    client.release(first.positions);
    client.tick({ atMs: ISS_EPOCH_MS + 1000, selected: null });
    expect(port.sentBuffers).toHaveLength(0);
  });

  test("stops talking once terminated", () => {
    const { client, port, received } = rig();
    client.terminate();
    client.load([element("a")]);
    client.clear();
    expect(client.tick({ atMs: ISS_EPOCH_MS, selected: null })).toBe(false);
    expect(port.requests).toEqual([]);
    expect(port.terminated).toBe(true);
    expect(received).toEqual([]);
  });

  test("a failure frees the client for the next tick", () => {
    const { client, port } = rig();
    port.holdReplies = true;
    client.tick({ atMs: ISS_EPOCH_MS, selected: null });
    expect(client.busy).toBe(true);
    port.flush();
    client.load(null as never);
    port.flush();
    expect(client.busy).toBe(false);
  });
});
