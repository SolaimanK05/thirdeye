import asyncio
from datetime import timedelta
from typing import Any

import psycopg
import pytest
from conftest import NOW

from thirdeye.layers import LayerCache
from thirdeye.reads import SnapshotRecord
from thirdeye.stream import (
    Broadcaster,
    ModuleKind,
    Subscriber,
    event_id,
    parse_event_id,
    refresh_delay,
)

LATER = NOW + timedelta(seconds=60)
EVEN_LATER = NOW + timedelta(seconds=120)


def plane(
    n: int, lon: float = 90.0, lat: float = 23.0, **changes: Any
) -> dict[str, Any]:
    return {
        "id": f"b0000000-0000-4000-8000-{n:012d}",
        "kind": "aircraft",
        "name": f"PLANE{n}",
        "lon": lon,
        "lat": lat,
        "t": NOW.isoformat(),
        "sog": 400.0,
        "cog": 90.0,
        "heading": None,
        "alt": 10000.0,
        "confidence": "observed",
        "attrs": {},
    } | changes


class World:
    def __init__(self) -> None:
        self.snapshots: dict[str, SnapshotRecord | None] = {}
        self.fetched: dict[str, Any] = {}
        self.loads: list[str] = []
        self.failing = False

    def put(self, module_id: str, *rows: dict[str, Any], at: Any = NOW) -> None:
        self.snapshots[module_id] = SnapshotRecord(payload=list(rows), fetched_at=at)
        self.fetched[module_id] = at

    async def load(self, module_id: str) -> SnapshotRecord | None:
        self.loads.append(module_id)
        if self.failing:
            raise psycopg.OperationalError("the database is down")
        return self.snapshots.get(module_id)

    async def fetched_at(self, module_id: str) -> Any:
        if self.failing:
            raise psycopg.OperationalError("the database is down")
        return self.fetched.get(module_id)


MODULES: dict[str, ModuleKind] = {
    "aircraft": "entities",
    "ports": "entities",
    "earthquakes": "events",
}


def build(
    world: World, modules: dict[str, ModuleKind] | None = None, **options: Any
) -> tuple[Broadcaster, LayerCache]:
    cache = LayerCache(world.load)
    broadcaster = Broadcaster(
        cache,
        world.fetched_at,
        MODULES if modules is None else modules,
        "test-instance",
        clock=lambda: NOW,
        **options,
    )
    return broadcaster, cache


async def update(
    world: World,
    broadcaster: Broadcaster,
    cache: LayerCache,
    module_id: str,
    *rows: dict[str, Any],
    at: Any = LATER,
) -> None:
    world.put(module_id, *rows, at=at)
    cache.invalidate(module_id)
    await broadcaster.refresh(module_id)


async def drain(subscriber: Subscriber) -> list[Any]:
    events = []
    while subscriber.pending:
        event = await subscriber.next()
        if event is None:
            break
        events.append(event)
    return events


async def started() -> tuple[World, Broadcaster, LayerCache]:
    world = World()
    world.put("aircraft", plane(1), plane(2))
    world.put("ports", plane(9, kind="facility") | {"kind": "facility"})
    world.put("earthquakes", at=NOW)
    broadcaster, cache = build(world)
    await broadcaster.ready(broadcaster.entity_modules)
    for module_id in MODULES:
        await broadcaster.refresh(module_id)
    return world, broadcaster, cache


class TestEventIds:
    def test_an_id_round_trips(self) -> None:
        assert parse_event_id(event_id("ab12cd34", 17)) == ("ab12cd34", 17)

    @pytest.mark.parametrize(
        "value", [None, "", "17", "-17", "abc-", "abc-x", "abc--1", "abc-1.5", "abc-١٢"]
    )
    def test_bad_ids_are_refused(self, value: str | None) -> None:
        assert parse_event_id(value) is None


