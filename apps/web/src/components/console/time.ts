const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

const pad = (n: number) => String(n).padStart(2, "0");

export type UtcParts = {
  iso: string;
  time: string;
  date: string;
};

export function formatUtc(at: Date): UtcParts {
  const iso = `${at.toISOString().slice(0, 19)}Z`;
  return {
    iso,
    time: `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())}Z`,
    date: `${WEEKDAYS[at.getUTCDay()]} ${pad(at.getUTCDate())} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`,
  };
}

export function msUntilNextSecond(nowMs: number): number {
  return 1000 - (nowMs % 1000);
}
