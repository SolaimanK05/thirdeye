import type { WorkerPort } from "./client";

export function createSatelliteWorker(): WorkerPort {
  return new Worker(new URL("../../workers/sgp4.worker.ts", import.meta.url), {
    type: "module",
  });
}
