import { glyphIndex } from "./glyphs";
import {
  clampSize,
  ecefToGeodetic,
  geodeticToEcef,
  toneIndex,
} from "./gpu/encode";
import {
  evaluateSegmentEcef,
  segmentFraction,
  segmentHeading,
} from "./gpu/segment-math";
import {
  type LayerOptions,
  type LayerSizing,
  type Marker,
  POSITION_STRIDE,
  SEGMENT_FADED,
  SEGMENT_H0,
  SEGMENT_H1,
  SEGMENT_LAT0,
  SEGMENT_LAT1,
  SEGMENT_LON0,
  SEGMENT_LON1,
  SEGMENT_STRIDE,
  SEGMENT_T0,
  SEGMENT_T1,
  type SegmentUpdate,
} from "./markers";
import { DIRTY_BLOCK, type RenderLayer } from "./renderer";

const RADIANS = Math.PI / 180;
const DEGREES = 180 / Math.PI;

export type LayerState = {
  moduleId: string;
  markers: readonly Marker[];
  render: RenderLayer;
  lon: Float64Array;
  lat: Float64Array;
  baseRotation: Float32Array;
  inverse: Uint32Array;
  special: Uint32Array;
  selectedIndex: number;
  reported: boolean;
  needsSync: boolean;
  mask: Uint8Array | null;
  inView: number | null;
  zeros: Uint8Array | null;
  liveUntil: number;
};

export function partitionByTone(tone: Uint8Array): {
  order: Uint32Array;
  inverse: Uint32Array;
} {
  const count = tone.length;
  const starts = [0, 0, 0, 0];
  for (let i = 0; i < count; i++) starts[tone[i] + 1]++;
  for (let t = 1; t < 4; t++) starts[t] += starts[t - 1];
  const order = new Uint32Array(count);
  const inverse = new Uint32Array(count);
  const cursor = starts.slice(0, 3);
  for (let i = 0; i < count; i++) {
    const at = cursor[tone[i]]++;
    order[at] = i;
    inverse[i] = at;
  }
  return { order, inverse };
}

export function findIndex(
  markers: readonly Marker[],
  id: string | null,
): number {
  if (id === null) return -1;
  for (let i = 0; i < markers.length; i++) {
    if (markers[i].id === id) return i;
  }
  return -1;
}

type BuildInput = {
  moduleId: string;
  slot: number;
  markers: readonly Marker[];
  stale: boolean;
  sizing: LayerSizing | undefined;
  options: LayerOptions | undefined;
  previous: LayerState | undefined;
  selectedId: string | null;
  epoch: number;
};

export function buildLayer(input: BuildInput): LayerState {
  const { markers, previous } = input;
  const count = markers.length;
  const ecef = new Float64Array(count * 3);
  const lon = new Float64Array(count);
  const lat = new Float64Array(count);
  const baseRotation = new Float32Array(count);
  const rotationDeg = new Float32Array(count);
  const glyph = new Uint8Array(count);
  const size = new Uint8Array(count);
  const tone = new Uint8Array(count);
  const adaptive = new Uint8Array(count);
  const special: number[] = [];
  let lookup: Map<string, number> | null = null;

  for (let i = 0; i < count; i++) {
    const marker = markers[i];
    glyph[i] = glyphIndex(marker.glyph);
    size[i] = clampSize(marker.size);
    tone[i] = toneIndex(marker.tone);
    adaptive[i] = marker.adaptive ? 1 : 0;
    baseRotation[i] = marker.rotation ?? 0;
    rotationDeg[i] = baseRotation[i];
    if (marker.persistentLabel) special.push(i);

    let before = -1;
    if (previous) {
      if (previous.markers[i]?.id === marker.id) {
        before = i;
      } else {
        if (lookup === null) {
          lookup = new Map();
          previous.markers.forEach((old, index) => {
            lookup?.set(old.id, index);
          });
        }
        before = lookup.get(marker.id) ?? -1;
      }
    }
    const old = before >= 0 ? previous?.markers[before] : undefined;
    if (previous && old && old.lon === marker.lon && old.lat === marker.lat) {
      lon[i] = previous.lon[before];
      lat[i] = previous.lat[before];
      ecef[i * 3] = previous.render.ecef[before * 3];
      ecef[i * 3 + 1] = previous.render.ecef[before * 3 + 1];
      ecef[i * 3 + 2] = previous.render.ecef[before * 3 + 2];
    } else {
      lon[i] = marker.lon;
      lat[i] = marker.lat;
      geodeticToEcef(marker.lon, marker.lat, ecef, i * 3);
    }
  }

  const { order, inverse } = partitionByTone(tone);
  const render: RenderLayer = {
    slot: input.slot,
    count,
    stale: input.stale,
    pickable: input.options?.pickable ?? true,
    order,
    ecef,
    rotationDeg,
    glyph,
    size,
    tone,
    adaptive,
    faded: new Uint8Array(count),
    fadedCount: 0,
    sizing: input.sizing,
    sizedGlyph: previous?.render.sizedGlyph ?? -1,
    sizedSize: previous?.render.sizedSize ?? 0,
    dirtyBlocks: new Uint8Array(Math.ceil(count / DIRTY_BLOCK)).fill(1),
    dirtyCount: Math.ceil(count / DIRTY_BLOCK),
    moving: false,
    delta: null,
    times: null,
    headings: null,
    epoch: input.epoch,
  };
  if (!input.sizing) {
    render.sizedGlyph = -1;
    render.sizedSize = 0;
  }
  return {
    moduleId: input.moduleId,
    markers,
    render,
    lon,
    lat,
    baseRotation,
    inverse,
    special: Uint32Array.from(special),
    selectedIndex: findIndex(markers, input.selectedId),
    reported: input.options?.reported ?? true,
    needsSync: true,
    mask: null,
    inView: null,
    zeros: null,
    liveUntil: 0,
  };
}

