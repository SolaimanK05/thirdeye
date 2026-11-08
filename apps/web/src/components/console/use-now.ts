"use client";

import { useSyncExternalStore } from "react";

const TICK_MS = 15_000;

function subscribe(onTick: () => void) {
  const timer = setInterval(onTick, TICK_MS);
  return () => clearInterval(timer);
}

const currentTick = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;
const serverTick = () => null;

export function useNow(): number | null {
  return useSyncExternalStore(subscribe, currentTick, serverTick);
}
