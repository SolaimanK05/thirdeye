import { POSITION_STRIDE, Propagator } from "./propagator";
import type { WorkerRequest, WorkerResponse } from "./protocol";

export type Post = (message: WorkerResponse, transfer: Transferable[]) => void;

export class SatelliteService {
  private readonly propagator = new Propagator();
  private announce = true;
  private readonly post: Post;

  constructor(post: Post) {
    this.post = post;
  }

  handle(request: WorkerRequest): void {
    try {
      if (request.type === "load") this.load(request);
      else if (request.type === "tick") this.tick(request);
      else this.clear();
    } catch (error) {
      this.post(
        {
          type: "failed",
          message: error instanceof Error ? error.message : String(error),
        },
        [],
      );
    }
  }

  private load({ elements }: Extract<WorkerRequest, { type: "load" }>): void {
    const result = this.propagator.load(elements);
    this.announce = true;
    this.post({ type: "loaded", ...result }, []);
  }

  private clear(): void {
    this.propagator.clear();
    this.announce = true;
  }

  private tick(request: Extract<WorkerRequest, { type: "tick" }>): void {
    const needed = Math.max(1, this.propagator.count) * POSITION_STRIDE;
    const positions =
      request.recycle !== null && request.recycle.length >= needed
        ? request.recycle
        : new Float64Array(needed);
    const { written, dropped } = this.propagator.fill(request.atMs, positions);
    const send = this.announce || dropped > 0;
    this.announce = false;
    this.post(
      {
        type: "frame",
        atMs: request.atMs,
        count: written,
        positions,
        ids: send ? [...this.propagator.idList] : null,
        sample:
          request.selected === null
            ? null
            : this.propagator.sample(request.selected, request.atMs),
      },
      [positions.buffer],
    );
  }
}
