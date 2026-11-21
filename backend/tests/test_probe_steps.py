import asyncio
import json
import re

import pytest

from backend.specter_arena.config import Grants
from backend.specter_arena.probe.matrix import empty_run, to_host_facts_json, to_matrix_json
from backend.specter_arena.probe.sanitise import digest, placeholder
from backend.specter_arena.probe.steps import (
    MEMBER_RECORD_TYPE,
    STEP_IDS,
    STEPS,
    StepContext,
    UnknownStep,
    execute_step,
    is_allowed_client_text,
    is_reserved_frame_type,
    refusal_reasons,
    run_steps,
    select_steps,
)
from backend.tests.probe_fakes import (
    NOW,
    FakePort,
    error_body,
    event_frame,
    exchange_refused,
    json_body,
    rejected,
    slot_row,
    slots_frame,
)

OK = (200, json_body({"ok": True}))
DENY = (403, error_body("forbidden"))


def make_ctx(slug: str = "probe", **kwargs: object) -> StepContext:
    run = empty_run()
    run.run_id = "r1"
    run.probe_slug = slug
    options: dict[str, object] = {"now": lambda: NOW, "capture_seconds": 0.2, **kwargs}
    return StepContext(run=run, **options)  # type: ignore[arg-type]


def state(ctx: StepContext, cell_id: str) -> str:
    return ctx.run.cells[cell_id].state


def note(ctx: StepContext, cell_id: str) -> str:
    return ctx.run.cells[cell_id].notes or ""


def run_one(step_id: str, port: FakePort, ctx: StepContext) -> None:
    asyncio.run(run_steps(port, ctx, [step_id]))


def test_step_ids_match_the_design_order() -> None:
    assert STEP_IDS == (
        "token-exchange",
        "own-proxy-unauth",
        "other-app-proxy",
        "deny-matrix",
        "agents-roster",
        "usage-endpoints",
        "chat-slots",
        "ws-capture",
        "usage-turns",
        "member-record-write",
        "member-record-ungranted",
        "cli-compare",
    )


def test_every_step_cell_is_a_real_matrix_cell_decided_by_that_step() -> None:
    from backend.specter_arena.probe.questions import question_by_id

    for step in STEPS:
        for cell in step.cells:
            question = question_by_id(cell)
            assert question.kind == "matrix"
            assert question.method == step.id


def test_select_steps_orders_and_rejects_unknown_ids() -> None:
    assert [s.id for s in select_steps(["cli-compare", "token-exchange"])] == [
        "token-exchange",
        "cli-compare",
    ]
    assert [s.id for s in select_steps(None)] == [
        "token-exchange",
        "own-proxy-unauth",
        "other-app-proxy",
        "deny-matrix",
        "agents-roster",
        "usage-endpoints",
        "ws-capture",
    ]
    assert [s.id for s in select_steps(["cli-compare"])] == ["cli-compare"]
    with pytest.raises(UnknownStep):
        select_steps(["nope"])


def test_token_exchange_allowed_and_the_token_is_not_recorded() -> None:
    ctx = make_ctx()
    run_one("token-exchange", FakePort(token="secret-token-value"), ctx)
    cell = ctx.run.cells["app-owned-token-exchange"]
    assert cell.state == "ALLOWED"
    assert "secret-token-value" not in cell.evidence[0].excerpt
    assert "18 characters" in cell.evidence[0].excerpt


def test_token_exchange_refused_is_denied_and_other_faults_are_untested() -> None:
    ctx = make_ctx()
    run_one("token-exchange", FakePort(token=exchange_refused(403)), ctx)
    assert state(ctx, "app-owned-token-exchange") == "DENIED"
    faults: list[tuple[str | BaseException, str]] = [
        (exchange_refused(500), "token exchange failed (status 500)"),
        ("", "token exchange returned an empty token"),
        (TimeoutError(), "request timed out"),
    ]
    for token, reason in faults:
        fresh = make_ctx()
        run_one("token-exchange", FakePort(token=token), fresh)
        assert state(fresh, "app-owned-token-exchange") == "UNTESTED"
        assert note(fresh, "app-owned-token-exchange") == reason


def test_a_later_fault_in_the_same_run_keeps_the_decided_cell() -> None:
    ctx = make_ctx()
    run_one("token-exchange", FakePort(token=exchange_refused(403)), ctx)
    run_one("token-exchange", FakePort(token=TimeoutError()), ctx)
    assert state(ctx, "app-owned-token-exchange") == "DENIED"
    assert note(ctx, "app-owned-token-exchange").endswith("request timed out")


def test_own_proxy_unauth_sends_no_token_to_the_loopback_port() -> None:
    port = FakePort({("GET", "/api/ping"): (401, error_body("unauthorized"))})
    ctx = make_ctx()
    run_one("own-proxy-unauth", port, ctx)
    assert port.calls == [("GET", "/api/ping", False, True)]
    assert state(ctx, "app-owned-unsigned-direct-rejected") == "DENIED"


@pytest.mark.parametrize(
    ("answer", "expected"),
    [
        (OK, "ALLOWED"),
        ((403, error_body()), "DENIED"),
        ((404, error_body("not_found")), "DENIED"),
        ((200, b"{not json"), "UNTESTED"),
        ((500, b"boom"), "UNTESTED"),
        (TimeoutError(), "UNTESTED"),
    ],
)
def test_http_outcomes_map_to_states(answer: object, expected: str) -> None:
    port = FakePort({("GET", "/apps/specter-other/api/ping"): answer})  # type: ignore[dict-item]
    ctx = make_ctx()
    run_one("other-app-proxy", port, ctx)
    cell = "other-app-proxy-denied"
    assert state(ctx, cell) == expected
    if expected == "UNTESTED":
        assert note(ctx, cell)


def test_malformed_json_names_it_in_the_reason() -> None:
    port = FakePort({("GET", "/api/members"): (200, b"{broken")})
    ctx = make_ctx()
    run_one("deny-matrix", port, ctx)
    assert state(ctx, "bot-list-members-denied") == "UNTESTED"


def test_deny_matrix_probes_member_routes_when_the_slug_is_set() -> None:
    port = FakePort()
    ctx = make_ctx()
    run_one("deny-matrix", port, ctx)
    paths = [call[1] for call in port.calls]
    assert "/api/members/probe/goals/key-results" in paths
    assert state(ctx, "bot-ledger-read") == "DENIED"
    assert state(ctx, "other-app-api-denied") == "DENIED"


def test_deny_matrix_without_a_slug_leaves_member_cells_untested() -> None:
    port = FakePort()
    ctx = make_ctx(slug="")
    run_one("deny-matrix", port, ctx)
    assert "/api/members/probe/goals" not in [call[1] for call in port.calls]
    assert note(ctx, "bot-goals-read") == "probe slug not set"
    assert state(ctx, "bot-list-members-denied") == "DENIED"


def roster(*rows: object) -> tuple[int, bytes]:
    return 200, json_body({"agents": list(rows)})


def test_agents_roster_finds_the_probe_bot_and_reports_field_names_only() -> None:
    row = {"slug": "probe", "display_name": "Probe", "avatar_url": "https://x/y.png"}
    port = FakePort({("GET", "/api/agents"): roster(row, {"slug": "other", "display_name": "N"})})
    ctx = make_ctx()
    run_one("agents-roster", port, ctx)
    listed = ctx.run.cells["bot-list-via-agents"]
    assert listed.state == "ALLOWED"
    assert "avatar_url" in listed.evidence[0].excerpt
    assert "https://x/y.png" not in listed.evidence[0].excerpt
    assert state(ctx, "bot-name-avatar") == "ALLOWED"


def test_agents_roster_variants() -> None:
    cases = [
        (roster({"slug": "probe", "display_name": "P"}), "ALLOWED", "UNTESTED"),
        (roster({"slug": "other"}), "UNTESTED", "UNTESTED"),
        ((200, json_body([{"slug": "probe", "name": "P", "avatar": "a"}])), "ALLOWED", "ALLOWED"),
        (DENY, "DENIED", "DENIED"),
    ]
    for answer, listed, named in cases:
        ctx = make_ctx()
        run_one("agents-roster", FakePort({("GET", "/api/agents"): answer}), ctx)
        assert state(ctx, "bot-list-via-agents") == listed
        assert state(ctx, "bot-name-avatar") == named