class TestConnecting:
    async def test_a_new_client_gets_hello_then_a_snapshot_per_entity_module(
        self,
    ) -> None:
        _, broadcaster, _ = await started()
        client = broadcaster.subscribe(frozenset({"aircraft", "ports"}))
        events = await drain(client)
        assert [e.kind for e in events] == ["hello", "snapshot", "snapshot"]
        assert [e.module_id for e in events[1:]] == ["aircraft", "ports"]
        assert events[0].id is None
        assert '"resumed":false' in events[0].data
        assert '"instance":"test-instance"' in events[0].data
        assert events[0].retry == 3000

    async def test_only_the_last_snapshot_carries_an_id(self) -> None:
        _, broadcaster, _ = await started()
        events = await drain(broadcaster.subscribe(frozenset({"aircraft", "ports"})))
        assert [e.id is None for e in events] == [True, True, False]
        assert events[2].id == event_id(broadcaster.epoch, broadcaster.last_seq)

    async def test_a_snapshot_holds_every_row_and_the_version(self) -> None:
        _, broadcaster, _ = await started()
        events = await drain(broadcaster.subscribe(frozenset({"aircraft"})))
        snapshot = events[1].data
        assert '"module_id":"aircraft"' in snapshot
        assert '"version":1' in snapshot
        assert snapshot.count('"name":"PLANE') == 2

    async def test_a_client_that_wants_no_entities_gets_only_hello(self) -> None:
        _, broadcaster, _ = await started()
        events = await drain(broadcaster.subscribe(frozenset()))
        assert [e.kind for e in events] == ["hello"]

    async def test_snapshots_are_built_once_per_version(self) -> None:
        _, broadcaster, _ = await started()
        first = await drain(broadcaster.subscribe(frozenset({"aircraft"})))
        second = await drain(broadcaster.subscribe(frozenset({"aircraft"})))
        assert first[1].data is second[1].data

    async def test_a_closed_broadcaster_ends_new_clients_at_once(self) -> None:
        _, broadcaster, _ = await started()
        broadcaster.close()
        client = broadcaster.subscribe(frozenset())
        assert await client.next() is None
        assert broadcaster.clients == 0


class TestUpdates:
    async def test_an_entity_update_sends_a_layer_notice_and_a_delta(self) -> None:
        world, broadcaster, cache = await started()
        client = broadcaster.subscribe(frozenset({"aircraft"}))
        await drain(client)
        await update(
            world,
            broadcaster,
            cache,
            "aircraft",
            plane(1, lon=91.0),
            plane(3),
        )
        layer, delta = await drain(client)
        assert (layer.kind, delta.kind) == ("layer", "delta")
        assert '"version":2' in layer.data
        assert delta.data.count('"name":"PLANE') == 2
        assert '"upserts"' in delta.data
        assert '"removes":["b0000000-0000-4000-8000-000000000002"]' in delta.data
        assert layer.id == event_id(broadcaster.epoch, broadcaster.last_seq - 1)
        assert delta.id == event_id(broadcaster.epoch, broadcaster.last_seq)

    async def test_an_unchanged_row_is_not_sent_again(self) -> None:
        world, broadcaster, cache = await started()
        client = broadcaster.subscribe(frozenset({"aircraft"}))
        await drain(client)
        await update(
            world, broadcaster, cache, "aircraft", plane(1), plane(2, lat=24.0)
        )
        _, delta = await drain(client)
        assert delta.data.count('"name":"PLANE') == 1
        assert '"name":"PLANE2"' in delta.data
        assert '"removes":[]' in delta.data

    async def test_a_refresh_with_nothing_new_sends_nothing(self) -> None:
        _, broadcaster, cache = await started()
        client = broadcaster.subscribe(frozenset({"aircraft"}))
        await drain(client)
        before = broadcaster.last_seq
        cache.invalidate("aircraft")
        await broadcaster.refresh("aircraft")
        assert broadcaster.last_seq == before
        assert client.pending == 0

    async def test_versions_count_up_one_per_update(self) -> None:
        world, broadcaster, cache = await started()
        client = broadcaster.subscribe(frozenset({"aircraft"}))
        await drain(client)
        for step, at in enumerate((LATER, EVEN_LATER), start=2):
            await update(
                world, broadcaster, cache, "aircraft", plane(1, lon=step), at=at
            )
        events = await drain(client)
        versions = [e.data for e in events if e.kind == "delta"]
        assert ['"version":2' in versions[0], '"version":3' in versions[1]] == [
            True,
            True,
        ]

    async def test_an_event_module_only_sends_a_layer_notice(self) -> None:
        world, broadcaster, _ = await started()
        client = broadcaster.subscribe(frozenset({"aircraft"}))
        await drain(client)
        world.put("earthquakes", at=LATER)
        await broadcaster.refresh("earthquakes")
        [event] = await drain(client)
        assert event.kind == "layer"
        assert event.module_id == "earthquakes"
        assert '"version":2' in event.data

    async def test_the_first_load_is_a_baseline_and_sends_nothing(self) -> None:
        world = World()
        world.put("aircraft", plane(1))
        broadcaster, _ = build(world)
        await broadcaster.refresh("aircraft")
        assert broadcaster.last_seq == 0
        assert broadcaster.buffered == 0

    async def test_deltas_only_reach_clients_that_asked_for_the_module(self) -> None:
        world, broadcaster, cache = await started()
        wants_planes = broadcaster.subscribe(frozenset({"aircraft"}))
        wants_ports = broadcaster.subscribe(frozenset({"ports"}))
        wants_nothing = broadcaster.subscribe(frozenset())
        for client in (wants_planes, wants_ports, wants_nothing):
            await drain(client)
        await update(world, broadcaster, cache, "aircraft", plane(1, lon=95.0))
        assert [e.kind for e in await drain(wants_planes)] == ["layer", "delta"]
        assert [e.kind for e in await drain(wants_ports)] == ["layer"]
        assert [e.kind for e in await drain(wants_nothing)] == ["layer"]

    async def test_a_row_that_disappears_is_a_remove(self) -> None:
        world, broadcaster, cache = await started()
        client = broadcaster.subscribe(frozenset({"aircraft"}))
        await drain(client)
        await update(world, broadcaster, cache, "aircraft")
        _, delta = await drain(client)
        assert '"upserts":[]' in delta.data
        assert delta.data.count("b0000000-0000-4000-8000-00000000000") == 2

    async def test_a_module_that_was_never_filled_is_an_empty_baseline(self) -> None:
        world = World()
        broadcaster, _ = build(world)
        await broadcaster.ready({"aircraft"})
        events = await drain(broadcaster.subscribe(frozenset({"aircraft"})))
        assert '"entities":[]' in events[1].data
        assert '"fetched_at":null' in events[1].data


