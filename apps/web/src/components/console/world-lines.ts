import type { FeatureCollection, Position } from "geojson";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";

export type WorldTopology = Topology<{
  countries: GeometryCollection;
  land: GeometryCollection;
}>;

export type Line = Position[];

export type WorldLines = {
  coast: Line[];
  borders: Line[];
  land: FeatureCollection;
};

const ANTIMERIDIAN = 180;
const SOUTH_EDGE = -84;
const EPSILON = 1e-6;

function samePoint(a: Position, b: Position): boolean {
  return Math.abs(a[0] - b[0]) < EPSILON && Math.abs(a[1] - b[1]) < EPSILON;
}

function isSeam(a: Position, b: Position): boolean {
  const alongAntimeridian =
    Math.abs(Math.abs(a[0]) - ANTIMERIDIAN) < EPSILON &&
    Math.abs(a[0] - b[0]) < EPSILON;
  const alongSouthEdge =
    a[1] < SOUTH_EDGE && b[1] < SOUTH_EDGE && Math.abs(a[1] - b[1]) < EPSILON;
  return alongAntimeridian || alongSouthEdge;
}

export function cleanLines(lines: Line[]): Line[] {
  const result: Line[] = [];
  for (const line of lines) {
    let current: Line = [];
    for (const point of line) {
      const previous = current.at(-1);
      if (previous && samePoint(previous, point)) continue;
      if (previous && isSeam(previous, point)) {
        if (current.length > 1) result.push(current);
        current = [];
      }
      current.push(point);
    }
    if (current.length > 1) result.push(current);
  }
  return result;
}

export function worldLines(topology: WorldTopology): WorldLines {
  const { countries, land } = topology.objects;
  return {
    coast: cleanLines(mesh(topology, land).coordinates),
    borders: cleanLines(
      mesh(topology, countries, (a, b) => a !== b).coordinates,
    ),
    land: feature(topology, land),
  };
}

export type Graticule = { meridians: Line[]; parallels: Line[] };

export function graticule(step: number): Graticule {
  const meridians: Line[] = [];
  for (let lon = -180; lon < 180; lon += step) {
    const line: Line = [];
    for (let lat = -90; lat <= 90; lat += step) line.push([lon, lat]);
    meridians.push(line);
  }
  const parallels: Line[] = [];
  for (let lat = -90 + step; lat < 90; lat += step) {
    const line: Line = [];
    for (let lon = -180; lon <= 180; lon += step) line.push([lon, lat]);
    parallels.push(line);
  }
  return { meridians, parallels };
}

export type PackedLines = {
  coordinates: Float64Array;
  starts: Uint32Array;
};

export function packLines(lines: Line[]): PackedLines {
  const total = lines.reduce((sum, line) => sum + line.length, 0);
  const coordinates = new Float64Array(total * 2);
  const starts = new Uint32Array(lines.length + 1);
  let point = 0;
  lines.forEach((line, index) => {
    starts[index] = point;
    for (const [lon, lat] of line) {
      coordinates[point * 2] = lon;
      coordinates[point * 2 + 1] = lat;
      point += 1;
    }
  });
  starts[lines.length] = point;
  return { coordinates, starts };
}

export function packedLineCount({ starts }: PackedLines): number {
  return Math.max(0, starts.length - 1);
}

export function packedLine(
  { coordinates, starts }: PackedLines,
  index: number,
): Float64Array {
  return coordinates.subarray(starts[index] * 2, starts[index + 1] * 2);
}