def test_agents_roster_without_a_slug_is_untested() -> None:
    ctx = make_ctx(slug="")
    run_one("agents-roster", FakePort({("GET", "/api/agents"): roster({"slug": "p"})}), ctx)
    assert note(ctx, "bot-list-via-agents").startswith("probe slug not set; GET /api/agents")


def test_chat_slots_without_a_known_worker_leaves_history_untested() -> None:
    ctx = make_ctx()
    run_one("chat-slots", FakePort({("GET", "/api/chat/slots"): OK}), ctx)
    assert state(ctx, "user-chat-slots-api") == "ALLOWED"
    assert "run ws-capture" in note(ctx, "user-chat-slot-history")


def test_chat_slots_reads_history_for_a_known_worker() -> None:
    ctx = make_ctx()
    ctx.run.last_rows = {"w 1": slot_row("w 1", created_by="member-probe")}
    port = FakePort({("GET", "/api/chat/slots"): DENY, ("GET", "/api/chat/slots/w%201"): OK})
    run_one("chat-slots", port, ctx)
    assert state(ctx, "user-chat-slots-api") == "DENIED"
    assert state(ctx, "user-chat-slot-history") == "ALLOWED"


def scenario_frames() -> list[dict[str, object]]:
    dm = "member-probe"
    return [
        slots_frame(slot_row(dm), slot_row("chat-7", title="private")),
        slots_frame(slot_row(dm, running=True, last_activity_ts=101.0), slot_row("chat-7")),
        slots_frame(slot_row(dm, running=True, last_activity_ts=102.0, pending_approval=True)),
        slots_frame(
            slot_row(dm, running=True, last_activity_ts=103.0),
            slot_row("w1", created_by=dm, running=True, source_links=[{"url": "u"}]),
        ),
        slots_frame(
            slot_row(dm, wait_state="waiting for you", last_activity_ts=104.0),
            slot_row("w1", created_by=dm, running=False),
        ),
        {"type": "log_replay", "data": ["x"]},
    ]


def test_ws_capture_replays_a_scenario_into_cells_and_attempts() -> None:
    port = FakePort(frames=scenario_frames())
    ctx = make_ctx()
    run_one("ws-capture", port, ctx)
    for cell in (
        "app-owned-ws-token-transport",
        "user-slots-visible",
        "user-signal-start",
        "user-signal-progress",
        "user-signal-terminal",
        "user-signal-approval",
        "user-source-links",
        "bot-id-observable",
        "bot-own-session-attribution",
        "bot-worker-session-attribution",
    ):
        assert state(ctx, cell) == "ALLOWED", cell
    assert state(ctx, "user-outcome-evidence") == "ALLOWED"
    assert ctx.run.attempts["member-probe"].outcome_evidence == "waiting for you"
    assert (
        "lineage_minted=False"
        in ctx.run.cells["bot-worker-session-attribution"].evidence[0].excerpt
    )
    assert state(ctx, "user-slots-no-grant-denied") == "UNTESTED"
    assert ctx.run.stats.unknown_types == {"log_replay": 1}
    assert port.closed
    kinds = [s.kind for s in ctx.run.attempts["member-probe"].signals]
    assert kinds[:2] == ["start", "progress"]
    assert ctx.run.attempts["member-probe"].kind == "bot-turn"
    assert ctx.run.attempts["member-probe"].bot_ref == "probe"
    assert ctx.run.attempts["w1"].kind == "worker-session"
    assert ctx.run.attempts["w1"].outcome_evidence is None


def test_ws_capture_never_stores_non_probe_values() -> None:
    ctx = make_ctx()
    run_one("ws-capture", FakePort(frames=scenario_frames()), ctx)
    rendered = str(list(ctx.run.frames))
    assert "chat-7" not in rendered
    assert "private" not in rendered
    assert digest(ctx.run.salt, "chat-7") in rendered


def test_ws_capture_records_outcome_text_on_a_terminal_signal() -> None:
    dm = "member-probe"
    frames = [
        slots_frame(slot_row(dm, running=True)),
        slots_frame(slot_row(dm, running=False, wait_state="idle after reply")),
    ]
    ctx = make_ctx()
    run_one("ws-capture", FakePort(frames=frames), ctx)
    assert state(ctx, "user-outcome-evidence") == "ALLOWED"
    assert ctx.run.attempts[dm].outcome_evidence == "idle after reply"


def test_ws_capture_terminal_without_text_and_without_terminal() -> None:
    dm = "member-probe"
    silent = [slots_frame(slot_row(dm, running=True)), slots_frame(slot_row(dm))]
    ctx = make_ctx()
    run_one("ws-capture", FakePort(frames=silent), ctx)
    assert "no outcome text" in note(ctx, "user-outcome-evidence")
    quiet = make_ctx()
    run_one("ws-capture", FakePort(frames=[slots_frame(slot_row(dm))]), quiet)
    assert "no terminal signal" in note(quiet, "user-outcome-evidence")


def test_ws_capture_without_grants_reads_an_empty_snapshot_as_denied() -> None:
    ctx = make_ctx(grants=Grants.none())
    run_one("ws-capture", FakePort(frames=[slots_frame()]), ctx)
    assert state(ctx, "user-slots-no-grant-denied") == "DENIED"
    assert "no slots grant" in note(ctx, "user-slots-visible")


def test_ws_capture_without_grants_reports_visible_rows() -> None:
    ctx = make_ctx(grants=Grants.none())
    run_one("ws-capture", FakePort(frames=[slots_frame(slot_row("chat-1"))]), ctx)
    assert state(ctx, "user-slots-no-grant-denied") == "ALLOWED"


def test_ws_capture_without_grants_and_without_frames_is_untested() -> None:
    ctx = make_ctx(grants=Grants.none())
    run_one("ws-capture", FakePort(frames=[], transport=None), ctx)
    assert state(ctx, "user-slots-no-grant-denied") == "UNTESTED"
    assert "no frame received" in note(ctx, "app-owned-ws-token-transport")


def test_ws_capture_with_grants_and_empty_snapshots_is_untested() -> None:
    ctx = make_ctx()
    run_one("ws-capture", FakePort(frames=[slots_frame()]), ctx)
    assert state(ctx, "user-slots-visible") == "UNTESTED"
    assert "probe DM slot not in" in note(ctx, "bot-id-observable")


def test_ws_capture_dm_without_agent_field_and_no_slug() -> None:
    row = slot_row("member-probe")
    del row["agent"]
    ctx = make_ctx()
    run_one("ws-capture", FakePort(frames=[slots_frame(row)]), ctx)
    assert state(ctx, "bot-id-observable") == "ALLOWED"
    assert note(ctx, "bot-own-session-attribution") == "DM slot has no agent field"
    bare = make_ctx(slug="")
    run_one("ws-capture", FakePort(frames=[slots_frame(slot_row("member-probe"))]), bare)
    assert note(bare, "bot-id-observable") == "probe slug not set"


def test_ws_capture_handshake_rejection_is_recorded_as_denied() -> None:
    ctx = make_ctx()
    run_one("ws-capture", FakePort(feed_error=rejected(403)), ctx)
    assert state(ctx, "app-owned-ws-token-transport") == "DENIED"
    assert "refused with 403" in note(ctx, "user-signal-start")


def test_ws_capture_stops_at_the_time_window() -> None:
    ctx = make_ctx()
    run_one("ws-capture", FakePort(frames=[slots_frame(slot_row("member-probe"))], hang=True), ctx)
    assert state(ctx, "bot-id-observable") == "ALLOWED"


def test_the_retained_row_cap_stops_keeping_rows_but_not_signals() -> None:
    dm = "member-probe"
    frames = [
        slots_frame(slot_row(dm, running=True)),
        *(event_frame("tool_call", slot=dm, kind="execute") for _ in range(5)),
        slots_frame(slot_row(dm, running=False)),
    ]
    ctx = make_ctx(max_kept_rows=2)
    run_one("ws-capture", FakePort(frames=frames), ctx)
    assert len(ctx.run.events.rows) == 2
    assert ctx.run.events.rows_dropped_by_cap == 3
    assert signal_kinds(ctx).count("tool-call") == 5
    assert state(ctx, "user-signal-terminal") == "ALLOWED"


