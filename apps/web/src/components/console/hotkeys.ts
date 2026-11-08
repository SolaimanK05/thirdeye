export function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT")
  );
}

export function isPlainKey(event: KeyboardEvent, key: string): boolean {
  return (
    event.key === key &&
    !event.repeat &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    !isTyping(event.target)
  );
}

/** Escape clears the selection unless something that is open should take it first. */
export function clearsSelection(
  event: KeyboardEvent,
  active: Element | null,
): boolean {
  return (
    !event.defaultPrevented &&
    active?.getAttribute("aria-expanded") !== "true" &&
    isPlainKey(event, "Escape")
  );
}
