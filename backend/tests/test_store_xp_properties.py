"""Seeded property tests for the XP ledger (FP-09-AC02, FP-09-AC03).

Randomness comes only from `random.Random(seed)`; every assertion message carries the seed, so a
failure replays exactly. No property-testing package is used.
"""

import contextlib
import random
from collections import Counter
from collections.abc import Callable
from functools import partial
from pathlib import Path
from typing import Any

import pytest

from backend.specter_arena.store import (
    Store,
    StoreError,
    StoreUnavailable,
    WorkRecord,
    create_work,
    decide_work,
    get_work,
    link_attempt,
    set_milestone,
    split_bounty,
    xp_summaries,
)
from backend.specter_arena.store.work import ACTIONS, TRANSITIONS

from .work_fakes import (
    T0,
    Seeded,
    decide,
    invariants,
    make_work,
    open_seeded,
    query,
    submit_and_accept,
    token,
)

CONSERVATION_SEEDS = range(1_000, 1_200)
DETERMINISM_SEEDS = range(2_000, 2_030)
RETRY_SEEDS = range(3_000, 3_060)
TREE_SEEDS = range(4_000, 4_040)
OPERATION_SEEDS = range(5_000, 5_060)
OPERATIONS_PER_SEED = 110


def ledger_shape(store: Store) -> list[tuple[int, int, str, int]]:
    """The ledger without ids: (work index by creation order, seq, kind, amount), sorted."""
    order = {
        str(r[0]): index
        for index, r in enumerate(query(store, "SELECT work_id FROM work_item ORDER BY rowid"))
    }
    return sorted(
        (order[str(w)], int(s), str(k), int(a))
        for w, s, k, a in query(store, "SELECT work_id, seq, kind, amount FROM xp_entry")
    )


def contributor_ids(store: Store, work_id: str) -> list[str]:
    rows = query(
        store, "SELECT DISTINCT binding_id FROM work_attempt WHERE work_id = ? ORDER BY 1", work_id
    )
    return [str(r[0]) for r in rows]


def awards_of(store: Store, work_id: str) -> dict[str, int]:
    rows = query(
        store,
        "SELECT binding_id, amount FROM xp_entry WHERE work_id = ? AND kind = 'award'",
        work_id,
    )
    return {str(b): int(a) for b, a in rows}


def random_attempts(rnd: random.Random, seeded: Seeded) -> list[str]:
    """One to eight bots, each with one or two of its attempts, at most sixteen in all."""
    bots = rnd.sample(range(len(seeded.attempts)), rnd.randint(1, len(seeded.attempts)))
    chosen: list[str] = []
    for bot in bots:
        chosen.extend(rnd.sample(list(seeded.attempts[bot]), rnd.randint(1, 2)))
    return chosen


def conservation_scenario(root: Path, seed: int) -> tuple[Store, WorkRecord, list[str]]:
    rnd = random.Random(seed)
    opened, seeded = open_seeded(root, bots=8, per_bot=2)
    chosen = random_attempts(rnd, seeded)
    rnd.shuffle(chosen)
    record = make_work(opened, chosen, 1)
    return opened, submit_and_accept(opened, record, 1, at=T0 + 5000), chosen


def test_budget_is_conserved_over_random_contributor_sets(tmp_path: Path) -> None:
    for seed in CONSERVATION_SEEDS:
        opened, accepted, chosen = conservation_scenario(tmp_path / f"s{seed}", seed)
        try:
            note = f"seed={seed}"
            awards = awards_of(opened, accepted.work_id)
            people = contributor_ids(opened, accepted.work_id)
            assert sum(awards.values()) == 100, note
            assert awards == {b: v for b, v in split_bounty(100, people).items() if v > 0}, note
            assert len(awards) == len(people) == len({c.binding_id for c in accepted.contributors})
            assert {c.binding_id: c.xp_net for c in accepted.contributors} == awards, note
            assert max(awards.values()) - min(awards.values()) <= 1, note
            assert len(chosen) <= 16, note
        finally:
            opened.close()


