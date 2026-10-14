"use client";

import { createContext, type ReactNode, use, useState } from "react";
import type { GlobeStyle, LatLon } from "./types";
import { clampZoom } from "./zoom";

export type Side = "left" | "right";

type ConsoleState = {
  collapsed: Record<Side, boolean>;
  toggleSide: (side: Side) => void;
  zoomPercent: number;
  setZoomPercent: (percent: number) => void;
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
  const [zoomPercent, setZoom] = useState(() => clampZoom(initialZoom));
  const [globeStyle, setGlobeStyle] = useState(initialGlobeStyle);
  const [centre, setCentre] = useState(initialCentre);

  const state: ConsoleState = {
    collapsed,
    toggleSide: (side) =>
      setCollapsed((current) => ({ ...current, [side]: !current[side] })),
    zoomPercent,
    setZoomPercent: (percent) => setZoom(clampZoom(percent)),
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
