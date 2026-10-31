import type { EntityRow } from "./client";

export type StreamStatus = "connecting" | "live" | "reconnecting";

export type StreamSnapshot = {
  moduleId: string;
  fetchedAt: string | null;
  version: number;
  entities: EntityRow[];
};

export type StreamDelta = {
  moduleId: string;
  fetchedAt: string | null;
  version: number;
  upserts: EntityRow[];
  removes: string[];
};

export type StreamEventLike = { readonly data: string };

export type EventSourceLike = {
  readonly readyState: number;
  close(): void;
  addEventListener(
    type: string,
    listener: (event: StreamEventLike) => void,
  ): void;
};

export type StreamOptions = {
  url: string;
  onStatus: (status: StreamStatus) => void;
  onLayer: (moduleId: string) => void;
  /** Like onLayer, with the version the module reached; for binary clients. */
  onNotice?: (moduleId: string, version: number) => void;
  onResync: () => void;
  onSnapshot?: (snapshot: StreamSnapshot) => void;
  onDelta?: (delta: StreamDelta) => void;
  onServerTime?: (serverTimeMs: number) => void;
  connect?: (url: string) => EventSourceLike;
  setTimer?: (callback: () => void, milliseconds: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  random?: () => number;
};

const CLOSED = 2;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_CAP_MS = 30_000;
const MAX_DOUBLINGS = 8;

export function reconnectDelay(
  failures: number,
  random: () => number = Math.random,
): number {
  const doublings = Math.min(Math.max(0, failures - 1), MAX_DOUBLINGS);
  const ceiling = Math.min(
    RECONNECT_CAP_MS,
    RECONNECT_BASE_MS * 2 ** doublings,
  );
  return Math.round(ceiling / 2 + (random() * ceiling) / 2);
}

function parseJson(data: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(data);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export type StreamHello = { resumed: boolean; serverTimeMs: number | null };

export function parseHello(data: string): StreamHello | null {
  const body = parseJson(data);
  if (typeof body?.resumed !== "boolean") return null;
  const serverTimeMs =
    typeof body.server_time === "string" ? Date.parse(body.server_time) : null;
  return {
    resumed: body.resumed,
    serverTimeMs:
      serverTimeMs !== null && Number.isFinite(serverTimeMs)
        ? serverTimeMs
        : null,
  };
}

export function parseLayerNotice(data: string): string | null {
  const body = parseJson(data);
  return typeof body?.module_id === "string" ? body.module_id : null;
}

export function parseLayerVersion(data: string): number | null {
  const body = parseJson(data);
  return finite(body?.version) ? body.version : null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finiteOrNull(value: unknown): boolean {
  return value === null || finite(value);
}

export function isEntityRow(value: unknown): value is EntityRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    row.id.length > 0 &&
    typeof row.kind === "string" &&
    typeof row.name === "string" &&
    finite(row.lon) &&
    row.lon >= -180 &&
    row.lon <= 180 &&
    finite(row.lat) &&
    row.lat >= -90 &&
    row.lat <= 90 &&
    typeof row.t === "string" &&
    !Number.isNaN(Date.parse(row.t)) &&
    finiteOrNull(row.sog) &&
    finiteOrNull(row.cog) &&
    finiteOrNull(row.heading) &&
    finiteOrNull(row.alt) &&
    typeof row.confidence === "string" &&
    typeof row.attrs === "object" &&
    row.attrs !== null
  );
}

function moduleHeader(
  body: Record<string, unknown> | null,
): { moduleId: string; fetchedAt: string | null; version: number } | null {
  if (!body || typeof body.module_id !== "string") return null;
  if (!finite(body.version)) return null;
  const fetchedAt =
    typeof body.fetched_at === "string" ? body.fetched_at : null;
  return { moduleId: body.module_id, fetchedAt, version: body.version };
}

export function parseSnapshot(data: string): StreamSnapshot | null {
  const body = parseJson(data);
  const header = moduleHeader(body);
  if (!header || !Array.isArray(body?.entities)) return null;
  return { ...header, entities: body.entities.filter(isEntityRow) };
}

export function parseDelta(data: string): StreamDelta | null {
  const body = parseJson(data);
  const header = moduleHeader(body);
  if (
    !header ||
    !Array.isArray(body?.upserts) ||
    !Array.isArray(body?.removes)
  ) {
    return null;
  }
  return {
    ...header,
    upserts: body.upserts.filter(isEntityRow),
    removes: body.removes.filter((id): id is string => typeof id === "string"),
  };
}

export function startStream(options: StreamOptions): () => void {
  const {
    url,
    onStatus,
    onLayer,
    onNotice,
    onResync,
    onSnapshot,
    onDelta,
    onServerTime,
    connect = (target: string) => new EventSource(target),
    setTimer = (callback: () => void, milliseconds: number) =>
      setTimeout(callback, milliseconds),
    clearTimer = (handle: unknown) =>
      clearTimeout(handle as ReturnType<typeof setTimeout>),
    random = Math.random,
  } = options;

  let source: EventSourceLike | null = null;
  let timer: unknown = null;
  let failures = 0;
  let stopped = false;
  let announced = false;

  const report = (status: StreamStatus) => {
    if (!stopped) onStatus(status);
  };

  const open = () => {
    timer = null;
    if (stopped) return;
    const current = connect(url);
    source = current;
    const active = () => !stopped && source === current;

    current.addEventListener("hello", (event) => {
      if (!active()) return;
      const hello = parseHello(event.data);
      if (hello === null) return;
      failures = 0;
      if (hello.serverTimeMs !== null) onServerTime?.(hello.serverTimeMs);
      if (announced && !hello.resumed) onResync();
      announced = true;
      report("live");
    });

    current.addEventListener("layer", (event) => {
      if (!active()) return;
      const moduleId = parseLayerNotice(event.data);
      if (moduleId === null) return;
      onLayer(moduleId);
      const version = parseLayerVersion(event.data);
      if (version !== null) onNotice?.(moduleId, version);
    });

    current.addEventListener("snapshot", (event) => {
      if (!active()) return;
      const snapshot = parseSnapshot(event.data);
      if (snapshot !== null) onSnapshot?.(snapshot);
    });

    current.addEventListener("delta", (event) => {
      if (!active()) return;
      const delta = parseDelta(event.data);
      if (delta !== null) onDelta?.(delta);
    });

    current.addEventListener("error", () => {
      if (!active()) return;
      report("reconnecting");
      if (current.readyState !== CLOSED) return;
      current.close();
      source = null;
      failures += 1;
      timer = setTimer(open, reconnectDelay(failures, random));
    });
  };

  report("connecting");
  open();

  return () => {
    stopped = true;
    if (timer !== null) clearTimer(timer);
    timer = null;
    source?.close();
    source = null;
  };
}
