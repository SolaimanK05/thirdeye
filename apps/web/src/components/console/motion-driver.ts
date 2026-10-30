import {
  Cartesian3,
  type CesiumWidget,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
} from "cesium";
import { Breadcrumbs } from "@/motion/breadcrumbs";
import { MotionEngine } from "@/motion/engine";
import { MotionLoop } from "@/motion/loop";
import { type EntityStore, entityStore } from "@/state/entities";
import {
  renderedPosition,
  setMotionProbe,
  useMotionStatus,
} from "@/state/motion";
import { useOrbit } from "@/state/orbit";
import { useSelection } from "@/state/selection";
import { serverNowMs } from "@/state/stream";
import type { MarkerOverlay } from "./marker-overlay";
import { kmPerPixel } from "./zoom";

export type FollowTarget = { moduleId: string; id: string };

const PUBLISH_EVERY_MS = 1000;

const CANCEL_INPUTS = [
  ScreenSpaceEventType.LEFT_DOWN,
  ScreenSpaceEventType.RIGHT_DOWN,
  ScreenSpaceEventType.MIDDLE_DOWN,
  ScreenSpaceEventType.PINCH_START,
] as const;

export class MotionDriver {
  readonly engine: MotionEngine;
  private readonly loop: MotionLoop;
  private readonly widget: CesiumWidget;
  private readonly overlay: MarkerOverlay;
  private readonly store: EntityStore;
  private readonly onMoved: () => void;
  private readonly handler: ScreenSpaceEventHandler;
  private readonly unobserve: () => void;
  private readonly unsubscribe: () => void;
  private readonly unorbit: () => void;
  private readonly unframe: () => void;
  private following: FollowTarget | null = null;
  private readonly crumbs = new Breadcrumbs();
  private metresPerPixel = kmPerPixel(100) * 1000;
  private lastPublishAt = Number.NEGATIVE_INFINITY;

  constructor(
    widget: CesiumWidget,
    overlay: MarkerOverlay,
    onMoved: () => void,
    store: EntityStore = entityStore,
  ) {
    this.widget = widget;
    this.overlay = overlay;
    this.store = store;
    this.onMoved = onMoved;
    this.engine = new MotionEngine({
      target: overlay,
      clock: () => serverNowMs(),
      onMode: (moduleId, mode) =>
        useMotionStatus.getState().setMode(moduleId, mode),
    });
    this.loop = new MotionLoop({ step: () => this.tick() });

    this.unobserve = store.observe((change) => {
      if (this.engine.ingest(change)) this.loop.wake();
    });
    this.unsubscribe = overlay.onChange((moduleId, change) => {
      if (!this.engine.movers.has(moduleId)) return;
      if (change === "layer" || change === "renderer") {
        this.engine.apply(moduleId);
      } else if (overlay.isVisible(moduleId)) {
        this.engine.apply(moduleId);
      }
      this.loop.wake();
    });

    this.unorbit = useOrbit.subscribe((state, previous) => {
      const target = this.following;
      if (
        state.sample === previous.sample ||
        target === null ||
        this.engine.movers.has(target.moduleId) ||
        this.overlay.segmentMotion()
      ) {
        return;
      }
      this.centre();
      this.countStep();
    });

    this.unframe = overlay.onFrame(() => this.frame());

    this.handler = new ScreenSpaceEventHandler(widget.scene.canvas);
    for (const input of CANCEL_INPUTS) {
      this.handler.setInputAction(
        () => useSelection.getState().stopFollowing(),
        input,
      );
    }
    setMotionProbe((moduleId, id) => this.engine.positionOf(moduleId, id));
  }

  setMovers(delays: ReadonlyMap<string, number>) {
    this.engine.setMovers(delays);
    for (const moduleId of delays.keys()) {
      const rows = this.store.view(moduleId)?.rows;
      if (rows) {
        this.engine.ingest({
          moduleId,
          upserts: rows,
          removes: [],
          reset: true,
        });
      }
      this.engine.apply(moduleId);
    }
    this.loop.wake();
  }

  setScale(zoomPercent: number) {
    this.metresPerPixel = kmPerPixel(zoomPercent) * 1000;
    this.engine.setScale(this.metresPerPixel);
    this.loop.wake();
  }

  follow(target: FollowTarget | null) {
    const wasFollowing = this.following !== null;
    const same =
      target !== null &&
      this.following?.moduleId === target.moduleId &&
      this.following.id === target.id;
    this.following = target;
    this.engine.setFullRate(target?.moduleId ?? null);
    this.overlay.setFullRate(target !== null);
    this.lastPublishAt = performance.now();
    if (!same && this.crumbs.clear()) this.overlay.setBreadcrumbs([]);
    if (target) {
      this.centre();
      this.loop.wake();
    } else if (wasFollowing) {
      this.onMoved();
    }
  }

  destroy() {
    this.loop.stop();
    this.unobserve();
    this.unsubscribe();
    this.unorbit();
    this.unframe();
    this.overlay.setFullRate(false);
    this.handler.destroy();
    setMotionProbe(null);
    for (const moduleId of this.engine.movers.keys()) {
      useMotionStatus.getState().setMode(moduleId, null);
    }
  }

  private tick(): boolean {
    const moved = this.engine.step();
    if (this.following && moved && !this.overlay.segmentMotion()) {
      this.centre();
      this.countStep();
    }
    return moved || this.engine.pending;
  }

  private frame() {
    if (!this.following || !this.overlay.segmentMotion()) return;
    this.centre();
    this.countStep();
  }

  private countStep() {
    const now = performance.now();
    if (now - this.lastPublishAt >= PUBLISH_EVERY_MS) {
      this.lastPublishAt = now;
      this.onMoved();
    }
  }

  private centre() {
    const target = this.following;
    if (!target || this.widget.isDestroyed()) return;
    const position = renderedPosition(target.moduleId, target.id);
    if (!position) {
      useSelection.getState().stopFollowing();
      return;
    }
    if (this.crumbs.record(position.lon, position.lat, this.metresPerPixel)) {
      this.overlay.setBreadcrumbs(this.crumbs.points);
    }
    const { camera } = this.widget;
    camera.setView({
      destination: Cartesian3.fromDegrees(
        position.lon,
        position.lat,
        camera.positionCartographic.height,
      ),
      orientation: {
        heading: camera.heading,
        pitch: camera.pitch,
        roll: camera.roll,
      },
    });
    this.overlay.invalidate();
  }
}