function markDirty(render: RenderLayer, instance: number): void {
  const block = (instance / DIRTY_BLOCK) | 0;
  if (render.dirtyBlocks[block] === 0) {
    render.dirtyBlocks[block] = 1;
    render.dirtyCount++;
  }
}

export function dirtyRuns(render: RenderLayer): [number, number][] {
  const runs: [number, number][] = [];
  if (render.dirtyCount === 0) return runs;
  const blocks = render.dirtyBlocks;
  let start = -1;
  for (let block = 0; block <= blocks.length; block++) {
    const set = block < blocks.length && blocks[block] === 1;
    if (set && start < 0) start = block;
    if (!set && start >= 0) {
      runs.push([
        start * DIRTY_BLOCK,
        Math.min(block * DIRTY_BLOCK, render.count),
      ]);
      start = -1;
    }
  }
  return runs;
}

export function markClean(render: RenderLayer): void {
  render.dirtyBlocks.fill(0);
  render.dirtyCount = 0;
}

export function hasDirty(render: RenderLayer): boolean {
  return render.dirtyCount > 0;
}

export function makeStatic(state: LayerState): void {
  const { render } = state;
  if (!render.moving) return;
  render.moving = false;
  render.delta = null;
  render.times = null;
  render.headings = null;
  state.needsSync = true;
}

export function applyPositions(state: LayerState, data: Float64Array): boolean {
  const { render, markers } = state;
  const count = render.count;
  if (data.length < count * POSITION_STRIDE) return false;
  makeStatic(state);
  let faded = 0;
  let changed = false;
  for (let i = 0; i < count; i++) {
    const at = i * POSITION_STRIDE;
    let lon = data[at];
    let lat = data[at + 1];
    if (Number.isNaN(lon) || Number.isNaN(lat)) {
      lon = markers[i].lon;
      lat = markers[i].lat;
    }
    const turn = Math.fround(
      Number.isNaN(data[at + 2]) ? state.baseRotation[i] : data[at + 2],
    );
    const fade = data[at + 3] === 1 ? 1 : 0;
    faded += fade;
    let moved = false;
    if (lon !== state.lon[i] || lat !== state.lat[i]) {
      state.lon[i] = lon;
      state.lat[i] = lat;
      geodeticToEcef(lon, lat, render.ecef, i * 3);
      moved = true;
    }
    if (turn !== render.rotationDeg[i]) {
      render.rotationDeg[i] = turn;
      moved = true;
    }
    if (fade !== render.faded[i]) {
      render.faded[i] = fade;
      moved = true;
    }
    if (moved) {
      changed = true;
      markDirty(render, state.inverse[i]);
    }
  }
  render.fadedCount = faded;
  return changed;
}

