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

const PUBLISH_EVERY_STEPS = 12;

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
  private following: FollowTarget | null = null;
  private readonly crumbs = new Breadcrumbs();
  private metresPerPixel = kmPerPixel(100) * 1000;
  private stepsSincePublish = 0;

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
      if (change === "layer") this.engine.apply(moduleId);
      else if (overlay.isVisible(moduleId)) this.engine.apply(moduleId);
      this.loop.wake();
    });

    this.unorbit = useOrbit.subscribe((state, previous) => {
      const target = this.following;
      if (
        state.sample === previous.sample ||
        target === null ||
        this.engine.movers.has(target.moduleId)
      ) {
        return;
      }
      this.centre();
      this.countStep();
    });

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
    this.stepsSincePublish = 0;
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
    this.handler.destroy();
    setMotionProbe(null);
    for (const moduleId of this.engine.movers.keys()) {
      useMotionStatus.getState().setMode(moduleId, null);
    }
  }

  private tick(): boolean {
    const moved = this.engine.step();
    if (this.following && moved) {
      this.centre();
      this.countStep();
    }
    return moved || this.engine.pending;
  }

  private countStep() {
    this.stepsSincePublish += 1;
    if (this.stepsSincePublish >= PUBLISH_EVERY_STEPS) {
      this.stepsSincePublish = 0;
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
