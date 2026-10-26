export type StreamStatus = "connecting" | "live" | "reconnecting";

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
  onResync: () => void;
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

export function parseHello(data: string): { resumed: boolean } | null {
  const body = parseJson(data);
  return typeof body?.resumed === "boolean" ? { resumed: body.resumed } : null;
}

export function parseLayerNotice(data: string): string | null {
  const body = parseJson(data);
  return typeof body?.module_id === "string" ? body.module_id : null;
}

export function startStream(options: StreamOptions): () => void {
  const {
    url,
    onStatus,
    onLayer,
    onResync,
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
      if (announced && !hello.resumed) onResync();
      announced = true;
      report("live");
    });

    current.addEventListener("layer", (event) => {
      if (!active()) return;
      const moduleId = parseLayerNotice(event.data);
      if (moduleId !== null) onLayer(moduleId);
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