def test_a_long_feed_is_read_until_the_timer_ends_it() -> None:
    frames = [slots_frame(slot_row("member-probe")) for _ in range(10_000)]
    ctx = make_ctx()
    run_one("ws-capture", FakePort(frames=frames, hang=True), ctx)
    assert ctx.run.events.frames_seen["slots"] == 10_000


def test_ws_capture_drops_unsanitisable_frames_and_counts_them() -> None:
    ctx = make_ctx()
    bad = slots_frame(slot_row("chat-1", blob=b"raw"))
    run_one("ws-capture", FakePort(frames=[bad, slots_frame(slot_row("member-probe"))]), ctx)
    assert ctx.run.stats.dropped == 1
    assert state(ctx, "bot-id-observable") == "ALLOWED"


def test_member_record_write_and_ungranted_follow_the_grant_phase() -> None:
    path = "/api/member-records/probe"
    ctx = make_ctx()
    port = FakePort({("POST", path): (204, b"")})
    run_one("member-record-write", port, ctx)
    run_one("member-record-ungranted", port, ctx)
    assert state(ctx, "bot-dashboard-member-record") == "ALLOWED"
    assert "grant is declared" in note(ctx, "bot-dashboard-record-ungranted")
    assert port.bodies[0] is not None
    bare = make_ctx(grants=Grants.none())
    run_one("member-record-write", port, bare)
    run_one("member-record-ungranted", FakePort({("POST", path): DENY}), bare)
    assert "no member-records grant" in note(bare, "bot-dashboard-member-record")
    assert state(bare, "bot-dashboard-record-ungranted") == "DENIED"


def test_member_record_steps_need_a_slug() -> None:
    ctx = make_ctx(slug="")
    run_one("member-record-write", FakePort(), ctx)
    run_one("member-record-ungranted", FakePort(), ctx)
    assert note(ctx, "bot-dashboard-member-record") == "probe slug not set"
    assert note(ctx, "bot-dashboard-record-ungranted") == "probe slug not set"


def test_cli_compare_finds_a_supplied_key_in_the_api_or_the_feed() -> None:
    ctx = make_ctx(cli_slot_key="cli-slot-9")
    listing = (200, json_body([{"key": "cli-slot-9"}]))
    run_one("cli-compare", FakePort({("GET", "/api/chat/slots"): listing}), ctx)
    assert "GET /api/chat/slots" in ctx.run.cells["external-cli-slot-appears"].evidence[0].excerpt
    feed_ctx = make_ctx(cli_slot_key="cli-slot-9")
    run_one("ws-capture", FakePort(frames=[slots_frame(slot_row("cli-slot-9"))]), feed_ctx)
    run_one("cli-compare", FakePort({("GET", "/api/chat/slots"): OK}), feed_ctx)
    assert (
        "the feed snapshot" in feed_ctx.run.cells["external-cli-slot-appears"].evidence[0].excerpt
    )


def test_cli_compare_without_a_key_or_a_match_is_untested() -> None:
    ctx = make_ctx()
    run_one("cli-compare", FakePort(), ctx)
    assert "no external CLI slot key" in note(ctx, "external-cli-slot-appears")
    ctx = make_ctx(cli_slot_key="absent")
    run_one("cli-compare", FakePort({("GET", "/api/chat/slots"): OK}), ctx)
    assert "was not seen" in note(ctx, "external-cli-slot-appears")


def test_without_a_gateway_origin_every_step_is_untested_not_failed() -> None:
    ctx = make_ctx(gateway_available=False)
    port = FakePort()
    asyncio.run(run_steps(port, ctx))
    assert port.calls == []
    assert len(ctx.run.cells) == sum(len(step.cells) for step in select_steps(None))
    assert {cell.state for cell in ctx.run.cells.values()} == {"UNTESTED"}
    assert "gateway origin unavailable" in note(ctx, "app-owned-token-exchange")


def test_an_unexpected_exception_becomes_untested_with_the_type_name() -> None:
    ctx = make_ctx()
    port = FakePort({("GET", "/apps/specter-other/api/ping"): RuntimeError("secret detail")})
    run_one("other-app-proxy", port, ctx)
    assert note(ctx, "other-app-proxy-denied") == "step failed: RuntimeError"


def test_execute_step_runs_a_single_step() -> None:
    ctx = make_ctx()
    asyncio.run(execute_step(STEPS[0], FakePort(), ctx))
    assert "app-owned-token-exchange" in ctx.run.cells


def test_scenario_yields_one_allowed_one_denied_and_one_untested_cell(
    capsys: pytest.CaptureFixture[str],
) -> None:
    ctx = make_ctx()
    port = FakePort(
        {("GET", "/api/members"): DENY, ("GET", "/api/chat/slots"): OK},
        frames=scenario_frames(),
    )
    asyncio.run(run_steps(port, ctx, ["deny-matrix", "chat-slots", "ws-capture"]))
    matrix = to_matrix_json(ctx.run)
    states = {cell["id"]: cell["state"] for cell in matrix["cells"]}  # type: ignore[attr-defined]
    assert states["user-chat-slots-api"] == "ALLOWED"
    assert states["bot-list-members-denied"] == "DENIED"
    assert states["bot-fresh-start"] == "UNTESTED"
    print({k: v for k, v in states.items() if v != "UNTESTED"})
    print([(a.id, [s.kind for s in a.signals]) for a in ctx.run.attempts.values()])
    assert capsys.readouterr().out
    assert len(to_host_facts_json(ctx.run)["facts"]) == 16  # type: ignore[arg-type]


def test_refusals_record_the_hosts_code_and_error_strings() -> None:
    body = json_body({"code": "grant_missing", "error": "not permitted", "detail": "secret-ish"})
    ctx = make_ctx()
    run_one("chat-slots", FakePort({("GET", "/api/chat/slots"): (403, body)}), ctx)
    excerpt = ctx.run.cells["user-chat-slots-api"].evidence[0].excerpt
    assert 'code="grant_missing"' in excerpt
    assert 'error="not permitted"' in excerpt
    assert "secret-ish" not in excerpt
    assert "object with fields code, detail, error" in excerpt


def test_refusal_reasons_are_redacted_then_capped_at_200_chars() -> None:
    long_error = "x" * 500
    reasons = refusal_reasons(403, {"code": "c", "error": long_error})
    assert reasons == f'; code="c"; error="{"x" * 200}"'
    leaked = refusal_reasons(401, {"error": "bad Bearer abcdefgh12345678 token"})
    assert "abcdefgh12345678" not in leaked
    assert "[redacted]" in leaked
    hex_run = "a" * 190 + "b" * 40
    assert hex_run[:200] not in refusal_reasons(500, {"error": hex_run})


def test_only_refusals_with_string_values_carry_reasons() -> None:
    body = {"code": "ok_code", "error": "fine"}
    assert refusal_reasons(200, body) == ""
    assert refusal_reasons(399, body) == ""
    assert refusal_reasons(403, ["code"]) == ""
    assert refusal_reasons(403, {"code": 7, "error": None}) == ""
    assert refusal_reasons(500, {"error": "boom"}) == '; error="boom"'


def test_success_bodies_stay_shape_only() -> None:
    body = json_body({"code": "visible?", "error": "no", "title": "private"})
    ctx = make_ctx()
    run_one("chat-slots", FakePort({("GET", "/api/chat/slots"): (200, body)}), ctx)
    excerpt = ctx.run.cells["user-chat-slots-api"].evidence[0].excerpt
    assert "visible?" not in excerpt
    assert "private" not in excerpt
    assert "object with fields code, error, title" in excerpt


def test_an_undecided_refusal_keeps_its_status_shape_and_reason_in_the_note() -> None:
    body = json_body({"code": "grant_pending", "error": "wait", "rows": [1, 2]})
    ctx = make_ctx()
    run_one("chat-slots", FakePort({("GET", "/api/chat/slots"): (409, body)}), ctx)
    cell_note = note(ctx, "user-chat-slots-api")
    assert cell_note.startswith("response not decisive (status 409)")
    assert 'code="grant_pending"' in cell_note
    assert len(cell_note) <= 500


def test_a_denial_without_a_reason_field_is_still_recorded() -> None:
    ctx = make_ctx()
    run_one("chat-slots", FakePort({("GET", "/api/chat/slots"): (403, json_body({"x": 1}))}), ctx)
    assert "answered 403; object with fields x" in note(ctx, "user-chat-slots-api")


