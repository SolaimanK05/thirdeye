"use client";

import {
  buildModuleUrl,
  Cartesian2,
  Cartesian3,
  Math as CesiumMath,
  CesiumWidget,
  Color,
  type Credit,
  CreditDisplay,
  Ellipsoid,
  ImageryLayer,
  PerspectiveFrustum,
  SceneTransforms,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  TileMapServiceImageryProvider,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useInView } from "@/state/in-view";
import { useSelection } from "@/state/selection";
import { useViewport } from "@/state/viewport";
import { useConsole } from "./console-shell";
import { GLOBE_CREDITS_ID } from "./globe-config";
import { isVectorStyle, mapDetailFor } from "./globe-style";
import { createVectorGlobe, type VectorGlobe } from "./globe-vectors";
import { LayerMarkers } from "./layer-markers";
import { MarkerOverlay } from "./marker-overlay";
import type { GlobeStyle } from "./types";
import {
  cameraHeightKm,
  cesiumFov,
  ZOOM_MAX,
  ZOOM_MIN,
  zoomForCameraHeightKm,
} from "./zoom";

type Globe = {
  widget: CesiumWidget;
  imagery: ImageryLayer;
  vectors: VectorGlobe;
  natural: { baseColor: Color; groundAtmosphere: boolean; fog: boolean };
  vectorBase: Color;
};

CreditDisplay.cesiumCredit = undefined as unknown as Credit;

const FLY_SECONDS = 0.6;
const SAME_HEIGHT = 0.01;

