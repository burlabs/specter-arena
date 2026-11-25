import copy
from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest

from backend.specter_arena.store import (
    BindingRecord,
    BindingSeen,
    DmKey,
    IngestBatch,
    QuarantineIn,
    QuarantineRecord,
    RosterPoll,
    RosterRowIn,
    Store,
    get_binding,
    ingest,
    open_store,
    recent_quarantine,
    start_run,
)
from backend.specter_arena.wire import (
    READERS,
    ContractViolation,
    bot_binding_to_wire,
    quarantine_record_to_wire,
)
from backend.tests.contract_support import compile_schema, load_registry

REGISTRY = load_registry()
BINDING_SCHEMA = compile_schema("urn:specter-arena:contract:bot-binding:v1", REGISTRY)
QUARANTINE_SCHEMA = compile_schema("urn:specter-arena:contract:quarantine-record:v1", REGISTRY)
T0 = 1_800_000_000_000
RUN = "run-00000001"


def binding(**fields: Any) -> BindingRecord:
    base = BindingRecord(
        binding_id="bnd_0123456789abcdef01234567",
        installation_id="00000000-0000-4000-8000-000000000001",
        member_id="alpha-0123456789ab",
        memory_store="memory-alpha",
        display_name="Alpha",
        presence="present",
        created_at_ms=T0,
        last_seen_ms=T0 + 5,
    )
    return replace(base, **fields)


def quarantine(**fields: Any) -> QuarantineRecord:
    base = QuarantineRecord(
        installation_id="00000000-0000-4000-8000-000000000001",
        reason="unknown-event-type",
        frame_type="mystery_frame",
        size_bytes=1234,
        digest="sha256:0123456789ab",
        count=7,
        first_received_at_ms=T0,
        received_at_ms=T0 + 9,
    )
    return replace(base, **fields)


@pytest.fixture
def store(tmp_path: Path) -> Iterator[Store]:
    opened = open_store(tmp_path / "data")
    try:
        yield opened
    finally:
        opened.close()


def test_the_registry_has_a_reader_for_both_store_wire_objects() -> None:
    assert {"bot-binding", "quarantine-record"} <= set(READERS)


@pytest.mark.parametrize("presence", ["present", "absent", "unknown"])
def test_a_binding_validates_against_the_real_schema_for_every_presence(presence: str) -> None:
    wire = bot_binding_to_wire(binding(presence=presence))
    assert BINDING_SCHEMA(wire) == wire
    assert READERS["bot-binding"](wire) == wire
    assert wire["presence"] == presence and wire["contractVersion"] == 1


def test_a_binding_with_no_name_or_last_seen_time_carries_nulls() -> None:
    wire = bot_binding_to_wire(binding(display_name=None, last_seen_ms=None))
    assert (wire["displayName"], wire["lastSeenAtMs"]) == (None, None)
    assert BINDING_SCHEMA(wire) == wire


def test_the_display_name_is_bounded_at_128_characters() -> None:
    assert bot_binding_to_wire(binding(display_name="n" * 128))["displayName"] == "n" * 128
    with pytest.raises(ContractViolation):
        bot_binding_to_wire(binding(display_name="n" * 129))


@pytest.mark.parametrize(
    "fields",
    [
        {"memory_store": "has.dot"},
        {"member_id": "Bad"},
        {"binding_id": "bnd/x"},
        {"installation_id": ""},
        {"created_at_ms": -1},
    ],
)
def test_a_stored_value_the_wire_cannot_carry_raises_instead_of_leaking(
    fields: dict[str, Any],
) -> None:
    with pytest.raises(ContractViolation):
        bot_binding_to_wire(binding(**fields))


def test_a_binding_wire_body_carries_no_dm_key_or_slot_key() -> None:
    wire = bot_binding_to_wire(binding())
    assert "dmKey" not in wire and not any("member-" in str(v) for v in wire.values())


def test_a_quarantine_record_validates_against_the_real_schema() -> None:
    wire = quarantine_record_to_wire(quarantine())
    assert QUARANTINE_SCHEMA(wire) == wire
    assert READERS["quarantine-record"](wire) == wire
    assert (wire["bindingId"], wire["sourceTimeMs"], wire["count"]) == (None, None, 7)
    assert (wire["firstReceivedAtMs"], wire["receivedAtMs"]) == (T0, T0 + 9)


def test_a_quarantine_record_without_a_digest_carries_null() -> None:
    wire = quarantine_record_to_wire(quarantine(digest=None, frame_type="invalid"))
    assert (wire["digest"], wire["frameType"]) == (None, "invalid")
    assert QUARANTINE_SCHEMA(wire) == wire


@pytest.mark.parametrize(
    "fields",
    [
        {"count": 0},
        {"count": 2**31},
        {"digest": "sha256:XYZ"},
        {"reason": "Bad Reason"},
        {"size_bytes": -1},
    ],
)
def test_a_quarantine_value_the_wire_cannot_carry_raises(fields: dict[str, Any]) -> None:
    with pytest.raises(ContractViolation):
        quarantine_record_to_wire(quarantine(**fields))


def test_the_readers_reject_extra_missing_and_mistyped_properties() -> None:
    good_binding = bot_binding_to_wire(binding())
    good_quarantine = quarantine_record_to_wire(quarantine())
    for name, good in (("bot-binding", good_binding), ("quarantine-record", good_quarantine)):
        extra = {**good, "extra": 1}
        missing = {k: v for k, v in good.items() if k != "contractVersion"}
        wrong_version = {**good, "contractVersion": 2}
        bad: Any
        for bad in (extra, missing, wrong_version, [], None, "text"):
            with pytest.raises(ContractViolation):
                READERS[name](copy.deepcopy(bad))


def test_the_store_records_round_trip_through_the_wire(store: Store) -> None:
    started = start_run(store, run_id=RUN, now_ms=T0)
    key = DmKey("alpha-0123456789ab", "memory-alpha")
    result = ingest(
        store,
        IngestBatch(
            RUN,
            started.installation_id,
            (
                BindingSeen(key, T0),
                RosterPoll(
                    True, T0 + 1, (RosterRowIn("memory-alpha", "Alpha", "Alpha Bot", None, None),)
                ),
                QuarantineIn(T0 + 2, "unknown-event-type", "mystery", 40, count=3),
            ),
        ),
    )
    binding_id = result.bindings[0].binding_id
    record = get_binding(store, binding_id)
    assert record is not None
    wire = bot_binding_to_wire(record)
    assert BINDING_SCHEMA(wire) == wire
    assert (wire["bindingId"], wire["displayName"], wire["presence"]) == (
        binding_id,
        "Alpha Bot",
        "present",
    )
    assert wire["installationId"] == started.installation_id
    (quarantined,) = recent_quarantine(store, limit=1)
    body = quarantine_record_to_wire(quarantined)
    assert QUARANTINE_SCHEMA(body) == body
    assert (body["count"], body["frameType"], body["firstReceivedAtMs"]) == (3, "mystery", T0 + 2)
