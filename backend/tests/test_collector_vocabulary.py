import json
from pathlib import Path

from backend.specter_arena.collector.vocabulary import (
    HANDLED_TYPES,
    IGNORED_TYPES,
    LIMITS,
    PARSE_REJECT_REASONS,
    QUARANTINE_REASONS,
    REJECT_REASONS,
    STORE_REJECT_REASONS,
    classify_type,
)

TESTS_DIR = Path(__file__).resolve().parent
REPO_ROOT = TESTS_DIR.parents[1]
FIXTURE = TESTS_DIR / "fixtures" / "collector" / "frame-types-0.12.2.json"
VOCABULARY = REPO_ROOT / "docs" / "compatibility" / "event-vocabulary.json"


def vocabulary_names() -> set[str]:
    body = json.loads(VOCABULARY.read_text())
    return set(body["eventTypes"]) - {"other"}


def fixture_names() -> set[str]:
    return set(json.loads(FIXTURE.read_text())["types"])


def test_handled_and_ignored_are_disjoint() -> None:
    assert HANDLED_TYPES.isdisjoint(IGNORED_TYPES)


def test_ignored_is_a_subset_of_vocabulary_union_fixture() -> None:
    assert vocabulary_names() | fixture_names() >= IGNORED_TYPES


def test_every_vocabulary_and_fixture_name_is_classified() -> None:
    unclassified = (vocabulary_names() | fixture_names()) - HANDLED_TYPES - IGNORED_TYPES
    assert unclassified == set()


def test_heartbeat_and_the_twelve_extra_types_are_ignored() -> None:
    extra = fixture_names() - vocabulary_names()
    assert len(extra) == 12
    assert "heartbeat" in extra
    assert extra <= IGNORED_TYPES


def test_fixture_holds_names_and_counts_only() -> None:
    body = json.loads(FIXTURE.read_text())
    assert set(body) == {"crewVersion", "run", "types"}
    assert all(isinstance(count, int) and count > 0 for count in body["types"].values())


def test_unlisted_name_is_quarantined_never_ignored() -> None:
    assert classify_type("brand_new_frame") == "quarantine"
    assert classify_type("") == "quarantine"
    assert classify_type("slots") == "handled"
    assert classify_type("chat_chunk") == "ignored"
    assert classify_type("heartbeat") == "ignored"


def test_every_vocabulary_and_fixture_name_has_a_category() -> None:
    categories = {classify_type(name) for name in vocabulary_names() | fixture_names()}
    assert categories == {"handled", "ignored"}


def test_reason_sets_are_closed_and_token_shaped() -> None:
    assert REJECT_REASONS == PARSE_REJECT_REASONS | STORE_REJECT_REASONS
    for reason in REJECT_REASONS | QUARANTINE_REASONS:
        assert reason.islower()
        assert reason.replace("-", "").isalpha()


def test_limits_match_the_contract_numbers() -> None:
    assert LIMITS.event_queue_max == 1_000
    assert LIMITS.batch_max == 100
    assert LIMITS.raw_frame_max_chars == 64 * 1024
    assert LIMITS.ws_max_size == 2 * 1024 * 1024
    assert LIMITS.roster_poll_rows_max == 200
    assert LIMITS.backoff_s == (1, 2, 4, 8, 16, 30)
