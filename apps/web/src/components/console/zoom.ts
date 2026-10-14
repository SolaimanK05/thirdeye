import type { ZoomLevel } from "./types";

export const ZOOM_MIN = 25;
export const ZOOM_MAX = 5000;
export const ZOOM_DEFAULT = 100;
export const ZOOM_STEP = 2;
export const GLOBAL_ALTITUDE_KM = 7240;
export const EARTH_RADIUS_KM = 6378.137;
export const VIEW_FOV_DEGREES = 10;
export const HORIZON_FILL = 342.6 / 389;
export const REFERENCE_VIEW_PX = 778;

const HALF_FOV = (VIEW_FOV_DEGREES * Math.PI) / 360;
const HORIZON_TAN = HORIZON_FILL * Math.tan(HALF_FOV);

export const GLOBAL_CAMERA_KM =
  EARTH_RADIUS_KM * (Math.hypot(1, HORIZON_TAN) / HORIZON_TAN - 1);

const KM_PER_PX_AT_GLOBAL =
  (GLOBAL_CAMERA_KM * 2 * Math.tan(HALF_FOV)) / REFERENCE_VIEW_PX;

const LEVELS: readonly { level: ZoomLevel; name: string; from: number }[] = [
  { level: 4, name: "LOCAL", from: 1000 },
  { level: 3, name: "REGIONAL", from: 200 },
  { level: 2, name: "GLOBAL", from: 60 },
  { level: 1, name: "ORBIT", from: 0 },
];

export function clampZoom(percent: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(percent)));
}

export function altitudeKm(percent: number): number {
  return (GLOBAL_ALTITUDE_KM * 100) / clampZoom(percent);
}

export function zoomForAltitudeKm(km: number): number {
  return clampZoom((GLOBAL_ALTITUDE_KM * 100) / km);
}

export function cameraHeightKm(percent: number): number {
  return (GLOBAL_CAMERA_KM * 100) / clampZoom(percent);
}

export function zoomForCameraHeightKm(km: number): number {
  return clampZoom((GLOBAL_CAMERA_KM * 100) / km);
}

export function cesiumFov(aspectRatio: number): number {
  return aspectRatio > 1
    ? 2 * Math.atan(Math.tan(HALF_FOV) * aspectRatio)
    : 2 * HALF_FOV;
}

export function zoomLevelFor(percent: number): {
  level: ZoomLevel;
  name: string;
} {
  const p = clampZoom(percent);
  const found = LEVELS.find((l) => p >= l.from) ?? LEVELS[LEVELS.length - 1];
  return { level: found.level, name: found.name };
}

export function levelBounds(level: ZoomLevel): { from: number; to: number } {
  const index = LEVELS.findIndex((l) => l.level === level);
  const from = Math.max(ZOOM_MIN, LEVELS[index].from);
  const to = index === 0 ? ZOOM_MAX : LEVELS[index - 1].from - 1;
  return { from, to };
}

export function zoomIn(percent: number): number {
  return clampZoom(percent * ZOOM_STEP);
}

export function zoomOut(percent: number): number {
  return clampZoom(percent / ZOOM_STEP);
}

export function parseZoom(text: string, current: number): number {
  const digits = text.trim().replace(/%$/, "").trim();
  if (!/^\d+(\.\d+)?$/.test(digits)) return current;
  return clampZoom(Number(digits));
}

export function formatKm(km: number): string {
  return `${Math.round(km).toLocaleString("en-US")} km`;
}

const SCALE_BAR_PX = 96;

export function scaleBar(percent: number): { label: string; widthPx: number } {
  const kmAcrossBar =
    (SCALE_BAR_PX * KM_PER_PX_AT_GLOBAL * 100) / clampZoom(percent);
  const magnitude = 10 ** Math.floor(Math.log10(kmAcrossBar));
  const nice =
    [5, 2, 1]
      .map((m) => m * magnitude)
      .find((v) => v <= kmAcrossBar * (1 + 1e-9)) ?? magnitude;
  return {
    label: formatKm(nice),
    widthPx: Math.round((SCALE_BAR_PX * nice) / kmAcrossBar),
  };
}