function cssValue(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

function themeColor(name: string): Color {
  return Color.fromCssColorString(cssValue(name));
}

function applyStyle(globe: Globe, style: GlobeStyle, zoomPercent: number) {
  const { scene } = globe.widget;
  const vector = isVectorStyle(style);
  globe.imagery.show = !vector;
  scene.globe.baseColor = vector ? globe.vectorBase : globe.natural.baseColor;
  scene.globe.showGroundAtmosphere = !vector && globe.natural.groundAtmosphere;
  scene.fog.enabled = !vector && globe.natural.fog;
  globe.vectors.update(vector, mapDetailFor(zoomPercent));
  scene.requestRender();
}

function publishViewport(widget: CesiumWidget) {
  const rectangle = widget.camera.computeViewRectangle();
  useViewport.getState().setBox(
    rectangle
      ? {
          west: CesiumMath.toDegrees(rectangle.west),
          south: CesiumMath.toDegrees(rectangle.south),
          east: CesiumMath.toDegrees(rectangle.east),
          north: CesiumMath.toDegrees(rectangle.north),
        }
      : null,
  );
}

function trackDisc(widget: CesiumWidget, element: HTMLElement) {
  const { scene, camera } = widget;
  const radius = Ellipsoid.default.maximumRadius;
  const centre = new Cartesian2();
  return scene.postRender.addEventListener(() => {
    const frustum = camera.frustum;
    if (!(frustum instanceof PerspectiveFrustum) || !frustum.fovy) return;
    const projected = SceneTransforms.worldToWindowCoordinates(
      scene,
      Cartesian3.ZERO,
      centre,
    );
    if (!projected) return;
    const distance = Cartesian3.magnitude(camera.positionWC);
    const horizon = Math.asin(Math.min(radius / distance, 1));
    const pixels =
      (Math.tan(horizon) / Math.tan(frustum.fovy / 2)) *
      (scene.canvas.clientHeight / 2);
    element.style.setProperty("--disc-x", `${projected.x}px`);
    element.style.setProperty("--disc-y", `${projected.y}px`);
    element.style.setProperty("--disc-r", `${pixels}px`);
  });
}

function watchPointer(widget: CesiumWidget, overlay: MarkerOverlay) {
  const canvas = widget.scene.canvas;
  const handler = new ScreenSpaceEventHandler(canvas);
  handler.setInputAction(
    ({ position }: ScreenSpaceEventHandler.PositionedEvent) => {
      const hit = overlay.hitTest(position.x, position.y);
      useSelection.getState().select(
        hit
          ? hit.marker.entity
            ? { kind: "entity", id: hit.marker.id, moduleId: hit.moduleId }
            : {
                kind: "event",
                id: hit.marker.id,
                moduleId: hit.moduleId,
                cluster: hit.marker.cluster,
              }
          : null,
      );
    },
    ScreenSpaceEventType.LEFT_CLICK,
  );
  handler.setInputAction(
    ({ endPosition }: ScreenSpaceEventHandler.MotionEvent) => {
      const hit = overlay.hitTest(endPosition.x, endPosition.y);
      canvas.style.cursor = hit ? "pointer" : "";
    },
    ScreenSpaceEventType.MOUSE_MOVE,
  );
  return () => handler.destroy();
}

export default function GlobeCanvas() {
  const frame = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const markerCanvas = useRef<HTMLCanvasElement>(null);
  const globe = useRef<Globe | null>(null);
  const [overlay, setOverlay] = useState<MarkerOverlay | null>(null);
  const selectedId = useSelection((state) => state.selected?.id ?? null);
  const focus = useSelection((state) => state.focus);
  const { zoomPercent, setZoomPercent, globeStyle, centre, setCentre } =
    useConsole();

  const startView = useEffectEvent(() => ({ zoomPercent, centre, globeStyle }));

  const onCameraMoved = useEffectEvent((widget: CesiumWidget) => {
    const { latitude, longitude, height } = widget.camera.positionCartographic;
    setZoomPercent(zoomForCameraHeightKm(height / 1000));
    setCentre({
      lat: CesiumMath.toDegrees(latitude),
      lon: CesiumMath.toDegrees(longitude),
    });
    publishViewport(widget);
  });

  useEffect(() => {
    const element = container.current;
    const frameElement = frame.current;
    const markerElement = markerCanvas.current;
    const creditElement = document.getElementById(GLOBE_CREDITS_ID);
    if (!element || !frameElement || !markerElement || !creditElement) return;

    const start = startView();
    const imagery = ImageryLayer.fromProviderAsync(
      TileMapServiceImageryProvider.fromUrl(
        buildModuleUrl("Assets/Textures/NaturalEarthII"),
        { fileExtension: "jpg", credit: "Natural Earth II" },
      ),
    );
    const widget = new CesiumWidget(element, {
      baseLayer: imagery,
      skyBox: false,
      skyAtmosphere: false,
      scene3DOnly: true,
      requestRenderMode: true,
      maximumRenderTimeChange: Number.POSITIVE_INFINITY,
      creditContainer: creditElement,
      contextOptions: { webgl: { alpha: true } },
    });

    const { scene, camera } = widget;
    scene.backgroundColor = Color.TRANSPARENT;
    scene.globe.baseColor = themeColor("--color-well");
    scene.screenSpaceCameraController.minimumZoomDistance =
      cameraHeightKm(ZOOM_MAX) * 1000;
    scene.screenSpaceCameraController.maximumZoomDistance =
      cameraHeightKm(ZOOM_MIN) * 1000;
    const fitFov = () => {
      const { frustum } = camera;
      if (!(frustum instanceof PerspectiveFrustum)) return;
      const fov = cesiumFov(
        scene.canvas.clientWidth / scene.canvas.clientHeight,
      );
      if (Math.abs((frustum.fov ?? 0) - fov) > 1e-6) frustum.fov = fov;
    };
    fitFov();
    camera.setView({
      destination: Cartesian3.fromDegrees(
        start.centre.lon,
        start.centre.lat,
        cameraHeightKm(start.zoomPercent) * 1000,
      ),
    });

    const vectors = createVectorGlobe(scene, {
      land: themeColor("--globe-land"),
      border: themeColor("--color-ink-3"),
      grid: themeColor("--globe-grid"),
      landCss: cssValue("--globe-land"),
    });

    const current: Globe = {
      widget,
      imagery,
      vectors,
      natural: {
        baseColor: scene.globe.baseColor,
        groundAtmosphere: scene.globe.showGroundAtmosphere,
        fog: scene.fog.enabled,
      },
      vectorBase: themeColor("--color-space"),
    };
    globe.current = current;
    applyStyle(current, start.globeStyle, start.zoomPercent);

    const markers = new MarkerOverlay(
      widget,
      markerElement,
      {
        default: cssValue("--color-ink-2"),
        notable: cssValue("--color-amber"),
        accent: cssValue("--color-accent"),
        plate: cssValue("--color-panel"),
        font: getComputedStyle(document.body).fontFamily,
      },
      (counts) => useInView.getState().setCounts(counts),
    );
    const stopPointer = watchPointer(widget, markers);
    setOverlay(markers);

    const removeFov = scene.preRender.addEventListener(fitFov);
    const removeDisc = trackDisc(widget, frameElement);
    const removeMoveEnd = camera.moveEnd.addEventListener(() =>
      onCameraMoved(widget),
    );
    publishViewport(widget);

    return () => {
      useViewport.getState().setBox(null);
      setOverlay(null);
      stopPointer();
      markers.destroy();
      removeMoveEnd();
      removeDisc();
      removeFov();
      vectors.destroy();
      globe.current = null;
      if (!widget.isDestroyed()) widget.destroy();
    };
  }, []);

  useEffect(() => {
    if (globe.current) applyStyle(globe.current, globeStyle, zoomPercent);
  }, [globeStyle, zoomPercent]);

  useEffect(() => {
    const camera = globe.current?.widget.camera;
    if (!camera) return;
    const target = cameraHeightKm(zoomPercent) * 1000;
    const { latitude, longitude, height } = camera.positionCartographic;
    if (Math.abs(height - target) / target < SAME_HEIGHT) return;
    camera.flyTo({
      destination: Cartesian3.fromRadians(longitude, latitude, target),
      orientation: {
        heading: camera.heading,
        pitch: camera.pitch,
        roll: camera.roll,
      },
      duration: FLY_SECONDS,
    });
  }, [zoomPercent]);

  useEffect(() => {
    overlay?.setSelected(selectedId);
  }, [overlay, selectedId]);

  useEffect(() => {
    const camera = globe.current?.widget.camera;
    if (!camera || !focus) return;
    camera.flyTo({
      destination: Cartesian3.fromDegrees(
        focus.at.lon,
        focus.at.lat,
        camera.positionCartographic.height,
      ),
      duration: FLY_SECONDS,
    });
  }, [focus]);

  return (
    <div ref={frame} data-look={globeStyle} className="globe-frame">
      <div className="globe-look">
        <div
          ref={container}
          role="img"
          aria-label="Globe. Drag to rotate, scroll or use the zoom buttons to zoom."
          className="absolute inset-0"
        />
        <div aria-hidden="true" className="globe-disc">
          <div className="globe-sphere" />
          <div className="globe-scan" />
        </div>
      </div>
      <div aria-hidden="true" className="globe-disc">
        <div className="globe-glow" />
      </div>
      <canvas
        ref={markerCanvas}
        className="pointer-events-none absolute inset-0 size-full"
      />
      {overlay && <LayerMarkers overlay={overlay} />}
    </div>
  );
}
