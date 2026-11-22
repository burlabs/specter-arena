"""FP-18: `GET /api/work?view=list` and `GET /api/xp?view=paged` over the signed routes, the real
service and the real store. The v1 bodies must not move; the v2 bodies validate against their
schemas, which this file names (work-items:v2, work-list-item:v1, xp-summaries:v2) so the
schema-producer check sees a real producer. Test-time only."""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from starlette.testclient import TestClient

from backend.specter_arena.work.service import ORDERS, VIEWS, XP_VIEWS

from .contract_support import compile_schema, load_registry
from .work_api_fakes import SIGNING_VALUE, Api, WorkRig, build_rig, signed
from .work_fakes import T0, decide, make_work, submit_and_accept

REGISTRY = load_registry()
WORK_ITEMS_V1 = compile_schema("urn:specter-arena:contract:work-items:v1", REGISTRY)
WORK_ITEMS_V2 = compile_schema("urn:specter-arena:contract:work-items:v2", REGISTRY)
WORK_LIST_ITEM_V1 = compile_schema("urn:specter-arena:contract:work-list-item:v1", REGISTRY)
XP_SUMMARIES_V1 = compile_schema("urn:specter-arena:contract:xp-summaries:v1", REGISTRY)
XP_SUMMARIES_V2 = compile_schema("urn:specter-arena:contract:xp-summaries:v2", REGISTRY)
API_ERROR = compile_schema("urn:specter-arena:contract:api-error:v1", REGISTRY)

LIST_KEYS = {
    "contractVersion",
    "workId",
    "parentId",
    "title",
    "rewardable",
    "bountyXp",
    "state",
    "version",
    "createdAtMs",
    "updatedAtMs",
    "attempts",
    "contributors",
    "progress",
    "childCount",
    "childrenAccepted",
    "everAccepted",
}
DROPPED = {
    "acceptanceCondition",
    "policyVersion",
    "milestones",
    "evidenceRevision",
    "review",
    "decisions",
}


