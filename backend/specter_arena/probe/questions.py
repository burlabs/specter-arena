# SPECTER-DIAGNOSTIC-ONLY
# ruff: noqa: E501
# Question text is pinned byte-for-byte to docs/compatibility/capability-questions.json, so long
# lines stay unwrapped.
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Literal

MARKER = "SPECTER-DIAGNOSTIC-ONLY"

Scope = Literal["app-owned", "user-owned", "other-app", "bot", "external-cli"]
Kind = Literal["matrix", "host-fact"]
Priority = Literal["must", "best-effort", "deferred"]
Method = Literal[
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
    "owner-step",
    "not-probed",
]

QUESTIONS_VERSION = 1


@dataclass(frozen=True)
class Question:
    id: str
    kind: Kind
    question: str
    scope: Scope | None
    priority: Priority
    intake: str
    method: Method
    needs_owner: bool


# Sorted by id. `method` names the probe step that decides the cell, "owner-step" when only
# the owner can drive it, and "not-probed" for the one cell committed UNTESTED on purpose.
QUESTIONS: tuple[Question, ...] = (
    Question(
        id="app-owned-grant-staging",
        kind="matrix",
        question="Does an update that adds a permission stay denied until Eric approves?",
        scope="app-owned",
        priority="must",
        intake="NFR-7",
        method="owner-step",
        needs_owner=True,
    ),
    Question(
        id="app-owned-slots-visible",
        kind="matrix",
        question="Does the app see its own slots with no event grant?",
        scope="app-owned",
        priority="best-effort",
        intake="AC04",
        method="owner-step",
        needs_owner=True,
    ),
    Question(
        id="app-owned-token-exchange",
        kind="matrix",
        question="Does POST {origin}/api/apps/specter-arena/token with X-App-Secret return a token?",
        scope="app-owned",
        priority="must",
        intake="SC-8",
        method="token-exchange",
        needs_owner=False,
    ),
    Question(
        id="app-owned-token-lifetime",
        kind="matrix",
        question="Token lifetime and refresh behaviour on a long-lived WS",
        scope="app-owned",
        priority="best-effort",
        intake="AC03",
        method="owner-step",
        needs_owner=True,
    ),
    Question(
        id="app-owned-unsigned-direct-rejected",
        kind="matrix",
        question="Does the backend reject a direct unsigned /api/ping with 401? (backend calls its own loopback port)",
        scope="app-owned",
        priority="must",
        intake="AC01",
        method="own-proxy-unauth",
        needs_owner=False,
    ),
    Question(
        id="app-owned-ws-token-transport",
        kind="matrix",
        question="Which transport does /api/ws and HTTP accept (?token=, cookie, Bearer)?",
        scope="app-owned",
        priority="must",
        intake="SC-8",
        method="ws-capture",
        needs_owner=False,
    ),
    Question(
        id="bot-activity-read",
        kind="matrix",
        question="/api/members/<slug>/activity",
        scope="bot",
        priority="must",
        intake="PA-1 activity",
        method="deny-matrix",
        needs_owner=False,
    ),
    Question(
        id="bot-attribution-survives-restart",
        kind="matrix",
        question="Do created_by/lineage_minted survive a gateway restart? (only with Eric's explicit go-ahead, FD-21)",
        scope="bot",
        priority="best-effort",
        intake="PA-1",
        method="owner-step",
        needs_owner=True,
    ),
    Question(
        id="bot-dashboard-member-record",
        kind="matrix",
        question="Does POST /api/member-records/<slug> write and does a bound bot-dashboard page render it? (SC-10(1))",
        scope="bot",
        priority="must",
        intake="FR-7, PA1-D5",
        method="member-record-write",
        needs_owner=True,
    ),
    Question(
        id="bot-dashboard-record-ungranted",
        kind="matrix",
        question="Is the same POST refused without the grant?",
        scope="bot",
        priority="must",
        intake="FR-7",
        method="member-record-ungranted",
        needs_owner=False,
    ),
    Question(
        id="bot-dashboard-webview-hook",
        kind="matrix",
        question="Can app HTML reach the Crew Webview drawer via an on_startup hook? (SC-10(2)) NOT PROBED (FD-6): needs backend.hooks (excluded by FP-00 C-2) and an execution trust grant. Committed as UNTESTED with that reason; mechanism documented from rfc-app-sdk-crew-webview.md for PA1-D5",
        scope="bot",
        priority="deferred",
        intake="FR-7, PA1-D5",
        method="not-probed",
        needs_owner=False,
    ),
    Question(
        id="bot-delete-behaviour",
        kind="matrix",
        question="After deleting the probe bot, what happens to its slots/history in frames and /api/chat/slots?",
        scope="bot",
        priority="must",
        intake="PA-1 delete",
        method="owner-step",
        needs_owner=True,
    ),
    Question(
        id="bot-fresh-start",
        kind="matrix",
        question="What does fresh-start do to the slot key/history in frames?",
        scope="bot",
        priority="best-effort",
        intake="PA-1 fresh start",
        method="owner-step",
        needs_owner=True,
    ),
    Question(
        id="bot-goals-read",
        kind="matrix",
        question="/api/members/<slug>/goals",
        scope="bot",
        priority="must",
        intake="PA-1 goals",
        method="deny-matrix",
        needs_owner=False,
    ),
    Question(
        id="bot-id-observable",
        kind="matrix",
        question="Is a stable bot id (slug) derivable (member-<slug> DM slot key)",
        scope="bot",
        priority="must",
        intake="PA-1 stable id",
        method="ws-capture",
        needs_owner=False,
    ),
    Question(
        id="bot-id-stable-across-rename",
        kind="matrix",
        question="Does the id/key stay the same after Eric renames the probe bot?",
        scope="bot",
        priority="must",
        intake="PA-1 rename",
        method="owner-step",
        needs_owner=True,
    ),
    Question(
        id="bot-key-results-read",
        kind="matrix",
        question="/api/members/<slug>/goals/key-results",
        scope="bot",
        priority="must",
        intake="PA-1 KRs",
        method="deny-matrix",
        needs_owner=False,
    ),
    Question(
        id="bot-ledger-read",
        kind="matrix",
        question="Can the app read the bot's work-ledger items (/api/members/<slug>/projections)?",
        scope="bot",
        priority="must",
        intake="PA-1 ledger",
        method="deny-matrix",
        needs_owner=False,
    ),
    Question(
        id="bot-list-members-denied",
        kind="matrix",
        question="GET /api/members with app token",
        scope="bot",
        priority="must",
        intake="PA-1 list bots",
        method="deny-matrix",
        needs_owner=False,
    ),
    Question(
        id="bot-list-via-agents",
        kind="matrix",
        question="Do /api/agents rows include the probe bot, and which fields do they carry?",
        scope="bot",
        priority="must",
        intake="PA-1 list bots, name",
        method="agents-roster",
        needs_owner=False,
    ),
    Question(
        id="bot-name-avatar",
        kind="matrix",
        question="Are display name and avatar readable by the app?",
        scope="bot",
        priority="must",
        intake="PA-1 name/avatar",
        method="agents-roster",
        needs_owner=False,
    ),
    Question(
        id="bot-notes-memory-private",
        kind="matrix",
        question="Notes/memory/lessons are not requested; record route deny only, never read content",
        scope="bot",
        priority="best-effort",
        intake="PA-1 privacy",
        method="deny-matrix",
        needs_owner=False,
    ),
    Question(
        id="bot-own-session-attribution",
        kind="matrix",
        question="Is the bot's own DM turn identifiable (member-<slug>, agent)",
        scope="bot",
        priority="must",
        intake="PA-1 bot-own",
        method="ws-capture",
        needs_owner=False,
    ),
    Question(
        id="bot-per-bot-opt-in",
        kind="matrix",
        question="Is there any per-bot grant or opt-in? (expected UNSUPPORTED: grants are app-wide)",
        scope="bot",
        priority="must",
        intake="PA-1 opt-in",
        method="owner-step",
        needs_owner=True,
    ),
    Question(
        id="bot-reimport-kirobot",
        kind="matrix",
        question="After re-importing the bot's .kirobot file, does id/attribution return?",
        scope="bot",
        priority="best-effort",
        intake="PA-1 re-import",
        method="owner-step",
        needs_owner=True,
    ),
    Question(
        id="bot-scheduled-turn-origin",
        kind="matrix",
        question="What origin does a scheduled bot turn carry (cron hides from slots:user)?",
        scope="bot",
        priority="best-effort",
        intake="PA-1",
        method="owner-step",
        needs_owner=True,
    ),
    Question(
        id="bot-worker-session-attribution",
        kind="matrix",
        question="Is a dispatched worker linked to its bot (created_by, lineage_minted)?",
        scope="bot",
        priority="must",
        intake="PA-1 worker",
        method="ws-capture",
        needs_owner=False,
    ),
    Question(
        id="closed-tab-collection",
        kind="matrix",
        question="With the arena tab closed, does the backend keep receiving frames while a worker runs?",
        scope="app-owned",
        priority="must",
        intake="AC03",
        method="owner-step",
        needs_owner=True,
    ),
    Question(
        id="external-cli-slot-appears",
        kind="matrix",
        question="Does a kiro-cli chat in a detached tmux session appear in the app's WS snapshot, /api/chat/slots, or the owner session list?",
        scope="external-cli",
        priority="must",
        intake="AC04, FR-6",
        method="cli-compare",
        needs_owner=True,
    ),
    Question(
        id="gateway-restart-reconnect",
        kind="matrix",
        question="Does the backend WS resubscribe after a gateway restart? (only with Eric's explicit go-ahead, FD-21)",
        scope="app-owned",
        priority="best-effort",
        intake="AC03",
        method="owner-step",
        needs_owner=True,
    ),
    Question(
        id="host-backend-spawn",
        kind="host-fact",
        question="Does the backend start under the sandbox, pip --target provision, and pass /health? (duration recorded)",
        scope=None,
        priority="must",
        intake="FR-2",
        method="owner-step",
        needs_owner=True,
    ),
    Question(
        id="host-consent-screen",
        kind="host-fact",
        question="What does install/enable consent show for api/events grants? (screenshot)",
        scope=None,
        priority="best-effort",
        intake="NFR-7",
        method="owner-step",
        needs_owner=True,
    ),
    Question(
        id="host-dev-diagnostic-only",
        kind="host-fact",
        question="Does the diagnostic page render only from the staged app and 404 from a release-tree install?",
        scope=None,
        priority="must",
        intake="NFR-4",
        method="owner-step",
        needs_owner=True,
    ),
    Question(
        id="host-disable-reenable",
        kind="host-fact",
        question="After disable the proxy returns 403 app_not_enabled; after re-enable it recovers?",
        scope=None,
        priority="must",
        intake="AC01",
        method="owner-step",
        needs_owner=True,
    ),
    Question(
        id="host-import-map-sdk",
        kind="host-fact",
        question="Does @kirocrew/app-sdk (and /ui) resolve from the bundle?",
        scope=None,
        priority="best-effort",
        intake="FR-2",
        method="owner-step",
        needs_owner=True,
    ),
    Question(
        id="host-install-validates",
        kind="host-fact",
        question="Does live app.json validation accept the manifest (incl. minKiroCrewVersion)?",
        scope=None,
        priority="must",
        intake="FR-2, FR-10",
        method="owner-step",
        needs_owner=True,
    ),
    Question(
        id="host-proxy-path",
        kind="host-fact",
        question="Which backend path does the gateway proxy (/apps/specter-arena/api/ping vs declared backend.routes)?",
        scope=None,
        priority="must",
        intake="FR-2",
        method="owner-step",
        needs_owner=True,
    ),
    Question(
        id="host-react-version",
        kind="host-fact",
        question="What is React.version in the host?",
        scope=None,
        priority="must",
        intake="FR-2",
        method="owner-step",
        needs_owner=True,
    ),
    Question(
        id="host-roundtrip-signed",
        kind="host-fact",
        question="Does a signed GET /api/ping from the installed page succeed?",
        scope=None,
        priority="must",
        intake="AC01",
        method="owner-step",
        needs_owner=True,
    ),
    Question(
        id="host-ui-default-export-renders",
        kind="host-fact",
        question="Does a default-export component render in the app page?",
        scope=None,
        priority="must",
        intake="FR-2, AC01",
        method="owner-step",
        needs_owner=True,
    ),
    Question(
        id="host-ui-stub-failure",
        kind="host-fact",
        question="What does the host show when the FP-00 stub (named mount only) is installed unchanged?",
        scope=None,
        priority="must",
        intake="FR-2, CI-D2",
        method="owner-step",
        needs_owner=True,
    ),
    Question(
        id="other-app-api-denied",
        kind="matrix",
        question="Is an ungranted /api/* path refused (app token not permitted)?",
        scope="other-app",
        priority="must",
        intake="AC01",
        method="deny-matrix",
        needs_owner=False,
    ),
    Question(
        id="other-app-proxy-denied",
        kind="matrix",
        question="Is an app token for specter-arena refused on another app's proxy (/apps/<other>/api/..) with 403?",
        scope="other-app",
        priority="must",
        intake="AC01, AC04",
        method="other-app-proxy",
        needs_owner=False,
    ),
    Question(
        id="other-app-slots-absent",
        kind="matrix",
        question="Are another app's slots absent from the snapshot (no slots:app:* grant)?",
        scope="other-app",
        priority="best-effort",
        intake="AC04",
        method="owner-step",
        needs_owner=True,
    ),
    Question(
        id="reconnect-cursor-history",
        kind="matrix",
        question="Is there any cursor/since/sequence for missed events?",
        scope="app-owned",
        priority="must",
        intake="AC03",
        method="owner-step",
        needs_owner=True,
    ),
    Question(
        id="reconnect-snapshot",
        kind="matrix",
        question="After WS reconnect, what is recovered (slots snapshot, subagent cards, log replay)?",
        scope="app-owned",
        priority="must",
        intake="AC03",
        method="owner-step",
        needs_owner=True,
    ),
    Question(
        id="user-chat-slot-history",
        kind="matrix",
        question="Is GET /api/chat/slots/{slot} history readable for a worker slot?",
        scope="user-owned",
        priority="best-effort",
        intake="AC03",
        method="chat-slots",
        needs_owner=False,
    ),
    Question(
        id="user-chat-slots-api",
        kind="matrix",
        question="Does GET /api/chat/slots return all rows (unfiltered) with the grant, and 403 without?",
        scope="user-owned",
        priority="must",
        intake="AC04",
        method="chat-slots",
        needs_owner=False,
    ),
    Question(
        id="user-outcome-evidence",
        kind="matrix",
        question='What outcome evidence exists beyond idle? (never recorded as "accepted")',
        scope="user-owned",
        priority="must",
        intake="AC02, invariant 2",
        method="ws-capture",
        needs_owner=False,
    ),
    Question(
        id="user-signal-approval",
        kind="matrix",
        question="Is a pending approval observable (pending_approval, needs_input)?",
        scope="user-owned",
        priority="must",
        intake="AC02",
        method="ws-capture",
        needs_owner=True,
    ),
    Question(
        id="user-signal-progress",
        kind="matrix",
        question="Is progress observable (last_activity_ts, running)?",
        scope="user-owned",
        priority="must",
        intake="AC02",
        method="ws-capture",
        needs_owner=False,
    ),
    Question(
        id="user-signal-start",
        kind="matrix",
        question="Is a start signal observable (running false to true)?",
        scope="user-owned",
        priority="must",
        intake="AC02",
        method="ws-capture",
        needs_owner=False,
    ),
    Question(
        id="user-signal-terminal",
        kind="matrix",
        question="Is a terminal signal observable, and does it carry any outcome evidence?",
        scope="user-owned",
        priority="must",
        intake="AC02",
        method="ws-capture",
        needs_owner=False,
    ),
    Question(
        id="user-signal-tool-error",
        kind="matrix",
        question="Is a tool error observable in frames?",
        scope="user-owned",
        priority="best-effort",
        intake="intake tool errors",
        method="owner-step",
        needs_owner=True,
    ),
    Question(
        id="user-slots-no-grant-denied",
        kind="matrix",
        question="With no slots:user grant, are user-origin slots absent from the WS snapshot?",
        scope="user-owned",
        priority="must",
        intake="AC04, deny-by-default",
        method="ws-capture",
        needs_owner=False,
    ),
    Question(
        id="user-slots-visible",
        kind="matrix",
        question="With slots:user, does the app receive user-origin slot rows?",
        scope="user-owned",
        priority="must",
        intake="AC02, AC04",
        method="ws-capture",
        needs_owner=False,
    ),
    Question(
        id="user-source-links",
        kind="matrix",
        question="Are source_links present for a probe session that references a PR/URL?",
        scope="user-owned",
        priority="best-effort",
        intake="intake source links",
        method="ws-capture",
        needs_owner=False,
    ),
)


def question_ids() -> tuple[str, ...]:
    return tuple(question.id for question in QUESTIONS)


def question_by_id(question_id: str) -> Question:
    for question in QUESTIONS:
        if question.id == question_id:
            return question
    raise KeyError(question_id)


def matrix_questions() -> tuple[Question, ...]:
    return tuple(question for question in QUESTIONS if question.kind == "matrix")


def host_fact_questions() -> tuple[Question, ...]:
    return tuple(question for question in QUESTIONS if question.kind == "host-fact")


def canonical_json(document: object) -> str:
    """Two-space indent, UTF-8 text kept as is, trailing newline: the committed JSON layout."""
    return json.dumps(document, indent=2, ensure_ascii=False) + "\n"


def export_json() -> str:
    """Canonical bytes of docs/compatibility/capability-questions.json (V1-13)."""
    entries: list[dict[str, str]] = []
    for question in sorted(QUESTIONS, key=lambda item: item.id):
        entry = {"id": question.id, "kind": question.kind}
        if question.scope is not None:
            entry["scope"] = question.scope
        entry["question"] = question.question
        entry["priority"] = question.priority
        entries.append(entry)
    return canonical_json({"version": QUESTIONS_VERSION, "questions": entries})
