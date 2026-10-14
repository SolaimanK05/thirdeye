"use client";

import "./cesium-base-url";
import dynamic from "next/dynamic";

const GlobeCanvas = dynamic(() => import("./globe-canvas"), {
  ssr: false,
  loading: () => (
    <div
      aria-hidden="true"
      className="globe-placeholder -translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 size-[min(70cqh,70cqw)]"
    />
  ),
});

export function GlobeView() {
  return <GlobeCanvas />;
}