class TestReplay:
    async def make(self, **options: Any) -> tuple[World, Broadcaster, LayerCache]:
        world = World()
        world.put("aircraft", plane(1))
        world.put("earthquakes", at=NOW)
        broadcaster, cache = build(
            world,
            {"aircraft": "entities", "earthquakes": "events"},
            **options,
        )
        await broadcaster.refresh("aircraft")
        await broadcaster.refresh("earthquakes")
        return world, broadcaster, cache

    async def publish(
        self, world: World, broadcaster: Broadcaster, cache: LayerCache, count: int
    ) -> None:
        for step in range(count):
            at = NOW + timedelta(seconds=60 * (step + 1))
            await update(
                world, broadcaster, cache, "aircraft", plane(1, lon=step), at=at
            )

    async def test_a_client_inside_the_buffer_gets_only_what_it_missed(self) -> None:
        world, broadcaster, cache = await self.make()
        await self.publish(world, broadcaster, cache, 3)
        seen = event_id(broadcaster.epoch, 2)
        events = await drain(broadcaster.subscribe(frozenset({"aircraft"}), seen))
        assert [e.kind for e in events] == ["hello", "layer", "delta", "layer", "delta"]
        assert '"resumed":true' in events[0].data
        assert [e.id for e in events[1:]] == [
            event_id(broadcaster.epoch, n) for n in (3, 4, 5, 6)
        ]

    async def test_a_client_that_is_up_to_date_gets_only_hello(self) -> None:
        world, broadcaster, cache = await self.make()
        await self.publish(world, broadcaster, cache, 2)
        seen = event_id(broadcaster.epoch, broadcaster.last_seq)
        events = await drain(broadcaster.subscribe(frozenset({"aircraft"}), seen))
        assert [e.kind for e in events] == ["hello"]
        assert '"resumed":true' in events[0].data

    async def test_replay_leaves_out_deltas_the_client_did_not_ask_for(self) -> None:
        world, broadcaster, cache = await self.make()
        await self.publish(world, broadcaster, cache, 2)
        seen = event_id(broadcaster.epoch, 0)
        events = await drain(broadcaster.subscribe(frozenset(), seen))
        assert [e.kind for e in events] == ["hello", "layer", "layer"]

    async def test_a_client_older_than_the_buffer_gets_fresh_snapshots(self) -> None:
        world, broadcaster, cache = await self.make(ring_events=4)
        await self.publish(world, broadcaster, cache, 6)
        assert broadcaster.buffered == 4
        seen = event_id(broadcaster.epoch, 1)
        events = await drain(broadcaster.subscribe(frozenset({"aircraft"}), seen))
        assert [e.kind for e in events] == ["hello", "snapshot"]
        assert '"resumed":false' in events[0].data

    async def test_the_oldest_buffered_event_is_still_replayable(self) -> None:
        world, broadcaster, cache = await self.make(ring_events=4)
        await self.publish(world, broadcaster, cache, 6)
        seen = event_id(broadcaster.epoch, broadcaster.last_seq - 4)
        events = await drain(broadcaster.subscribe(frozenset({"aircraft"}), seen))
        assert [e.kind for e in events] == ["hello", "layer", "delta", "layer", "delta"]

    async def test_an_id_from_another_process_gets_fresh_snapshots(self) -> None:
        world, broadcaster, cache = await self.make()
        await self.publish(world, broadcaster, cache, 2)
        events = await drain(
            broadcaster.subscribe(frozenset({"aircraft"}), "deadbeef-2")
        )
        assert [e.kind for e in events] == ["hello", "snapshot"]

    async def test_an_id_from_the_future_gets_fresh_snapshots(self) -> None:
        world, broadcaster, cache = await self.make()
        await self.publish(world, broadcaster, cache, 1)
        seen = event_id(broadcaster.epoch, broadcaster.last_seq + 5)
        events = await drain(broadcaster.subscribe(frozenset({"aircraft"}), seen))
        assert [e.kind for e in events] == ["hello", "snapshot"]

    async def test_a_junk_id_gets_fresh_snapshots(self) -> None:
        _, broadcaster, _ = await self.make()
        events = await drain(broadcaster.subscribe(frozenset({"aircraft"}), "junk"))
        assert [e.kind for e in events] == ["hello", "snapshot"]

    async def test_the_buffer_keeps_at_most_the_configured_events(self) -> None:
        world, broadcaster, cache = await self.make(ring_events=500)
        await self.publish(world, broadcaster, cache, 300)
        assert broadcaster.last_seq == 600
        assert broadcaster.buffered == 500

    async def test_the_buffer_is_also_capped_by_size(self) -> None:
        world, broadcaster, cache = await self.make(ring_bytes=1500)
        await self.publish(world, broadcaster, cache, 12)
        assert 1 <= broadcaster.buffered < 12

    async def test_a_reply_that_is_too_big_for_the_cap_is_still_kept(self) -> None:
        world, broadcaster, cache = await self.make(ring_bytes=10)
        await self.publish(world, broadcaster, cache, 2)
        assert broadcaster.buffered == 1


