import { formatCount } from "./count";

export type NoticeInput = {
  /** The satellites module is on, has its data, and is set to draw all. */
  active: boolean;
  /** The zoom is inside the satellites' range, so they are drawn. */
  inRange: boolean;
  pinned: boolean;
  /** How many satellites have their sub-point in the view; undefined until known. */
  here: number | undefined;
  /** The zoom percent above which satellites hide themselves. */
  capPercent: number;
};

export type Notice = {
  text: string;
  action: "show-here" | "auto";
};

function overhead(here: number | undefined): string {
  if (here === undefined) return "";
  return `${formatCount(here)} overhead`;
}

/** The note at the top of the globe about the satellites that the zoom hides. */
export function satellitesNotice(input: NoticeInput): Notice | null {
  if (!input.active) return null;
  if (input.pinned && !input.inRange) {
    const count = overhead(input.here);
    return {
      text: count === "" ? "Showing satellites here" : `Showing ${count}`,
      action: "auto",
    };
  }
  if (input.inRange) return null;
  const count = overhead(input.here);
  const base = `Satellites auto-hide above ${input.capPercent}%`;
  return {
    text: count === "" ? base : `${base}. ${count}`,
    action: "show-here",
  };
}
