"""The assignment routes over a real store: `?view=assignment` and `POST .../hero` (FP-23)."""

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from starlette.applications import Starlette
from starlette.testclient import TestClient

from backend.specter_arena.specter_routes import MAX_BODY_BYTES, specter_routes
from backend.specter_arena.specters.service import SpecterService
from backend.specter_arena.store import Store, open_store

from .contract_support import compile_schema, load_registry
from .specter_fakes import ALPHA, BETA, FakeClock, bind, table_counts
from .test_specter_routes import Api, proxy_secret, signed  # noqa: F401 - fixture import

REGISTRY = load_registry()
URN = "urn:specter-arena:contract:"
SPECTER_V3 = compile_schema(f"{URN}specter:v3", REGISTRY)
SPECTERS_V3 = compile_schema(f"{URN}specters:v3", REGISTRY)
ERROR = compile_schema(f"{URN}api-error:v1", REGISTRY)
UNKNOWN = "bnd_" + "0" * 24


class Rig:
    def __init__(self, store: Store) -> None:
        self.store = store
        self.alpha = bind(store, ALPHA, "Alpha", assign=False)
        self.beta = bind(store, BETA, "Beta", assign=False)
        self.service = SpecterService(store, clock=FakeClock())
        self.app = Starlette(routes=specter_routes())
        self.app.state.specters = self.service


@pytest.fixture
def rig(tmp_path: Path) -> Iterator[tuple[Rig, Api]]:
    opened = open_store(tmp_path / "data")
    made = Rig(opened)
    try:
        with TestClient(made.app) as client:
            client.portal.call(made.service.start)  # type: ignore[union-attr]
            yield made, Api(client)
    finally:
        opened.close()


def hero_path(binding: str) -> str:
    return f"/api/specters/{binding}/hero"


def test_the_assignment_list_validates_and_v2_stays_unchanged(rig: tuple[Rig, Api]) -> None:
    made, api = rig
    listing = api.get("/api/specters?view=assignment")
    assert listing.status_code == 200
    assert listing.headers["x-content-type-options"] == "nosniff"
    SPECTERS_V3(listing.json())
    assert listing.json() == {
        "contractVersion": 3,
        "items": [],
        "unassignedBindingIds": [made.alpha, made.beta],
    }
    v2 = api.get("/api/specters")
    assert v2.status_code == 200 and v2.json() == {"contractVersion": 2, "items": []}


def test_the_assignment_get_is_no_hero_until_assigned_and_the_v2_get_stays_unknown(
    rig: tuple[Rig, Api],
) -> None:
    made, api = rig
    missing = api.get(f"/api/specters/{made.alpha}?view=assignment")
    assert (missing.status_code, missing.json()) == (
        404,
        {"contractVersion": 1, "error": "no_hero"},
    )
    assert api.get(f"/api/specters/{made.alpha}").json()["error"] == "unknown_binding"
    for target in (
        f"/api/specters/{UNKNOWN}?view=assignment",
        "/api/specters/nope?view=assignment",
    ):
        response = api.get(target)
        assert response.status_code == 404 and response.json()["error"] == "unknown_binding"
        ERROR(response.json())


@pytest.mark.parametrize(
    "target", ["/api/specters?view=other", "/api/specters?view=", f"/api/specters/{UNKNOWN}?view=x"]
)
def test_an_unknown_view_is_400_invalid_view(rig: tuple[Rig, Api], target: str) -> None:
    _, api = rig
    response = api.get(target)
    assert response.status_code == 400
    assert response.json() == {"contractVersion": 1, "error": "invalid_view"}


def test_a_picked_assignment_is_200_and_a_replay_is_200_with_no_new_row(
    rig: tuple[Rig, Api],
) -> None:
    made, api = rig
    first = api.post(hero_path(made.alpha), {"expectedVersion": 0, "heroId": "stitch"})
    assert first.status_code == 200, first.text
    SPECTER_V3(first.json())
    assert first.json()["heroId"] == "stitch" and first.json()["assignedBy"] == "picked"
    assert first.headers["x-content-type-options"] == "nosniff"
    again = api.post(hero_path(made.alpha), {"expectedVersion": 0, "heroId": "stitch"})
    assert again.status_code == 200 and again.json() == first.json()
    assert table_counts(made.store, except_prefixes=())["hero_assignment"] == 1
    assert api.get(f"/api/specters/{made.alpha}?view=assignment").json() == first.json()


def test_a_different_or_random_request_on_an_assigned_binding_is_409(rig: tuple[Rig, Api]) -> None:
    made, api = rig
    api.post(hero_path(made.alpha), {"expectedVersion": 0, "heroId": "stitch"})
    for body in ({"expectedVersion": 0, "heroId": "vell"}, {"expectedVersion": 0, "heroId": None}):
        response = api.post(hero_path(made.alpha), body)
        assert response.status_code == 409
        assert response.json() == {"contractVersion": 1, "error": "version_conflict"}
        ERROR(response.json())


def test_a_stale_expected_version_on_an_unassigned_binding_is_409(rig: tuple[Rig, Api]) -> None:
    made, api = rig
    response = api.post(hero_path(made.alpha), {"expectedVersion": 3, "heroId": "vell"})
    assert response.status_code == 409 and response.json()["error"] == "version_conflict"


