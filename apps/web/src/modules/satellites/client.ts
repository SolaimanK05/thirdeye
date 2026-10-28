import type { RawElement } from "./propagator";
import type { WorkerRequest, WorkerResponse } from "./protocol";

export type WorkerPort = {
  postMessage: (message: WorkerRequest, transfer: Transferable[]) => void;
  terminate: () => void;
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<WorkerResponse>) => void,
  ) => void;
  removeEventListener: (
    type: "message",
    listener: (event: MessageEvent<WorkerResponse>) => void,
  ) => void;
};

export type TickOptions = {
  atMs: number;
  selected: string | null;
};

export type FrameMessage = Extract<WorkerResponse, { type: "frame" }>;

export class SatelliteClient {
  private readonly port: WorkerPort;
  private readonly listener: (event: MessageEvent<WorkerResponse>) => void;
  private spare: Float64Array | null = null;
  private waiting = false;
  private closed = false;

  constructor(port: WorkerPort, onMessage: (message: WorkerResponse) => void) {
    this.port = port;
    this.listener = (event) => {
      if (event.data.type === "frame" || event.data.type === "failed") {
        this.waiting = false;
      }
      onMessage(event.data);
    };
    port.addEventListener("message", this.listener);
  }

  get busy(): boolean {
    return this.waiting;
  }

  load(elements: readonly RawElement[]): void {
    if (this.closed) return;
    this.port.postMessage({ type: "load", elements }, []);
  }

  clear(): void {
    if (this.closed) return;
    this.port.postMessage({ type: "clear" }, []);
  }

  tick({ atMs, selected }: TickOptions): boolean {
    if (this.closed || this.waiting) return false;
    const recycle = this.spare;
    this.spare = null;
    this.waiting = true;
    this.port.postMessage(
      { type: "tick", atMs, selected, recycle },
      recycle === null ? [] : [recycle.buffer],
    );
    return true;
  }

  release(positions: Float64Array): void {
    if (!this.closed && positions.buffer.byteLength > 0) {
      this.spare = positions;
    }
  }

  terminate(): void {
    if (this.closed) return;
    this.closed = true;
    this.port.removeEventListener("message", this.listener);
    this.port.terminate();
  }
}
