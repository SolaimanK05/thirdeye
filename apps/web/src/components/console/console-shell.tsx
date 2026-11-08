"use client";

import { createContext, type ReactNode, use, useEffect, useState } from "react";
import { ZOOM_CAPS } from "@/modules/registry";
import { readSavedStyle, saveStyle } from "./globe-style";
import type { GlobeStyle, LatLon, ZoomLevel } from "./types";
import { initialZoomState, nextZoomState } from "./zoom-state";

export type Side = "left" | "right";

type ConsoleState = {
  collapsed: Record<Side, boolean>;
  toggleSide: (side: Side) => void;
  zoomPercent: number;
  setZoomPercent: (percent: number) => void;
  /** The zoom level the draw rules use: it does not flicker at a boundary. */
  level: ZoomLevel;
  levelName: string;
  /** The modules whose own zoom cap the zoom is past. */
  over: ReadonlySet<string>;
  globeStyle: GlobeStyle;
  setGlobeStyle: (style: GlobeStyle) => void;
  centre: LatLon;
  setCentre: (centre: LatLon) => void;
};

const ConsoleContext = createContext<ConsoleState | null>(null);

export function useConsole(): ConsoleState {
  const state = use(ConsoleContext);
  if (!state) {
    throw new Error("Console components must be rendered inside ConsoleShell");
  }
  return state;
}

type Props = {
  initialZoom: number;
  initialGlobeStyle: GlobeStyle;
  initialCentre: LatLon;
  children: ReactNode;
};

export function ConsoleShell({
  initialZoom,
  initialGlobeStyle,
  initialCentre,
  children,
}: Props) {
  const [collapsed, setCollapsed] = useState<Record<Side, boolean>>({
    left: false,
    right: false,
  });
  const [zoom, setZoom] = useState(() =>
    initialZoomState(initialZoom, ZOOM_CAPS),
  );
  const [globeStyle, setStyle] = useState(initialGlobeStyle);
  // The saved style is read after the first paint, so server and client markup agree.
  useEffect(() => {
    const saved = readSavedStyle();
    if (saved) setStyle(saved);
  }, []);
  const setGlobeStyle = (style: GlobeStyle) => {
    setStyle(style);
    saveStyle(style);
  };
  const [centre, setCentre] = useState(initialCentre);

  const state: ConsoleState = {
    collapsed,
    toggleSide: (side) =>
      setCollapsed((current) => ({ ...current, [side]: !current[side] })),
    zoomPercent: zoom.percent,
    setZoomPercent: (percent) =>
      setZoom((current) => nextZoomState(current, percent, ZOOM_CAPS)),
    level: zoom.level,
    levelName: zoom.name,
    over: zoom.over,
    globeStyle,
    setGlobeStyle,
    centre,
    setCentre,
  };

  return (
    <ConsoleContext value={state}>
      <div
        data-left={collapsed.left ? "collapsed" : "open"}
        data-right={collapsed.right ? "collapsed" : "open"}
        className="console-grid isolate"
      >
        {children}
      </div>
    </ConsoleContext>
  );
}