def test_an_unknown_binding_is_404(rig: tuple[Rig, Api]) -> None:
    _, api = rig
    for target in (hero_path(UNKNOWN), "/api/specters/nope/hero"):
        response = api.post(target, {"expectedVersion": 0, "heroId": "vell"})
        assert response.status_code == 404 and response.json()["error"] == "unknown_binding"


@pytest.mark.parametrize(
    "body",
    [
        b"not json",
        b"[]",
        b"7",
        b"{}",
        b'{"expectedVersion": 0}',
        b'{"heroId": "vell"}',
        b'{"expectedVersion": 0, "heroId": "vell", "extra": 1}',
        b'{"expectedVersion": "0", "heroId": "vell"}',
        b'{"expectedVersion": -1, "heroId": "vell"}',
        b'{"expectedVersion": true, "heroId": "vell"}',
        b'{"expectedVersion": 0, "heroId": "nova"}',
        b'{"expectedVersion": 0, "heroId": 3}',
    ],
)
def test_a_wrong_body_is_400_invalid_body_and_writes_nothing(
    rig: tuple[Rig, Api], body: bytes
) -> None:
    made, api = rig
    headers = signed("POST", hero_path(made.alpha), body)
    response = api.client.post(hero_path(made.alpha), content=body, headers=headers)
    assert response.status_code == 400
    assert response.json() == {"contractVersion": 1, "error": "invalid_body"}
    assert table_counts(made.store, except_prefixes=())["hero_assignment"] == 0


def test_an_unsigned_request_is_401_and_a_body_over_the_cap_is_413(rig: tuple[Rig, Api]) -> None:
    made, api = rig
    unsigned = api.call(
        "POST", hero_path(made.alpha), {"expectedVersion": 0, "heroId": "vell"}, sign=False
    )
    assert unsigned.status_code == 401 and unsigned.json()["error"] == "unauthorized"
    assert api.call("GET", "/api/specters?view=assignment", sign=False).status_code == 401
    big = json.dumps({"expectedVersion": 0, "heroId": "v" * (MAX_BODY_BYTES + 1)}).encode()
    headers = signed("POST", hero_path(made.alpha), big)
    over = api.client.post(hero_path(made.alpha), content=big, headers=headers)
    assert over.status_code == 413 and over.json()["error"] == "body_too_large"
    nolength = api.client.post(hero_path(made.alpha), headers=signed("POST", hero_path(made.alpha)))
    assert nolength.status_code in (400, 413)


def test_a_service_that_is_not_running_is_503_store_not_ready() -> None:
    app = Starlette(routes=specter_routes())
    app.state.specters = None
    with TestClient(app) as client:
        api = Api(client)
        for response in (
            api.get("/api/specters?view=assignment"),
            api.get(f"/api/specters/{UNKNOWN}?view=assignment"),
            api.post(hero_path(UNKNOWN), {"expectedVersion": 0, "heroId": "vell"}),
        ):
            assert response.status_code == 503
            assert response.json() == {"contractVersion": 1, "error": "store_not_ready"}


def test_a_closed_store_is_503_store_unavailable(rig: tuple[Rig, Api]) -> None:
    made, api = rig
    made.store.close()
    for response in (
        api.get("/api/specters?view=assignment"),
        api.post(hero_path(made.alpha), {"expectedVersion": 0, "heroId": "vell"}),
    ):
        assert response.status_code == 503 and response.json()["error"] == "store_unavailable"


def test_the_portrait_route_of_an_unassigned_binding_is_404_no_hero(rig: tuple[Rig, Api]) -> None:
    made, api = rig
    response = api.post(
        f"/api/specters/{made.alpha}/portrait", {"expectedVersion": 0, "assetId": None}
    )
    assert response.status_code == 404 and response.json()["error"] == "no_hero"


def test_the_whole_flow_randomizes_every_unassigned_bot_and_writes_only_hero_rows(
    rig: tuple[Rig, Api],
) -> None:
    made, api = rig
    before = table_counts(made.store, except_prefixes=("hero_assignment",))
    listing = api.get("/api/specters?view=assignment").json()
    for binding in listing["unassignedBindingIds"]:
        done = api.post(hero_path(binding), {"expectedVersion": 0, "heroId": None})
        assert done.status_code == 200 and done.json()["assignedBy"] == "random"
        SPECTER_V3(done.json())
    final = api.get("/api/specters?view=assignment").json()
    SPECTERS_V3(final)
    assert final["unassignedBindingIds"] == []
    assert [i["bindingId"] for i in final["items"]] == [made.alpha, made.beta]
    assert len({i["heroId"] for i in final["items"]}) == 2
    assert table_counts(made.store, except_prefixes=("hero_assignment",)) == before
    heroes: Any = api.get("/api/heroes").json()
    assert sum(item["assignedCount"] for item in heroes["items"]) == 2
    assert api.get("/api/specters").json()["items"] == [
        {k: v for k, v in i.items() if k != "assignedBy"} | {"contractVersion": 2}
        for i in final["items"]
    ]
