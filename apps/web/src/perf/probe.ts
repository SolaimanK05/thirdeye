import type { PerfSnapshot } from "./metrics";

export type ThirdEyePerf = {
  readonly snapshot: () => PerfSnapshot;
  readonly project: (
    lon: number,
    lat: number,
  ) => { x: number; y: number } | null;
  readonly position: (
    moduleId: string,
    id: string,
  ) => { lon: number; lat: number } | null;
  readonly renderer: "canvas" | "webgl2";
};

export type ProbeHost = { __thirdeyePerf?: ThirdEyePerf };

export function installProbe(host: ProbeHost, probe: ThirdEyePerf): () => void {
  const frozen = Object.freeze({
    snapshot: probe.snapshot,
    project: probe.project,
    position: probe.position,
    get renderer() {
      return probe.renderer;
    },
  });
  host.__thirdeyePerf = frozen;
  return () => {
    if (host.__thirdeyePerf === frozen) delete host.__thirdeyePerf;
  };
}
