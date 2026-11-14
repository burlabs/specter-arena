import json
import random
import re
import string

import pytest

from backend.specter_arena.probe.events import EVENT_FIELDS
from backend.specter_arena.probe.sanitise import (
    DROPPED_ROW_FIELDS,
    MAX_FRAME_BYTES,
    SANITISED_PATTERN,
    SanitiseStats,
    digest,
    placeholder,
    redact_text,
    reduce_event,
    sanitise_frame,
    sanitise_slot_row,
    sanitise_value,
)
from backend.tests.probe_fakes import event_frame, prose_row, slot_row, slots_frame

GRAMMAR = re.compile(r"^(sha256:[0-9a-f]{12}|<redacted type=(str|list|object) len=\d+>)$")
SALT = b"0123456789abcdef"
VALUE_ALPHABET = string.ascii_lowercase[6:]


def test_the_pattern_constant_is_the_v1_14_regex() -> None:
    assert GRAMMAR.pattern == SANITISED_PATTERN


@pytest.mark.parametrize(
    "good",
    ["sha256:0123456789ab", "<redacted type=str len=12>", "<redacted type=list len=0>"],
)
def test_shared_valid_examples_match(good: str) -> None:
    assert GRAMMAR.match(good)


@pytest.mark.parametrize(
    "bad",
    [
        "sha256:0123456789a",
        "sha256:0123456789AB",
        "h:0123456789ab",
        "<redacted type=int len=3>",
        "free text",
    ],
)
def test_shared_invalid_examples_do_not_match(bad: str) -> None:
    assert not GRAMMAR.match(bad)


def random_text(rng: random.Random, low: int = 8, high: int = 24) -> str:
    return "".join(rng.choices(VALUE_ALPHABET, k=rng.randint(low, high)))


def random_value(rng: random.Random, depth: int = 0) -> object:
    kinds = ["str", "int", "float", "bool", "none"]
    if depth < 4:
        kinds += ["list", "dict", "dict"]
    kind = rng.choice(kinds)
    if kind == "str":
        return random_text(rng)
    if kind == "int":
        return rng.randint(-1000, 1000)
    if kind == "float":
        return rng.random() * 100
    if kind == "bool":
        return rng.random() < 0.5
    if kind == "none":
        return None
    if kind == "list":
        return [random_value(rng, depth + 1) for _ in range(rng.randint(0, 4))]
    names = ["key", "created_by", "folder_id"] + [f"k_{i}" for i in range(rng.randint(0, 4))]
    chosen = rng.sample(names, rng.randint(0, len(names)))
    return {name: random_value(rng, depth + 1) for name in chosen}


def leaves(value: object) -> list[object]:
    if isinstance(value, dict):
        return [leaf for child in value.values() for leaf in leaves(child)]
    if isinstance(value, list):
        return [leaf for child in value for leaf in leaves(child)]
    return [value]


def key_names(value: object) -> list[str]:
    if isinstance(value, dict):
        return [n for name, child in value.items() for n in [name, *key_names(child)]]
    return []


def random_row(rng: random.Random) -> dict[str, object]:
    return {"k_root": random_value(rng), "key": random_text(rng, 10, 10)}


def test_every_non_probe_leaf_is_a_scalar_or_in_the_grammar() -> None:
    rng = random.Random(1234)
    for _ in range(300):
        out = sanitise_slot_row(random_row(rng), is_probe=False, salt=SALT)
        for leaf in leaves(out):
            if isinstance(leaf, str):
                assert GRAMMAR.match(leaf), leaf
            else:
                assert leaf is None or isinstance(leaf, bool | int | float)


def test_no_input_string_survives_in_non_probe_output() -> None:
    rng = random.Random(99)
    for _ in range(300):
        row = random_row(rng)
        rendered = json.dumps(sanitise_slot_row(row, is_probe=False, salt=SALT))
        for text in (leaf for leaf in leaves(row) if isinstance(leaf, str)):
            assert text not in rendered


def test_object_keys_are_kept_through_nesting() -> None:
    rng = random.Random(7)
    for _ in range(100):
        row = {"k_root": random_value(rng)}
        out = sanitise_slot_row(row, is_probe=False, salt=SALT)
        assert sorted(key_names(out)) == sorted(key_names(row))


def test_bool_is_not_coerced_to_int() -> None:
    assert sanitise_value(True, SALT) is True
    assert sanitise_value(False, SALT) is False
    assert type(sanitise_value(1, SALT)) is int
    assert sanitise_value(None, SALT) is None
    assert sanitise_value(2.5, SALT) == 2.5


