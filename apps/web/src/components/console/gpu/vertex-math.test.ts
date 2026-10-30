import { Cartesian3, Ellipsoid, Matrix4, PerspectiveFrustum } from "cesium";
import { describe, expect, test } from "vitest";
import { glyphPath, type PathSink } from "../glyphs";
import { HIT_RADIUS_PX } from "../markers";
import { type ScreenPoint, ScreenProjection } from "../projection";
import {
  FLAG_ADAPTIVE,
  FLAG_FADED,
  geodeticToEcef,
  instanceViews,
  packInstance,
  unpackInstance,
} from "./encode";
import {
  createFrame,
  type FrameUniforms,
  fillFrame,
  STALE_ALPHA,
} from "./frame";
import {
  beyondHorizon,
  QUAD_CORNERS,
  quadPosition,
  relativeToEye,
  rotateOffset,
  vertexCentre,
} from "./vertex-math";

const WIDTH = 1440;
const HEIGHT = 900;

type Pose = { name: string; eye: Cartesian3; target: Cartesian3 };

const POSES: readonly Pose[] = [
  {
    name: "orbit",
    eye: Cartesian3.fromDegrees(40, 10, 20_000_000),
    target: Cartesian3.fromDegrees(40, 10),
  },
  {
    name: "1500 percent over Bangladesh",
    eye: Cartesian3.fromDegrees(90.4, 23.7, 180_000),
    target: Cartesian3.fromDegrees(90.4, 23.7),
  },
  {
    name: "5000 percent near the dateline",
    eye: Cartesian3.fromDegrees(179.95, 0.1, 40_000),
    target: Cartesian3.fromDegrees(179.95, 0.1),
  },
];

function camera(pose: Pose) {
  const direction = Cartesian3.normalize(
    Cartesian3.subtract(pose.target, pose.eye, new Cartesian3()),
    new Cartesian3(),
  );
  const right = Cartesian3.normalize(
    Cartesian3.cross(direction, Cartesian3.UNIT_Z, new Cartesian3()),
    new Cartesian3(),
  );
  const up = Cartesian3.cross(right, direction, new Cartesian3());
  const frustum = new PerspectiveFrustum({
    fov: 0.6,
    aspectRatio: WIDTH / HEIGHT,
    near: 1,
    far: 5e7,
  });
  const view = Matrix4.computeView(
    pose.eye,
    direction,
    up,
    right,
    new Matrix4(),
  );
  const rotation = Matrix4.setTranslation(view, Cartesian3.ZERO, new Matrix4());
  const rte = Matrix4.multiply(
    frustum.projectionMatrix,
    rotation,
    new Matrix4(),
  );
  const full = Matrix4.multiply(frustum.projectionMatrix, view, new Matrix4());
  return {
    rte: Matrix4.toArray(rte, []),
    full: Matrix4.toArray(full, []),
  };
}

function frameFor(pose: Pose): {
  frame: FrameUniforms;
  projection: ScreenProjection;
} {
  const { rte, full } = camera(pose);
  const frame = createFrame();
  fillFrame(frame, {
    viewProjectionRte: rte,
    viewProjection: full,
    eye: [pose.eye.x, pose.eye.y, pose.eye.z],
    width: WIDTH,
    height: HEIGHT,
    ratio: 1,
    tones: new Float32Array(12),
    now: 0,
    epoch: 0,
  });
  const projection = new ScreenProjection();
  projection.update(full, WIDTH, HEIGHT);
  return { frame, projection };
}

function samplePoints(pose: Pose): [number, number][] {
  const points: [number, number][] = [];
  const centre = Ellipsoid.WGS84.cartesianToCartographic(pose.target);
  const lon0 = (centre?.longitude ?? 0) * (180 / Math.PI);
  const lat0 = (centre?.latitude ?? 0) * (180 / Math.PI);
  for (let i = 0; i < 200; i++) {
    points.push([((i * 47) % 360) - 180, ((i * 29) % 160) - 80]);
  }
  for (let i = 0; i < 200; i++) {
    const lon = lon0 + (((i * 37) % 200) - 100) / 100;
    const wrapped = ((lon + 540) % 360) - 180;
    points.push([wrapped, lat0 + (((i * 53) % 200) - 100) / 100]);
  }
  return points;
}

