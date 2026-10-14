"use client";

import { useModules } from "@/api/queries";
import { attributionLine } from "./module-status";

export function Attribution() {
  const { data } = useModules();
  const line = data ? attributionLine(data) : null;
  if (!line) return null;
  return (
    <p className="text-right text-ink-3 text-micro leading-normal tracking-normal">
      {line}
    </p>
  );
}