def test_agents_roster_records_status_and_shape_on_every_outcome() -> None:
    cases = {
        "refused": (DENY, "DENIED"),
        "server error": ((500, b"boom"), "UNTESTED"),
        "malformed": ((200, b"{nope"), "UNTESTED"),
        "scalar": ((200, json_body("text")), "UNTESTED"),
        "empty": ((204, b""), "UNTESTED"),
    }
    for label, (answer, expected) in cases.items():
        ctx = make_ctx()
        run_one("agents-roster", FakePort({("GET", "/api/agents"): answer}), ctx)
        for cell in ("bot-list-via-agents", "bot-name-avatar"):
            assert state(ctx, cell) == expected, label
            recorded = (
                ctx.run.cells[cell].evidence[0].excerpt if expected == "DENIED" else note(ctx, cell)
            )
            assert "/api/agents answered" in recorded, label
    ctx = make_ctx()
    run_one("agents-roster", FakePort({("GET", "/api/agents"): (500, b"boom")}), ctx)
    assert "malformed JSON" in note(ctx, "bot-list-via-agents")


def test_agents_roster_without_the_probe_row_names_status_shape_and_row_count_only() -> None:
    other = {"slug": "other", "display_name": "Someone Else", "avatar_url": "https://x/o.png"}
    ctx = make_ctx()
    run_one("agents-roster", FakePort({("GET", "/api/agents"): roster(other, other)}), ctx)
    for cell in ("bot-list-via-agents", "bot-name-avatar"):
        recorded = note(ctx, cell)
        assert recorded.startswith("probe bot not found in the roster rows; GET /api/agents")
        assert "answered 200; object with fields agents; roster rows: 2" in recorded
        assert "Someone Else" not in recorded
        assert "o.png" not in recorded


def test_agents_roster_probe_row_lists_fields_never_values_or_other_rows() -> None:
    row = {"slug": "probe", "display_name": "Probe Name", "avatar_url": "https://x/p.png"}
    other = {"slug": "other", "private_field": "Other Value"}
    ctx = make_ctx()
    run_one("agents-roster", FakePort({("GET", "/api/agents"): roster(row, other)}), ctx)
    for cell in ("bot-list-via-agents", "bot-name-avatar"):
        excerpt = ctx.run.cells[cell].evidence[0].excerpt
        assert "avatar_url" in excerpt
        for hidden in ("Probe Name", "p.png", "private_field", "Other Value"):
            assert hidden not in excerpt


def test_ws_capture_attributes_a_suffixed_dm_slot_and_its_workers() -> None:
    dm = "member-probe.memory-store1"
    frames = [
        slots_frame(slot_row(dm), slot_row("w1", created_by=dm), slot_row("chat-7", title="x")),
        slots_frame(
            slot_row(dm, running=True),
            slot_row("w1", created_by=dm, running=True),
            slot_row("chat-7", title="x"),
        ),
    ]
    ctx = make_ctx()
    run_one("ws-capture", FakePort(frames=frames), ctx)
    assert ctx.run.attempts[dm].kind == "bot-turn"
    assert ctx.run.attempts[dm].bot_ref == "probe"
    assert ctx.run.attempts["w1"].kind == "worker-session"
    assert "chat-7" not in ctx.run.attempts
    assert state(ctx, "bot-id-observable") == "ALLOWED"
    assert state(ctx, "bot-own-session-attribution") == "ALLOWED"
    assert state(ctx, "bot-worker-session-attribution") == "ALLOWED"
    assert "chat-7" not in str(list(ctx.run.frames))


def test_ws_capture_does_not_attribute_a_longer_slug_to_the_probe_bot() -> None:
    frames = [slots_frame(slot_row("member-probex.memory-s", title="other bot"))]
    ctx = make_ctx()
    run_one("ws-capture", FakePort(frames=frames), ctx)
    assert ctx.run.attempts == {}
    assert state(ctx, "bot-id-observable") == "UNTESTED"
    assert "other bot" not in str(list(ctx.run.frames))


D_P1_GRANTS = Grants(
    api=frozenset(
        {"/apps/specter-arena/api/*", "/api/agents", "/api/usage", "/api/sessions/usage"}
    ),
    events=frozenset({"slots:user", "subagent:user"}),
    basis="manifest",
)


def signal_kinds(ctx: StepContext, key: str = "member-probe") -> list[str]:
    return [signal.kind for signal in ctx.run.attempts[key].signals]


def test_h1_a_non_slots_frame_neither_removes_the_slot_nor_swallows_the_terminal() -> None:
    dm = "member-probe"
    frames: list[dict[str, object]] = [
        slots_frame(slot_row(dm, running=False)),
        slots_frame(slot_row(dm, running=True)),
        {"type": "dashboard", "data": {"x": 1}},
        slots_frame(slot_row(dm, running=True)),
        event_frame("chat_status", slot=dm, status="Thinking"),
        slots_frame(slot_row(dm, running=False)),
    ]
    ctx = make_ctx()
    run_one("ws-capture", FakePort(frames=frames), ctx)
    kinds = signal_kinds(ctx)
    assert kinds.count("start") == 1
    assert kinds.count("terminal") == 1
    assert "removed" not in kinds
    assert state(ctx, "user-signal-terminal") == "ALLOWED"


@pytest.mark.parametrize("between", ["dashboard", "refresh", "update_progress", "models_changed"])
def test_h1_a_frame_between_running_and_idle_keeps_the_terminal(between: str) -> None:
    dm = "member-probe"
    frames: list[dict[str, object]] = [
        slots_frame(slot_row(dm, running=True)),
        {"type": between, "data": {}},
        slots_frame(slot_row(dm, running=False)),
    ]
    ctx = make_ctx()
    run_one("ws-capture", FakePort(frames=frames), ctx)
    assert signal_kinds(ctx) == ["start", "terminal"]
    assert ctx.run.last_rows[dm]["running"] is False


def test_an_empty_slots_frame_still_reads_as_no_rows() -> None:
    ctx = make_ctx(grants=Grants.none())
    frames: list[dict[str, object]] = [{"type": "dashboard", "data": {}}, slots_frame()]
    run_one("ws-capture", FakePort(frames=frames), ctx)
    assert state(ctx, "user-slots-no-grant-denied") == "DENIED"


def test_a_string_stamp_that_moves_is_progress_and_its_type_is_named() -> None:
    dm = "member-probe"
    frames = [
        slots_frame(slot_row(dm, running=True, last_activity_ts="2026-11-13T05:00:00")),
        slots_frame(slot_row(dm, running=True, last_activity_ts="2026-11-13T05:00:04")),
    ]
    ctx = make_ctx()
    run_one("ws-capture", FakePort(frames=frames), ctx)
    assert signal_kinds(ctx) == ["start", "progress"]
    excerpt = ctx.run.cells["user-signal-progress"].evidence[0].excerpt
    assert excerpt.endswith("last_activity_ts is JSON str")


def test_outcome_text_comes_from_the_raw_row_and_prose_is_not_retained() -> None:
    dm = "member-probe"
    frames = [
        slots_frame(slot_row(dm, running=True)),
        slots_frame(slot_row(dm, running=False, last_message="finished the sweep")),
    ]
    ctx = make_ctx()
    run_one("ws-capture", FakePort(frames=frames), ctx)
    assert ctx.run.attempts[dm].outcome_evidence == "finished the sweep"
    assert "last_message" not in ctx.run.last_rows[dm]
    assert "finished the sweep" not in str(list(ctx.run.frames))


def test_event_frames_are_kept_allow_listed_with_the_probe_slot_text() -> None:
    dm = "member-probe"
    frames = [
        slots_frame(slot_row(dm, running=True)),
        event_frame("chat_done", slot=dm, turn=2, continuing=False, text="secret reply"),
        event_frame("chat_done", slot="chat-7", turn=1),
    ]
    ctx = make_ctx()
    run_one("ws-capture", FakePort(frames=frames), ctx)
    probe_event, other_event = list(ctx.run.frames)[1:]
    assert probe_event == {
        "type": "chat_done",
        "data": {"continuing": False, "slot": dm, "turn": 2},
    }
    assert other_event["data"] == {"slot": digest(ctx.run.salt, "chat-7"), "turn": 1}
    assert ctx.run.probe_slots == frozenset({dm})


