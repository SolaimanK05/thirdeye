export type LabelBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LabelCandidate = LabelBox & { priority: number };

export function overlaps(a: LabelBox, b: LabelBox): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

export function placeLabels<T extends LabelCandidate>(
  candidates: readonly T[],
  limit: number,
  blocked: readonly LabelBox[] = [],
): T[] {
  const order = [...candidates].sort((a, b) => b.priority - a.priority);
  const placed: T[] = [];
  for (const candidate of order) {
    if (placed.length >= limit) break;
    if (blocked.some((box) => overlaps(candidate, box))) continue;
    if (placed.some((box) => overlaps(candidate, box))) continue;
    placed.push(candidate);
  }
  return placed;
}