@pytest.fixture(autouse=True)
def gateway_value(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KIROCREW_PROXY_SECRET", SIGNING_VALUE)


@pytest.fixture
def rig(tmp_path: Path) -> Iterator[tuple[WorkRig, Api, TestClient]]:
    made = build_rig(tmp_path, bots=3, per_bot=12)
    try:
        with TestClient(made.app) as client:
            yield made, Api(client), client
    finally:
        made.store.close()


def seed(made: WorkRig, count: int = 30) -> list[Any]:
    return [
        make_work(
            made.store,
            [made.seeded.attempts[i % 3][i // 3]],
            i + 1,
            at=T0 + 1000 + i,
            milestones=["a", "b"],
        )
        for i in range(count)
    ]


# --- v1 does not move -----------------------------------------------------------------------------


def test_the_work_list_without_view_is_still_work_items_v1_with_full_items(
    rig: tuple[WorkRig, Api, TestClient],
) -> None:
    made, api, _ = rig
    seed(made, 3)
    response = api.get("/api/work")
    body = response.json()
    assert response.status_code == 200
    WORK_ITEMS_V1(body)
    assert set(body) == {"contractVersion", "items", "nextCursor", "asOfMs"}
    assert body["contractVersion"] == 1
    assert (
        set(body["items"][0]) >= DROPPED
        and "order" not in body
        and "everAccepted" not in body["items"][0]
    )


def test_xp_without_view_is_still_xp_summaries_v1_and_ignores_cursor_and_limit(
    rig: tuple[WorkRig, Api, TestClient],
) -> None:
    made, api, _ = rig
    records = seed(made, 3)
    for n, record in enumerate(records):
        submit_and_accept(made.store, record, n + 1, at=T0 + 5000 + n)
    plain = api.get("/api/xp").json()
    extra = api.get("/api/xp?limit=1&cursor=nonsense").json()
    XP_SUMMARIES_V1(plain)
    assert set(plain) == {"contractVersion", "items", "asOfMs"} and plain["contractVersion"] == 1
    assert plain["items"] == extra["items"] and len(plain["items"]) == 3


# --- the list view --------------------------------------------------------------------------------


def test_view_list_defaults_to_created_order_and_validates_against_the_v2_schemas(
    rig: tuple[WorkRig, Api, TestClient],
) -> None:
    made, api, _ = rig
    seed(made, 30)
    response = api.get("/api/work?view=list")
    body = response.json()
    assert response.status_code == 200
    WORK_ITEMS_V2(body)
    assert body["contractVersion"] == 2 and body["order"] == "created"
    assert len(body["items"]) == 25 and body["nextCursor"]
    for item in body["items"]:
        WORK_LIST_ITEM_V1(item)
        assert set(item) == LIST_KEYS and DROPPED.isdisjoint(item)
    v1 = api.get("/api/work").json()
    assert [i["workId"] for i in body["items"]] == [i["workId"] for i in v1["items"]]
    assert api.get("/api/work?view=list&order=created").json()["items"] == body["items"]


def test_an_old_item_accepted_today_leads_the_accepted_page_in_updated_order_only(
    rig: tuple[WorkRig, Api, TestClient],
) -> None:
    """KL-09 over HTTP: the arena's one accepted page."""
    made, api, _ = rig
    records = seed(made, 30)
    for n, record in enumerate(records[1:], start=1):
        submit_and_accept(made.store, record, n + 1, at=T0 + 5000 + n * 3)
    submit_and_accept(made.store, records[0], 1, at=T0 + 90_000)
    old = records[0].work_id
    created = api.get("/api/work?view=list&order=created&state=accepted").json()
    updated = api.get("/api/work?view=list&order=updated&state=accepted").json()
    v1 = api.get("/api/work?state=accepted").json()
    WORK_ITEMS_V2(created)
    WORK_ITEMS_V2(updated)
    assert old not in [i["workId"] for i in created["items"]]
    assert old not in [i["workId"] for i in v1["items"]]
    assert updated["order"] == "updated" and updated["items"][0]["workId"] == old
    assert all(i["everAccepted"] and i["state"] == "accepted" for i in updated["items"])


def test_a_decision_moves_an_item_to_the_head_of_the_updated_page(
    rig: tuple[WorkRig, Api, TestClient],
) -> None:
    made, api, _ = rig
    records = seed(made, 5)
    decide(made.store, records[0], "block", 1, at=T0 + 50_000)
    ids = [i["workId"] for i in api.get("/api/work?view=list&order=updated").json()["items"]]
    assert ids[0] == records[0].work_id and len(ids) == 5


def test_the_list_projection_is_smaller_than_the_full_page(
    rig: tuple[WorkRig, Api, TestClient],
) -> None:
    made, api, _ = rig
    records = seed(made, 25)
    for n, record in enumerate(records[:5]):
        current = record
        for j in range(25):  # 50 decisions: the cap the full read carries
            current = decide(made.store, current, "block", 100 * n + 2 * j, at=T0 + 9000 + 2 * j)
            current = decide(
                made.store, current, "unblock", 100 * n + 2 * j + 1, at=T0 + 9001 + 2 * j
            )
    full = len(api.get("/api/work").content)
    lean = len(api.get("/api/work?view=list").content)
    assert lean < full * 0.5, (lean, full)


def test_pages_in_updated_order_walk_every_item_once(rig: tuple[WorkRig, Api, TestClient]) -> None:
    made, api, _ = rig
    seed(made, 30)
    seen: list[str] = []
    target = "/api/work?view=list&order=updated&limit=7"
    while True:
        body = api.get(target).json()
        WORK_ITEMS_V2(body)
        seen.extend(i["workId"] for i in body["items"])
        if body["nextCursor"] is None:
            break
        target = f"/api/work?view=list&order=updated&limit=7&cursor={body['nextCursor']}"
    assert len(seen) == len(set(seen)) == 30


@pytest.mark.parametrize(
    ("query", "code"),
    [
        ("view=full", "invalid_view"),
        ("view=", "invalid_view"),
        ("view=LIST", "invalid_view"),
        ("view=list&order=newest", "invalid_order"),
        ("view=list&order=", "invalid_order"),
        ("view=list&order=Updated", "invalid_order"),
        ("order=updated", "invalid_order"),
        ("order=created", "invalid_order"),
        ("view=list&state=done", "invalid_state"),
        ("view=list&limit=abc", "invalid_limit"),
        ("view=list&limit=-1", "invalid_limit"),
        ("view=list&cursor=nonsense", "invalid_cursor"),
        ("view=list&order=updated&cursor=nonsense", "invalid_cursor"),
    ],
)
def test_a_bad_view_order_or_cursor_is_a_typed_400(
    rig: tuple[WorkRig, Api, TestClient], query: str, code: str
) -> None:
    _, api, _ = rig
    response = api.get(f"/api/work?{query}")
    assert response.status_code == 400
    assert response.json() == {"contractVersion": 1, "error": code}
    API_ERROR(response.json())


def test_an_unknown_binding_is_404_and_unknown_query_keys_are_ignored(
    rig: tuple[WorkRig, Api, TestClient],
) -> None:
    made, api, _ = rig
    seed(made, 2)
    missing = api.get("/api/work?view=list&bindingId=bnd_" + "f" * 24)
    assert (missing.status_code, missing.json()["error"]) == (404, "unknown_binding")
    ok = api.get("/api/work?view=list&order=updated&unknown=1&limit=1")
    assert ok.status_code == 200 and len(ok.json()["items"]) == 1


def test_a_cursor_from_the_other_order_or_from_v1_is_a_400_invalid_cursor(
    rig: tuple[WorkRig, Api, TestClient],
) -> None:
    made, api, _ = rig
    seed(made, 30)
    created = api.get("/api/work?view=list&order=created&limit=5").json()["nextCursor"]
    updated = api.get("/api/work?view=list&order=updated&limit=5").json()["nextCursor"]
    v1 = api.get("/api/work?limit=5").json()["nextCursor"]
    for target in (
        f"/api/work?view=list&order=updated&cursor={created}",
        f"/api/work?view=list&order=created&cursor={updated}",
        f"/api/work?view=list&cursor={v1}",
        f"/api/work?cursor={created}",
    ):
        response = api.get(target)
        assert (response.status_code, response.json()["error"]) == (400, "invalid_cursor"), target


def test_the_view_and_order_values_are_the_ones_the_service_names() -> None:
    assert {"list"} == VIEWS and {"created", "updated"} == ORDERS and {"paged", "tasks"} == XP_VIEWS


# --- signing covers the query ---------------------------------------------------------------------


def test_the_signature_covers_view_and_order(rig: tuple[WorkRig, Api, TestClient]) -> None:
    made, api, client = rig
    seed(made, 2)
    for target in ("/api/work?view=list&order=updated", "/api/xp?view=paged"):
        assert client.get(target).status_code == 401
    mismatch = client.get(
        "/api/work?view=list&order=updated",
        headers=signed("GET", "/api/work?view=list&order=created"),
    )
    assert mismatch.status_code == 401
    bare = client.get("/api/work?view=list", headers=signed("GET", "/api/work"))
    assert bare.status_code == 401


# --- paged XP -------------------------------------------------------------------------------------


def accept_all(made: WorkRig, count: int) -> None:
    for n, record in enumerate(seed(made, count)):
        submit_and_accept(made.store, record, n + 1, at=T0 + 5000 + n)


def test_xp_view_paged_returns_v2_pages_in_binding_order(
    rig: tuple[WorkRig, Api, TestClient],
) -> None:
    made, api, _ = rig
    accept_all(made, 9)
    seen: list[str] = []
    target = "/api/xp?view=paged&limit=2"
    pages = 0
    while True:
        body = api.get(target).json()
        XP_SUMMARIES_V2(body)
        assert body["contractVersion"] == 2 and "order" not in body
        seen.extend(i["bindingId"] for i in body["items"])
        pages += 1
        if body["nextCursor"] is None:
            break
        target = f"/api/xp?view=paged&limit=2&cursor={body['nextCursor']}"
    assert pages == 2 and seen == sorted(seen) and len(seen) == len(set(seen)) == 3
    whole = api.get("/api/xp?view=paged").json()
    assert whole["nextCursor"] is None
    assert [i["bindingId"] for i in whole["items"]] == seen
    assert whole["items"] == api.get("/api/xp").json()["items"]


@pytest.mark.parametrize(
    ("query", "code"),
    [
        ("view=all", "invalid_view"),
        ("view=", "invalid_view"),
        ("view=paged&limit=x", "invalid_limit"),
        ("view=paged&limit=1000000000", "invalid_limit"),
        ("view=paged&cursor=nonsense", "invalid_cursor"),
        ("view=paged&cursor=" + "A" * 600, "invalid_cursor"),
    ],
)
def test_a_bad_xp_view_limit_or_cursor_is_a_typed_400(
    rig: tuple[WorkRig, Api, TestClient], query: str, code: str
) -> None:
    _, api, _ = rig
    response = api.get(f"/api/xp?{query}")
    assert response.status_code == 400
    assert response.json() == {"contractVersion": 1, "error": code}


def test_a_work_cursor_is_refused_by_the_paged_xp_read(
    rig: tuple[WorkRig, Api, TestClient],
) -> None:
    made, api, _ = rig
    seed(made, 30)
    cursor = api.get("/api/work?view=list&limit=5").json()["nextCursor"]
    response = api.get(f"/api/xp?view=paged&cursor={cursor}")
    assert (response.status_code, response.json()["error"]) == (400, "invalid_cursor")


def test_the_v2_bodies_are_plain_json_with_nosniff(rig: tuple[WorkRig, Api, TestClient]) -> None:
    made, api, _ = rig
    seed(made, 1)
    for target in ("/api/work?view=list", "/api/xp?view=paged"):
        response = api.get(target)
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["content-type"].startswith("application/json")
        json.loads(response.content)
