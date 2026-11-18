"""FP-02-AC04 producer test for the five Specter contracts, over the real store.

The wire bodies are built here from what the store returns, so the store record shapes are proved
to fit the schemas. The domain service that will own the mapping lands in a later PR; it replaces
the local mappers with its own bodies.
"""

import base64
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from backend.specter_arena.store import Store, open_store
from backend.specter_arena.store import specters as sp

from .contract_support import compile_schema, load_registry
from .test_store_specters import LIMITS, PNG, T0, bind, profile, req

REGISTRY = load_registry()

IDS = {
    "specter-profile": "urn:specter-arena:contract:specter-profile:v1",
    "portrait-asset": "urn:specter-arena:contract:portrait-asset:v1",
    "specter": "urn:specter-arena:contract:specter:v1",
    "specters": "urn:specter-arena:contract:specters:v1",
    "summoning": "urn:specter-arena:contract:summoning:v1",
}


def check(schema: str, body: Any) -> None:
    compile_schema(IDS[schema], REGISTRY)(body)


def asset_body(record: sp.AssetRecord, data_base64: str | None = None) -> dict[str, Any]:
    return {
        "contractVersion": 1,
        "assetId": record.asset_id,
        "mediaType": record.media_type,
        "width": record.width,
        "height": record.height,
        "byteLength": record.byte_length,
        "origin": record.origin,
        "label": record.label,
        "dataBase64": data_base64,
    }


def specter_body(record: sp.SpecterRecord) -> dict[str, Any]:
    return {
        "contractVersion": 1,
        "specterId": record.specter_id,
        "bindingId": record.binding_id,
        "version": record.version,
        "profile": dict(record.profile),
        "portrait": None if record.portrait is None else asset_body(record.portrait),
        "source": record.source,
        "promptVersion": record.prompt_version,
        "createdAtMs": record.created_ms,
        "updatedAtMs": record.updated_ms,
    }


def summoning_body(record: sp.RequestRecord, budget: sp.Budget) -> dict[str, Any]:
    return {
        "contractVersion": 1,
        "requestId": record.request_id,
        "bindingId": record.binding_id,
        "status": record.status,
        "candidate": None if record.candidate is None else dict(record.candidate),
        "error": record.error_code,
        "promptVersion": record.prompt_version,
        "keep": list(record.keep),
        "createdAtMs": record.created_ms,
        "finishedAtMs": record.finished_ms,
        "budget": {
            "bindingRemaining": budget.binding_remaining,
            "bindingLimit": budget.binding_limit,
            "installRemaining": budget.install_remaining,
            "installLimit": budget.install_limit,
            "windowMs": budget.window_ms,
        },
    }


@pytest.fixture
def store(tmp_path: Path) -> Iterator[Store]:
    opened = open_store(tmp_path / "data")
    try:
        yield opened
    finally:
        opened.close()


def test_every_body_built_from_store_records_matches_its_contract(store: Store) -> None:
    binding = bind(store)
    check("specters", {"contractVersion": 1, "items": []})

    created = sp.create_request(
        store,
        request_id=req(1),
        binding_id=binding,
        keep=("name",),
        prompt_version="summon-1",
        now_ms=T0,
        **LIMITS,
    )
    budget = sp.get_budget(store, binding, T0, **LIMITS)
    check("summoning", summoning_body(created.record, budget))

    assert sp.mark_running(store, req(1), T0 + 1)
    assert sp.complete_request(
        store, req(1), candidate=profile(), model_label="auto", attempts=1, now_ms=T0 + 2
    )
    ready = sp.get_request(store, req(1))
    assert ready is not None
    check("summoning", summoning_body(ready, sp.get_budget(store, binding, T0 + 3, **LIMITS)))
    check("specter-profile", dict(ready.candidate or {}))

    accepted = sp.accept_request(store, req(1), expected_version=0, now_ms=T0 + 4)
    check("specter", specter_body(accepted))

    inserted = sp.insert_asset(
        store, data=PNG, width=1, height=1, origin="uploaded", label="Lantern", now_ms=T0 + 5
    )
    check("portrait-asset", asset_body(inserted.record))
    with_data = sp.get_asset(store, inserted.record.asset_id)
    assert with_data is not None and with_data.data is not None
    check("portrait-asset", asset_body(with_data, base64.b64encode(with_data.data).decode()))

    with_portrait = sp.set_portrait(
        store,
        accepted.binding_id,
        asset_id=inserted.record.asset_id,
        expected_version=accepted.version,
        now_ms=T0 + 6,
    )
    check("specter", specter_body(with_portrait))
    check(
        "specters",
        {"contractVersion": 1, "items": [specter_body(s) for s in sp.list_specters(store)]},
    )