def build_scenario(root: Path, seed: int) -> tuple[Store, list[WorkRecord]]:
    """Two random items on one store, one reopened and accepted again, from the seed alone."""
    rnd = random.Random(seed)
    opened, seeded = open_seeded(root, bots=6, per_bot=4)
    pool = [list(per_bot) for per_bot in seeded.attempts]
    made: list[WorkRecord] = []
    for n in range(1, 3):
        chosen: list[str] = []
        for bot in rnd.sample(range(6), rnd.randint(1, 4)):
            for _ in range(rnd.randint(1, 2)):
                chosen.append(pool[bot].pop())
        record = make_work(opened, chosen, n, at=T0 + 1000 * n)
        accepted = submit_and_accept(opened, record, n, at=T0 + 1000 * n + 10)
        if rnd.random() < 0.5:
            reopened = decide(opened, accepted, "reopen", 30 + n, at=T0 + 9000 + n)
            accepted = submit_and_accept(opened, reopened, 40 + n, at=T0 + 9100 + n)
        made.append(accepted)
    return opened, made


def test_allocation_is_deterministic_for_the_same_inputs(tmp_path: Path) -> None:
    for seed in DETERMINISM_SEEDS:
        first, first_made = build_scenario(tmp_path / f"a{seed}", seed)
        second, second_made = build_scenario(tmp_path / f"b{seed}", seed)
        try:
            note = f"seed={seed}"
            assert ledger_shape(first) == ledger_shape(second), note
            for store, made in ((first, first_made), (second, second_made)):
                for record in made:
                    people = contributor_ids(store, record.work_id)
                    expected = {b: v for b, v in split_bounty(100, people).items() if v > 0}
                    assert awards_of(store, record.work_id) == expected, note
        finally:
            first.close()
            second.close()


def test_no_duplicate_credit_across_retries(tmp_path: Path) -> None:
    for seed in RETRY_SEEDS:
        rnd = random.Random(seed)
        opened, seeded = open_seeded(tmp_path / f"s{seed}", bots=4, per_bot=6)
        try:
            note = f"seed={seed}"
            bots = rnd.sample(range(4), rnd.randint(1, 4))
            first = [seeded.attempts[b][0] for b in bots]
            record = make_work(opened, first, 1)
            extra = [(b, k) for b in bots for k in range(1, 6)]
            rnd.shuffle(extra)
            for bot, k in extra[: rnd.randint(0, 8)]:
                record = link_attempt(
                    opened,
                    record.work_id,
                    expected_version=record.version,
                    attempt_id=seeded.attempts[bot][k],
                    now_ms=T0 + 1500,
                )
            accepted = submit_and_accept(opened, record, 1, at=T0 + 2000)
            for _ in range(rnd.randint(1, 4)):
                replay = decide_work(
                    opened,
                    accepted.work_id,
                    action="accept",
                    expected_version=record.version + 1,
                    request_token=token("accept", 1),
                    evidence_revision=record.evidence_revision,
                    note=None,
                    now_ms=T0 + 3000,
                )
                assert replay.replayed, note
            with pytest.raises(StoreError):
                decide(opened, accepted, "accept", 2, at=T0 + 4000)
            per_binding = Counter(
                str(r[0])
                for r in query(opened, "SELECT binding_id FROM xp_entry WHERE kind = 'award'")
            )
            assert set(per_binding.values()) == {1}, note
            assert len(per_binding) == len(bots), note
            assert sum(s.total_xp for s in xp_summaries(opened)) == 100, note
        finally:
            opened.close()


def random_node(
    store: Store, rnd: random.Random, free: list[str], parent_id: str | None, n: int
) -> WorkRecord:
    take = [free.pop() for _ in range(min(len(free), rnd.randint(0, 3)))]
    return make_work(
        store, take, n, rewardable=rnd.random() < 0.8, parent_id=parent_id, at=T0 + 100 * n
    )


