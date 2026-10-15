import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Watchlist } from "./client";
import type { StarTarget } from "./watchlist";

const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<(request: Request) => Promise<Response>>();
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
});

const { queryKeys, refreshSeconds, starMutationOptions } = await import(
  "./queries"
);

const TARGET: StarTarget = {
  id: "a0000000-0000-4000-8000-000000000001",
  moduleId: "ports",
  name: "Karachi",
  kind: "facility",
  position: { lon: 66.9, lat: 24.8 },
  lastSeen: "2026-10-15T06:00:00Z",
};

const EMPTY: Watchlist = { writable: true, items: [] };

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(queryKeys.watchlist, EMPTY);
  const observer = new MutationObserver(client, starMutationOptions(client));
  return { client, observer };
}

const ids = (client: QueryClient) =>
  client
    .getQueryData<Watchlist>(queryKeys.watchlist)
    ?.items.map((item) => item.entity_id);

beforeEach(() => {
  fetchMock.mockReset();
});

describe("starring", () => {
  test("shows the star at once, before the server answers", async () => {
    let release: (response: Response) => void = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const { client, observer } = setup();
    const done = observer.mutate({ target: TARGET, starred: true });
    await vi.waitFor(() => expect(ids(client)).toEqual([TARGET.id]));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release(new Response(null, { status: 204 }));
    await done;
  });

  test("puts the watchlist back when the server refuses", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "forbidden", message: "Not allowed" },
        }),
        { status: 403, headers: { "content-type": "application/json" } },
      ),
    );
    const { client, observer } = setup();
    await expect(
      observer.mutate({ target: TARGET, starred: true }),
    ).rejects.toThrow("Not allowed");
    expect(ids(client)).toEqual([]);
  });

  test("puts a removed star back when unstarring fails", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    const { client, observer } = setup();
    client.setQueryData<Watchlist>(queryKeys.watchlist, {
      writable: true,
      items: [
        {
          entity_id: TARGET.id,
          name: TARGET.name,
          kind: TARGET.kind,
          module_id: TARGET.moduleId,
          added_at: "2026-10-15T05:00:00Z",
          last_seen: "2026-10-15T06:00:00Z",
          position: TARGET.position,
        },
      ],
    });
    await expect(
      observer.mutate({ target: TARGET, starred: false }),
    ).rejects.toThrow();
    expect(ids(client)).toEqual([TARGET.id]);
  });

  test("uses PUT to star and DELETE to unstar", async () => {
    fetchMock.mockImplementation(
      async () => new Response(null, { status: 204 }),
    );
    const { observer } = setup();
    await observer.mutate({ target: TARGET, starred: true });
    await observer.mutate({ target: TARGET, starred: false });
    expect(fetchMock.mock.calls.map(([request]) => request.method)).toEqual([
      "PUT",
      "DELETE",
    ]);
  });
});

describe("refreshSeconds", () => {
  test("follows the module cadence between the floor and the ceiling", () => {
    expect(refreshSeconds(5)).toBe(15);
    expect(refreshSeconds(60)).toBe(60);
    expect(refreshSeconds(7 * 24 * 3600)).toBe(3600);
  });
});
