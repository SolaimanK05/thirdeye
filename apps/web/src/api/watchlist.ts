import type { EntityKind, Position, WatchItem, Watchlist } from "./client";

export type StarTarget = {
  id: string;
  moduleId: string;
  name: string;
  kind: EntityKind;
  position: Position | null;
  lastSeen: string | null;
};

export type StarItem = {
  entity_id: string;
  module_id: string;
  name: string;
  position: Position | null;
  last_seen: string | null;
};

export function withStar(
  list: Watchlist,
  target: StarTarget,
  starred: boolean,
  nowIso: string,
): Watchlist {
  const rest = list.items.filter((item) => item.entity_id !== target.id);
  if (!starred) return { ...list, items: rest };
  const item: WatchItem = {
    entity_id: target.id,
    name: target.name,
    kind: target.kind,
    module_id: target.moduleId,
    added_at: nowIso,
    last_seen: target.lastSeen ?? nowIso,
    position: target.position,
  };
  return { ...list, items: [item, ...rest] };
}