def test_no_duplicate_credit_across_parent_child_trees(tmp_path: Path) -> None:
    for seed in TREE_SEEDS:
        rnd = random.Random(seed)
        opened, seeded = open_seeded(tmp_path / f"s{seed}", bots=4, per_bot=8)
        try:
            note = f"seed={seed}"
            free = seeded.flat()
            rnd.shuffle(free)
            nodes: list[tuple[WorkRecord, int]] = []

            counter = 1
            root = random_node(opened, rnd, free, None, counter)
            nodes.append((root, 1))
            for _ in range(rnd.randint(2, 6)):
                parent, depth = rnd.choice([x for x in nodes if x[1] < 3])
                counter += 1
                nodes.append((random_node(opened, rnd, free, parent.work_id, counter), depth + 1))
            current = {r.work_id: get_work(opened, r.work_id) for r, _ in nodes}
            leaves = [r for r in current.values() if r.child_count == 0]
            deeper_first = sorted(
                (r for r in current.values() if r.child_count > 0),
                key=lambda r: -dict((x.work_id, d) for x, d in nodes)[r.work_id],
            )
            rnd.shuffle(leaves)
            accepted_leaf_credit = 0
            for number, leaf in enumerate(leaves, start=1):
                if not leaf.attempts:
                    continue
                submit_and_accept(
                    opened, get_work(opened, leaf.work_id), number, at=T0 + 9000 + number
                )
                accepted_leaf_credit += 100 if leaf.rewardable else 0
            for number, container in enumerate(deeper_first, start=1):
                fresh = get_work(opened, container.work_id)
                with contextlib.suppress(StoreError):
                    submit_and_accept(opened, fresh, 500 + number, at=T0 + 20_000 + number)
            for container in deeper_first:
                assert not query(
                    opened, "SELECT 1 FROM xp_entry WHERE work_id = ?", container.work_id
                ), note
            total = sum(s.total_xp for s in xp_summaries(opened))
            assert total == accepted_leaf_credit, note
            per_pair = Counter(
                (str(r[0]), str(r[1]))
                for r in query(
                    opened, "SELECT work_id, binding_id FROM xp_entry WHERE kind = 'award'"
                )
            )
            assert all(count == 1 for count in per_pair.values()), note
        finally:
            opened.close()