class TestSlowClients:
    async def prepared(self, **options: Any) -> tuple[World, Broadcaster, LayerCache]:
        world = World()
        world.put("aircraft", plane(1))
        broadcaster, cache = build(world, {"aircraft": "entities"}, **options)
        await broadcaster.refresh("aircraft")
        return world, broadcaster, cache

    async def push(
        self,
        world: World,
        broadcaster: Broadcaster,
        cache: LayerCache,
        count: int,
        first: int = 0,
    ) -> None:
        for step in range(first, first + count):
            at = NOW + timedelta(seconds=60 * (step + 1))
            await update(
                world, broadcaster, cache, "aircraft", plane(1, lon=step), at=at
            )

    async def test_a_client_over_the_event_limit_is_dropped(self) -> None:
        world, broadcaster, cache = await self.prepared(client_events=3)
        slow = broadcaster.subscribe(frozenset())
        quick = broadcaster.subscribe(frozenset())
        for step in range(3):
            await self.push(world, broadcaster, cache, 1, first=step)
            await drain(quick)
        assert slow.dropped
        assert broadcaster.clients == 1
        assert await slow.next() is None
        assert not quick.dropped

    async def test_a_client_over_the_byte_limit_is_dropped(self) -> None:
        world, broadcaster, cache = await self.prepared(client_bytes=600)
        client = broadcaster.subscribe(frozenset({"aircraft"}))
        await self.push(world, broadcaster, cache, 1)
        assert client.dropped
        assert broadcaster.clients == 0

    async def test_a_dropped_client_can_resume_from_the_buffer(self) -> None:
        world, broadcaster, cache = await self.prepared(client_events=3)
        client = broadcaster.subscribe(frozenset({"aircraft"}))
        received = await drain(client)
        assert [e.kind for e in received] == ["hello", "snapshot"]
        seen = received[-1].id
        await self.push(world, broadcaster, cache, 2)
        assert client.dropped
        assert await drain(client) == []
        resumed = await drain(broadcaster.subscribe(frozenset({"aircraft"}), seen))
        assert [e.kind for e in resumed] == [
            "hello",
            "layer",
            "delta",
            "layer",
            "delta",
        ]
        assert '"resumed":true' in resumed[0].data

    async def test_one_slow_client_does_not_hold_up_the_others(self) -> None:
        world, broadcaster, cache = await self.prepared(client_events=2)
        stuck = broadcaster.subscribe(frozenset({"aircraft"}))
        quick = broadcaster.subscribe(frozenset({"aircraft"}))
        await drain(quick)
        await self.push(world, broadcaster, cache, 1)
        assert stuck.dropped
        assert [e.kind for e in await drain(quick)] == ["layer", "delta"]

    async def test_unsubscribing_removes_the_client_and_ends_its_stream(self) -> None:
        _, broadcaster, _ = await started()
        client = broadcaster.subscribe(frozenset())
        assert broadcaster.clients == 1
        broadcaster.unsubscribe(client)
        assert broadcaster.clients == 0
        first = await client.next()
        assert first is not None and first.kind == "hello"
        assert await client.next() is None

    async def test_closing_lets_clients_read_what_is_queued_then_ends_them(
        self,
    ) -> None:
        _, broadcaster, _ = await started()
        client = broadcaster.subscribe(frozenset({"aircraft"}))
        broadcaster.close()
        first = await client.next()
        second = await client.next()
        assert first is not None and first.kind == "hello"
        assert second is not None and second.kind == "snapshot"
        assert await client.next() is None
        assert await client.next() is None


