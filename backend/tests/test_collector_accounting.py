import json
from dataclasses import fields

from backend.specter_arena.collector.accounting import UNLISTED, Accounting, Breakdown

SC3_7_FIELDS = (
    "received",
    "ignored",
    "coalesced",
    "persisted",
    "deduplicated",
    "quarantined",
    "rejected",
    "dropped_with_gap_record",
)


def test_accounting_has_exactly_the_eight_sc3_7_fields() -> None:
    assert tuple(item.name for item in fields(Accounting)) == SC3_7_FIELDS
    assert tuple(Accounting().counts()) == SC3_7_FIELDS


def test_empty_accounting_balances() -> None:
    assert Accounting().balanced(0)


def test_every_disposition_balances_the_equation() -> None:
    accounting = Accounting()
    for name in SC3_7_FIELDS[1:]:
        accounting.received += 1
        setattr(accounting, name, getattr(accounting, name) + 1)
        assert accounting.balanced(0)


def test_in_flight_units_balance_only_when_declared() -> None:
    accounting = Accounting(received=10, persisted=6, ignored=1)
    assert not accounting.balanced(0)
    assert not accounting.balanced(2)
    assert accounting.balanced(3)


def test_a_lost_unit_unbalances() -> None:
    accounting = Accounting(received=5, persisted=4)
    assert not accounting.balanced(0)


def test_diagnostics_carry_counts_and_balance_only() -> None:
    accounting = Accounting(received=3, ignored=1, persisted=1)
    body = accounting.diagnostics(in_flight=1)
    assert body == {
        "counts": accounting.counts(),
        "in_flight": 1,
        "balanced": True,
    }


def test_breakdown_counts_closed_set_members() -> None:
    breakdown = Breakdown()
    breakdown.ignore_type("chat_chunk", 3)
    breakdown.ignore_type("heartbeat")
    breakdown.ignore_reason("worker-event")
    breakdown.reject("oversize-frame", 2)
    breakdown.quarantine("schema-mismatch")
    assert breakdown.as_dict() == {
        "ignored_by_type": {"chat_chunk": 3, "heartbeat": 1},
        "ignored_by_reason": {"worker-event": 1},
        "rejected": {"oversize-frame": 2},
        "quarantined": {"schema-mismatch": 1},
    }


def test_breakdown_collapses_gateway_text_to_unlisted() -> None:
    hostile = "member-secret-9d63166ee3a3.memory-x"
    breakdown = Breakdown()
    breakdown.ignore_type(hostile)
    breakdown.ignore_reason(hostile)
    breakdown.reject(hostile)
    breakdown.quarantine(hostile)
    body = breakdown.as_dict()
    assert hostile not in json.dumps(body)
    for counter in body.values():
        assert counter == {UNLISTED: 1}


def test_diagnostics_with_breakdown_never_hold_gateway_text() -> None:
    breakdown = Breakdown()
    breakdown.reject("sentinel-title-text")
    body = Accounting(received=1, rejected=1).diagnostics(0, breakdown)
    assert "sentinel-title-text" not in json.dumps(body)
    assert body["balanced"] is True
