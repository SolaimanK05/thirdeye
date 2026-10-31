import { aircraftRefine, FEET_PER_METRE } from "@/modules/aircraft/refine";
import { passes, type RefineSpec, type RefineValues } from "@/modules/refine";
import {
  SHIP_TYPES,
  UNKNOWN_TYPE,
  vesselRefine,
} from "@/modules/vessels/refine";
import type { Mirror } from "./mirror";

/**
 * Column versions of the per-module refine readers. They answer exactly what
 * the row versions in modules/<id>/refine.ts answer (a parity test checks it),
 * but read straight from the mirror by slot, so filtering 50,000 movers makes
 * no objects.
 */
type SlotReaders = Readonly<
  Record<string, (mirror: Mirror, slot: number) => number | string | null>
>;

const READERS: Readonly<Record<string, SlotReaders>> = {
  aircraft: {
    altitude: (mirror, slot) => {
      if (mirror.onGround(slot)) return 0;
      const alt = mirror.alt[slot];
      return Number.isNaN(alt) ? null : alt * FEET_PER_METRE;
    },
  },
  vessels: {
    type: (mirror, slot) => {
      const index = mirror.cls[slot];
      return index >= 1 && index <= SHIP_TYPES.length
        ? SHIP_TYPES[index - 1].value
        : UNKNOWN_TYPE;
    },
    speed: (mirror, slot) => {
      const sog = mirror.sog[slot];
      return Number.isNaN(sog) ? null : sog;
    },
  },
};

const CONTROLS: Readonly<Record<string, RefineSpec<never>["controls"]>> = {
  aircraft: aircraftRefine.controls,
  vessels: vesselRefine.controls,
};

export type SlotFilter = (slot: number) => boolean;

/**
 * A predicate over slots for one module and one set of refine values, or null
 * when the module has no refine controls (everything passes).
 */
export function slotFilter(
  moduleId: string,
  mirror: Mirror,
  values: RefineValues,
  nowMs: number,
): SlotFilter | null {
  const controls = CONTROLS[moduleId];
  const readers = READERS[moduleId];
  if (controls === undefined || readers === undefined) return null;
  const spec: RefineSpec<number> = {
    controls,
    read: Object.fromEntries(
      Object.entries(readers).map(([id, read]) => [
        id,
        (slot: number) => read(mirror, slot),
      ]),
    ),
  };
  return (slot) => passes(spec, values, slot, nowMs);
}
