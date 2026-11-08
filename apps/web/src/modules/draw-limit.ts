/**
 * The per-module draw limit: how many markers a module may put on the globe.
 * `null` means no limit. The cut is never random: starred and selected
 * markers always stay, and the rest are ranked by the module's own measure of
 * importance (altitude, ship size, magnitude, ...), ties going to the earlier
 * row, so the same data always gives the same picture.
 */
export type DrawLimit = number | null;

export const DRAW_PRESETS: readonly number[] = [2_000, 5_000, 10_000];
export const DRAW_LIMIT_MAX = 1_000_000;
/** What a module draws on the 2D canvas fallback until the user says otherwise. */
export const CANVAS_DEFAULT_LIMIT = 2_000;

export type RendererKind = "webgl2" | "canvas";

export function defaultLimit(kind: RendererKind): DrawLimit {
  return kind === "canvas" ? CANVAS_DEFAULT_LIMIT : null;
}

/**
 * Reads what a person typed into the limit field. Returns undefined when the
 * text is not a limit, so the field can keep the old value.
 */
export function parseLimit(text: string): DrawLimit | undefined {
  const cleaned = text
    .trim()
    .toUpperCase()
    .replace(/[,_\s]/g, "");
  if (cleaned === "ALL") return null;
  if (!/^\d+$/.test(cleaned)) return undefined;
  const value = Number(cleaned);
  if (value < 1) return undefined;
  return Math.min(value, DRAW_LIMIT_MAX);
}

export function sanitiseLimits(value: unknown): Record<string, DrawLimit> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, DrawLimit] =>
        entry[1] === null ||
        (typeof entry[1] === "number" &&
          Number.isInteger(entry[1]) &&
          entry[1] >= 1 &&
          entry[1] <= DRAW_LIMIT_MAX),
    ),
  );
}

export function resolveLimit(
  chosen: Readonly<Record<string, DrawLimit>>,
  moduleId: string,
  kind: RendererKind,
): DrawLimit {
  return moduleId in chosen ? chosen[moduleId] : defaultLimit(kind);
}

function swap(values: Float64Array, a: number, b: number) {
  const held = values[a];
  values[a] = values[b];
  values[b] = held;
}

function median(a: number, b: number, c: number): number {
  if (a < b) return b < c ? b : a < c ? c : a;
  return a < c ? a : b < c ? c : b;
}

/** The value that would sit at `rank` (from zero) if `values[0..count)` were sorted ascending. */
function nth(values: Float64Array, count: number, rank: number): number {
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const pivot = median(values[low], values[(low + high) >>> 1], values[high]);
    let below = low;
    let at = low;
    let above = high;
    while (at <= above) {
      const value = values[at];
      if (value < pivot) {
        swap(values, below, at);
        below += 1;
        at += 1;
      } else if (value > pivot) {
        swap(values, at, above);
        above -= 1;
      } else {
        at += 1;
      }
    }
    if (rank < below) high = below - 1;
    else if (rank > above) low = above + 1;
    else return pivot;
  }
  return values[low];
}

/**
 * Which of `count` candidates to draw: `forced` ones always, then the highest
 * keys until `limit` is reached. Returns null when everything fits, otherwise
 * a mask with 1 for each candidate to draw. Missing keys (NaN) rank last and
 * equal keys go to the earlier index.
 */
export function selectTop(
  count: number,
  keyOf: (index: number) => number,
  isForced: (index: number) => boolean,
  limit: number,
): Uint8Array | null {
  if (count <= limit) return null;
  const mask = new Uint8Array(count);
  const keys = new Float64Array(count);
  const pool = new Float64Array(count);
  let forced = 0;
  let pooled = 0;
  for (let index = 0; index < count; index++) {
    if (isForced(index)) {
      mask[index] = 1;
      forced += 1;
      continue;
    }
    const key = keyOf(index);
    const ranked = Number.isNaN(key) ? Number.NEGATIVE_INFINITY : key;
    keys[index] = ranked;
    pool[pooled++] = ranked;
  }
  const room = Math.max(0, limit - forced);
  if (room === 0) return mask;
  if (pooled <= room) {
    for (let index = 0; index < count; index++) mask[index] = 1;
    return mask;
  }
  const cut = nth(pool, pooled, pooled - room);
  let above = 0;
  for (let index = 0; index < count; index++) {
    if (mask[index] === 0 && keys[index] > cut) above += 1;
  }
  let ties = room - above;
  for (let index = 0; index < count; index++) {
    if (mask[index] === 1) continue;
    if (keys[index] > cut) {
      mask[index] = 1;
    } else if (keys[index] === cut && ties > 0) {
      mask[index] = 1;
      ties -= 1;
    }
  }
  return mask;
}

export type Limited<Row> = { rows: Row[]; drawn: number };

/** The row-list form of `selectTop`, keeping the rows' order. */
export function limitRows<Row extends { id: string }>(
  rows: readonly Row[],
  limit: DrawLimit,
  importance: ((row: Row) => number) | undefined,
  keep: ReadonlySet<string> = new Set(),
): Limited<Row> {
  if (limit === null) return { rows: [...rows], drawn: rows.length };
  const mask = selectTop(
    rows.length,
    (index) => (importance ? importance(rows[index]) : 0),
    (index) => keep.has(rows[index].id),
    limit,
  );
  if (mask === null) return { rows: [...rows], drawn: rows.length };
  const drawn = rows.filter((_row, index) => mask[index] === 1);
  return { rows: drawn, drawn: drawn.length };
}