def test_placeholder_length_is_correct_per_type() -> None:
    assert placeholder("abcd") == "<redacted type=str len=4>"
    assert placeholder(["a", "b"]) == "<redacted type=list len=2>"
    assert placeholder(("a",)) == "<redacted type=list len=1>"
    assert placeholder({"a": 1, "b": 2, "c": 3}) == "<redacted type=object len=3>"
    with pytest.raises(TypeError):
        placeholder(b"bytes")


def test_lists_collapse_without_element_values_or_shapes() -> None:
    out = sanitise_value({"tags": ["alpha", {"inner": 1}, 3]}, SALT)
    assert out == {"tags": "<redacted type=list len=3>"}


def test_id_fields_become_digests_and_other_strings_placeholders() -> None:
    out = sanitise_value({"key": "chat-1", "title": "private"}, SALT)
    assert isinstance(out, dict)
    assert out["key"] == digest(SALT, "chat-1")
    assert out["title"] == "<redacted type=str len=7>"


def test_digest_is_deterministic_per_salt_and_differs_across_salts() -> None:
    assert digest(SALT, "chat-1") == digest(SALT, "chat-1")
    assert digest(SALT, "chat-1") != digest(b"another-salt-16by", "chat-1")
    assert digest(SALT, "chat-1") != digest(SALT, "chat-2")


def test_the_salt_never_appears_in_output() -> None:
    row = slot_row("chat-1", created_by="chat-0")
    rendered = json.dumps(sanitise_slot_row(row, is_probe=False, salt=SALT))
    assert SALT.decode() not in rendered
    assert SALT.hex() not in rendered


def test_non_finite_numbers_and_deep_nesting_fail() -> None:
    with pytest.raises(ValueError):
        sanitise_value(float("nan"), SALT)
    deep: object = {"k": 1}
    for _ in range(40):
        deep = {"k": deep}
    with pytest.raises(ValueError):
        sanitise_value(deep, SALT)


def test_redact_text_strips_credential_shapes() -> None:
    dull = "x" * 20
    hexish = "ab" * 20
    samples = [
        f"Authorization: Bearer {dull}",
        f"GET /ws?token={dull}&x=1",
        f"X-App-Secret: {dull}",
        f"mc_token_5476={dull}",
        f"secret={dull}",
        f"digest {hexish}",
        "AKIA" + "A" * 16,
    ]
    for sample in samples:
        redacted = redact_text(sample)
        assert "[redacted]" in redacted, sample
        assert dull not in redacted
        assert hexish not in redacted


def test_redact_text_leaves_plain_prose() -> None:
    assert redact_text("the build finished in 12 s") == "the build finished in 12 s"


def test_probe_rows_keep_values_after_redaction() -> None:
    dull = "y" * 20
    row = slot_row(
        "member-probe",
        title=f"Probe turn token={dull}",
        todo={"items": ["one", "two"]},
        ratio=0.5,
    )
    out = sanitise_slot_row(row, is_probe=True, salt=SALT)
    assert out["title"] == "Probe turn [redacted]"
    assert out["key"] == "member-probe"
    assert out["todo"] == {"items": ["one", "two"]}
    assert dull not in json.dumps(out)


def test_probe_rows_drop_their_prose_fields_and_keep_the_rest() -> None:
    prose = "PROSE-SENTINEL"
    row = prose_row("member-probe", prose)
    out = sanitise_slot_row(row, is_probe=True, salt=SALT)
    assert DROPPED_ROW_FIELDS.isdisjoint(out)
    assert prose not in json.dumps(out)
    for kept in ("agent", "lineage_minted", "source_links", "wait_state", "running"):
        assert out[kept] == row[kept], kept


def test_probe_rows_reject_values_they_cannot_represent() -> None:
    with pytest.raises(ValueError):
        sanitise_slot_row({"key": "member-probe", "raw": b"bytes"}, is_probe=True, salt=SALT)
    with pytest.raises(TypeError):
        sanitise_slot_row("not a row", is_probe=False, salt=SALT)  # type: ignore[arg-type]


def test_probe_slot_keeps_values_and_other_slots_keep_shape_in_one_frame() -> None:
    stats = SanitiseStats()
    frame = slots_frame(
        slot_row("member-probe", title="Probe DM"),
        slot_row("chat-9", title="Someone else's private chat", created_by="chat-3"),
    )
    out = sanitise_frame(frame, "probe", SALT, stats)
    assert out is not None
    rows = out["data"]
    assert isinstance(rows, list)
    probe_row, other_row = rows
    assert probe_row["title"] == "Probe DM"
    assert other_row["title"] == "<redacted type=str len=27>"
    assert other_row["key"] == digest(SALT, "chat-9")
    assert other_row["created_by"] == digest(SALT, "chat-3")
    assert stats.dropped == 0


