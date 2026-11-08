"use client";

import { useWatchlist } from "@/api/queries";

export function PublicBadge() {
  const watchlist = useWatchlist();
  if (watchlist.data?.writable !== false) return null;
  return (
    <span className="shrink-0 border border-amber px-1.5 py-0.5 text-amber text-micro uppercase">
      Public
    </span>
  );
}
