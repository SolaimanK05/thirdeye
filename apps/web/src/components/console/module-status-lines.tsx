"use client";

import { useModules } from "@/api/queries";
import { useStreamStatus } from "@/state/stream";
import { StatusLines } from "./footer";
import { moduleStatusLines } from "./module-status";

export function ModuleStatusLines({ className }: { className?: string }) {
  const { data, isError } = useModules();
  const stream = useStreamStatus((state) => state.status);
  return (
    <StatusLines
      status={moduleStatusLines(data, isError, stream)}
      className={className}
    />
  );
}
