import type { WorkerRequest } from "@/modules/satellites/protocol";
import { SatelliteService } from "@/modules/satellites/service";

const service = new SatelliteService((message, transfer) =>
  postMessage(message, { transfer }),
);

addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  service.handle(event.data);
});