def test_a_suffixed_dm_slot_and_its_workers_keep_values_but_a_longer_slug_does_not() -> None:
    stats = SanitiseStats()
    frame = slots_frame(
        slot_row("member-probe.memory-s1", title="Probe DM"),
        slot_row("w1", title="Probe worker", created_by="member-probe.memory-s1"),
        slot_row("member-probex", title="Another bot"),
    )
    out = sanitise_frame(frame, "probe", SALT, stats)
    assert out is not None
    rows = out["data"]
    assert isinstance(rows, list)
    dm, worker, other = rows
    assert dm["title"] == "Probe DM"
    assert worker["title"] == "Probe worker"
    assert other["title"] == "<redacted type=str len=11>"
    assert other["key"] == digest(SALT, "member-probex")


def test_a_failing_row_drops_the_whole_frame_and_counts_it() -> None:
    stats = SanitiseStats()
    frame = slots_frame(slot_row("chat-1", blob=b"bytes"))
    assert sanitise_frame(frame, "probe", SALT, stats) is None
    assert stats.dropped == 1


def test_a_non_object_row_drops_the_frame() -> None:
    stats = SanitiseStats()
    frame: dict[str, object] = {"type": "slots", "data": [slot_row("chat-1"), "stray"]}
    assert sanitise_frame(frame, "probe", SALT, stats) is None
    assert stats.dropped == 1


def test_a_non_list_data_field_drops_the_frame() -> None:
    stats = SanitiseStats()
    assert sanitise_frame({"type": "slots", "data": "nope"}, "probe", SALT, stats) is None
    assert stats.dropped == 1


def test_an_oversize_frame_is_dropped_and_counted() -> None:
    stats = SanitiseStats()
    frame = slots_frame(slot_row("chat-1", blob="z" * (1024 * 1024 + 1)))
    assert sanitise_frame(frame, "probe", SALT, stats) is None
    assert stats.dropped == 1


def test_unknown_frame_types_keep_only_their_type_and_are_counted() -> None:
    stats = SanitiseStats()
    frame: dict[str, object] = {"type": "log_replay", "data": ["secret text"], "extra": 1}
    assert sanitise_frame(frame, "probe", SALT, stats) == {"type": "log_replay"}
    assert sanitise_frame(frame, "probe", SALT, stats) == {"type": "log_replay"}
    assert stats.unknown_types == {"log_replay": 2}
    assert stats.dropped == 0


def test_odd_frame_types_are_not_echoed() -> None:
    stats = SanitiseStats()
    odd: dict[str, object] = {"type": "Has Spaces And Secrets"}
    assert sanitise_frame(odd, "p", SALT, stats) == {"type": "invalid"}
    assert sanitise_frame({"type": 5}, "p", SALT, stats) == {"type": "invalid"}
    assert sanitise_frame({}, "p", SALT, stats) == {"type": "invalid"}
    assert stats.unknown_types == {"invalid": 3}


def test_without_a_probe_slug_every_row_is_shape_only() -> None:
    stats = SanitiseStats()
    frame = slots_frame(slot_row("member-probe", title="Probe DM"))
    out = sanitise_frame(frame, "", SALT, stats)
    assert out is not None
    assert out["data"][0]["title"].startswith("<redacted")  # type: ignore[index]


PROBE_SLOTS = frozenset({"member-probe", "w1"})
TEXT = "TEXT-SENTINEL words the probe must never keep"

# Each frame carries every text-bearing key Crew is known to send for its type.
TEXT_BEARING_FRAMES = (
    event_frame("chat_status", slot="member-probe", status=TEXT),
    event_frame("chat_chunk", slot="member-probe", text=TEXT, chunk=TEXT),
    event_frame("chat_thinking", slot="member-probe", text=TEXT),
    event_frame(
        "tool_call",
        slot="member-probe",
        tool=TEXT,
        purpose=TEXT,
        input_preview=TEXT,
        kind="execute",
        tool_call_id="call-1",
    ),
    event_frame("tool_result", slot="member-probe", result=TEXT, kind="execute", is_error=False),
    event_frame(
        "approval", id="ap-1", slot="member-probe", tool=TEXT, tool_input=TEXT, tool_purpose=TEXT
    ),
    event_frame(
        "subagent_spawn",
        id="sa-1",
        slot="member-probe",
        batch_id="b-1",
        task=TEXT,
        agent=TEXT,
        label=TEXT,
        model=TEXT,
    ),
    event_frame("subagent_status", id="sa-1", slot="member-probe", status=TEXT),
    event_frame(
        "subagent_done", id="sa-1", slot="member-probe", result=TEXT, error=TEXT, outcome="done"
    ),
    event_frame("subagent_chunk", id="sa-1", slot="member-probe", text=TEXT),
)


