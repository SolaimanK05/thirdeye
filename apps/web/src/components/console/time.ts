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

export function formatMinute(at: Date): string {
  const parts = formatUtc(at);
  return `${parts.time.slice(0, 5)}Z`;
}

export function formatClock(at: Date): string {
  return formatUtc(at).time;
}

export function formatShortDate(at: Date): string {
  return `${pad(at.getUTCDate())} ${MONTHS[at.getUTCMonth()]}`;
}

export function relativeAge(then: Date, nowMs: number): string {
  const seconds = Math.max(0, Math.round((nowMs - then.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}