class TestRunning:
    async def test_a_notification_is_turned_into_events(self) -> None:
        world, broadcaster, cache = await started()
        client = broadcaster.subscribe(frozenset({"aircraft"}))
        await drain(client)
        task = asyncio.create_task(broadcaster.run())
        try:
            world.put("aircraft", plane(1, lon=70.0), at=LATER)
            cache.invalidate("aircraft")
            broadcaster.notify("aircraft")
            layer = await asyncio.wait_for(client.next(), 2)
            delta = await asyncio.wait_for(client.next(), 2)
        finally:
            task.cancel()
        assert layer is not None and delta is not None
        assert (layer.kind, delta.kind) == ("layer", "delta")

    async def test_notifying_everything_refreshes_every_module(self) -> None:
        world, broadcaster, cache = await started()
        client = broadcaster.subscribe(frozenset())
        await drain(client)
        task = asyncio.create_task(broadcaster.run())
        try:
            world.put("aircraft", plane(1, lon=70.0), at=LATER)
            world.put("earthquakes", at=LATER)
            cache.invalidate()
            broadcaster.notify(None)
            first = await asyncio.wait_for(client.next(), 2)
            second = await asyncio.wait_for(client.next(), 2)
        finally:
            task.cancel()
        assert first is not None and second is not None
        assert sorted([first.module_id or "", second.module_id or ""]) == [
            "aircraft",
            "earthquakes",
        ]

    async def test_unknown_modules_are_ignored(self) -> None:
        _, broadcaster, _ = await started()
        broadcaster._dirty.clear()
        broadcaster.notify("nowhere")
        assert not broadcaster._dirty
        assert not broadcaster._wake.is_set()

    async def test_a_failed_refresh_is_retried_with_a_growing_delay(self) -> None:
        world, broadcaster, cache = await started()
        sleeps: list[float] = []
        retried = asyncio.Event()

        async def sleep(seconds: float) -> None:
            sleeps.append(seconds)
            if len(sleeps) == 2:
                world.failing = False
            if len(sleeps) == 3:
                retried.set()

        broadcaster._sleep = sleep
        client = broadcaster.subscribe(frozenset({"aircraft"}))
        await drain(client)
        world.put("aircraft", plane(1, lon=70.0), at=LATER)
        cache.invalidate("aircraft")
        world.failing = True
        task = asyncio.create_task(broadcaster.run())
        try:
            broadcaster.notify("aircraft")
            layer = await asyncio.wait_for(client.next(), 2)
        finally:
            task.cancel()
        assert layer is not None and layer.kind == "layer"
        assert sleeps == [5.0, 10.0]

    async def test_a_baseline_that_cannot_load_raises_for_the_caller(self) -> None:
        world = World()
        world.failing = True
        broadcaster, _ = build(world)
        with pytest.raises(psycopg.OperationalError):
            await broadcaster.ready({"aircraft"})

    async def test_concurrent_baselines_load_the_layer_once(self) -> None:
        world = World()
        world.put("aircraft", plane(1))
        broadcaster, _ = build(world)
        await asyncio.gather(*(broadcaster.ready({"aircraft"}) for _ in range(10)))
        assert world.loads == ["aircraft"]


def test_the_retry_delay_doubles_and_caps() -> None:
    assert [refresh_delay(n) for n in (1, 2, 3, 4, 5, 50)] == [5, 10, 20, 40, 60, 60]
