import {
  aircraftAltitudeFeet,
  shipSizeClass,
  shipTypeAt,
} from "@/modules/importance";
import type { Mirror } from "./mirror";

type SlotImportance = (slot: number) => number;

/**
 * The data worker's version of modules/importance: how much a mover matters
 * when a draw limit has to leave some out, read straight from the mirror's
 * columns. Modules without a measure return null and rank by slot order.
 */
export function slotImportance(
  moduleId: string,
  mirror: Mirror,
): SlotImportance | null {
  switch (moduleId) {
    case "aircraft":
      return (slot) =>
        aircraftAltitudeFeet(
          mirror.onGround(slot),
          Number.isNaN(mirror.alt[slot]) ? null : mirror.alt[slot],
        );
    case "vessels":
      return (slot) => shipSizeClass(shipTypeAt(mirror.cls[slot]));
    default:
      return null;
  }
}