const scratchEnd = new Float64Array(3);

export function applySegments(
  state: LayerState,
  update: SegmentUpdate,
): boolean {
  const { render, markers } = state;
  const count = render.count;
  const { data, rows } = update;
  if (data.length < count * SEGMENT_STRIDE) return false;
  if (!render.moving) {
    render.moving = true;
    render.delta = new Float64Array(count * 3);
    render.times = new Float64Array(count * 2);
    render.headings = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      render.headings[i * 2] = render.headings[i * 2 + 1] =
        state.baseRotation[i] * RADIANS;
    }
    state.needsSync = true;
  }
  const { delta, times, headings } = render;
  if (!delta || !times || !headings) return false;
  const total = rows === null ? count : update.count;
  let faded = render.fadedCount;
  let changed = false;
  let live = rows === null ? 0 : state.liveUntil;
  for (let k = 0; k < total; k++) {
    const i = rows === null ? k : rows[k];
    if (i >= count) continue;
    const at = i * SEGMENT_STRIDE;
    let lon0 = data[at + SEGMENT_LON0];
    let lat0 = data[at + SEGMENT_LAT0];
    let lon1 = data[at + SEGMENT_LON1];
    let lat1 = data[at + SEGMENT_LAT1];
    let start = data[at + SEGMENT_T0];
    let end = data[at + SEGMENT_T1];
    if (Number.isNaN(lon0) || Number.isNaN(lat0)) {
      lon0 = markers[i].lon;
      lat0 = markers[i].lat;
      lon1 = lon0;
      lat1 = lat0;
    } else if (Number.isNaN(lon1) || Number.isNaN(lat1)) {
      lon1 = lon0;
      lat1 = lat0;
    }
    if (Number.isNaN(start) || Number.isNaN(end)) {
      start = 0;
      end = 0;
    }
    state.lon[i] = lon0;
    state.lat[i] = lat0;
    geodeticToEcef(lon0, lat0, render.ecef, i * 3);
    geodeticToEcef(lon1, lat1, scratchEnd, 0);
    delta[i * 3] = scratchEnd[0] - render.ecef[i * 3];
    delta[i * 3 + 1] = scratchEnd[1] - render.ecef[i * 3 + 1];
    delta[i * 3 + 2] = scratchEnd[2] - render.ecef[i * 3 + 2];
    times[i * 2] = start;
    times[i * 2 + 1] = end;
    if (end > live) live = end;
    const h0 = data[at + SEGMENT_H0];
    const h1 = data[at + SEGMENT_H1];
    const base = state.baseRotation[i] * RADIANS;
    headings[i * 2] = Math.fround(Number.isNaN(h0) ? base : h0 * RADIANS);
    headings[i * 2 + 1] = Math.fround(
      Number.isNaN(h1) ? headings[i * 2] : h1 * RADIANS,
    );
    const fade = data[at + SEGMENT_FADED] === 1 ? 1 : 0;
    faded += fade - render.faded[i];
    render.faded[i] = fade;
    markDirty(render, state.inverse[i]);
    changed = true;
  }
  render.fadedCount = faded;
  state.liveUntil = live;
  return changed;
}

export function freezeAt(state: LayerState, nowSeconds: number): void {
  const { render } = state;
  const { delta, times, headings } = render;
  if (!render.moving || !delta || !times || !headings) return;
  const found = { lon: 0, lat: 0 };
  for (let i = 0; i < render.count; i++) {
    const start = times[i * 2];
    const end = times[i * 2 + 1];
    evaluateSegmentEcef(
      render.ecef,
      delta,
      i * 3,
      start,
      end,
      nowSeconds,
      render.ecef,
      i * 3,
    );
    ecefToGeodetic(
      render.ecef[i * 3],
      render.ecef[i * 3 + 1],
      render.ecef[i * 3 + 2],
      found,
    );
    state.lon[i] = found.lon;
    state.lat[i] = found.lat;
    render.rotationDeg[i] =
      segmentHeading(
        headings[i * 2],
        headings[i * 2 + 1],
        segmentFraction(start, end, nowSeconds),
      ) * DEGREES;
  }
  makeStatic(state);
  state.liveUntil = 0;
}
