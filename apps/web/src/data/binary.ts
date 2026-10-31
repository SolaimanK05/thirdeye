import type { ModuleInfo } from "@/api/client";
import type { MoverSpec } from "./protocol";

/**
 * Modules the server sends as binary frames (see `has_frames` in the API's
 * frames module). Everything else keeps using JSON.
 */
export const BINARY_MOVERS: ReadonlySet<string> = new Set([
  "aircraft",
  "vessels",
]);

/** The test-only module of `SYNTHETIC_MOVERS`, drawn only with `?synthetic=1`. */
export const SYNTHETIC_MODULE = "synthetic";
export const SYNTHETIC_DELAY_SECONDS = 5;

export function isBinaryMover(moduleId: string): boolean {
  return BINARY_MOVERS.has(moduleId);
}

export function moverSpecs(
  modules: readonly ModuleInfo[] | undefined,
  synthetic: boolean,
): MoverSpec[] {
  const specs: MoverSpec[] = (modules ?? []).flatMap((module) =>
    module.enabled && isBinaryMover(module.id)
      ? [{ id: module.id, delaySeconds: module.render_delay_seconds ?? 0 }]
      : [],
  );
  if (synthetic) {
    specs.push({
      id: SYNTHETIC_MODULE,
      delaySeconds: SYNTHETIC_DELAY_SECONDS,
    });
  }
  return specs;
}
