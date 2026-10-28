import { formatCount } from "./count";
import type {
  ConfidenceTag,
  DomainGroup,
  Filter,
  Health,
  ModuleRow,
  ZoomLevel,
} from "./types";
import { levelBounds } from "./zoom";

export const HEALTH: Record<
  Health,
  { glyph: string; label: string; tone: string }
> = {
  fresh: { glyph: "[+]", label: "fresh", tone: "text-ink-2" },
  stale: {
    glyph: "[!]",
    label: "stale, serving last good",
    tone: "text-amber",
  },
  cooldown: {
    glyph: "[!]",
    label: "cooling down, serving last good",
    tone: "text-amber",
  },
  failed: { glyph: "[E]", label: "feed failed", tone: "text-red" },
  empty: {
    glyph: "[ ]",
    label: "feed OK, nothing to show",
    tone: "text-ink-3",
  },
  "missing-key": { glyph: "[K]", label: "missing key", tone: "text-ink-3" },
};

export const CONFIDENCE: Record<
  ConfidenceTag,
  { meaning: string; className: string }
> = {
  OBS: {
    meaning: "observed by a sensor",
    className: "border-solid border-line-2 text-accent",
  },
  REP: {
    meaning: "reported by the operator",
    className: "border-dashed border-ink-3 text-ink-2",
  },
  DER: {
    meaning: "derived (computed)",
    className: "border-dotted border-ink-3 text-ink-2",
  },
  INF: {
    meaning: "inferred (a guess with a method)",
    className: "border-dashed border-amber text-amber",
  },
};

export const FILTER_LABEL: Record<Filter | "mixed", string> = {
  all: "ALL",
  starred: "STARRED",
  none: "NONE",
  mixed: "MIXED",
};

export function isOn(row: ModuleRow): boolean {
  return row.health !== "missing-key" && row.filter !== "none";
}

export function drawsAnything(row: ModuleRow): boolean {
  if (!isOn(row)) return false;
  return row.filter === "all" || row.starredCount > 0;
}

export function inRange(
  row: ModuleRow,
  zoom: ZoomLevel,
  percent?: number,
): boolean {
  return (
    row.zoomRange !== null &&
    zoom >= row.zoomRange[0] &&
    zoom <= row.zoomRange[1] &&
    (row.maxPercent === undefined ||
      percent === undefined ||
      percent <= row.maxPercent)
  );
}

export type ModuleNote = {
  text: string;
  tone: "ink-3" | "ink-2" | "red" | "amber";
};

export function rangeNote(
  range: readonly [ZoomLevel, ZoomLevel],
  maxPercent?: number,
): string {
  const [min, max] = range;
  if (min === 1 && max === 4 && maxPercent === undefined) {
    return "auto, any zoom";
  }
  const from = levelBounds(min).from;
  const to = Math.min(
    levelBounds(max).to,
    maxPercent ?? Number.POSITIVE_INFINITY,
  );
  if (max === 4 && maxPercent === undefined) return `auto from ${from}%`;
  if (min === 1) return `auto to ${to}%`;
  return `auto ${from}–${to}%`;
}

export function moduleNote(
  row: ModuleRow,
  zoom: ZoomLevel,
  percent?: number,
): ModuleNote {
  if (row.health === "missing-key") {
    return { text: `needs ${row.missingKey ?? "an API key"}`, tone: "ink-3" };
  }
  if (row.health === "failed") {
    return { text: row.failure ?? "feed failed", tone: "red" };
  }
  if (row.filter === "none") {
    return { text: "off", tone: "ink-3" };
  }
  if (row.filter === "starred" && row.starredCount === 0) {
    return { text: "nothing starred", tone: "ink-3" };
  }
  if (row.zoomRange === null) {
    return { text: "no map layer", tone: "ink-3" };
  }
  if (!inRange(row, zoom, percent)) {
    return {
      text: row.inView ? `hidden, ${row.inView} here` : "hidden here",
      tone: "ink-2",
    };
  }
  if (row.health === "cooldown") {
    const last =
      row.loaded > 0 && row.lastGood ? `, last good ${row.lastGood}` : "";
    return {
      text: `cooldown until ${row.cooldownUntil ?? "later"}${last}`,
      tone: "amber",
    };
  }
  if (row.health === "stale") {
    return {
      text: `last good ${row.lastGood ?? "unknown"}`,
      tone: "amber",
    };
  }
  if (row.capped) {
    return {
      text: `top ${formatCount(row.capped.shown)} of ${formatCount(row.capped.matched)}`,
      tone: "ink-2",
    };
  }
  return { text: rangeNote(row.zoomRange, row.maxPercent), tone: "ink-3" };
}

export function everyModuleFilter(
  domains: readonly DomainGroup[],
): Filter | "mixed" {
  const filters = new Set(
    domains
      .flatMap((d) => d.modules)
      .filter((m) => m.health !== "missing-key")
      .map((m) => m.filter),
  );
  if (filters.size !== 1) return "mixed";
  const [only] = filters;
  return only;
}

export function railCounts(
  domains: readonly DomainGroup[],
  zoom: ZoomLevel,
  percent?: number,
): { on: number; drawn: number } {
  const modules = domains.flatMap((d) => d.modules).filter(isOn);
  return {
    on: modules.length,
    drawn: modules.filter((m) => drawsAnything(m) && inRange(m, zoom, percent))
      .length,
  };
}