function instanceFor(lon: number, lat: number, flags = 0, rotation = 0) {
  const views = instanceViews(new ArrayBuffer(32));
  const ecef = new Float64Array(3);
  geodeticToEcef(lon, lat, ecef, 0);
  packInstance(views, 0, ecef, 0, rotation, 4, 10, 0, flags);
  return { instance: unpackInstance(views, 0), ecef };
}

describe.each(POSES)("vertex twin, camera $name", (pose) => {
  const { frame, projection } = frameFor(pose);
  const ellipsoid = Ellipsoid.WGS84;
  const eyeScaled = ellipsoid.transformPositionToScaledSpace(
    pose.eye,
    new Cartesian3(),
  );

  test("lands within 0.01 px of ScreenProjection for 400 points", () => {
    let seen = 0;
    for (const [lon, lat] of samplePoints(pose)) {
      const { instance, ecef } = instanceFor(lon, lat);
      const world = new Cartesian3(ecef[0], ecef[1], ecef[2]);
      const scaled = ellipsoid.transformPositionToScaledSpace(
        world,
        new Cartesian3(),
      );
      const borderline = Math.abs(Cartesian3.dot(scaled, eyeScaled) - 1) < 1e-5;
      const hidden = Cartesian3.dot(scaled, eyeScaled) <= 1;
      if (!borderline) expect(beyondHorizon(instance, frame)).toBe(hidden);
      if (hidden || borderline) continue;
      const out: ScreenPoint = { x: 0, y: 0 };
      const found = projection.project(world.x, world.y, world.z, out);
      const centre = vertexCentre(instance, frame, {
        sized: null,
        layerStale: false,
      });
      expect(centre.culled).toBe(!found);
      if (found) {
        seen += 1;
        expect(Math.abs(centre.x - out.x)).toBeLessThan(0.01);
        expect(Math.abs(centre.y - out.y)).toBeLessThan(0.01);
      }
    }
    expect(seen).toBeGreaterThan(10);
  });
});

describe("culling", () => {
  const pose = POSES[0];
  const { frame } = frameFor(pose);

  test("a marker on the far side of the globe is culled", () => {
    const { instance } = instanceFor(-140, -10);
    expect(beyondHorizon(instance, frame)).toBe(true);
    expect(
      vertexCentre(instance, frame, { sized: null, layerStale: false }).culled,
    ).toBe(true);
  });

  test("a marker straight ahead is kept and sits at the centre of the view", () => {
    const { instance } = instanceFor(40, 10);
    const centre = vertexCentre(instance, frame, {
      sized: null,
      layerStale: false,
    });
    expect(centre.culled).toBe(false);
    expect(centre.x).toBeCloseTo(WIDTH / 2, 1);
    expect(centre.y).toBeCloseTo(HEIGHT / 2, 1);
  });
});

describe("style", () => {
  const { frame } = frameFor(POSES[0]);

  test("faded markers and stale layers draw at the stale alpha", () => {
    const faded = instanceFor(40, 10, FLAG_FADED).instance;
    const plain = instanceFor(40, 10).instance;
    expect(
      vertexCentre(faded, frame, { sized: null, layerStale: false }).alpha,
    ).toBe(STALE_ALPHA);
    expect(
      vertexCentre(plain, frame, { sized: null, layerStale: false }).alpha,
    ).toBe(1);
    expect(
      vertexCentre(plain, frame, { sized: null, layerStale: true }).alpha,
    ).toBe(STALE_ALPHA);
  });

  test("adaptive markers take the layer size, others keep their own", () => {
    const adaptive = instanceFor(40, 10, FLAG_ADAPTIVE).instance;
    const fixed = instanceFor(40, 10).instance;
    const sized = { glyph: 6, size: 4 };
    expect(
      vertexCentre(adaptive, frame, { sized, layerStale: false }),
    ).toMatchObject({ glyph: 6, size: 4 });
    expect(
      vertexCentre(fixed, frame, { sized, layerStale: false }),
    ).toMatchObject({ glyph: 4, size: 10 });
    expect(
      vertexCentre(adaptive, frame, {
        sized: { glyph: -1, size: 0 },
        layerStale: false,
      }),
    ).toMatchObject({ glyph: 4, size: 10 });
  });
});

