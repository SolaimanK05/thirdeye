"use client";

import { useModules } from "@/api/queries";
import { StatusLines } from "./footer";
import { moduleStatusLines } from "./module-status";

export function ModuleStatusLines({ className }: { className?: string }) {
  const { data, isError } = useModules();
  return (
    <StatusLines
      status={moduleStatusLines(data, isError)}
      className={className}
    />
  );
}