def test_with_the_d_p1_grants_no_member_record_post_and_no_chat_slots_read() -> None:
    ctx = make_ctx(grants=D_P1_GRANTS)
    port = FakePort()
    for step_id in ("member-record-write", "chat-slots", "cli-compare"):
        run_one(step_id, port, ctx)
    assert port.calls == []
    assert "no member-records grant" in note(ctx, "bot-dashboard-member-record")
    assert note(ctx, "user-chat-slots-api") == "no /api/chat/slots grant declared"
    assert note(ctx, "user-chat-slot-history") == "no /api/chat/slots grant declared"


def test_cli_compare_without_the_chat_slots_grant_reads_only_the_feed() -> None:
    ctx = make_ctx(grants=D_P1_GRANTS, cli_slot_key="absent")
    port = FakePort()
    run_one("cli-compare", port, ctx)
    assert port.calls == []
    assert "/api/chat/slots not granted" in note(ctx, "external-cli-slot-appears")


def test_with_the_d_p1_grants_the_ungranted_refusal_is_probed() -> None:
    path = "/api/member-records/probe"
    ctx = make_ctx(grants=D_P1_GRANTS)
    port = FakePort({("POST", path): DENY})
    run_one("member-record-ungranted", port, ctx)
    assert port.calls == [("POST", path, True, False)]
    assert state(ctx, "bot-dashboard-record-ungranted") == "DENIED"


def test_d_p1_grants_decide_the_slots_cells_from_the_slots_event() -> None:
    ctx = make_ctx(grants=D_P1_GRANTS)
    run_one("ws-capture", FakePort(frames=[slots_frame(slot_row("member-probe"))]), ctx)
    assert "slots grant is declared" in note(ctx, "user-slots-no-grant-denied")
    assert state(ctx, "user-slots-visible") == "ALLOWED"


DM = "member-probe"


def marker(generation: object = 2) -> dict[str, object]:
    return {"type": "_probe_reconnect", "data": {"generation": generation}}


def test_subscribe_subagents_is_sent_once_and_only_with_the_subagent_grant() -> None:
    granted = FakePort(frames=[slots_frame(slot_row(DM))])
    run_one("ws-capture", granted, make_ctx(grants=D_P1_GRANTS))
    assert granted.sent == ['{"type":"subscribe_subagents"}']
    slots_only = Grants(frozenset(), frozenset({"slots:user"}), "manifest")
    quiet = FakePort(frames=[slots_frame(slot_row(DM))])
    run_one("ws-capture", quiet, make_ctx(grants=slots_only))
    assert quiet.sent == []


def test_only_underscore_types_are_reserved_for_the_probe() -> None:
    assert is_reserved_frame_type("_probe_reconnect")
    assert is_reserved_frame_type("_anything")
    assert not is_reserved_frame_type("slots")
    assert not is_reserved_frame_type(None)


def test_only_the_subscribe_message_is_an_allowed_client_text() -> None:
    assert is_allowed_client_text('{"type":"subscribe_subagents"}')
    assert not is_allowed_client_text('{"type": "subscribe_subagents"}')
    assert not is_allowed_client_text('{"type":"chat","text":"hi"}')


def test_a_reconnect_marker_resyncs_without_a_spurious_start_or_removal() -> None:
    frames = [
        slots_frame(slot_row(DM, running=True)),
        marker(),
        slots_frame(slot_row(DM, running=True)),
        event_frame("subagent_snapshot", id="sa-1", slot=DM),
        slots_frame(slot_row(DM, running=False)),
    ]
    ctx = make_ctx(reconnect_after_start=1)
    run_one("ws-capture", FakePort(frames=frames), ctx)
    assert signal_kinds(ctx) == ["start", "reconnect", "resync", "terminal"]
    excerpt = ctx.run.cells["reconnect-snapshot"].evidence[0].excerpt
    assert excerpt.startswith("1 reconnect(s); probe rows before 1, after 1")
    assert excerpt.endswith("replayed within 10 s: subagent_snapshot 1")
    assert note(ctx, "reconnect-cursor-history") == "no history frames after reconnect"


def test_a_reconnect_with_no_slots_frame_after_it_is_untested() -> None:
    ctx = make_ctx()
    run_one("ws-capture", FakePort(frames=[slots_frame(slot_row(DM)), marker()]), ctx)
    assert note(ctx, "reconnect-snapshot") == "reconnected but no slots frame followed"


def test_forged_or_malformed_markers_and_underscore_frames_are_ignored() -> None:
    frames: list[dict[str, object]] = [
        slots_frame(slot_row(DM, running=True)),
        marker(1),
        marker(True),
        marker("2"),
        {"type": "_probe_reconnect"},
        {"type": "_other", "data": {}},
        slots_frame(slot_row(DM, running=False)),
    ]
    ctx = make_ctx()
    run_one("ws-capture", FakePort(frames=frames), ctx)
    assert signal_kinds(ctx) == ["start", "terminal"]
    assert "no deliberate reconnect was configured" in note(ctx, "reconnect-snapshot")
    assert "_other" not in ctx.run.events.frames_seen


def test_earlier_turns_replayed_after_a_reconnect_decide_cursor_history() -> None:
    frames = [
        slots_frame(slot_row(DM, running=True)),
        event_frame("chat_done", slot=DM, turn=3),
        marker(),
        slots_frame(slot_row(DM, running=True)),
        event_frame("chat_done", slot=DM, turn=2),
        event_frame("chat_done", slot=DM, turn=3),
        event_frame("chat_done", slot=DM, turn=4),
    ]
    ctx = make_ctx()
    run_one("ws-capture", FakePort(frames=frames), ctx)
    assert state(ctx, "reconnect-cursor-history") == "ALLOWED"
    assert ctx.run.cells["reconnect-cursor-history"].evidence[0].excerpt.startswith("1 earlier")


def test_the_reconnect_timer_drops_the_feed_after_the_first_start() -> None:
    port = FakePort(frames=[slots_frame(slot_row(DM)), slots_frame(slot_row(DM, running=True))])
    port.hang = True
    ctx = make_ctx(reconnect_after_start=0.05)
    run_one("ws-capture", port, ctx)
    assert port.drops == 1
    idle = FakePort(frames=[slots_frame(slot_row(DM))], hang=True)
    run_one("ws-capture", idle, make_ctx(reconnect_after_start=0.05))
    assert idle.drops == 0


def test_an_event_before_its_slot_row_is_kept_as_a_probe_row_at_the_next_slots_frame() -> None:
    worker = "w9"
    frames = [
        slots_frame(slot_row(DM)),
        event_frame("tool_call", slot=worker, kind="execute"),
        slots_frame(slot_row(DM), slot_row(worker, created_by=DM, running=True)),
    ]
    ctx = make_ctx()
    run_one("ws-capture", FakePort(frames=frames), ctx)
    (row,) = ctx.run.events.rows
    assert (row["rowKind"], row["data"]) == ("probe", {"kind": "execute", "slot": worker})
    assert "tool-call" in signal_kinds(ctx, worker)


def test_an_event_whose_slot_never_becomes_a_probe_slot_is_kept_in_plain_form() -> None:
    frames = [
        slots_frame(slot_row(DM)),
        event_frame("tool_call", slot="chat-7", kind="execute"),
        slots_frame(slot_row(DM)),
        event_frame("chat_done", slot="chat-8", turn=1),
    ]
    ctx = make_ctx()
    run_one("ws-capture", FakePort(frames=frames), ctx)
    rows = ctx.run.events.rows
    assert [row["rowKind"] for row in rows] == ["non-probe", "non-probe"]
    assert rows[0]["data"] == {
        "kind": placeholder("execute"),
        "slot": digest(ctx.run.salt, "chat-7"),
    }
    assert "chat-7" not in str(rows)


def test_a_pending_event_expires_after_its_ttl() -> None:
    ticks = iter([0.0])
    frames = [
        slots_frame(slot_row(DM)),
        event_frame("tool_call", slot="w9", kind="execute"),
        event_frame("chat_done", slot=DM, turn=1),
    ]
    ctx = make_ctx(monotonic=lambda: next(ticks, 10.0))
    run_one("ws-capture", FakePort(frames=frames), ctx)
    assert [row["rowKind"] for row in ctx.run.events.rows] == ["non-probe", "probe"]