@pytest.mark.parametrize("probe_slots", [PROBE_SLOTS, frozenset()], ids=["probe", "non-probe"])
@pytest.mark.parametrize("frame", TEXT_BEARING_FRAMES, ids=lambda f: str(f["type"]))
def test_no_event_text_survives_for_any_slot(
    frame: dict[str, object], probe_slots: frozenset[str]
) -> None:
    out = sanitise_frame(frame, "probe", SALT, SanitiseStats(), probe_slots)
    assert out is not None
    assert "SENTINEL" not in json.dumps(out)


@pytest.mark.parametrize("event_type", sorted(EVENT_FIELDS))
def test_every_allow_listed_type_keeps_only_its_keys(event_type: str) -> None:
    data = {name: 1 for name in EVENT_FIELDS[event_type]} | {"slot": "member-probe", "extra": 2}
    out = sanitise_frame(
        event_frame(event_type, **data), "probe", SALT, SanitiseStats(), PROBE_SLOTS
    )
    assert out is not None
    assert out["type"] == event_type
    kept = out["data"]
    assert isinstance(kept, dict)
    assert set(kept) == EVENT_FIELDS[event_type]


def test_a_probe_event_keeps_its_slot_and_enum_words_and_digests_ids() -> None:
    frame = event_frame(
        "subagent_done",
        id="sa-1",
        slot="member-probe",
        batch_id="b-1",
        outcome="completed",
        stop_reason="Free text, Not an enum",
        elapsed=3.5,
        credits=2,
        stopped=False,
        partial=None,
    )
    out = reduce_event("subagent_done", frame["data"], PROBE_SLOTS, SALT)
    assert out["slot"] == "member-probe"
    assert out["outcome"] == "completed"
    assert out["id"] == digest(SALT, "sa-1")
    assert out["batch_id"] == digest(SALT, "b-1")
    assert out["stop_reason"] == placeholder("Free text, Not an enum")
    assert (out["elapsed"], out["credits"], out["stopped"], out["partial"]) == (3.5, 2, False, None)


def test_a_non_probe_event_matches_the_grammar_or_is_a_scalar() -> None:
    frame = event_frame(
        "tool_result",
        slot="chat-7",
        kind="execute",
        is_shell=True,
        tool_call_id="call-9",
        is_error=False,
    )
    out = reduce_event("tool_result", frame["data"], PROBE_SLOTS, SALT)
    assert out["slot"] == digest(SALT, "chat-7")
    for value in out.values():
        assert value is None or isinstance(value, bool | int | float) or GRAMMAR.match(str(value))
    assert "chat-7" not in json.dumps(out)


def test_nested_event_values_keep_shape_only_and_odd_values_drop_the_frame() -> None:
    nested = reduce_event(
        "subagent_done", {"slot": "member-probe", "error": {"m": TEXT}}, PROBE_SLOTS, SALT
    )
    assert nested["error"] == "<redacted type=object len=1>"
    assert reduce_event("chat_done", ["not", "an", "object"], PROBE_SLOTS, SALT) == {}
    stats = SanitiseStats()
    bad = event_frame("context_usage", slot="member-probe", pct=float("nan"))
    assert sanitise_frame(bad, "probe", SALT, stats, PROBE_SLOTS) is None
    assert stats.dropped == 1


def test_vocabulary_types_without_fields_keep_their_type_and_are_not_unknown() -> None:
    stats = SanitiseStats()
    for event_type in ("dashboard", "refresh", "chat_chunk", "update_progress"):
        assert sanitise_frame(event_frame(event_type, x=TEXT), "p", SALT, stats) == {
            "type": event_type
        }
    assert stats.unknown_types == {}


def test_an_oversize_event_frame_is_dropped_and_counted() -> None:
    stats = SanitiseStats()
    big = event_frame("chat_done", slot="member-probe", pad="x" * (MAX_FRAME_BYTES + 1))
    assert sanitise_frame(big, "probe", SALT, stats, PROBE_SLOTS) is None
    assert stats.dropped == 1
