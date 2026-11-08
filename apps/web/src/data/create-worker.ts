import type { WorkerPort } from "./hub";

export function createDataWorker(): WorkerPort {
  return new Worker(new URL("../workers/data.worker.ts", import.meta.url), {
    type: "module",
  });
}
