import { formatCount } from "./count";
import { inZoomRange } from "./draw-rules";
import type {
  ConfidenceTag,
  DomainGroup,
  Filter,
  Health,
  ModuleRow,
  ZoomLevel,
} from "./types";

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

export function isOn(row: ModuleRow): boolean {
  return row.health !== "missing-key" && row.filter !== "none";
}

export function drawsAnything(row: ModuleRow): boolean {
  if (!isOn(row)) return false;
  return row.filter === "all" || row.starredCount > 0;
}

/** `over` is true while the zoom is past the row's own percent cap. */
export function inRange(
  row: ModuleRow,
  zoom: ZoomLevel,
  over = false,
): boolean {
  return inZoomRange(row.zoomRange, { level: zoom, over });
}

/** Whether the row draws anything now: in range, or pinned with SHOW HERE. */
export function isShown(
  row: ModuleRow,
  zoom: ZoomLevel,
  over = false,
): boolean {
  return (
    drawsAnything(row) && (inRange(row, zoom, over) || row.pinned !== undefined)
  );
}

/** Whether SHOW HERE would do something: the module is on but hidden at this zoom. */
export function canShowHere(
  row: ModuleRow,
  zoom: ZoomLevel,
  over = false,
): boolean {
  return (
    row.filter === "all" &&
    row.health !== "missing-key" &&
    row.zoomRange !== null &&
    row.pinned === undefined &&
    !inRange(row, zoom, over)
  );
}

export type StatusState = "live" | "attention" | "off";

export type ModuleStatus = {
  text: string;
  state: StatusState;
  /** The feed itself failed; drawn in red, still in the attention state. */
  failed?: boolean;
  /** The long reason, for a tooltip; the line itself stays short. */
  detail?: string;
};

export const STATUS_LEGEND: readonly { state: StatusState; label: string }[] = [
  { state: "live", label: "Live" },
  { state: "attention", label: "Needs attention" },
  { state: "off", label: "Off or no key" },
];

/** 11:21:07Z reads as 11:21Z; a time without seconds is left alone. */
const toMinute = (time: string) =>
  time.replace(/^(\d\d:\d\d):\d\d(?=Z$)/, "$1");

/** One plain-words line about a module, with the state its colour square shows. */
export function moduleStatus(
  row: ModuleRow,
  zoom: ZoomLevel,
  over = false,
): ModuleStatus {
  if (row.health === "missing-key") {
    return { text: `Needs ${row.missingKey ?? "an API key"}`, state: "off" };
  }
  if (row.health === "failed") {
    return {
      text: "Feed failed, last data kept",
      state: "attention",
      failed: true,
      ...(row.failure ? { detail: row.failure } : {}),
    };
  }
  if (row.filter === "none") return { text: "Off", state: "off" };
  if (row.filter === "starred" && row.starredCount === 0) {
    return { text: "Nothing starred yet", state: "off" };
  }
  if (row.zoomRange === null) return { text: "No map layer", state: "off" };
  if (!inRange(row, zoom, over)) {
    if (row.pinned !== undefined) {
      return { text: "Shown here by you", state: "live" };
    }
    const hidden =
      over && row.maxPercent !== undefined
        ? `Hidden above ${row.maxPercent}%`
        : "Hidden at this zoom";
    return {
      text: row.starredCount > 0 ? `${hidden}, starred still shown` : hidden,
      state: "off",
    };
  }
  if (row.health === "cooldown") {
    const last =
      row.loaded > 0 && row.lastGood
        ? `, last good ${toMinute(row.lastGood)}`
        : "";
    return {
      text: `Paused until ${row.cooldownUntil ?? "later"}${last}`,
      state: "attention",
    };
  }
  if (row.health === "stale") {
    return {
      text: `Stale since ${row.lastGood ? toMinute(row.lastGood) : "unknown"}`,
      state: "attention",
    };
  }
  if (row.capped) {
    return {
      text: `Showing top ${formatCount(row.capped.shown)} of ${formatCount(row.capped.matched)}`,
      state: "live",
    };
  }
  if (row.health === "empty") {
    return { text: "Nothing to show right now", state: "off" };
  }
  return { text: "Up to date", state: "live" };
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

const NO_MODULES: ReadonlySet<string> = new Set();

export function railCounts(
  domains: readonly DomainGroup[],
  zoom: ZoomLevel,
  over: ReadonlySet<string> = NO_MODULES,
): { on: number; drawn: number } {
  const modules = domains.flatMap((d) => d.modules).filter(isOn);
  return {
    on: modules.length,
    drawn: modules.filter((m) => isShown(m, zoom, over.has(m.id))).length,
  };
}