def test_subagent_frames_on_the_dm_slot_decide_both_subagent_cells() -> None:
    frames = [
        slots_frame(slot_row(DM, running=True)),
        event_frame("subagent_spawn", id="sa-1", slot=DM, batch_id="b-1", task="secret task"),
        event_frame("subagent_status", id="sa-1", slot=DM, status="running"),
        event_frame("subagent_done", id="sa-1", slot=DM, outcome="completed"),
    ]
    ctx = make_ctx(grants=D_P1_GRANTS)
    run_one("ws-capture", FakePort(frames=frames), ctx)
    assert state(ctx, "subagent-events-visible") == "ALLOWED"
    excerpt = ctx.run.cells["bot-worker-session-attribution-subagent"].evidence[0].excerpt
    assert excerpt.startswith("2 subagent_spawn/subagent_done frame(s)")
    assert "batch_id present: yes" in excerpt
    worker = ctx.run.attempts[f"subagent:{digest(ctx.run.salt, 'sa-1')}"]
    assert (worker.kind, worker.bot_ref) == ("worker-session", "probe")
    assert [s.kind for s in worker.signals] == [
        "subagent-spawn",
        "subagent-status",
        "subagent-done",
    ]
    assert "secret task" not in str(ctx.run.events.rows)


def test_a_longer_slug_is_not_attributed_and_no_grant_leaves_the_cell_untested() -> None:
    other = "member-probex"
    frames = [
        slots_frame(slot_row(DM), slot_row(other)),
        event_frame("subagent_spawn", id="sa-2", slot=other),
    ]
    ctx = make_ctx(grants=D_P1_GRANTS)
    run_one("ws-capture", FakePort(frames=frames), ctx)
    assert state(ctx, "bot-worker-session-attribution-subagent") == "UNTESTED"
    assert "a quiet bot and a denial" in note(ctx, "subagent-events-visible")
    bare = make_ctx(grants=Grants(frozenset(), frozenset({"slots:user"}), "manifest"))
    run_one("ws-capture", FakePort(frames=frames), bare)
    assert note(bare, "subagent-events-visible") == "no subagent grant declared"


def test_event_signals_decide_the_lifecycle_cells() -> None:
    frames = [
        slots_frame(slot_row(DM)),
        event_frame("chat_status", slot=DM, status="Thinking"),
        event_frame("tool_call", slot=DM, kind="execute"),
        event_frame("tool_result", slot=DM, kind="execute", is_error=True),
        event_frame("approval", id="ap-1", slot=DM, tool="shell"),
        event_frame("question_card", slot=DM),
        event_frame("chat_done", slot=DM, turn=1),
    ]
    ctx = make_ctx()
    run_one("ws-capture", FakePort(frames=frames), ctx)
    for cell in ("user-signal-start", "user-signal-progress", "user-signal-terminal"):
        assert state(ctx, cell) == "ALLOWED", cell
    assert (
        ctx.run.cells["user-signal-terminal"]
        .evidence[0]
        .excerpt.endswith("a turn boundary, not an outcome")
    )
    approval = ctx.run.cells["user-signal-approval"].evidence[0].excerpt
    assert approval.endswith("question_card frames: 1")
    assert state(ctx, "user-signal-tool-error") == "ALLOWED"


def test_tool_error_is_untested_without_an_indicator_or_without_a_tool_result() -> None:
    frames = [slots_frame(slot_row(DM)), event_frame("tool_result", slot=DM, kind="execute")]
    ctx = make_ctx()
    run_one("ws-capture", FakePort(frames=frames), ctx)
    assert (
        note(ctx, "user-signal-tool-error") == "1 tool_result frame(s) carried no error indicator"
    )
    quiet = make_ctx()
    run_one("ws-capture", FakePort(frames=[slots_frame(slot_row(DM))]), quiet)
    assert note(quiet, "user-signal-tool-error") == "no tool_result on a probe slot in the window"
    assert note(quiet, "closed-tab-collection") == "no probe-slot progress or terminal"


def test_a_terminal_in_a_long_idle_gap_decides_the_closed_tab_cell() -> None:
    times = iter(f"2026-11-14T10:{minute:02d}:00+00:00" for minute in range(60))
    frames = [slots_frame(slot_row(DM, running=True)), slots_frame(slot_row(DM, running=False))]
    ctx = make_ctx(now=lambda: next(times))
    run_one("ws-capture", FakePort(frames=frames), ctx)
    assert state(ctx, "closed-tab-collection") == "ALLOWED"
    busy_times = iter(f"2026-11-14T10:{minute:02d}:00+00:00" for minute in range(60))
    every_ten_seconds = [f"2026-11-14T10:{m:02d}:{s:02d}+00:00" for m in range(60) for s in (0, 10)]
    busy = make_ctx(now=lambda: next(busy_times), page_requests=lambda: every_ten_seconds)
    run_one("ws-capture", FakePort(frames=frames), busy)
    assert state(busy, "closed-tab-collection") == "UNTESTED"


def roster_body(name: str) -> tuple[int, bytes]:
    return 200, json_body({"agents": [{"slug": "probe", "display_name": name}]})


class RenamingPort(FakePort):
    """Answers /api/agents with a new display name on the second read."""

    def __init__(self, frames: list[dict[str, object]]) -> None:
        super().__init__(frames=frames, hang=True)
        self.names = iter(["Probe", "Probe Renamed"])

    async def http(
        self,
        method: str,
        path: str,
        body: bytes | None = None,
        *,
        token: bool = True,
        local: bool = False,
    ) -> tuple[int, bytes]:
        self.responses[("GET", "/api/agents")] = roster_body(next(self.names, "Probe Renamed"))
        return await super().http(method, path, body, token=token, local=local)


def test_the_roster_poller_decides_rename_from_digests_only() -> None:
    port = RenamingPort([slots_frame(slot_row(DM))])
    ctx = make_ctx(grants=D_P1_GRANTS, agents_poll_seconds=0.05)
    run_one("ws-capture", port, ctx)
    cell = ctx.run.cells["bot-id-stable-across-rename"]
    assert cell.state == "ALLOWED"
    assert "Probe Renamed" not in str(cell) and "Probe Renamed" not in str(ctx.run.events.rows)
    assert all(call[1] == "/api/agents" for call in port.calls)


def test_rename_needs_a_slug_and_the_agents_grant() -> None:
    no_slug = make_ctx(slug="", grants=D_P1_GRANTS)
    run_one("ws-capture", FakePort(frames=[slots_frame()]), no_slug)
    assert note(no_slug, "bot-id-stable-across-rename") == "probe slug not set"
    slots_only = make_ctx(grants=Grants(frozenset(), frozenset({"slots:user"}), "manifest"))
    run_one("ws-capture", FakePort(frames=[slots_frame()]), slots_only)
    assert note(slots_only, "bot-id-stable-across-rename") == "no /api/agents grant declared"


def test_a_failing_roster_read_is_skipped_and_the_poll_continues() -> None:
    port = FakePort({("GET", "/api/agents"): TimeoutError()}, frames=[slots_frame()], hang=True)
    ctx = make_ctx(grants=D_P1_GRANTS, agents_poll_seconds=0.05)
    run_one("ws-capture", port, ctx)
    assert len(port.calls) >= 2
    assert note(ctx, "bot-id-stable-across-rename") == "display_name did not change across 0 reads"


USERNAME = "sentinel-os-user"


def test_usage_endpoints_make_exactly_two_gets_and_record_field_names_only() -> None:
    usage = (200, json_body({"user": USERNAME, "credits": 3, "sessions": [{"slot": "s", "n": 1}]}))
    sessions = (200, json_body({"owner": USERNAME, "total_tokens": 9}))
    port = FakePort({("GET", "/api/usage"): usage, ("GET", "/api/sessions/usage"): sessions})
    ctx = make_ctx(grants=D_P1_GRANTS)
    run_one("usage-endpoints", port, ctx)
    assert port.calls == [
        ("GET", "/api/usage", True, False),
        ("GET", "/api/sessions/usage", True, False),
    ]
    assert state(ctx, "usage-api-app-token") == "ALLOWED"
    assert state(ctx, "sessions-usage-api-app-token") == "ALLOWED"
    per_bot = ctx.run.cells["bot-token-usage-per-bot"]
    assert per_bot.state == "ALLOWED"
    assert "field names present (slot)" in per_bot.evidence[0].excerpt
    assert USERNAME not in str(ctx.run.cells)


