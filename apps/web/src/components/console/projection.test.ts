import {
  Cartesian3,
  Matrix4,
  PerspectiveFrustum,
  type Scene,
  SceneMode,
  SceneTransforms,
} from "cesium";
import { describe, expect, test } from "vitest";
import { type ScreenPoint, ScreenProjection } from "./projection";

const WIDTH = 1440;
const HEIGHT = 900;

function sceneLooking(from: Cartesian3, at: Cartesian3) {
  const direction = Cartesian3.normalize(
    Cartesian3.subtract(at, from, new Cartesian3()),
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
  const camera = {
    viewMatrix: Matrix4.computeView(from, direction, up, right, new Matrix4()),
    frustum,
  };
  const scene = {
    frameState: { mode: SceneMode.SCENE3D },
    canvas: { clientWidth: WIDTH, clientHeight: HEIGHT },
    camera,
  } as unknown as Scene;
  const viewProjection = Matrix4.multiply(
    frustum.projectionMatrix,
    camera.viewMatrix,
    new Matrix4(),
  );
  return { scene, matrix: Matrix4.toArray(viewProjection, []) };
}

describe("ScreenProjection", () => {
  const from = Cartesian3.fromDegrees(40, 10, 9_000_000);
  const { scene, matrix } = sceneLooking(from, Cartesian3.fromDegrees(40, 10));
  const projection = new ScreenProjection();
  projection.update(matrix, WIDTH, HEIGHT);

  test("lands where Cesium puts every point it can see", () => {
    let seen = 0;
    for (let i = 0; i < 400; i++) {
      const lon = ((i * 47) % 360) - 180;
      const lat = ((i * 29) % 160) - 80;
      const point = Cartesian3.fromDegrees(lon, lat);
      const expected = SceneTransforms.worldToWindowCoordinates(scene, point);
      const out: ScreenPoint = { x: 0, y: 0 };
      const found = projection.project(point.x, point.y, point.z, out);
      expect(found).toBe(expected !== undefined);
      if (expected) {
        seen += 1;
        expect(out.x).toBeCloseTo(expected.x, 6);
        expect(out.y).toBeCloseTo(expected.y, 6);
      }
    }
    expect(seen).toBeGreaterThan(40);
  });

  test("the point straight ahead is the centre of the view", () => {
    const point = Cartesian3.fromDegrees(40, 10);
    const out: ScreenPoint = { x: 0, y: 0 };
    expect(projection.project(point.x, point.y, point.z, out)).toBe(true);
    expect(out.x).toBeCloseTo(WIDTH / 2, 3);
    expect(out.y).toBeCloseTo(HEIGHT / 2, 3);
  });

  test("a point behind the camera is not projected", () => {
    const behind = Cartesian3.multiplyByScalar(from, 3, new Cartesian3());
    const out: ScreenPoint = { x: 0, y: 0 };
    expect(projection.project(behind.x, behind.y, behind.z, out)).toBe(false);
  });
});
