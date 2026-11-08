import {
  Cartesian2,
  Cartesian3,
  type CesiumWidget,
  Ellipsoid,
  EllipsoidalOccluder,
  SceneTransforms,
} from "cesium";
import { positionAt, splitAtAntimeridian, trailUpTo } from "@/motion/trail";
import type { MoverTrail } from "./use-trails";

export type TrailColours = { line: string; head: string; edge: string };

const LINE_WIDTH = 2;
const HEAD_RADIUS = 4.5;

/**
 * Starred movers' last 24 h: a line each, and while replaying a dot at where
 * each one was, with the line cut off behind it. Drawn on its own 2D canvas
 * above the globe, because the globe sits under the green colour filter and
 * anything drawn inside it would turn green too.
 */
export class TrailLayer {
  private trails: readonly MoverTrail[] = [];
  /** Replay time in epoch ms, or null while live. */
  private replayAt: number | null = null;
  private readonly removeListener: () => void;
  private readonly scratch = new Cartesian2();

  constructor(
    private readonly widget: CesiumWidget,
    private readonly canvas: HTMLCanvasElement,
    private readonly colours: TrailColours,
  ) {
    this.removeListener = widget.scene.postRender.addEventListener(() =>
      this.draw(),
    );
  }

  setTrails(trails: readonly MoverTrail[]): void {
    this.trails = trails;
    this.widget.scene.requestRender();
  }

  setReplay(at: number | null): void {
    if (at === this.replayAt) return;
    this.replayAt = at;
    this.widget.scene.requestRender();
  }

  destroy(): void {
    this.removeListener();
  }

  private draw(): void {
    const { canvas } = this;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== Math.round(width * ratio)) {
      canvas.width = Math.round(width * ratio);
    }
    if (canvas.height !== Math.round(height * ratio)) {
      canvas.height = Math.round(height * ratio);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (this.trails.length === 0) return;

    const { scene, camera } = this.widget;
    const occluder = new EllipsoidalOccluder(
      Ellipsoid.WGS84,
      camera.positionWC,
    );
    const point = (
      lon: number,
      lat: number,
    ): { x: number; y: number } | null => {
      const world = Cartesian3.fromDegrees(lon, lat);
      if (!occluder.isPointVisible(world)) return null;
      const window = SceneTransforms.worldToWindowCoordinates(
        scene,
        world,
        this.scratch,
      );
      return window ? { x: window.x, y: window.y } : null;
    };

    ctx.lineWidth = LINE_WIDTH;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = this.colours.line;
    for (const { trail } of this.trails) {
      const points =
        this.replayAt === null ? trail : trailUpTo(trail, this.replayAt);
      for (const segment of splitAtAntimeridian(points)) {
        ctx.beginPath();
        let pen = false;
        for (const [lon, lat] of segment) {
          const at = point(lon, lat);
          if (!at) {
            pen = false;
          } else if (pen) {
            ctx.lineTo(at.x, at.y);
          } else {
            ctx.moveTo(at.x, at.y);
            pen = true;
          }
        }
        ctx.stroke();
      }
      const head =
        this.replayAt === null ? null : positionAt(trail, this.replayAt);
      const at = head ? point(head.lon, head.lat) : null;
      if (at) {
        ctx.beginPath();
        ctx.arc(at.x, at.y, HEAD_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = this.colours.head;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = this.colours.edge;
        ctx.stroke();
        ctx.lineWidth = LINE_WIDTH;
        ctx.strokeStyle = this.colours.line;
      }
    }
  }
}
