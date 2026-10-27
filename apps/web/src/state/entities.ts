import { useCallback, useSyncExternalStore } from "react";
import type { EntityRow } from "@/api/client";

export type EntitySource = "stream" | "query";

export type ModuleEntities = {
  readonly rows: readonly EntityRow[];
  readonly version: number;
  readonly fetchedAtMs: number | null;
  readonly updatedAt: number;
  readonly source: EntitySource;
};

export type EntityChange = {
  readonly moduleId: string;
  readonly upserts: readonly EntityRow[];
  readonly removes: readonly string[];
  readonly reset: boolean;
};

type Entry = {
  byId: Map<string, EntityRow>;
  version: number;
  fetchedAtMs: number | null;
  updatedAt: number;
  source: EntitySource;
  view: ModuleEntities | null;
};

type Listener = () => void;
type ChangeListener = (change: EntityChange) => void;

export function parseInstant(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function newer(candidate: number | null, current: number | null): boolean {
  if (candidate === null) return false;
  return current === null || candidate > current;
}

function notOlder(candidate: number | null, current: number | null): boolean {
  if (current === null || candidate === null) return true;
  return candidate >= current;
}

export class EntityStore {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly changes = new Set<ChangeListener>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  view(moduleId: string): ModuleEntities | undefined {
    const entry = this.entries.get(moduleId);
    if (!entry) return undefined;
    entry.view ??= {
      rows: Array.from(entry.byId.values()),
      version: entry.version,
      fetchedAtMs: entry.fetchedAtMs,
      updatedAt: entry.updatedAt,
      source: entry.source,
    };
    return entry.view;
  }

  has(moduleId: string): boolean {
    return this.entries.has(moduleId);
  }

  applySnapshot(
    moduleId: string,
    rows: readonly EntityRow[],
    fetchedAt: string | null,
    version: number,
  ): boolean {
    const fetchedAtMs = parseInstant(fetchedAt);
    const current = this.entries.get(moduleId);
    if (current && !notOlder(fetchedAtMs, current.fetchedAtMs)) return false;
    this.replace(moduleId, rows, fetchedAtMs, version, "stream");
    return true;
  }

  seed(
    moduleId: string,
    rows: readonly EntityRow[],
    fetchedAt: string | null,
  ): boolean {
    const fetchedAtMs = parseInstant(fetchedAt);
    const current = this.entries.get(moduleId);
    if (current && !newer(fetchedAtMs, current.fetchedAtMs)) return false;
    this.replace(moduleId, rows, fetchedAtMs, 0, "query");
    return true;
  }

  applyDelta(
    moduleId: string,
    upserts: readonly EntityRow[],
    removes: readonly string[],
    fetchedAt: string | null,
    version: number,
  ): boolean {
    const entry = this.entries.get(moduleId);
    if (!entry || version <= entry.version) return false;
    for (const row of upserts) entry.byId.set(row.id, row);
    for (const id of removes) entry.byId.delete(id);
    const fetchedAtMs = parseInstant(fetchedAt);
    if (newer(fetchedAtMs, entry.fetchedAtMs)) entry.fetchedAtMs = fetchedAtMs;
    entry.version = version;
    entry.updatedAt = this.now();
    entry.source = "stream";
    entry.view = null;
    this.emit(moduleId, { moduleId, upserts, removes, reset: false });
    return true;
  }

  clear(moduleId?: string): void {
    const ids = moduleId === undefined ? [...this.entries.keys()] : [moduleId];
    for (const id of ids) {
      if (this.entries.delete(id)) {
        this.emit(id, { moduleId: id, upserts: [], removes: [], reset: true });
      }
    }
  }

  subscribe(moduleId: string, listener: Listener): () => void {
    let set = this.listeners.get(moduleId);
    if (!set) {
      set = new Set();
      this.listeners.set(moduleId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  observe(listener: ChangeListener): () => void {
    this.changes.add(listener);
    return () => {
      this.changes.delete(listener);
    };
  }

  private replace(
    moduleId: string,
    rows: readonly EntityRow[],
    fetchedAtMs: number | null,
    version: number,
    source: EntitySource,
  ): void {
    this.entries.set(moduleId, {
      byId: new Map(rows.map((row) => [row.id, row])),
      version,
      fetchedAtMs,
      updatedAt: this.now(),
      source,
      view: null,
    });
    this.emit(moduleId, {
      moduleId,
      upserts: rows,
      removes: [],
      reset: true,
    });
  }

  private emit(moduleId: string, change: EntityChange): void {
    for (const listener of this.changes) listener(change);
    for (const listener of this.listeners.get(moduleId) ?? []) listener();
  }
}

export const entityStore = new EntityStore();

export function useEntityView(moduleId: string): ModuleEntities | undefined {
  const subscribe = useCallback(
    (listener: Listener) => entityStore.subscribe(moduleId, listener),
    [moduleId],
  );
  return useSyncExternalStore(
    subscribe,
    () => entityStore.view(moduleId),
    () => undefined,
  );
}