describe("rotation", () => {
  test("rotating an offset matches the plane path convention", () => {
    const moves: [number, number][] = [];
    const sink: PathSink = {
      moveTo: (x, y) => moves.push([x, y]),
      lineTo: () => {},
      bezierCurveTo: () => {},
      arc: () => {},
      rect: () => {},
      closePath: () => {},
    };
    for (const degrees of [0, 30, 90, 180, 271]) {
      moves.length = 0;
      glyphPath(sink, "plane", 20, degrees, 0, 0);
      const [x, y] = rotateOffset(0, -0.5 * 20, (degrees * Math.PI) / 180);
      expect(x).toBeCloseTo(moves[0][0], 9);
      expect(y).toBeCloseTo(moves[0][1], 9);
    }
  });

  test("a ninety degree turn moves the nose from up to right", () => {
    const [x, y] = rotateOffset(0, -10, Math.PI / 2);
    expect(x).toBeCloseTo(10, 9);
    expect(y).toBeCloseTo(0, 9);
  });

  test("only rotating glyphs turn, and the pick quad never does", () => {
    const centre = { culled: false, x: 100, y: 100 } as Parameters<
      typeof quadPosition
    >[0];
    const extent = { halfWidth: 10, halfHeight: 10 };
    const turned = quadPosition(
      centre,
      [1, -1],
      extent,
      true,
      Math.PI / 2,
      false,
    );
    expect(turned.x).toBeCloseTo(100 + 10, 9);
    expect(turned.y).toBeCloseTo(100 + 10, 9);
    const still = quadPosition(
      centre,
      [1, -1],
      extent,
      false,
      Math.PI / 2,
      false,
    );
    expect(still).toEqual({ x: 110, y: 90 });
    const pick = quadPosition(centre, [1, 1], extent, true, 1.2, true);
    expect(pick).toEqual({ x: 100 + HIT_RADIUS_PX, y: 100 + HIT_RADIUS_PX });
  });

  test("the four corners cover the quad", () => {
    expect(QUAD_CORNERS).toHaveLength(4);
    expect(new Set(QUAD_CORNERS.map(([x, y]) => `${x},${y}`)).size).toBe(4);
  });
});

describe("precision", () => {
  const eye = Cartesian3.fromDegrees(10, 10, 1000);
  const frame = createFrame();
  fillFrame(frame, {
    viewProjectionRte: new Float32Array(16),
    viewProjection: new Float32Array(16),
    eye: [eye.x, eye.y, eye.z],
    width: WIDTH,
    height: HEIGHT,
    ratio: 1,
    tones: new Float32Array(12),
    now: 0,
    epoch: 0,
  });

  test("two markers one metre apart stay one metre apart relative to the eye, within a millimetre", () => {
    const a = Cartesian3.fromDegrees(10, 10);
    const eastward = Cartesian3.fromDegrees(10, 10);
    const normal = Ellipsoid.WGS84.geodeticSurfaceNormal(a, new Cartesian3());
    const east = Cartesian3.normalize(
      Cartesian3.cross(Cartesian3.UNIT_Z, normal, new Cartesian3()),
      new Cartesian3(),
    );
    const b = Cartesian3.add(
      eastward,
      Cartesian3.multiplyByScalar(east, 1, new Cartesian3()),
      new Cartesian3(),
    );
    const read = (position: Cartesian3) => {
      const views = instanceViews(new ArrayBuffer(32));
      packInstance(
        views,
        0,
        Float64Array.of(position.x, position.y, position.z),
        0,
        0,
        6,
        4,
        0,
        0,
      );
      return relativeToEye(unpackInstance(views, 0), frame);
    };
    const ra = read(a);
    const rb = read(b);
    const apart = Math.hypot(rb[0] - ra[0], rb[1] - ra[1], rb[2] - ra[2]);
    expect(Math.abs(apart - 1)).toBeLessThan(0.001);
    const truth = Cartesian3.subtract(a, eye, new Cartesian3());
    expect(Math.abs(ra[0] - truth.x)).toBeLessThan(0.001);
    expect(Math.abs(ra[1] - truth.y)).toBeLessThan(0.001);
    expect(Math.abs(ra[2] - truth.z)).toBeLessThan(0.001);
  });

  test("absolute float32 positions could not tell points 0.15 m apart", () => {
    expect(Math.fround(6378137.05)).toBe(Math.fround(6378137.2));
    expect(Math.fround(6378137.2) - Math.fround(6378137.05)).toBe(0);
  });
});
