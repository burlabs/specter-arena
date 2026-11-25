"""FP-08-AC06: an unsigned or badly signed acceptance is rejected and writes no row. Row hashes
of every ledger table and the attempt projection are compared around each attempt."""

import json
import secrets
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from starlette.testclient import TestClient

from .work_api_fakes import SIGNING_VALUE, Api, WorkRig, build_rig, run, signed
from .work_fakes import ledger_hash, query, token


@pytest.fixture(autouse=True)
def gateway_value(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KIROCREW_PROXY_SECRET", SIGNING_VALUE)


@pytest.fixture
def rig(tmp_path: Path) -> Iterator[tuple[WorkRig, TestClient]]:
    made = build_rig(tmp_path)
    try:
        with TestClient(made.app) as client:
            yield made, client
    finally:
        made.store.close()


def awaiting_review(made: WorkRig, n: int, bot: int) -> dict[str, Any]:
    _, created = run(
        made.service.create_work(
            {
                "requestId": token("create", n),
                "title": "Write the release notes",
                "acceptanceCondition": "The owner read them and agrees.",
                "rewardable": True,
                "attemptIds": [made.seeded.attempts[bot][0], made.seeded.attempts[bot][1]],
                "milestones": [],
            }
        )
    )
    return run(
        made.service.decide(
            created["workId"],
            {"requestId": token("submit", n), "expectedVersion": 1, "action": "submit"},
        )
    )


def accept_body(item: dict[str, Any], n: int = 1, **changes: Any) -> bytes:
    body = {
        "requestId": token("accept", n),
        "expectedVersion": item["version"],
        "action": "accept",
        "evidenceRevision": item["evidenceRevision"],
        **changes,
    }
    return json.dumps(body).encode()


def send(client: TestClient, item: dict[str, Any], raw: bytes, headers: dict[str, str]) -> Any:
    return client.post(f"/api/work/{item['workId']}/decisions", content=raw, headers=headers)


def test_an_unsigned_or_badly_signed_acceptance_is_rejected_and_writes_nothing(
    rig: tuple[WorkRig, TestClient],
) -> None:
    made, client = rig
    item = awaiting_review(made, 1, 0)
    raw = accept_body(item)
    target = f"/api/work/{item['workId']}/decisions"
    before = ledger_hash(made.store)
    other = b'{"requestId": "somebody-else"}'
    used = secrets.token_hex(16)
    assert client.get("/api/xp", headers=signed("GET", "/api/xp", nonce=used)).status_code == 200

    attempts: dict[str, dict[str, str]] = {
        "no headers": {},
        "wrong signing value": signed("POST", target, raw, signing="another-signing-value"),
        "signature over another body": signed("POST", target, other),
        "signature over another path": signed("POST", "/api/work", raw),
        "signature over another method": signed("GET", target, raw),
        "timestamp two minutes old": signed("POST", target, raw, age_s=120),
        "replayed nonce": signed("POST", target, raw, nonce=used),
        "malformed header": {"X-KiroCrew-Proxy-V2": "garbage", "X-KiroCrew-Proxy-Nonce": "x"},
    }
    for name, headers in attempts.items():
        response = send(client, item, raw, headers)
        assert response.status_code == 401, name
        assert response.json() == {"contractVersion": 1, "error": "unauthorized"}, name
        assert ledger_hash(made.store) == before, name

    with_actor = accept_body(item, actor="app-owner")
    response = send(client, item, with_actor, signed("POST", target, with_actor))
    assert response.status_code == 400
    assert ledger_hash(made.store) == before

    assert query(made.store, "SELECT count(*) FROM xp_entry") == [(0,)]
    accepted = send(client, item, raw, signed("POST", target, raw))
    assert accepted.status_code == 200
    body = accepted.json()
    assert body["state"] == "accepted"
    assert body["decisions"][-1]["actor"] == "app-owner"
    assert query(made.store, "SELECT COALESCE(sum(amount), 0) FROM xp_entry") == [(100,)]
    assert ledger_hash(made.store) != before


def test_a_signed_acceptance_with_the_wrong_revision_is_409_and_writes_nothing(
    rig: tuple[WorkRig, TestClient],
) -> None:
    made, client = rig
    item = awaiting_review(made, 2, 1)
    before = ledger_hash(made.store)
    raw = accept_body(item, evidenceRevision="0" * 24)
    target = f"/api/work/{item['workId']}/decisions"
    response = send(client, item, raw, signed("POST", target, raw))
    assert response.status_code == 409
    assert response.json() == {"contractVersion": 1, "error": "stale_evidence"}
    assert ledger_hash(made.store) == before


def test_no_other_decision_route_accepts_without_a_signature(
    rig: tuple[WorkRig, TestClient],
) -> None:
    made, client = rig
    item = awaiting_review(made, 3, 2)
    before = ledger_hash(made.store)
    api = Api(client)
    work = f"/api/work/{item['workId']}"
    submissions = [
        (
            "POST",
            work + "/decisions",
            {"requestId": token("block"), "expectedVersion": 2, "action": "block"},
        ),
        (
            "POST",
            work + "/attempts",
            {"expectedVersion": 2, "attemptId": made.seeded.attempts[2][4]},
        ),
        ("POST", work + "/milestones", {"expectedVersion": 2, "position": 1, "done": True}),
        ("POST", "/api/work", {"requestId": token("create", 9)}),
    ]
    for method, target, body in submissions:
        assert api.call(method, target, body, sign=False).status_code == 401, target
    assert ledger_hash(made.store) == before
