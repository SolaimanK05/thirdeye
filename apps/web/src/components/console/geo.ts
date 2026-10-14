import type { LatLon } from "./types";

const hemisphere = (value: number, positive: string, negative: string) =>
  value < 0 ? negative : positive;

export function formatCentre({ lat, lon }: LatLon): string {
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  const latText = `${Math.abs(lat).toFixed(1)}°${hemisphere(lat, "N", "S")}`;
  const lonText = `${Math.abs(wrapped).toFixed(1)}°${hemisphere(wrapped, "E", "W")}`;
  return `${latText} ${lonText}`;
}