def test_usage_without_per_bot_fields_or_bodies_leaves_the_per_bot_cell_untested() -> None:
    flat = (200, json_body({"credits": 3}))
    port = FakePort({("GET", "/api/usage"): flat, ("GET", "/api/sessions/usage"): DENY})
    ctx = make_ctx(grants=D_P1_GRANTS)
    run_one("usage-endpoints", port, ctx)
    assert state(ctx, "sessions-usage-api-app-token") == "DENIED"
    assert note(ctx, "bot-token-usage-per-bot").startswith(
        "no per-slot or per-bot field names: /api/usage object with fields credits"
    )
    listed = FakePort(
        {("GET", "/api/usage"): (200, b'"text"'), ("GET", "/api/sessions/usage"): DENY}
    )
    odd = make_ctx(grants=D_P1_GRANTS)
    run_one("usage-endpoints", listed, odd)
    assert state(odd, "usage-api-app-token") == "UNTESTED"
    assert note(odd, "bot-token-usage-per-bot").startswith("no usage endpoint answered with a body")


def test_usage_paths_without_a_grant_are_not_requested() -> None:
    only_usage = Grants(frozenset({"/api/usage"}), frozenset(), "manifest")
    port = FakePort({("GET", "/api/usage"): (200, json_body([{"bot_id": "x"}]))})
    ctx = make_ctx(grants=only_usage)
    run_one("usage-endpoints", port, ctx)
    assert port.calls == [("GET", "/api/usage", True, False)]
    assert note(ctx, "sessions-usage-api-app-token") == "no /api/sessions/usage grant declared"
    assert state(ctx, "bot-token-usage-per-bot") == "ALLOWED"


def test_events_without_a_slot_unsanitisable_events_and_a_full_buffer() -> None:
    frames: list[dict[str, object]] = [
        slots_frame(slot_row(DM)),
        event_frame("approval_resolved", id="ap-1", approved=True),
        event_frame("context_usage", slot=DM, pct=float("nan")),
        *(event_frame("tool_call", slot=f"chat-{n}", kind="read") for n in range(101)),
    ]
    ctx = make_ctx()
    run_one("ws-capture", FakePort(frames=frames), ctx)
    rows = ctx.run.events.rows
    assert rows[0]["data"] == {"approved": True, "id": digest(ctx.run.salt, "ap-1")}
    assert ctx.run.stats.dropped == 1
    assert len(rows) == 102
    assert {row["rowKind"] for row in rows} == {"non-probe"}


def test_per_bot_field_names_deeper_than_three_levels_are_not_read() -> None:
    deep = {"a": {"b": {"c": {"d": {"slot": 1}}}}}
    port = FakePort({("GET", "/api/usage"): (200, json_body(deep))})
    ctx = make_ctx(grants=Grants(frozenset({"/api/usage"}), frozenset(), "manifest"))
    run_one("usage-endpoints", port, ctx)
    assert state(ctx, "bot-token-usage-per-bot") == "UNTESTED"


def test_a_bot_turn_in_a_slot_named_by_its_agent_field_is_attributed() -> None:
    """The 0.12.2 sitting shape: a stale `member-` DM row that never runs, and the bot's real
    DM turn in a slot keyed otherwise whose `agent` is the slug, with a worker under it."""
    stale = slot_row(f"{DM}.memory-old", agent="probe")
    live, worker = "chat-live", "chat-worker"
    frames = [
        slots_frame(stale, slot_row(live, agent="probe", created_by="someone")),
        slots_frame(stale, slot_row(live, agent="probe", created_by="someone", running=True)),
        event_frame("tool_call", slot=live, kind="execute"),
        event_frame("subagent_spawn", id="sa-1", slot=live),
        slots_frame(
            stale,
            slot_row(live, agent="probe", created_by="someone", running=True),
            slot_row(worker, agent="helper", created_by=live, running=True),
        ),
        event_frame("chat_done", slot=live, turn=1),
        slots_frame(
            stale,
            slot_row(live, agent="probe", created_by="someone"),
            slot_row(worker, agent="helper", created_by=live),
        ),
    ]
    ctx = make_ctx(grants=D_P1_GRANTS)
    run_one("ws-capture", FakePort(frames=frames), ctx)
    for cell in (
        "user-signal-start",
        "user-signal-progress",
        "user-signal-terminal",
        "bot-worker-session-attribution",
        "bot-worker-session-attribution-subagent",
        "subagent-events-visible",
    ):
        assert state(ctx, cell) == "ALLOWED", cell
    assert ctx.run.attempts[live].kind == "bot-turn"
    assert ctx.run.attempts[worker].kind == "worker-session"
    subagent = ctx.run.attempts[f"subagent:{digest(ctx.run.salt, 'sa-1')}"]
    assert (subagent.kind, subagent.bot_ref) == ("worker-session", "probe")
    assert {row["rowKind"] for row in ctx.run.events.rows} == {"probe"}
    assert ctx.run.cells["bot-id-observable"].evidence[0].excerpt == (
        "probe bot slot present: DM slot key member-probe; a slot whose agent field is the "
        "probe slug"
    )


def test_an_agent_field_for_another_bot_or_a_longer_slug_is_not_attributed() -> None:
    frames = [
        slots_frame(
            slot_row("chat-a", agent="probex", running=True),
            slot_row("chat-b", agent="Probe", running=True),
        ),
        event_frame("chat_done", slot="chat-a", turn=1),
    ]
    ctx = make_ctx()
    run_one("ws-capture", FakePort(frames=frames), ctx)
    assert ctx.run.probe_slots == frozenset()
    assert note(ctx, "bot-id-observable") == "probe DM slot not in the snapshots"
    assert {row["rowKind"] for row in ctx.run.events.rows} == {"non-probe"}


def test_the_bot_id_excerpt_names_which_form_matched() -> None:
    by_agent = make_ctx()
    run_one(
        "ws-capture", FakePort(frames=[slots_frame(slot_row("chat-x", agent="probe"))]), by_agent
    )
    excerpt = by_agent.run.cells["bot-id-observable"].evidence[0].excerpt
    assert excerpt == "probe bot slot present: a slot whose agent field is the probe slug"
    by_key = make_ctx()
    run_one("ws-capture", FakePort(frames=[slots_frame(slot_row(DM))]), by_key)
    excerpt = by_key.run.cells["bot-id-observable"].evidence[0].excerpt
    assert excerpt == "probe bot slot present: DM slot key member-probe"


V3_GRANTS = Grants(
    api=frozenset(
        {
            "/apps/specter-arena/api/*",
            "/api/agents",
            "=/api/usage",
            "=/api/sessions/usage",
            "=/api/usage/turns",
            "/api/member-records/*",
        }
    ),
    events=frozenset({"slots:user", "subagent:user"}),
    basis="manifest",
)


def test_the_member_record_body_names_a_type_and_a_data_object() -> None:
    path = "/api/member-records/probe"
    port = FakePort({("POST", path): (200, json_body({"ok": True}))})
    run_one("member-record-write", port, make_ctx(grants=V3_GRANTS))
    body = json.loads(port.bodies[0] or b"")
    assert set(body) == {"type", "data"}
    assert body["type"] == MEMBER_RECORD_TYPE
    # Crew keys it as specter_arena__<type>: letters, digits, single underscores, 64 at most.
    assert re.fullmatch(r"[A-Za-z0-9_]+", f"specter_arena__{body['type']}")
    assert "__" not in body["type"]
    assert len(f"specter_arena__{body['type']}") <= 64
    assert body["data"]["source"] == "specter-probe"
    ungranted = FakePort({("POST", path): DENY})
    run_one("member-record-ungranted", ungranted, make_ctx(grants=Grants.none()))
    assert json.loads(ungranted.bodies[0] or b"")["type"] == MEMBER_RECORD_TYPE


def test_exact_usage_grants_let_the_usage_step_run() -> None:
    port = FakePort(
        {
            ("GET", "/api/usage"): (
                200,
                json_body({"username": "x", "sessions": {}, "billing": {}}),
            ),
            ("GET", "/api/sessions/usage"): (200, json_body({"usage": {}})),
        }
    )
    ctx = make_ctx(grants=V3_GRANTS)
    run_one("usage-endpoints", port, ctx)
    assert state(ctx, "usage-api-app-token") == "ALLOWED"
    assert state(ctx, "sessions-usage-api-app-token") == "ALLOWED"
    assert [call[1] for call in port.calls] == ["/api/usage", "/api/sessions/usage"]


