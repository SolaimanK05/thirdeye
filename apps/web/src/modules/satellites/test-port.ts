import type { WorkerPort } from "./client";
import type { WorkerRequest, WorkerResponse } from "./protocol";
import { SatelliteService } from "./service";

type Listener = (event: MessageEvent<WorkerResponse>) => void;

export class InProcessPort implements WorkerPort {
  readonly requests: WorkerRequest[] = [];
  readonly sentBuffers: ArrayBuffer[] = [];
  terminated = false;
  holdReplies = false;
  private readonly listeners = new Set<Listener>();
  private readonly held: WorkerResponse[] = [];
  private readonly service = new SatelliteService((message, transfer) =>
    this.reply(message, transfer),
  );

  postMessage(message: WorkerRequest, transfer: Transferable[]): void {
    this.requests.push(message);
    for (const item of transfer) {
      if (item instanceof ArrayBuffer) this.sentBuffers.push(item);
    }
    const copy = structuredClone(message, { transfer });
    this.service.handle(copy);
  }

  terminate(): void {
    this.terminated = true;
    this.listeners.clear();
  }

  addEventListener(_type: "message", listener: Listener): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "message", listener: Listener): void {
    this.listeners.delete(listener);
  }

  flush(): void {
    for (const message of this.held.splice(0)) this.deliver(message);
  }

  private reply(message: WorkerResponse, transfer: Transferable[]): void {
    const copy = structuredClone(message, { transfer });
    if (this.holdReplies) this.held.push(copy);
    else this.deliver(copy);
  }

  private deliver(message: WorkerResponse): void {
    for (const listener of this.listeners) {
      listener({ data: message } as MessageEvent<WorkerResponse>);
    }
  }
}
