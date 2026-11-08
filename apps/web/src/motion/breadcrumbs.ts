import { distanceMetres } from "./sphere";

export const CRUMB_COUNT = 6;
export const CRUMB_SPACING_PX = 14;

export type Crumb = { lon: number; lat: number };

export class Breadcrumbs {
  private crumbs: readonly Crumb[] = [];

  get points(): readonly Crumb[] {
    return this.crumbs;
  }

  clear(): boolean {
    if (this.crumbs.length === 0) return false;
    this.crumbs = [];
    return true;
  }

  record(lon: number, lat: number, metresPerPixel: number): boolean {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
    const last = this.crumbs[this.crumbs.length - 1];
    if (last) {
      if (!(metresPerPixel > 0)) return false;
      const moved = distanceMetres(last.lon, last.lat, lon, lat);
      if (moved < CRUMB_SPACING_PX * metresPerPixel) return false;
    }
    this.crumbs = [...this.crumbs, { lon, lat }].slice(-CRUMB_COUNT);
    return true;
  }
}