def run_operations(
    root: Path, seed: int, operations: int = OPERATIONS_PER_SEED
) -> tuple[Store, Counter[str]]:
    rnd = random.Random(seed)
    opened, seeded = open_seeded(root, bots=4, per_bot=8)
    free = seeded.flat()
    rnd.shuffle(free)
    works: list[str] = []
    tokens: list[tuple[str, str, str, str | None]] = []
    outcomes: Counter[str] = Counter()
    clock = [T0 + 1000]
    serial = [0]
    note = f"seed={seed}"

    def tick() -> int:
        clock[0] += rnd.choice([0, 1, 2, 5])
        return clock[0]

    def fresh_token() -> str:
        serial[0] += 1
        return f"s{seed:05d}-tok-{serial[0]:06d}"

    def tolerate(call: Callable[[], Any]) -> Any:
        try:
            result = call()
        except StoreUnavailable as error:
            raise AssertionError(
                f"{note}: a trigger fired through the API: {error.__cause__}"
            ) from error
        except StoreError as error:
            outcomes[type(error).__name__] += 1
            return None
        outcomes["ok"] += 1
        return result

    weights = [2, 1, 1, 1, 8, 1, 1, 1]
    kinds = ["create", "child", "link", "milestone", "act", "replay", "tamper", "stalerev"]
    for _ in range(operations):
        op = rnd.choices(kinds, weights=weights, k=1)[0]
        if op in ("create", "child") or not works:
            low = 0 if op == "child" else 1
            take = [free.pop() for _ in range(min(len(free), rnd.randint(low, 4)))]
            parent = rnd.choice(works[-3:]) if (op == "child" and works) else None
            made = tolerate(
                partial(
                    create_work,
                    opened,
                    request_token=fresh_token(),
                    title="t",
                    acceptance_condition="c",
                    rewardable=rnd.random() < 0.85,
                    parent_id=parent,
                    attempt_ids=take,
                    milestones=[f"m{i}" for i in range(rnd.randint(0, 3))],
                    now_ms=tick(),
                )
            )
            if made is None:
                free.extend(take)
            else:
                works.append(made.record.work_id)
        elif op == "link" and free:
            target = rnd.choice(works[-4:])
            attempt = free.pop()
            record = get_work(opened, target)
            linked = tolerate(
                partial(
                    link_attempt,
                    opened,
                    target,
                    expected_version=record.version,
                    attempt_id=attempt,
                    now_ms=tick(),
                )
            )
            if linked is None:
                free.append(attempt)
        elif op == "milestone":
            target = rnd.choice(works[-4:])
            record = get_work(opened, target)
            if record.milestones:
                tolerate(
                    partial(
                        set_milestone,
                        opened,
                        target,
                        expected_version=record.version,
                        position=rnd.randint(1, len(record.milestones)),
                        done=rnd.random() < 0.5,
                        now_ms=tick(),
                    )
                )
        elif op == "act":
            target = rnd.choice(works[-4:])
            record = get_work(opened, target)
            legal = [a for a, (frm, _) in TRANSITIONS.items() if record.state in frm]
            if rnd.random() < 0.12 or not legal:
                action = rnd.choice(ACTIONS)
            elif "accept" in legal and rnd.random() < 0.7:
                action = "accept"
            elif record.state in ("open", "reopened") and rnd.random() < 0.7:
                action = "submit"
            elif record.state == "accepted" and rnd.random() < 0.5:
                action = "reopen"
            else:
                action = rnd.choice(legal)
            used = fresh_token()
            revision = record.evidence_revision if action in ("accept", "reject") else None
            done_result = tolerate(
                partial(
                    decide_work,
                    opened,
                    target,
                    action=action,
                    expected_version=record.version,
                    request_token=used,
                    evidence_revision=revision,
                    note=None,
                    now_ms=tick(),
                )
            )
            if done_result is not None:
                tokens.append((target, action, used, revision))
        elif op == "replay" and tokens:
            target, action, used, revision = rnd.choice(tokens)
            record = get_work(opened, target)
            replayed = tolerate(
                partial(
                    decide_work,
                    opened,
                    target,
                    action=action,
                    expected_version=record.version,
                    request_token=used,
                    evidence_revision=revision,
                    note=None,
                    now_ms=tick(),
                )
            )
            if replayed is not None:
                assert replayed.replayed, f"{note}: a replayed token must never write"
        elif op == "tamper":
            rows = query(opened, "SELECT attempt_id FROM work_attempt ORDER BY rowid")
            if rows:
                victim = str(rnd.choice(rows)[0])
                with opened.write() as conn:
                    if rnd.random() < 0.5:
                        conn.execute(
                            "UPDATE attempt SET running = 1, ended_ms = NULL WHERE attempt_id = ?",
                            (victim,),
                        )
                    else:
                        conn.execute(
                            "UPDATE attempt SET running = 0, ended_ms = COALESCE(ended_ms, 0) + 1"
                            " WHERE attempt_id = ?",
                            (victim,),
                        )
        elif op == "stalerev":
            target = rnd.choice(works[-4:])
            record = get_work(opened, target)
            tolerate(
                partial(
                    decide_work,
                    opened,
                    target,
                    action=rnd.choice(["accept", "reject"]),
                    expected_version=record.version,
                    request_token=fresh_token(),
                    evidence_revision="0" * 24,
                    note=None,
                    now_ms=tick(),
                )
            )
        invariants(opened, note)
    return opened, outcomes


def test_random_operation_sequences_keep_every_ledger_invariant(tmp_path: Path) -> None:
    totals: Counter[str] = Counter()
    entries_written = 0
    for seed in OPERATION_SEEDS:
        opened, outcomes = run_operations(tmp_path / f"s{seed}", seed)
        try:
            totals.update(outcomes)
            entries_written += query(opened, "SELECT count(*) FROM xp_entry")[0][0]
        finally:
            opened.close()
    assert sum(totals.values()) >= len(OPERATION_SEEDS) * OPERATIONS_PER_SEED * 0.9
    assert totals["ok"] > 0 and totals["StaleEvidence"] > 0
    assert entries_written > 0


def test_the_same_seed_gives_the_same_ledger_shape(tmp_path: Path) -> None:
    for seed in OPERATION_SEEDS[:5]:
        first, first_outcomes = run_operations(tmp_path / f"a{seed}", seed)
        second, second_outcomes = run_operations(tmp_path / f"b{seed}", seed)
        try:
            assert ledger_shape(first) == ledger_shape(second), f"seed={seed}"
            assert first_outcomes == second_outcomes, f"seed={seed}"
        finally:
            first.close()
            second.close()
