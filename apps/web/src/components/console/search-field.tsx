import type { Ref } from "react";
import { cx } from "./cx";

export function SearchField({
  id,
  inputRef,
  className,
}: {
  id: string;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex h-8.5 items-center gap-2 border border-line-2 bg-well px-2.5 focus-within:outline focus-within:outline-1 focus-within:outline-accent focus-within:outline-offset-2",
        className,
      )}
    >
      <span aria-hidden="true" className="text-accent">
        &gt;
      </span>
      <label htmlFor={id} className="sr-only">
        Search all modules
      </label>
      <input
        ref={inputRef}
        id={id}
        type="search"
        name="q"
        autoComplete="off"
        spellCheck={false}
        placeholder="ship, aircraft, place"
        className="h-8 min-w-0 flex-1 bg-transparent text-ink focus-visible:outline-none"
      />
      <span
        aria-hidden="true"
        className="h-3.75 w-2 bg-accent/90 motion-safe:animate-blink"
      />
      <kbd className="hidden border border-line-2 px-1.5 text-ink-3 text-label tracking-normal lg:inline">
        /
      </kbd>
    </div>
  );
}
