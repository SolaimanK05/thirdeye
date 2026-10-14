import {
  ArcType,
  Cartesian3,
  type Color,
  GeometryInstance,
  ImageryLayer,
  Material,
  PolylineGeometry,
  PolylineMaterialAppearance,
  Primitive,
  type Scene,
  SingleTileImageryProvider,
} from "cesium";
import { GEO_BASE_URL } from "./globe-config";
import {
  DASH_PATTERN,
  FILL_WIDTH,
  GRATICULE_STEP,
  LINE_LOOK,
  type MapDetail,
} from "./globe-style";
import {
  graticule,
  type PackedLines,
  packedLine,
  packedLineCount,
  packLines,
} from "./world-lines";
import type { WorldRequest, WorldResponse } from "./world-worker";

export type VectorPalette = {
  land: Color;
  border: Color;
  grid: Color;
  landCss: string;
};

type DetailLayers = {
  coast: Primitive;
  borders: Primitive;
  fill: ImageryLayer;
};

type WorldData = Extract<WorldResponse, { ok: true }>;

export type VectorGlobe = {
  update: (visible: boolean, detail: MapDetail) => void;
  destroy: () => void;
};

function polylines(
  lines: PackedLines,
  width: number,
  material: Material,
  arcType: ArcType = ArcType.GEODESIC,
): Primitive {
  const geometryInstances: GeometryInstance[] = [];
  for (let index = 0; index < packedLineCount(lines); index++) {
    const line = packedLine(lines, index);
    const positions: Cartesian3[] = [];
    for (let i = 0; i < line.length; i += 2) {
      positions.push(Cartesian3.fromDegrees(line[i], line[i + 1]));
    }
    geometryInstances.push(
      new GeometryInstance({
        geometry: new PolylineGeometry({
          positions,
          width,
          arcType,
          vertexFormat: PolylineMaterialAppearance.VERTEX_FORMAT,
        }),
      }),
    );
  }
  return new Primitive({
    geometryInstances,
    appearance: new PolylineMaterialAppearance({ material }),
    show: false,
  });
}

function solid(color: Color, alpha: number): Material {
  return Material.fromType(Material.ColorType, {
    color: color.withAlpha(alpha),
  });
}

function dashed(color: Color, alpha: number, dashLength: number): Material {
  return Material.fromType(Material.PolylineDashType, {
    color: color.withAlpha(alpha),
    dashLength,
    dashPattern: DASH_PATTERN,
  });
}

async function landFill(image: Blob): Promise<ImageryLayer> {
  const url = URL.createObjectURL(image);
  try {
    const provider = await SingleTileImageryProvider.fromUrl(url);
    return new ImageryLayer(provider, {
      alpha: LINE_LOOK.landFill.alpha,
      show: false,
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function worldWorker() {
  const worker = new Worker(new URL("./world-worker.ts", import.meta.url), {
    type: "module",
    name: "world-map",
  });
  const pending = new Map<
    number,
    { resolve: (data: WorldData) => void; reject: (error: Error) => void }
  >();
  let nextId = 0;

  worker.addEventListener("message", (event: MessageEvent<WorldResponse>) => {
    const reply = event.data;
    const waiting = pending.get(reply.id);
    if (!waiting) return;
    pending.delete(reply.id);
    if (reply.ok) waiting.resolve(reply);
    else waiting.reject(new Error(reply.error));
  });

  return {
    load(detail: MapDetail, fill: string): Promise<WorldData> {
      const id = nextId++;
      const request: WorldRequest = {
        id,
        url: new URL(`${GEO_BASE_URL}countries-${detail}.json`, location.origin)
          .href,
        fill,
        width: FILL_WIDTH[detail],
      };
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage(request);
      });
    },
    terminate() {
      worker.terminate();
      for (const { reject } of pending.values()) {
        reject(new Error("Map worker stopped"));
      }
      pending.clear();
    },
  };
}

export function createVectorGlobe(
  scene: Scene,
  palette: VectorPalette,
): VectorGlobe {
  const { meridians, parallels } = graticule(GRATICULE_STEP);
  const gridMaterial = () => solid(palette.grid, LINE_LOOK.grid.alpha);
  const grid = [
    polylines(packLines(meridians), LINE_LOOK.grid.width, gridMaterial()),
    polylines(
      packLines(parallels),
      LINE_LOOK.grid.width,
      gridMaterial(),
      ArcType.RHUMB,
    ),
  ];
  for (const primitive of grid) scene.primitives.add(primitive);

  const worker = worldWorker();
  const loaded = new Map<MapDetail, DetailLayers>();
  const loading = new Set<MapDetail>();
  let visible = false;
  let wanted: MapDetail = "110m";
  let destroyed = false;
  let synced: string | undefined;

  const isReady = (layers: DetailLayers) =>
    layers.coast.ready && layers.borders.ready && layers.fill.ready;

  function shown(): MapDetail | undefined {
    const want = loaded.get(wanted);
    if (want && isReady(want)) return wanted;
    return [...loaded].find(([, layers]) => isReady(layers))?.[0];
  }

  function sync() {
    if (destroyed) return;
    const detail = shown();
    synced = `${visible}:${detail}`;
    for (const primitive of grid) primitive.show = visible;
    for (const [key, layers] of loaded) {
      const on = visible && key === detail;
      layers.fill.show = on;
      layers.coast.show = on;
      layers.borders.show = on;
    }
    scene.requestRender();
  }

  const removePoll = scene.postRender.addEventListener(() => {
    if (synced !== `${visible}:${shown()}`) sync();
    if ([...loaded.values()].some((layers) => !isReady(layers))) {
      scene.requestRender();
    }
  });

  async function load(detail: MapDetail) {
    if (loaded.has(detail) || loading.has(detail)) return;
    loading.add(detail);
    try {
      const data = await worker.load(detail, palette.landCss);
      const fill = await landFill(data.land);
      if (destroyed) return;
      scene.imageryLayers.add(fill);
      loaded.set(detail, {
        fill,
        coast: scene.primitives.add(
          polylines(
            data.coast,
            LINE_LOOK.coast.width,
            solid(palette.land, LINE_LOOK.coast.alpha),
          ),
        ),
        borders: scene.primitives.add(
          polylines(
            data.borders,
            LINE_LOOK.border.width,
            dashed(
              palette.border,
              LINE_LOOK.border.alpha,
              LINE_LOOK.border.dash,
            ),
          ),
        ),
      });
      scene.requestRender();
    } finally {
      loading.delete(detail);
    }
  }

  return {
    update(nextVisible, detail) {
      visible = nextVisible;
      wanted = detail;
      if (visible) {
        load(detail).catch((error: unknown) => {
          if (!destroyed) console.error(error);
        });
      }
      sync();
    },
    destroy() {
      destroyed = true;
      removePoll();
      worker.terminate();
    },
  };
}
