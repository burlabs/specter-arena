import asyncio

import pytest

from backend.specter_arena.probe.matrix import empty_run, to_host_facts_json, to_matrix_json
from backend.specter_arena.probe.sanitise import digest
from backend.specter_arena.probe.steps import (
    STEP_IDS,
    STEPS,
    StepContext,
    UnknownStep,
    execute_step,
    run_steps,
    select_steps,
)
from backend.tests.probe_fakes import (
    NOW,
    FakePort,
    error_body,
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
    return StepContext(run=run, now=lambda: NOW, capture_seconds=0.2, **kwargs)  # type: ignore[arg-type]


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
        "chat-slots",
        "ws-capture",
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
    assert len(select_steps(None)) == 10
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
    run_one("token-exchange", FakePort(token=exchange_refused(500)), ctx)
    assert state(ctx, "app-owned-token-exchange") == "UNTESTED"
    assert "status 500" in note(ctx, "app-owned-token-exchange")
    run_one("token-exchange", FakePort(token=""), ctx)
    assert "empty token" in note(ctx, "app-owned-token-exchange")
    run_one("token-exchange", FakePort(token=TimeoutError()), ctx)
    assert note(ctx, "app-owned-token-exchange") == "request timed out"


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
    assert note(ctx, "bot-list-via-agents") == "probe slug not set"


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
    ctx = make_ctx(grants_declared=False)
    run_one("ws-capture", FakePort(frames=[slots_frame()]), ctx)
    assert state(ctx, "user-slots-no-grant-denied") == "DENIED"
    assert "no slots grant" in note(ctx, "user-slots-visible")


def test_ws_capture_without_grants_reports_visible_rows() -> None:
    ctx = make_ctx(grants_declared=False)
    run_one("ws-capture", FakePort(frames=[slots_frame(slot_row("chat-1"))]), ctx)
    assert state(ctx, "user-slots-no-grant-denied") == "ALLOWED"


def test_ws_capture_without_grants_and_without_frames_is_untested() -> None:
    ctx = make_ctx(grants_declared=False)
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


def test_ws_capture_stops_at_the_frame_cap() -> None:
    ctx = make_ctx()
    ctx.max_frames = 1
    frames = [
        slots_frame(slot_row("member-probe")),
        slots_frame(slot_row("member-probe", running=True)),
    ]
    run_one("ws-capture", FakePort(frames=frames), ctx)
    assert "user-signal-start" in ctx.run.cells
    assert state(ctx, "user-signal-start") == "UNTESTED"


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
    bare = make_ctx(grants_declared=False)
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
    assert len(ctx.run.cells) == sum(len(step.cells) for step in STEPS)
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
    assert len(to_host_facts_json(ctx.run)["facts"]) == 11  # type: ignore[arg-type]
