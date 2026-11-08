import { cssToRgba } from "./gpu/colour";
import { premultipliedTones } from "./gpu/frame";
import type { MarkerLook } from "./marker-colours";
import type { LayerLook } from "./renderer";

/** A module's look in the forms the two renderers draw with. */
export function buildLayerLook(look: MarkerLook): LayerLook {
  const css: [string, string, string] = [
    look.default,
    look.notable,
    look.accent,
  ];
  return {
    css,
    tones: premultipliedTones(css.map((colour) => cssToRgba(colour))),
    outlineCss: look.outline,
    outline: premultipliedTones([cssToRgba(look.outline)]),
    outlinePx: look.outlinePx,
  };
}