def test_approval_resolved_is_counted_and_a_plain_refusal_is_not_a_distinct_signal() -> None:
    frames = [
        slots_frame(slot_row(DM, running=True)),
        slots_frame(slot_row(DM, running=True, pending_approval=True)),
        event_frame(
            "approval_resolved", id="a-1", slot=DM, approved=False, origin="native", mid="m-1"
        ),
        event_frame("approval_resolved", id="a-2", slot=DM, approved=True, origin="native"),
    ]
    ctx = make_ctx(grants=V3_GRANTS)
    run_one("ws-capture", FakePort(frames=frames), ctx)
    assert state(ctx, "user-signal-approval") == "ALLOWED"
    resolved = ctx.run.cells["user-signal-approval-resolved"]
    assert resolved.state == "ALLOWED"
    assert (
        "2 approval_resolved frame(s) on a probe slot, 1 with approved=false"
        in resolved.evidence[0].excerpt
    )
    assert "origin=native" in resolved.evidence[0].excerpt
    blocked = ctx.run.cells["user-signal-blocked-distinct"]
    assert blocked.state == "UNSUPPORTED"
    assert "only approved distinguished a refusal" in blocked.evidence[0].excerpt
    assert "m-1" not in json.dumps(list(ctx.run.events.rows))


def test_a_decision_word_is_a_distinct_signal_and_free_text_is_never_kept() -> None:
    frames = [
        slots_frame(slot_row(DM, running=True)),
        event_frame(
            "approval_resolved",
            id="a-1",
            slot=DM,
            approved=False,
            origin="coordinator",
            decision="expired",
            tool="rm -rf",
        ),
    ]
    ctx = make_ctx(grants=V3_GRANTS)
    run_one("ws-capture", FakePort(frames=frames), ctx)
    blocked = ctx.run.cells["user-signal-blocked-distinct"]
    assert blocked.state == "ALLOWED"
    assert "decision=expired" in blocked.evidence[0].excerpt
    assert "rm -rf" not in json.dumps(list(ctx.run.events.rows))


def test_approval_cells_stay_untested_without_a_frame_or_a_refusal() -> None:
    ctx = make_ctx(grants=V3_GRANTS)
    run_one("ws-capture", FakePort(frames=[slots_frame(slot_row(DM, running=True))]), ctx)
    assert state(ctx, "user-signal-approval-resolved") == "UNTESTED"
    assert state(ctx, "user-signal-blocked-distinct") == "UNTESTED"
    approved_only = make_ctx(grants=V3_GRANTS)
    frames = [
        slots_frame(slot_row(DM, running=True)),
        event_frame("approval_resolved", id="a-1", slot=DM, approved=True),
    ]
    run_one("ws-capture", FakePort(frames=frames), approved_only)
    assert state(approved_only, "user-signal-approval-resolved") == "ALLOWED"
    assert state(approved_only, "user-signal-blocked-distinct") == "UNTESTED"
    assert "no approval was refused" in note(approved_only, "user-signal-blocked-distinct")


def test_context_usage_on_a_probe_slot_decides_the_context_cell_and_is_a_gauge() -> None:
    frames = [
        slots_frame(slot_row(DM, running=True)),
        event_frame("context_usage", slot=DM, pct=7.2, used_tokens=71806, window_tokens=1000000),
        event_frame("context_usage", slot=DM, pct=9.0, used_tokens=90000, window_tokens=1000000),
        event_frame("context_usage", slot="chat-9", pct=1.0, used_tokens=999999, window_tokens=1),
    ]
    ctx = make_ctx(grants=V3_GRANTS)
    run_one("ws-capture", FakePort(frames=frames), ctx)
    cell = ctx.run.cells["bot-token-context-usage"]
    assert cell.state == "ALLOWED"
    excerpt = cell.evidence[0].excerpt
    assert "2 context_usage frame(s)" in excerpt
    assert "largest used_tokens 90000 of a 1000000 token window" in excerpt
    assert "not cumulative spend" in excerpt
    none = make_ctx(grants=V3_GRANTS)
    run_one("ws-capture", FakePort(frames=[slots_frame(slot_row(DM))]), none)
    assert state(none, "bot-token-context-usage") == "UNTESTED"
    no_slots = make_ctx(grants=Grants.none())
    run_one("ws-capture", FakePort(frames=[slots_frame(slot_row(DM))]), no_slots)
    assert note(no_slots, "bot-token-context-usage") == "no slots grant declared"


def test_subagent_replay_after_a_reconnect_is_decided_only_after_a_reconnect() -> None:
    frames = [
        slots_frame(slot_row(DM, running=True)),
        marker(),
        slots_frame(slot_row(DM, running=True)),
        event_frame("subagent_done", id="sa-1", slot=DM, outcome="completed"),
        event_frame("subagent_snapshot", id="sa-2", slot=DM),
    ]
    ctx = make_ctx(grants=V3_GRANTS)
    run_one("ws-capture", FakePort(frames=frames), ctx)
    cell = ctx.run.cells["subagent-replay-after-reconnect"]
    assert cell.state == "ALLOWED"
    assert "subagent_done 1, subagent_snapshot 1" in cell.evidence[0].excerpt
    quiet = make_ctx(grants=V3_GRANTS)
    run_one(
        "ws-capture",
        FakePort(frames=[slots_frame(slot_row(DM)), marker(), slots_frame(slot_row(DM))]),
        quiet,
    )
    assert state(quiet, "subagent-replay-after-reconnect") == "UNTESTED"
    assert "replayed nothing" in note(quiet, "subagent-replay-after-reconnect")
    none = make_ctx(grants=V3_GRANTS)
    run_one("ws-capture", FakePort(frames=[slots_frame(slot_row(DM))]), none)
    assert "no reconnect happened" in note(none, "subagent-replay-after-reconnect")
    slots_only = Grants(frozenset(), frozenset({"slots:user"}), "manifest")
    bare = make_ctx(grants=slots_only)
    run_one(
        "ws-capture",
        FakePort(frames=[slots_frame(slot_row(DM)), marker(), slots_frame(slot_row(DM))]),
        bare,
    )
    assert note(bare, "subagent-replay-after-reconnect") == "no subagent grant declared"


def test_usage_turns_asks_once_for_the_bot_slot_and_records_shape_only() -> None:
    target = f"/api/usage/turns?slot={DM}"
    port = FakePort({("GET", target): (200, json_body({"slot": DM, "days": 7, "turns": []}))})
    ctx = make_ctx(grants=V3_GRANTS)
    run_one("ws-capture", FakePort(frames=[slots_frame(slot_row(DM, running=True))]), ctx)
    run_one("usage-turns", port, ctx)
    cell = ctx.run.cells["bot-token-usage-turns-app-scoped"]
    assert cell.state == "ALLOWED"
    assert "0 turn row(s)" in cell.evidence[0].excerpt
    assert [call[:2] for call in port.calls] == [("GET", target)]
    assert DM not in cell.evidence[0].excerpt


def test_usage_turns_denied_untested_without_grant_and_without_a_bot_slot() -> None:
    denied = make_ctx(grants=V3_GRANTS)
    run_one("ws-capture", FakePort(frames=[slots_frame(slot_row(DM, running=True))]), denied)
    run_one("usage-turns", FakePort({("GET", f"/api/usage/turns?slot={DM}"): DENY}), denied)
    assert state(denied, "bot-token-usage-turns-app-scoped") == "DENIED"
    bare = make_ctx(grants=Grants.none())
    run_one("usage-turns", FakePort(), bare)
    assert note(bare, "bot-token-usage-turns-app-scoped") == "no /api/usage/turns grant declared"
    no_bot = make_ctx(grants=V3_GRANTS)
    port = FakePort()
    run_one("usage-turns", port, no_bot)
    assert "no probe bot slot" in note(no_bot, "bot-token-usage-turns-app-scoped")
    assert port.calls == []


def test_usage_turns_is_opt_in_so_a_default_run_does_not_ask() -> None:
    assert "usage-turns" not in [step.id for step in select_steps(None)]
