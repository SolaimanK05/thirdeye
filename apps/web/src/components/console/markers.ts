export type ClusterInfo = { count: number; megawatts: number };

export type MarkerGlyph = "triangle" | "flame" | "flame-ring" | "square";

export type MarkerTone = "default" | "notable" | "accent";

export type Marker = {
  id: string;
  lon: number;
  lat: number;
  glyph: MarkerGlyph;
  size: number;
  tone: MarkerTone;
  label: string;
  cluster?: ClusterInfo;
  entity?: boolean;
  persistentLabel?: boolean;
};

export const HIT_RADIUS_PX = 22;

export function withStars(
  markers: readonly Marker[],
  starred: ReadonlySet<string>,
  onlyStarred: boolean,
): Marker[] {
  const result: Marker[] = [];
  for (const marker of markers) {
    if (starred.has(marker.id)) {
      result.push({ ...marker, tone: "accent", persistentLabel: true });
    } else if (!onlyStarred) {
      result.push(marker);
    }
  }
  return result;
}
