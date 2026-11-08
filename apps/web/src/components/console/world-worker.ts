import { geoEquirectangular, geoPath } from "d3-geo";
import type { FeatureCollection } from "geojson";
import {
  type PackedLines,
  packLines,
  type WorldTopology,
  worldLines,
} from "./world-lines";

export type WorldRequest = {
  id: number;
  url: string;
  fill: string;
  width: number;
};

export type WorldResponse =
  | {
      id: number;
      ok: true;
      coast: PackedLines;
      borders: PackedLines;
      land: Blob;
    }
  | { id: number; ok: false; error: string };

async function drawLand(
  land: FeatureCollection,
  fill: string,
  width: number,
): Promise<Blob> {
  const height = width / 2;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No 2D canvas in this worker");
  const projection = geoEquirectangular()
    .scale(width / (2 * Math.PI))
    .translate([width / 2, height / 2])
    .precision(0.1);
  context.fillStyle = fill;
  context.beginPath();
  geoPath(projection, context)(land);
  context.fill();
  return canvas.convertToBlob({ type: "image/png" });
}

async function handle({ id, url, fill, width }: WorldRequest) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const topology: WorldTopology = await response.json();
  const { coast, borders, land } = worldLines(topology);
  const result: WorldResponse = {
    id,
    ok: true,
    coast: packLines(coast),
    borders: packLines(borders),
    land: await drawLand(land, fill, width),
  };
  postMessage(result, {
    transfer: [
      result.coast.coordinates.buffer,
      result.coast.starts.buffer,
      result.borders.coordinates.buffer,
      result.borders.starts.buffer,
    ],
  });
}

addEventListener("message", (event: MessageEvent<WorldRequest>) => {
  handle(event.data).catch((error: unknown) => {
    const failure: WorldResponse = {
      id: event.data.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    postMessage(failure);
  });
});
