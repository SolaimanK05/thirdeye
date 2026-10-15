"use client";

import { Search, X } from "lucide-react";
import { useRef, useState } from "react";
import { SearchField } from "./search-field";

const ICON_BUTTON =
  "flex size-11 shrink-0 items-center justify-center text-ink-2 transition-colors duration-120 ease-out hover-fine:text-accent";

export function MobileSearch() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={open ? "Close search" : "Search"}
        aria-expanded={open}
        aria-controls="mobile-search"
        onClick={() => setOpen((value) => !value)}
        className={ICON_BUTTON}
      >
        {open ? <X size={20} /> : <Search size={20} />}
      </button>
      {open && (
        <search
          id="mobile-search"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              trigger.current?.focus();
            }
          }}
          className="absolute inset-x-0 top-full z-40 border-line border-b bg-ground px-3 py-2"
        >
          <SearchField
            id="console-search-mobile"
            focusOnMount
            onPick={() => setOpen(false)}
          />
        </search>
      )}
    </>
  );
}
