import { createContext as e, forwardRef as t, useCallback as n, useContext as r, useEffect as i, useId as a, useLayoutEffect as o, useMemo as s, useRef as c, useState as l } from "react";
import { Fragment as u, jsx as d, jsxs as f } from "react/jsx-runtime";
import * as p from "@kirocrew/app-sdk";
import { useAppApi as m } from "@kirocrew/app-sdk";
// ui/src/observatory/copy.ts
var h = { waiting: "Waiting on you" }, g = {
	running: "Crew reports a turn running, and the collector saw this bot's chat recently.",
	"not-running": "Crew reports no running turn. This is not a health reading.",
	"never-observed": "The collector has not seen a turn state for this bot yet.",
	"presence-absent": "Crew no longer lists this bot. Its last known facts are not shown as current.",
	"presence-unknown": "The collector has not yet confirmed that Crew lists this bot.",
	"no-coverage": "Nothing is being collected for this bot right now.",
	"heartbeat-stale": "The collector has not reported for more than 30 seconds, so this state may be out of date.",
	restart: "The collector restarted. Time between runs is not covered.",
	disconnect: "The collector lost its connection to Crew and is reconnecting.",
	"auth-stopped": "Crew stopped accepting the collector's access, so collection stopped.",
	"app-disabled": "The app is disabled in Crew, so nothing is collected.",
	"scope-lost-or-silent": "Crew stopped sending chat updates or the app lost that access, so collection stopped.",
	overflow: "The collector fell behind and dropped updates. This period has a gap.",
	"store-unavailable": "The app's own database was unavailable, so updates were not saved.",
	paused: "Collection was paused. Paused time is a gap, not a quiet period.",
	"source-restart": "Crew's update stream restarted. Updates in between were not collected.",
	"roster-unavailable": "The collector could not read Crew's bot list, so names and presence were not updated.",
	"feed-absent": "This bot's chat has not appeared in updates since the current collection period began.",
	"no-slot-yet": "Collection is running, but this bot's chat has not appeared in an update yet.",
	"unsupported-store-less-bot": "This bot has no memory store, so Crew gives the app no turn data for it.",
	"unobserved-turns": "One or more turns happened between two observations and were not seen.",
	"approval-pending": "Crew's row flag says a tool approval is waiting for you. Answer it in Crew. This app cannot approve for you, and this reading has not been checked against a live approval.",
	"question-pending": "Crew's row flag says a question is waiting for your answer. Answer it in Crew. This app cannot answer for you, and this reading has not been checked against a live question.",
	"ended-row-idle": "Ended. Crew's row stopped reporting a running turn.",
	"ended-chat-done": "Ended when Crew's turn-complete event arrived.",
	"ended-other": "Ended. The ending signal is not one this app recognizes.",
	"collector-not-started": "The backend has not started its collector.",
	shutdown: "The app was shut down cleanly.",
	"internal-error": "The collector hit an internal error and stopped."
};
function _(e, t) {
	return e === "running" && t === "worker" ? "Crew reports this worker running, and the collector saw its chat recently." : e === "running" && t === "bot-turn" ? "Crew reports this turn running, and the collector saw its chat recently." : g[e] ?? `Reason code: ${e}`;
}
var v = (e) => e === "bot-turn" ? "Bot turn" : e === "worker" ? "Worker" : e, y = {
	"row-idle": "Row stopped running",
	"chat-done": "Turn-complete event"
}, b = (e) => e === null ? "Still open" : y[e] ?? `Signal: ${e}`, x = {
	starting: "Collector is starting.",
	running: "Collector is running.",
	reconnecting: "Collector is reconnecting to Crew.",
	paused: "Collection paused. Nothing new is being recorded.",
	stopped: "Collector stopped.",
	unavailable: "Collector unavailable."
};
function ee(e, t) {
	let n = x[e] ?? `Collector state: ${e}.`;
	return t === null ? n : `${n} ${_(t)}`;
}
function S(e, t) {
	return e === "cron-turns-not-observable" ? "Scheduled (cron) turns are not observable, so a bot can be busy without showing it here." : e === "unsupported-store-less-bot" && t !== null ? `${t} ${t === 1 ? "bot" : "bots"} on Crew ${t === 1 ? "has" : "have"} no memory store and cannot be monitored.` : `Note: ${e}`;
}
var te = (e) => `Roster truncated: showing the first ${e} bots. Search narrows only what was loaded.`, C = {
	present: "Listed by Crew",
	absent: "No longer listed by Crew",
	unknown: "Not confirmed"
}, w = [
	["needsInput", "Needs input"],
	["hasOptions", "Has options"],
	["pendingApproval", "Pending approval"],
	["waitingForInput", "Waiting for input"]
], T = (e) => e === null ? "Not seen" : e ? "Yes" : "No", E = {
	covered: "Collected",
	gap: "Gap in collection",
	unknown: "Not known"
}, D = [
	{
		term: "Working",
		meaning: "Crew reports a turn running and the collector saw the chat recently."
	},
	{
		term: "No turn running",
		meaning: "Crew reports no running turn. This is not a health reading."
	},
	{
		term: "Unknown",
		meaning: "The collector cannot tell, so the reason says why."
	},
	{
		term: h.waiting,
		meaning: "Crew's approval or question flag is set for this bot, so Crew is waiting on you. The reason says which. Answer it in Crew; this app cannot approve or answer. The app reads the flag and has not checked it against a live approval."
	},
	{
		term: "Blocked",
		meaning: "Not observable yet. Crew does not report this to apps, so the app does not guess it."
	}
], O = {
	offline: {
		title: "Could not reach the app backend",
		body: "Check that the app is enabled in Crew, then retry."
	},
	expired: {
		title: "Session expired",
		body: "Reload the page to sign in to the app again."
	},
	"store-not-ready": {
		title: "Collector store is not ready yet",
		body: "The app is still starting. Retry in a moment."
	},
	"store-unavailable": {
		title: "The app's database is unavailable",
		body: "Collection is not saving data. Retry, or restart the app."
	},
	unknown: {
		title: "Unexpected reply from the app backend",
		body: "Retry. If it persists, reload."
	}
}, k = [
	{
		term: "Window",
		meaning: "A rolling span ending when the backend answered: 24 hours or 7 days. From and to are shown in the source details."
	},
	{
		term: "Sample size",
		meaning: "Attempts that first appeared in the window. Every count below is out of this number."
	},
	{
		term: "Bot turns and workers started",
		meaning: "Attempts split by kind. They add up to the sample size."
	},
	{
		term: "Working, Ended, Unknown",
		meaning: "The same attempts split by their condition now. They add up to the sample size. Ended says only that the attempt closed. It says nothing about the outcome."
	},
	{
		term: "Collector covered",
		meaning: "Time in the window when the collector was recording, from the time this bot was first seen. It measures coverage only."
	},
	{
		term: "Duplicates",
		meaning: "A reconnect replay does not create a second attempt for the same turn or worker."
	}
], A = {
	heading: "Context in use",
	note: "How much of the model's context window this bot's latest turn is using, as Crew reported it. It is a gauge for one turn. It is not tokens spent, not a total, not XP and not a score, and it is never compared between bots.",
	inUse: "In use",
	window: "Window size",
	read: "Read",
	notCollected: "Not collected",
	notCollectedWhy: "Crew has not reported a context reading for this bot in the current collection period."
}, j = (e) => new Intl.NumberFormat().format(e), M = (e, t) => `${j(e)} of ${j(t)} tokens`, N = {
	working: {
		tone: "working",
		label: "Working"
	},
	settled: {
		tone: "settled",
		label: "No turn running"
	},
	unknown: {
		tone: "unknown",
		label: "Unknown"
	},
	waiting: {
		tone: "waiting",
		label: h.waiting
	}
}, ne = {
	working: {
		tone: "working",
		label: "Working"
	},
	ended: {
		tone: "ended",
		label: "Ended"
	},
	unknown: {
		tone: "unknown",
		label: "Unknown"
	}
}, re = (e) => ({
	tone: "unknown",
	label: "Unknown",
	reason: `Reason code: ${e}`
});
function P(e) {
	let t = N[e.state];
	return t ? {
		...t,
		reason: _(e.reasonCode)
	} : re(e.state);
}
function F(e) {
	let t = ne[e.condition.state];
	return t ? {
		...t,
		reason: _(e.condition.reasonCode, e.kind)
	} : re(e.condition.state);
}
var I = (e) => `${e} worker${e === 1 ? "" : "s"}`;
function ie(e) {
	let t = [];
	return e.running > 0 && t.push({
		key: "working",
		count: e.running,
		text: `${I(e.running)} working`
	}), e.unknown > 0 && t.push({
		key: "unknown",
		count: e.unknown,
		text: `${I(e.unknown)} unknown`
	}), t;
}
var ae = (e) => "tokenReading" in e ? e.tokenReading ?? null : null, oe = "Unnamed bot", L = (e) => e.displayName !== null && e.displayName.trim() !== "" ? e.displayName : oe;
function se(e) {
	if (e.displayName === null) return "?";
	let t = e.displayName.trim().split(/\s+/).filter((e) => e !== "").slice(0, 2).map((e) => Array.from(e)[0]).join("").toLocaleUpperCase();
	return t === "" ? "?" : t;
}
function ce(e) {
	let t = new Intl.Collator(void 0, { sensitivity: "base" });
	return [...e].sort((e, n) => t.compare(L(e), L(n)) || (e.bindingId < n.bindingId ? -1 : +(e.bindingId > n.bindingId)));
}
function le(e, t) {
	let n = t.trim().toLocaleLowerCase();
	return n === "" || L(e).toLocaleLowerCase().includes(n);
}
function ue(e, t = {}) {
	return new Intl.DateTimeFormat(t.locale, {
		dateStyle: "medium",
		timeStyle: t.long === !0 ? "long" : "short",
		timeZone: t.timeZone
	}).format(new Date(e));
}
function de(e) {
	let t = Math.floor(Math.max(0, e) / 6e4);
	if (t === 0) return e > 0 ? "under 1 m" : "0 m";
	let n = Math.floor(t / 1440), r = Math.floor(t % 1440 / 60), i = t % 60;
	return [
		n > 0 ? `${n} d` : "",
		r > 0 ? `${r} h` : "",
		i > 0 ? `${i} m` : ""
	].filter((e) => e !== "").join(" ");
}
function fe(e, t) {
	if (e.coveredMs <= 0) return "Not collected";
	let n = e.observedFromMs === e.fromMs ? `of ${t}` : `of the ${de(e.toMs - e.observedFromMs)} since this bot was first seen`, r = e.gapCount === 0 ? "" : ` (${e.gapCount} ${e.gapCount === 1 ? "gap" : "gaps"})`;
	return `Collector covered ${de(e.coveredMs)} ${n}${r}`;
}
function pe(e, t) {
	let n = /* @__PURE__ */ new Set(), r = [];
	for (let i of [...e, ...t]) n.has(i.attemptId) || (n.add(i.attemptId), r.push(i));
	return r.sort((e, t) => t.startedMs - e.startedMs || (e.attemptId < t.attemptId ? 1 : e.attemptId > t.attemptId ? -1 : 0));
}
var R = (e, t) => ({
	label: e,
	text: t === null ? "None" : String(t)
}), z = (e, t) => ({
	label: e,
	ms: t
});
function me(e, t, n, r) {
	let i = [
		R("Presence", e.presence),
		R("Condition state", e.condition.state),
		R("Condition reason code", e.condition.reasonCode),
		R("Basis", e.condition.basis),
		z("Source time", e.condition.sourceTimeMs),
		z("Observed time", e.condition.observedAtMs),
		z("Last observed", e.lastObservedAtMs),
		R("Coverage state", e.coverage.state),
		z("Coverage since", e.coverage.sinceMs),
		R("Coverage reason code", e.coverage.reasonCode),
		R("Open gaps", e.coverage.openGapCount),
		R("Workers running", e.workers.running),
		R("Workers unknown", e.workers.unknown),
		R("Workers seen", e.workers.seen),
		R("Collector state", t.state),
		R("Collector reason code", t.reasonCode),
		z("Collector since", t.sinceMs),
		R("Roster revision", n)
	];
	if (r === null) return i;
	for (let [e, t] of [["24 h", r.activity.last24h], ["7 d", r.activity.last7d]]) i.push(z(`${e} window from`, t.fromMs), z(`${e} window to`, t.toMs), z(`${e} observed from`, t.observedFromMs), R(`${e} window length (ms)`, t.windowMs), R(`${e} covered (ms)`, t.coveredMs), R(`${e} gaps`, t.gapCount));
	return i;
}
var he = (e) => e.condition.state !== "ended", ge = e({});
function B({ ms: e, long: t = !1 }) {
	let n = r(ge);
	return e === null ? /* @__PURE__ */ d("span", { children: "Not recorded" }) : /* @__PURE__ */ d("time", {
		dateTime: new Date(e).toISOString(),
		title: ue(e, {
			...n,
			long: !0
		}),
		children: ue(e, {
			...n,
			long: t
		})
	});
}
// ui/src/observatory/ActivityPanel.tsx
var _e = [[
	"24 hours",
	"24 h",
	"last24h"
], [
	"7 days",
	"7 d",
	"last7d"
]];
function ve({ title: e, label: t, window: n }) {
	let r = n.coveredMs <= 0 && n.sampleSize === 0;
	return /* @__PURE__ */ f("section", {
		className: "sa-card",
		"aria-label": `Last ${e}`,
		children: [
			/* @__PURE__ */ d("h3", { children: `Last ${e}` }),
			/* @__PURE__ */ f("p", { children: [
				"From ",
				/* @__PURE__ */ d(B, { ms: n.fromMs }),
				" to ",
				/* @__PURE__ */ d(B, { ms: n.toMs })
			] }),
			/* @__PURE__ */ d("p", { children: fe(n, t) }),
			r ? /* @__PURE__ */ d("p", { children: "No collected time in this window, so there are no counts." }) : /* @__PURE__ */ f("dl", {
				className: "sa-counts",
				children: [
					/* @__PURE__ */ d("dt", { children: "Sample size" }),
					/* @__PURE__ */ d("dd", { children: n.sampleSize }),
					/* @__PURE__ */ d("dt", { children: "Bot turns started" }),
					/* @__PURE__ */ d("dd", { children: n.botTurnsStarted }),
					/* @__PURE__ */ d("dt", { children: "Workers started" }),
					/* @__PURE__ */ d("dd", { children: n.workersStarted }),
					/* @__PURE__ */ d("dt", { children: "Working" }),
					/* @__PURE__ */ d("dd", { children: n.stillOpen }),
					/* @__PURE__ */ d("dt", { children: "Ended" }),
					/* @__PURE__ */ d("dd", { children: n.ended }),
					/* @__PURE__ */ d("dt", { children: "Unknown" }),
					/* @__PURE__ */ d("dd", { children: n.unknown })
				]
			})
		]
	});
}
function ye({ activity: e }) {
	return /* @__PURE__ */ f("div", {
		className: "sa-activity",
		children: [/* @__PURE__ */ d("div", {
			className: "sa-cards",
			children: _e.map(([t, n, r]) => /* @__PURE__ */ d(ve, {
				title: t,
				label: n,
				window: e[r]
			}, r))
		}), /* @__PURE__ */ f("details", {
			className: "sa-glossary",
			children: [/* @__PURE__ */ d("summary", { children: "How these counts work" }), /* @__PURE__ */ d("dl", { children: k.map((e) => /* @__PURE__ */ f("div", { children: [/* @__PURE__ */ d("dt", { children: e.term }), /* @__PURE__ */ d("dd", { children: e.meaning })] }, e.term)) })]
		})]
	});
}
// ui/src/observatory/ConditionBadge.tsx
function be({ view: e }) {
	return /* @__PURE__ */ f("span", {
		className: `sa-status sa-status--${e.tone}`,
		children: [/* @__PURE__ */ d("span", {
			className: "sa-status__dot",
			"aria-hidden": "true"
		}), e.label]
	});
}
// ui/src/observatory/ui.tsx
var V = {
	search: /* @__PURE__ */ f(u, { children: [/* @__PURE__ */ d("circle", {
		cx: "11",
		cy: "11",
		r: "6"
	}), /* @__PURE__ */ d("path", { d: "m16 16 4 4" })] }),
	warning: /* @__PURE__ */ f(u, { children: [/* @__PURE__ */ d("path", { d: "M12 3 2.5 20h19L12 3Z" }), /* @__PURE__ */ d("path", { d: "M12 9v4M12 17h.01" })] }),
	spark: /* @__PURE__ */ d("path", { d: "m12 3 1.4 4.6L18 9l-4.6 1.4L12 15l-1.4-4.6L6 9l4.6-1.4L12 3Z" })
};
function xe({ name: e, size: t = 18 }) {
	return /* @__PURE__ */ d("svg", {
		width: t,
		height: t,
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: "2",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		"aria-hidden": "true",
		children: V[e]
	});
}
var H = t(function({ children: e, variant: t = "secondary", type: n = "button", ...r }, i) {
	return /* @__PURE__ */ d("button", {
		ref: i,
		type: n,
		className: `sa-button sa-button--${t}`,
		...r,
		children: e
	});
});
function Se({ children: e, label: t }) {
	return /* @__PURE__ */ d("section", {
		className: "sa-panel",
		"aria-label": t,
		children: e
	});
}
function Ce({ title: e, body: t, action: n }) {
	return /* @__PURE__ */ f("div", {
		className: "sa-state",
		children: [
			/* @__PURE__ */ d("span", {
				className: "sa-state__icon",
				children: /* @__PURE__ */ d(xe, {
					name: "spark",
					size: 24
				})
			}),
			/* @__PURE__ */ d("h3", { children: e }),
			/* @__PURE__ */ d("p", { children: t }),
			n
		]
	});
}
function we({ title: e, body: t, onRetry: n }) {
	return /* @__PURE__ */ f("div", {
		className: "sa-state sa-state--error",
		role: "alert",
		children: [
			/* @__PURE__ */ d("span", {
				className: "sa-state__icon",
				children: /* @__PURE__ */ d(xe, {
					name: "warning",
					size: 24
				})
			}),
			/* @__PURE__ */ d("h3", { children: e }),
			/* @__PURE__ */ d("p", { children: t }),
			n && /* @__PURE__ */ d(H, {
				onClick: n,
				children: "Retry"
			})
		]
	});
}
// ui/src/observatory/AttemptsList.tsx
function Te({ items: e, hasOlder: t, loadingOlder: n, olderFailed: r, onLoadOlder: i }) {
	return /* @__PURE__ */ f("div", {
		className: "sa-attempts",
		children: [
			e.length === 0 ? /* @__PURE__ */ d("p", { children: "No tracked attempts for this bot yet. That is not a count of zero work: older history and scheduled turns may not be collected." }) : /* @__PURE__ */ d("ol", {
				"aria-label": "Attempts, newest first",
				children: e.map((e) => {
					let t = F(e);
					return /* @__PURE__ */ f("li", {
						className: "sa-attempt",
						children: [
							/* @__PURE__ */ f("div", {
								className: "sa-chips",
								children: [/* @__PURE__ */ d("strong", { children: v(e.kind) }), /* @__PURE__ */ d(be, { view: t })]
							}),
							/* @__PURE__ */ d("p", { children: t.reason }),
							/* @__PURE__ */ f("p", { children: [
								"First seen ",
								/* @__PURE__ */ d(B, { ms: e.startedMs }),
								".",
								" ",
								e.endedMs === null ? "Still open." : /* @__PURE__ */ f(u, { children: [
									"Ended ",
									/* @__PURE__ */ d(B, { ms: e.endedMs }),
									"."
								] }),
								" ",
								"Signal: ",
								b(e.endSignal)
							] })
						]
					}, e.attemptId);
				})
			}),
			r && /* @__PURE__ */ d("p", {
				role: "alert",
				children: "Could not load older attempts. Retry."
			}),
			t && /* @__PURE__ */ d(H, {
				onClick: i,
				disabled: n,
				children: "Load older"
			})
		]
	});
}
function Ee({ state: e, onRetry: t }) {
	if (e.status === "gone") return /* @__PURE__ */ d("p", {
		role: "status",
		children: "This bot is no longer on the roster."
	});
	if (e.status === "failed") {
		let n = O[e.failure];
		return /* @__PURE__ */ d(we, {
			title: n.title,
			body: n.body,
			onRetry: t
		});
	}
	return /* @__PURE__ */ d("p", {
		role: "status",
		children: "Loading attempts…"
	});
}
// ui/src/work/copy.ts
var De = "Level follows XP credited automatically for tasks, plus earlier accepted work. It reflects observed activity, not ability, outcome quality or current condition.", U = {
	tasksCredited: "Tasks credited",
	xp: "XP",
	level: "Level",
	unit: "XP",
	loading: "Not loaded yet",
	unsupported: "Not supported by this backend",
	failed: "Could not load. It retries automatically.",
	topLevel: "Top level reached",
	levelWord: (e) => `Level ${e}`,
	toward: (e, t, n) => `${e} of ${t} XP toward level ${n}`,
	entryPolicy: (e) => `Policy ${e}`,
	policy: (e, t) => `Policy ${e} · Level table ${t}`
}, Oe = {
	label: "Progression",
	entries: "XP entries, newest first",
	empty: "No ledger entries to list yet.",
	basis: "XP is credited automatically when a task ends cleanly. It reflects observed activity, not verified outcomes.",
	loading: "Loading progression…",
	gone: "This bot is no longer on the roster.",
	loadOlder: "Load older entries",
	loadingOlder: "Loading older entries…",
	olderFailed: "Could not load older entries. Try again.",
	retry: "Retry",
	failedTitle: "Could not load progression",
	unsupportedTitle: "Progression is not supported here",
	unsupportedBody: "This version of the app backend does not support XP yet."
}, ke = {
	award: "Award",
	correction: "Correction (reopened)",
	reinstatement: "Reinstated"
}, Ae = (e) => ke[e] ?? `Unknown entry (${e})`, je = (e) => e.length <= 12 ? e : `${e.slice(0, 8)}…${e.slice(-4)}`, Me = class extends Error {}, Ne = (e) => typeof e == "object" && !!e, Pe = (e) => typeof e == "string", Fe = (e) => Ne(e) && Pe(e.bindingId) && typeof e.totalXp == "number" && typeof e.level == "number" && Pe(e.levelTableVersion), Ie = (e) => Fe(e) && e.contractVersion === 2 && typeof e.creditedTaskCount == "number" && Number.isInteger(e.creditedTaskCount) && e.creditedTaskCount >= 0;
function Le(e) {
	let t = e;
	if (typeof t != "object" || !t || t.contractVersion !== 3 || !Array.isArray(t.items) || t.items.length > 200 || !t.items.every(Ie) || t.nextCursor != null && !Pe(t.nextCursor)) throw new Me("unexpected xp body");
	return {
		contractVersion: 3,
		items: t.items,
		nextCursor: t.nextCursor ?? null,
		asOfMs: t.asOfMs ?? 0
	};
}
function Re(e) {
	let t = e;
	if (t === null || !Fe(t.summary) || !Array.isArray(t.items) || t.items.length > 50 || !t.items.every((e) => Ne(e) && Pe(e.entryId) && typeof e.amount == "number")) throw new Me("unexpected xp history body");
	return {
		contractVersion: 1,
		bindingId: t.bindingId ?? "",
		summary: t.summary,
		items: t.items,
		nextCursor: t.nextCursor ?? null,
		asOfMs: t.asOfMs ?? 0
	};
}
function ze(e, t) {
	let n = e.find((e) => e.bindingId === t);
	return n === void 0 ? `Unknown bot (${je(t)})` : L(n);
}
function Be(e) {
	let t = Math.max(0, e.totalXp - e.levelFloorXp), n = e.nextLevelXp === null ? null : e.nextLevelXp - e.levelFloorXp;
	return {
		into: t,
		span: n !== null && n > 0 ? n : null
	};
}
var Ve = (e) => `${e > 0 ? "+" : e < 0 ? "-" : ""}${Math.abs(e)} XP`;
// ui/src/specters/xpBar.ts
function He(e) {
	let { into: t, span: n } = Be(e);
	return n === null ? {
		label: U.topLevel,
		percent: 100,
		valueMax: 1,
		valueNow: 1,
		top: !0
	} : {
		label: U.toward(t, n, e.level + 1),
		percent: Math.min(100, Math.round(t / n * 100)),
		valueMax: n,
		valueNow: Math.min(t, n),
		top: !1
	};
}
// ui/src/work/XpMeter.tsx
function Ue({ summary: e }) {
	let t = He(e);
	return t.top ? /* @__PURE__ */ d("p", {
		className: "sa-work-xp-note",
		children: t.label
	}) : /* @__PURE__ */ f("div", {
		className: "sa-xp-meter",
		children: [/* @__PURE__ */ d("div", {
			className: "sa-xp-bar",
			role: "progressbar",
			"aria-label": t.label,
			"aria-valuemin": 0,
			"aria-valuemax": t.valueMax,
			"aria-valuenow": t.valueNow,
			children: /* @__PURE__ */ d("span", { style: { width: `${t.percent}%` } })
		}), /* @__PURE__ */ d("p", {
			className: "sa-work-xp-note",
			children: t.label
		})]
	});
}
// ui/src/work/XpCards.tsx
var We = [
	U.tasksCredited,
	U.xp,
	U.level
];
function Ge({ title: e, children: t }) {
	return /* @__PURE__ */ f("div", {
		className: "sa-card",
		children: [/* @__PURE__ */ d("h3", { children: e }), t]
	});
}
function Ke({ xp: e }) {
	if (e.status !== "ready") {
		let t = e.status === "loading" ? U.loading : e.failure === "unsupported" ? U.unsupported : U.failed;
		return /* @__PURE__ */ d("div", {
			className: "sa-cards",
			children: We.map((e) => /* @__PURE__ */ d(Ge, {
				title: e,
				children: /* @__PURE__ */ d("p", { children: t })
			}, e))
		});
	}
	let t = e.summary;
	return /* @__PURE__ */ f("div", {
		className: "sa-cards",
		children: [
			/* @__PURE__ */ d(Ge, {
				title: U.tasksCredited,
				children: /* @__PURE__ */ d("p", {
					className: "sa-work-xp-amount",
					children: t === null ? 0 : t.creditedTaskCount
				})
			}),
			/* @__PURE__ */ d(Ge, {
				title: U.xp,
				children: /* @__PURE__ */ f("p", { children: [
					/* @__PURE__ */ d("span", {
						className: "sa-work-xp-amount",
						children: t === null ? 0 : t.totalXp
					}),
					" ",
					U.unit
				] })
			}),
			/* @__PURE__ */ f(Ge, {
				title: U.level,
				children: [
					/* @__PURE__ */ d("p", {
						className: "sa-work-xp-amount",
						children: U.levelWord(t === null ? 1 : t.level)
					}),
					t !== null && /* @__PURE__ */ d(Ue, { summary: t }),
					/* @__PURE__ */ d("p", {
						className: "sa-help",
						children: De
					})
				]
			})
		]
	});
}
// ui/src/observatory/BotSummary.tsx
function qe({ item: e, xp: t }) {
	let n = a(), r = P(e.condition), { coverage: i } = e;
	return /* @__PURE__ */ f("section", {
		className: "sa-detail",
		"aria-labelledby": n,
		children: [
			/* @__PURE__ */ d("h2", {
				id: n,
				tabIndex: -1,
				children: L(e)
			}),
			/* @__PURE__ */ f("div", {
				className: "sa-chips",
				children: [/* @__PURE__ */ d(be, { view: r }), ie(e.workers).map((e) => /* @__PURE__ */ d("span", {
					className: `sa-chip sa-chip--${e.key}`,
					children: e.text
				}, e.key))]
			}),
			/* @__PURE__ */ d("p", { children: r.reason }),
			/* @__PURE__ */ f("div", {
				className: "sa-facts",
				children: [
					/* @__PURE__ */ d("p", { children: C[e.presence] ?? e.presence }),
					/* @__PURE__ */ f("p", { children: [E[i.state] ?? i.state, i.reasonCode !== null && `. ${_(i.reasonCode)}`] }),
					i.sinceMs !== null && /* @__PURE__ */ f("p", { children: ["Collecting since ", /* @__PURE__ */ d(B, { ms: i.sinceMs })] }),
					i.openGapCount > 0 && /* @__PURE__ */ d("p", { children: `${i.openGapCount} open ${i.openGapCount === 1 ? "gap" : "gaps"}` }),
					/* @__PURE__ */ f("p", { children: ["Last observed ", /* @__PURE__ */ d(B, { ms: e.lastObservedAtMs })] })
				]
			}),
			/* @__PURE__ */ d(Ke, { xp: t })
		]
	});
}
// ui/src/observatory/SourcePanel.tsx
function Je({ item: e, collector: t, rosterRevision: n, attempts: r }) {
	return /* @__PURE__ */ f("div", {
		className: "sa-source",
		children: [/* @__PURE__ */ d("dl", {
			className: "sa-counts",
			children: me(e, t, n, r).map((e) => /* @__PURE__ */ f("div", { children: [/* @__PURE__ */ d("dt", { children: e.label }), /* @__PURE__ */ d("dd", { children: "text" in e ? e.text : /* @__PURE__ */ d(B, {
				ms: e.ms,
				long: !0
			}) })] }, e.label))
		}), /* @__PURE__ */ f("section", {
			"aria-labelledby": "sa-raw-signals",
			children: [/* @__PURE__ */ d("h3", {
				id: "sa-raw-signals",
				children: "Raw signals from Crew (unverified, not used for the condition)"
			}), /* @__PURE__ */ d("dl", {
				className: "sa-counts",
				children: w.map(([t, n]) => /* @__PURE__ */ f("div", { children: [/* @__PURE__ */ d("dt", { children: n }), /* @__PURE__ */ d("dd", { children: T(e.condition.signals[t]) })] }, t))
			})]
		})]
	});
}
// ui/src/host/paths.ts
var Ye = "/apps/specter-arena/api";
function W(e) {
	return `${Ye}${e}`;
}
W("/ping");
var Xe = W("/roster");
function Ze(e, t) {
	let n = Object.entries(t).filter((e) => e[1] !== null && e[1] !== void 0).map(([e, t]) => `${e}=${encodeURIComponent(String(t))}`).join("&");
	return n === "" ? e : `${e}?${n}`;
}
var Qe = (e, t) => Ze(Xe, {
	limit: e,
	cursor: t
}), $e = (e, t) => Ze(Xe, {
	view: "signals",
	limit: e,
	cursor: t
}), et = (e, t = 50, n = null) => Ze(W(`/roster/${encodeURIComponent(e)}/attempts`), {
	limit: t,
	cursor: n
}), tt = encodeURIComponent, nt = Ze(W("/specters"), { view: "assignment" }), rt = W("/heroes"), it = W("/portraits"), at = W("/assets"), ot = (e) => W(`/specters/${tt(e)}/hero`), st = (e) => W(`/specters/${tt(e)}/portrait`), ct = (e) => W(`/assets/${tt(e)}`), lt = (e) => W(`/scene-assets/${tt(e)}`), ut = W("/xp"), dt = "tasks", ft = (e, t) => Ze(ut, {
	view: dt,
	limit: e,
	cursor: t
}), pt = W("/tasks"), mt = ({ state: e = null, bindingId: t = null, limit: n, cursor: r }) => Ze(pt, {
	state: e,
	bindingId: t,
	limit: n,
	cursor: r
}), ht = (e) => W(`/tasks/${tt(e)}`), gt = (e, t = 50, n = null) => Ze(W(`/roster/${tt(e)}/xp`), {
	limit: t,
	cursor: n
}), _t = W("/data"), vt = W("/data/retention"), yt = W("/data/purge"), bt = W("/data/export"), xt = W("/data/asset-cleanup"), St = W("/collector"), G = class extends Error {
	status;
	error;
	constructor(e, t) {
		super(`Request failed with status ${e}`), this.name = "HostApiError", this.status = e, this.error = t;
	}
}, Ct = /^[a-z][a-z0-9_]{0,63}$/;
function wt(e) {
	let t = typeof e == "object" && e ? e.error : void 0;
	return typeof t == "string" && Ct.test(t) ? t : null;
}
async function Tt(e) {
	try {
		return wt(await e.json());
	} catch {
		return null;
	}
}
function Et(e) {
	if (e instanceof G) return e;
	if (typeof e != "object" || !e) return null;
	let { status: t, body: n } = e;
	if (typeof t != "number" || !Number.isInteger(t) || t < 100 || t > 599) return null;
	let r = null;
	if (typeof n == "string") try {
		r = JSON.parse(n);
	} catch {
		r = null;
	}
	return new G(t, wt(r));
}
function Dt(e) {
	return typeof e == "object" && !!e && "ok" in e && typeof e.json == "function";
}
async function Ot(e) {
	let t;
	try {
		t = await e;
	} catch (e) {
		throw Et(e) ?? e;
	}
	if (!Dt(t)) return t;
	if (!t.ok) throw new G(t.status, await Tt(t));
	if (t.status !== 204) return await t.json();
}
function kt() {
	let e = m();
	return s(() => ({
		mode: e.sourceMode === "FIXTURE" ? "FIXTURE" : "LIVE",
		getJson: (t) => Ot(e.get(t)),
		postJson: (t, n) => Ot(e.post(t, n))
	}), [e]);
}
// ui/src/host/useHostNavigate.ts
var At = ["/members"], jt = "useNavigate" in p && typeof p.useNavigate == "function" ? p.useNavigate : null, Mt = () => null;
function Nt() {
	let e = (jt ?? Mt)();
	return n((t) => {
		At.includes(t) && (e === null ? window.location.assign(t) : e(t));
	}, [e]);
}
// ui/src/host/useSourceMode.ts
function Pt() {
	return kt().mode;
}
var Ft = 15e5, It = /^[A-Za-z0-9+/]+={0,2}$/, Lt = /* @__PURE__ */ new Map(), Rt = 0, zt = [];
function Bt() {
	return Rt < 4 ? (Rt += 1, Promise.resolve()) : new Promise((e) => {
		zt.push(() => {
			Rt += 1, e();
		});
	});
}
function Vt() {
	--Rt, zt.shift()?.();
}
async function Ht(e, t) {
	await Bt();
	try {
		let n = await e.getJson(ct(t)), r = n?.dataBase64;
		if (n?.mediaType !== "image/png" || typeof r != "string" || r.length > Ft || !It.test(r)) throw Error("unusable asset");
		return `data:image/png;base64,${r}`;
	} finally {
		Vt();
	}
}
function Ut(e, t) {
	let n = Lt.get(t);
	if (n !== void 0) return n;
	let r = Ht(e, t);
	if (Lt.set(t, r), r.catch(() => {
		Lt.get(t) === r && Lt.delete(t);
	}), Lt.size > 64) {
		let e = Lt.keys().next().value;
		e !== void 0 && Lt.delete(e);
	}
	return r;
}
// ui/src/specters/useAsset.ts
function Wt(e) {
	let t = kt(), [n, r] = l(null);
	return i(() => {
		if (e === null) return;
		let n = !0;
		return Ut(t, e).then((t) => {
			n && r({
				assetId: e,
				status: "ready",
				src: t
			});
		}, () => {
			n && r({
				assetId: e,
				status: "failed",
				src: null
			});
		}), () => {
			n = !1;
		};
	}, [t, e]), e === null ? {
		status: "none",
		src: null
	} : n === null || n.assetId !== e ? {
		status: "loading",
		src: null
	} : {
		status: n.status,
		src: n.src
	};
}
// ui/src/specters/AssetImage.tsx
function Gt({ assetId: e, size: t }) {
	let n = Wt(e);
	return n.status !== "ready" || n.src === null ? /* @__PURE__ */ d("span", {
		className: "sa-portrait sa-portrait--sm sa-portrait--loading",
		"aria-hidden": "true",
		"data-asset": n.status
	}) : /* @__PURE__ */ d("img", {
		className: "sa-portrait__img",
		src: n.src,
		alt: "",
		width: t,
		height: t
	});
}
var Kt = /^[A-Za-z0-9+/]+={0,2}$/, qt = /* @__PURE__ */ new Map(), Jt = 0, Yt = [];
function Xt() {
	return Jt < 4 ? (Jt += 1, Promise.resolve()) : new Promise((e) => {
		Yt.push(() => {
			Jt += 1, e();
		});
	});
}
function Zt() {
	--Jt, Yt.shift()?.();
}
function Qt(e) {
	try {
		let t = atob(e), n = new Uint8Array(t.length);
		for (let e = 0; e < t.length; e += 1) n[e] = t.charCodeAt(e);
		return URL.createObjectURL(new Blob([n], { type: "image/png" }));
	} catch {
		return `data:image/png;base64,${e}`;
	}
}
var $t = (e) => typeof e == "number" && Number.isInteger(e) && e > 0;
async function en(e, t) {
	await Xt();
	try {
		let n = await e.getJson(lt(t)), r = n?.dataBase64;
		if (n?.key !== t || n.mediaType !== "image/png" || typeof r != "string" || r.length > 57e5 || !Kt.test(r) || !$t(n.width) || !$t(n.height)) throw Error("unusable scene asset");
		return {
			url: Qt(r),
			width: n.width,
			height: n.height
		};
	} finally {
		Zt();
	}
}
function tn(e, t) {
	let n = qt.get(t);
	if (n !== void 0) return n;
	let r = en(e, t);
	if (qt.set(t, r), r.catch(() => {
		qt.get(t) === r && qt.delete(t);
	}), qt.size > 32) {
		let e = qt.keys().next().value;
		e !== void 0 && qt.delete(e);
	}
	return r;
}
// ui/src/arena/useSceneAsset.ts
function nn(e) {
	let t = kt(), [n, r] = l(null);
	return i(() => {
		let n = !0;
		return tn(t, e).then((t) => {
			n && r({
				key: e,
				view: {
					status: "ready",
					art: t
				}
			});
		}, () => {
			n && r({
				key: e,
				view: {
					status: "failed",
					art: null
				}
			});
		}), () => {
			n = !1;
		};
	}, [t, e]), n !== null && n.key === e ? n.view : {
		status: "loading",
		art: null
	};
}
// ui/src/specters/heroes.ts
var rn = (e) => `hero-${e}-sprite`, an = (e) => `hero-${e}-thumbnail`, on = {
	vell: [.60742188, .90039062],
	stitch: [.51905382, .90039062],
	reeve: [.43519788, .90039062],
	rattle: [.56401708, .90039062],
	ember: [.56244721, .90039062],
	shard: [.59646028, .90039062],
	poly: [.5, .90039062],
	tide: [.55196907, .90039062],
	lume: [.49503801, .90039062],
	moss: [.56576046, .90039062],
	bur: [.5, .90039062]
}, sn = [.5, .9], cn = {
	reeve: 1800,
	vell: 2e3,
	stitch: 1750,
	poly: 2200,
	rattle: 1850,
	ember: 1450,
	shard: 2400,
	tide: 1900,
	lume: 2100,
	moss: 2e3,
	bur: 1800
}, ln = 1900, un = on, dn = cn, fn = (e) => un[e] ?? sn, pn = (e) => dn[e] ?? ln, mn = (e) => e.map((e, t) => ({
	hero: e,
	index: t
})).sort((e, t) => e.hero.assignedCount - t.hero.assignedCount || e.index - t.index).map(({ hero: e }) => e);
// ui/src/specters/model.ts
function hn(e) {
	let t = 2166136261;
	for (let n = 0; n < e.length; n += 1) t = Math.imul(t ^ e.charCodeAt(n), 16777619) >>> 0;
	return t % 360;
}
function gn(e) {
	let t = e.trim().split(/\s+/).filter((e) => e !== "").slice(0, 2).map((e) => Array.from(e)[0] ?? "").join("").toUpperCase();
	return t === "" ? "?" : t;
}
// ui/src/specters/HeroThumb.tsx
function _n({ heroId: e, name: t, size: n, decorative: r = !0 }) {
	let i = nn(an(e));
	return i.status === "ready" ? /* @__PURE__ */ d("img", {
		className: "sa-portrait__img",
		src: i.art.url,
		width: n,
		height: n,
		alt: r ? "" : t
	}) : /* @__PURE__ */ d("span", {
		className: "sa-portrait__token",
		style: { "--sa-hue": hn(e) },
		"aria-hidden": "true",
		"data-initials": gn(t)
	});
}
// ui/src/specters/copy.ts
var vn = "No Specter yet", yn = "Placeholder token, not a portrait", bn = "Portrait could not be loaded. Showing a placeholder token.", xn = "A Specter is a name and a picture. It never changes this bot's setup, permissions, or work.", Sn = "This hero was assigned to the bot. Its name and personality are fixed. You can change the avatar.", Cn = "This bot has not been given a hero yet. It appears at the next refresh.", wn = {
	avatar: "Change avatar",
	checkAgain: "Check again",
	assign: "Assign a Specter"
}, Tn = {
	version_conflict: "This avatar changed somewhere else. It was reloaded; review it and try again.",
	unknown_binding: "This bot is no longer on the roster.",
	unknown_asset: "That portrait could not be found.",
	invalid_body: "The app could not use what was sent. Check the choice and try again.",
	body_too_large: "That request was too large.",
	upload_limit_reached: "You already have 100 uploaded images. Remove unused uploads on the Data tab, then try again.",
	asset_too_large: "That image is larger than 1 MB.",
	unsupported_media: "Only PNG images can be used.",
	invalid_image: "That file is not a valid PNG image the app can use.",
	store_not_ready: "The app database is still starting. Try again in a moment.",
	store_unavailable: "The app's database is unavailable. Nothing was changed.",
	offline: "Could not reach the app backend. Nothing was changed.",
	no_hero: "This bot has no Specter yet.",
	invalid_response: "The app backend sent an answer this version cannot read. Nothing was changed."
}, En = (e) => Tn[e] ?? `Something went wrong (${e}).`, Dn = "This version of the app backend does not support Specters yet.", On = "Loading Specters…", kn = "Only PNG images can be used.", An = "That image is larger than 1 MB.", jn = {
	progression: "Progression",
	personality: "Personality",
	appearance: "Appearance"
}, Mn = {
	heading: "Choose an avatar",
	heroDefault: "Use the hero portrait",
	gallery: "Portraits",
	apply: "Apply",
	cancel: "Cancel",
	upload: "Upload a PNG (up to 1 MB)",
	loading: "Loading portraits…",
	failed: "Portraits could not be loaded."
}, K = {
	dialogLabel: "Assign Specters",
	title: (e) => `Choose a Specter for ${e}`,
	note: "A bot keeps its Specter once assigned.",
	step: (e, t) => `Step ${e} of ${t}`,
	heroesLabel: "Heroes",
	held: (e) => e === 0 ? "not held yet" : `held by ${e}`,
	assign: (e) => `Assign ${e}`,
	assigning: "Assigning…",
	skip: "Skip for now",
	randomize: "Randomize all unassigned",
	progress: (e, t) => `Assigning ${e} of ${t}…`,
	close: "Close",
	done: "Done",
	summaryTitle: "Specters assigned",
	summary: (e, t, n) => `${e} assigned, ${t} skipped${n > 0 ? `, ${n} could not be assigned` : ""}`,
	skippedHint: "Skipped bots can be assigned later from the Specters tab or the Roster.",
	heroesLoading: "Loading heroes…",
	heroesFailed: "The heroes could not be loaded. You can still randomize.",
	botGone: "This bot is no longer on the roster.",
	detailHelp: "Pick one of the 11 heroes, or let the app pick. A bot keeps its Specter once assigned."
}, q = {
	label: "Specter showcase",
	heading: "Specters",
	intro: "The 11 heroes. Their names and personalities are fixed.",
	assignButton: (e) => `Assign Specters (${e})`,
	stageLabel: (e) => `${e} and a practice target, large preview`,
	practiceTarget: "Practice target, for show",
	attack: "Attack",
	cast: "Cast",
	motionOff: "Attack and Cast are off because reduced motion is requested.",
	previewNote: "These are previews. They do not show any bot’s work. The practice target is not a task and earns no XP.",
	holders: (e) => `Bots with this Specter (${e})`,
	noHolders: (e) => `No bot holds ${e} yet.`,
	showInRoster: "Show in the Roster",
	heroesLoading: "Loading heroes…",
	heroesFailed: "The heroes could not be loaded.",
	heroesUnsupported: "This version of the app backend cannot list the heroes yet.",
	retry: "Retry",
	avatarPackLine: "Use this Specter as your Crew avatar: download its avatar pack, then in Crew open Avatar → Customize → Library → Import.",
	avatarPackLink: (e) => `Download ${e}’s avatar pack`,
	avatarPackCopy: "If the link does not open, copy this address:"
}, Nn = { assign: "Assign" }, Pn = "", Fn = /[\u0000-\u001f\u007f<>]/g;
function In(e) {
	let t = Array.from(e.replace(/\.[^.]*$/, "").replace(Fn, " ").trim()).slice(0, 80).join("");
	return t === "" ? void 0 : t;
}
function Ln(e) {
	return new Promise((t, n) => {
		let r = new FileReader();
		r.onload = () => {
			let e = typeof r.result == "string" ? r.result : "";
			t(e.slice(e.indexOf(",") + 1));
		}, r.onerror = () => n(/* @__PURE__ */ Error("unreadable file")), r.readAsDataURL(e);
	});
}
function Rn({ heroId: e, currentAssetId: t, busy: n, onApply: r, onCancel: a }) {
	let o = kt(), [s, c] = l(null), [u, p] = l(!1), [m, h] = l(t ?? Pn), [g, _] = l(null);
	i(() => {
		let e = !0;
		return o.getJson(it).then((t) => {
			e && c(Array.isArray(t?.items) ? t.items : []);
		}, () => {
			e && p(!0);
		}), () => {
			e = !1;
		};
	}, [o]);
	let v = async (e) => {
		let t = e.target, n = t.files?.[0];
		if (t.value = "", n !== void 0) {
			if (n.type !== "image/png") return _(kn);
			if (n.size > 1048576) return _(An);
			_(null);
			try {
				let e = await Ln(n), t = In(n.name), r = await o.postJson(at, {
					mediaType: "image/png",
					dataBase64: e,
					...t === void 0 ? {} : { label: t }
				});
				c((e) => [...(e ?? []).filter((e) => e.assetId !== r.assetId), r]), h(r.assetId);
			} catch (e) {
				_(En(e instanceof G ? e.error ?? "invalid_image" : "offline"));
			}
		}
	};
	return /* @__PURE__ */ f("section", {
		className: "sa-form",
		"aria-label": Mn.heading,
		children: [
			/* @__PURE__ */ d("h3", { children: Mn.heading }),
			u && /* @__PURE__ */ d("p", {
				className: "sa-error",
				children: Mn.failed
			}),
			s === null && !u && /* @__PURE__ */ d("p", {
				role: "status",
				children: Mn.loading
			}),
			s !== null && /* @__PURE__ */ f("div", {
				className: "sa-gallery",
				role: "radiogroup",
				"aria-label": Mn.gallery,
				children: [/* @__PURE__ */ f("label", {
					className: "sa-gallery__item",
					children: [
						/* @__PURE__ */ d("input", {
							type: "radio",
							name: "specter-portrait",
							value: Pn,
							checked: m === Pn,
							onChange: () => h(Pn)
						}),
						e !== void 0 && /* @__PURE__ */ d(_n, {
							heroId: e,
							name: Mn.heroDefault,
							size: 64
						}),
						/* @__PURE__ */ d("span", { children: Mn.heroDefault })
					]
				}), s.map((e) => /* @__PURE__ */ f("label", {
					className: "sa-gallery__item",
					children: [
						/* @__PURE__ */ d("input", {
							type: "radio",
							name: "specter-portrait",
							value: e.assetId,
							checked: m === e.assetId,
							onChange: () => h(e.assetId)
						}),
						/* @__PURE__ */ d(Gt, {
							assetId: e.assetId,
							size: 64
						}),
						/* @__PURE__ */ d("span", { children: e.label })
					]
				}, e.assetId))]
			}),
			/* @__PURE__ */ f("label", { children: [Mn.upload, /* @__PURE__ */ d("input", {
				type: "file",
				accept: "image/png",
				onChange: (e) => void v(e)
			})] }),
			g !== null && /* @__PURE__ */ d("p", {
				className: "sa-error",
				role: "alert",
				children: g
			}),
			/* @__PURE__ */ f("div", {
				className: "sa-actions",
				children: [/* @__PURE__ */ d(H, {
					disabled: n || s === null || m === (t ?? Pn),
					onClick: () => r(m === Pn ? null : m),
					children: Mn.apply
				}), /* @__PURE__ */ d(H, {
					variant: "ghost",
					onClick: a,
					children: Mn.cancel
				})]
			})
		]
	});
}
// ui/src/specters/useMotionAllowed.ts
var zn = "(prefers-reduced-motion: reduce)";
function Bn() {
	return !(typeof window.matchMedia == "function" && window.matchMedia(zn).matches) && document.visibilityState !== "hidden";
}
function Vn() {
	let [e, t] = l(Bn);
	return i(() => {
		let e = () => t(Bn()), n = typeof window.matchMedia == "function" ? window.matchMedia(zn) : null;
		return n?.addEventListener("change", e), document.addEventListener("visibilitychange", e), e(), () => {
			n?.removeEventListener("change", e), document.removeEventListener("visibilitychange", e);
		};
	}, []), e;
}
// ui/src/specters/SpecterPortrait.tsx
function Hn({ specter: e, size: t, decorative: n = !1, active: r = !1 }) {
	let i = Wt(e.portrait.assetId), a = Vn(), o = e.displayName, s = i.status === "ready" && i.src !== null, c = i.status === "none" || i.status === "failed", l = i.status === "failed" ? bn : yn, u = t !== "sm", p = ["sa-portrait", `sa-portrait--${t}`];
	a && u && p.push("sa-portrait--float"), a && r && p.push("sa-portrait--active"), i.status === "loading" && p.push("sa-portrait--loading");
	let m = n || u, h = /* @__PURE__ */ f("span", {
		className: p.join(" "),
		"aria-hidden": n ? "true" : void 0,
		"data-portrait": s ? "image" : c ? "token" : "loading",
		children: [s && /* @__PURE__ */ d("img", {
			className: "sa-portrait__img",
			src: i.src ?? void 0,
			alt: n ? "" : `Portrait of ${o}`,
			width: Gn[t],
			height: Gn[t]
		}), c && /* @__PURE__ */ d("span", {
			className: "sa-portrait__token",
			style: { "--sa-hue": hn(e.bindingId) },
			role: m ? void 0 : "img",
			"aria-label": m ? void 0 : `${o}: ${l}`,
			"aria-hidden": u ? "true" : void 0,
			"data-initials": n ? gn(o) : void 0,
			children: n ? null : gn(o)
		})]
	});
	return u ? /* @__PURE__ */ f("span", {
		className: "sa-portrait-wrap",
		children: [h, c && /* @__PURE__ */ d("span", {
			className: "sa-caption",
			children: l
		})]
	}) : h;
}
function Un({ specter: e, decorative: t = !1, active: n = !1 }) {
	let r = Vn(), i = ["sa-portrait", "sa-portrait--sm"];
	return r && n && i.push("sa-portrait--active"), /* @__PURE__ */ d("span", {
		className: i.join(" "),
		"aria-hidden": t ? "true" : void 0,
		"data-portrait": "thumbnail",
		children: /* @__PURE__ */ d(_n, {
			heroId: e.heroId,
			name: e.displayName,
			size: Gn.sm,
			decorative: t
		})
	});
}
function Wn(e) {
	return e.size === "sm" && !e.specter.avatarChosen ? /* @__PURE__ */ d(Un, { ...e }) : /* @__PURE__ */ d(Hn, { ...e });
}
var Gn = {
	sm: 32,
	md: 96,
	lg: 160
}, Kn = [
	"auto",
	"picked",
	"random"
], qn = {
	contractVersion: !0,
	taskId: !0,
	bindingId: !0,
	attemptId: !0,
	kind: !0,
	state: !0,
	attemptState: !0,
	closeReason: !0,
	startedAtMs: !0,
	endedAtMs: !0,
	closedAtMs: !0,
	updatedAtMs: !0,
	runMs: !0,
	sizeClass: !0,
	xpCredited: !0,
	policyVersion: !0
}, Jn = 15e3;
function Yn(e, t) {
	let [r, a] = l({
		key: t,
		data: null,
		error: null,
		loading: e !== null
	}), o = c(e);
	o.current = e;
	let s = c(0), u = n(() => {
		let e = o.current;
		if (e === null) return;
		let n = ++s.current;
		e().then((e) => {
			n === s.current && a({
				key: t,
				data: e,
				error: null,
				loading: !1
			});
		}, (e) => {
			n === s.current && a((n) => ({
				key: t,
				data: n.key === t ? n.data : null,
				error: e,
				loading: !1
			}));
		});
	}, [t]), d = e !== null;
	i(() => {
		if (!d) return;
		a((e) => e.key === t ? e : {
			key: t,
			data: null,
			error: null,
			loading: !0
		}), u();
		let e = () => {
			document.visibilityState === "visible" && u();
		}, n = setInterval(e, Jn);
		return document.addEventListener("visibilitychange", e), () => {
			clearInterval(n), document.removeEventListener("visibilitychange", e), s.current += 1;
		};
	}, [
		d,
		t,
		u
	]);
	let f = r.key === t ? r : {
		key: t,
		data: null,
		error: null,
		loading: d
	};
	return {
		data: f.data,
		error: f.error,
		loading: f.loading,
		refresh: u
	};
}
// ui/src/specters/useSpecters.ts
var Xn = 500, Zn = class extends Error {}, Qn = (e) => typeof e == "string";
function $n(e) {
	if (typeof e != "object" || !e) return !1;
	let t = e, n = t.portrait;
	return Qn(t.bindingId) && typeof t.version == "number" && Qn(t.heroId) && Qn(t.displayName) && Qn(t.name) && typeof t.avatarChosen == "boolean" && typeof n == "object" && !!n && Qn(n.assetId);
}
function er(e) {
	if (!$n(e)) return !1;
	let t = e;
	return t.contractVersion === 3 && Kn.some((e) => e === t.assignedBy);
}
function tr(e) {
	let t = e, n = t?.items, r = t?.unassignedBindingIds;
	if (t?.contractVersion !== 3 || !Array.isArray(n) || n.length > Xn || !n.every(er) || !Array.isArray(r) || r.length > Xn || !r.every(Qn)) throw new Zn("unexpected specters body");
	let i = new Set(n.map((e) => e.bindingId));
	if (r.some((e) => i.has(e))) throw new Zn("unexpected specters body");
	return {
		items: n,
		unassigned: r
	};
}
function nr(e) {
	return e instanceof Zn ? "unexpected" : e instanceof G ? e.status === 404 ? "unsupported" : "unavailable" : "offline";
}
function rr(e) {
	return e instanceof G ? e.error ?? `http_${e.status}` : e instanceof Zn ? "invalid_response" : "offline";
}
function ir() {
	let e = kt(), t = Yn(n(async () => tr(await e.getJson(nt)), [e]), "specters"), [r, a] = l(/* @__PURE__ */ new Map()), o = t.data?.items ?? null;
	i(() => {
		o !== null && a((e) => {
			let t = new Map(e);
			for (let [n, r] of e) {
				let e = o.find((e) => e.bindingId === n);
				e !== void 0 && e.version >= r.version && t.delete(n);
			}
			return t.size === e.size ? e : t;
		});
	}, [o]);
	let c = s(() => {
		let e = new Map((o ?? []).map((e) => [e.bindingId, e]));
		for (let [t, n] of r) {
			let r = e.get(t);
			if ((r?.version ?? -1) < n.version) {
				let i = r?.assignedBy ?? "auto";
				e.set(t, {
					...n.specter,
					contractVersion: 3,
					assignedBy: "assignedBy" in n.specter ? n.specter.assignedBy : i
				});
			}
		}
		return e;
	}, [o, r]), u = s(() => (t.data?.unassigned ?? []).filter((e) => !c.has(e)), [t.data, c]), d = n((e) => {
		a((t) => new Map(t).set(e.bindingId, {
			version: e.version,
			specter: e
		}));
	}, []), { refresh: f } = t, p = n(async (t, n) => {
		let r = {
			expectedVersion: 0,
			heroId: n
		};
		try {
			let n = await e.postJson(ot(t), r);
			if (!er(n)) throw new Zn("unexpected specter body");
			return d(n), { kind: "assigned" };
		} catch (e) {
			return e instanceof G && e.status === 409 ? (f(), { kind: "already" }) : {
				kind: "failed",
				code: rr(e)
			};
		}
	}, [
		e,
		d,
		f
	]), m = t.error === null ? null : nr(t.error);
	return {
		status: o === null ? m === null ? "loading" : "failed" : "ready",
		byBinding: c,
		unassigned: u,
		failure: m,
		refresh: f,
		apply: d,
		assign: p
	};
}
// ui/src/specters/SpecterDetail.tsx
function ar({ bot: e, specter: t, specters: n, progression: r, onAssign: o }) {
	let s = kt(), p = a(), m = c(null), h = c(!1), [g, _] = l(!1), [v, y] = l(!1), [b, x] = l(null);
	if (i(() => {
		h.current && m.current !== null && (h.current = !1, m.current.focus());
	}), t === null) return /* @__PURE__ */ f("section", {
		className: "sa-profile",
		"aria-labelledby": p,
		children: [/* @__PURE__ */ d("h2", {
			id: p,
			children: vn
		}), o === void 0 ? /* @__PURE__ */ f(u, { children: [/* @__PURE__ */ d("p", {
			className: "sa-help",
			children: Cn
		}), /* @__PURE__ */ d(H, {
			onClick: n.refresh,
			children: wn.checkAgain
		})] }) : /* @__PURE__ */ f(u, { children: [/* @__PURE__ */ d("p", {
			className: "sa-help",
			children: K.detailHelp
		}), /* @__PURE__ */ d(H, {
			onClick: o,
			children: wn.assign
		})] })]
	});
	let ee = async (r) => {
		y(!0), x(null);
		try {
			n.apply(await s.postJson(st(e.bindingId), {
				expectedVersion: t.version,
				assetId: r
			})), h.current = !0, _(!1);
		} catch (e) {
			let t = rr(e);
			t === "version_conflict" && n.refresh(), x(t);
		} finally {
			y(!1);
		}
	};
	return /* @__PURE__ */ f("section", {
		className: "sa-profile",
		"aria-labelledby": p,
		children: [
			/* @__PURE__ */ f("div", {
				className: "sa-profile__head",
				children: [/* @__PURE__ */ d(Wn, {
					specter: t,
					size: "lg",
					active: e.condition.state === "working"
				}), /* @__PURE__ */ f("div", { children: [
					/* @__PURE__ */ d("h2", {
						id: p,
						ref: m,
						tabIndex: -1,
						children: t.displayName
					}),
					/* @__PURE__ */ d("p", { children: t.epithet }),
					/* @__PURE__ */ d("p", {
						className: "sa-help",
						children: Sn
					}),
					/* @__PURE__ */ d("p", {
						className: "sa-help",
						children: xn
					})
				] })]
			}),
			/* @__PURE__ */ f("dl", { children: [
				/* @__PURE__ */ f("div", {
					className: "sa-field",
					children: [/* @__PURE__ */ d("dt", { children: jn.progression }), /* @__PURE__ */ d("dd", { children: r })]
				}),
				/* @__PURE__ */ f("div", {
					className: "sa-field",
					children: [/* @__PURE__ */ d("dt", { children: jn.personality }), /* @__PURE__ */ d("dd", { children: t.personality })]
				}),
				/* @__PURE__ */ f("div", {
					className: "sa-field",
					children: [/* @__PURE__ */ d("dt", { children: jn.appearance }), /* @__PURE__ */ d("dd", { children: t.appearance })]
				})
			] }),
			b !== null && /* @__PURE__ */ d("p", {
				className: "sa-error",
				role: "alert",
				children: En(b)
			}),
			/* @__PURE__ */ d("div", {
				className: "sa-actions",
				children: /* @__PURE__ */ d(H, {
					"aria-expanded": g,
					onClick: () => _(!0),
					children: wn.avatar
				})
			}),
			g && /* @__PURE__ */ d(Rn, {
				heroId: t.heroId,
				currentAssetId: t.avatarChosen ? t.portrait.assetId : null,
				busy: v,
				onApply: (e) => void ee(e),
				onCancel: () => {
					h.current = !0, _(!1);
				}
			})
		]
	});
}
// ui/src/specters/SpecterProgression.tsx
function or({ summary: e, compact: t = !1, unavailable: n }) {
	let r = `sa-progression${t ? " sa-progression--compact" : ""}`, i = t ? "span" : "div";
	if (n !== void 0) return /* @__PURE__ */ d(i, {
		className: r,
		children: /* @__PURE__ */ d("small", {
			className: "sa-help",
			children: n === "loading" ? U.loading : U.failed
		})
	});
	if (e === void 0) return /* @__PURE__ */ f(i, {
		className: r,
		children: [/* @__PURE__ */ d("strong", { children: U.levelWord(1) }), /* @__PURE__ */ d("small", { children: `0 ${U.xp}` })]
	});
	let a = He(e), o = /* @__PURE__ */ d("span", { style: { width: `${a.percent}%` } });
	return /* @__PURE__ */ f(i, {
		className: r,
		children: [
			/* @__PURE__ */ d("strong", { children: U.levelWord(e.level) }),
			t ? /* @__PURE__ */ d("span", {
				className: "sa-xp-bar",
				"aria-hidden": "true",
				children: o
			}) : /* @__PURE__ */ d("div", {
				className: "sa-xp-bar",
				role: "progressbar",
				"aria-label": a.label,
				"aria-valuemin": 0,
				"aria-valuemax": a.valueMax,
				"aria-valuenow": a.valueNow,
				children: o
			}),
			/* @__PURE__ */ d("small", { children: e.nextLevelXp === null ? `${e.totalXp} ${U.xp}` : `${e.totalXp} / ${e.nextLevelXp} ${U.xp}` })
		]
	});
}
// ui/src/observatory/Tabs.tsx
function sr({ label: e, tabs: t, value: n, panelId: r, tabId: i, onChange: a }) {
	let o = c(/* @__PURE__ */ new Map());
	return /* @__PURE__ */ d("div", {
		className: "sa-tabs",
		role: "tablist",
		"aria-label": e,
		onKeyDown: (e) => {
			let r = t.findIndex((e) => e.name === n), i = t.length - 1, s = e.key === "ArrowRight" ? r === i ? 0 : r + 1 : e.key === "ArrowLeft" ? r === 0 ? i : r - 1 : e.key === "Home" ? 0 : e.key === "End" ? i : null, c = s === null ? void 0 : t[s];
			c !== void 0 && (e.preventDefault(), a(c.name), o.current.get(c.name)?.focus());
		},
		children: t.map((e) => /* @__PURE__ */ d("button", {
			type: "button",
			role: "tab",
			id: i(e.name),
			"aria-controls": r,
			className: "sa-tab",
			"aria-selected": n === e.name,
			tabIndex: n === e.name ? 0 : -1,
			ref: (t) => {
				t ? o.current.set(e.name, t) : o.current.delete(e.name);
			},
			onClick: () => a(e.name),
			children: e.label
		}, e.name))
	});
}
// ui/src/work/usePagedPolled.ts
var cr = (e) => ({
	key: e,
	items: [],
	cursor: void 0,
	busy: !1,
	failed: !1
});
function lr(e) {
	let { key: t, fetchPage: r, idOf: i, order: a } = e, o = Yn(t === null ? null : () => r(null), t ?? ""), [s, c] = l(cr("")), u = t !== null && s.key === t ? s : cr(t ?? ""), d = o.data?.nextCursor ?? null, f = u.cursor === void 0 ? d : u.cursor, p = n(() => {
		t === null || f === null || u.busy || (c({
			...u,
			key: t,
			busy: !0,
			failed: !1
		}), r(f).then((e) => c((n) => ({
			key: t,
			items: [...n.key === t ? n.items : [], ...e.items],
			cursor: e.nextCursor,
			busy: !1,
			failed: !1
		})), () => c((e) => ({
			...e.key === t ? e : cr(t),
			busy: !1,
			failed: !0
		}))));
	}, [
		t,
		f,
		u,
		r
	]), m = /* @__PURE__ */ new Set(), h = [];
	for (let e of [...o.data?.items ?? [], ...u.items]) {
		let t = i(e);
		m.has(t) || (m.add(t), h.push(e));
	}
	return h.sort(a), {
		firstPage: o.data,
		items: h,
		hasOlder: f !== null && o.data !== null,
		loadingOlder: u.busy,
		olderFailed: u.failed,
		error: o.error,
		loading: o.loading,
		refresh: o.refresh,
		loadOlder: p
	};
}
function ur(e) {
	return e instanceof Me ? "unexpected" : e instanceof G ? e.status === 404 ? "unsupported" : "unavailable" : "offline";
}
function dr() {
	let e = kt(), t = Yn(n(async () => {
		let t = [], n = null;
		for (let r = 0; r < 50; r += 1) {
			let r = Le(await e.getJson(ft(200, n)));
			if (t.push(...r.items), r.nextCursor === null) return {
				items: t,
				truncated: !1
			};
			if (r.nextCursor === n) throw new Me("xp cursor did not advance");
			n = r.nextCursor;
		}
		return {
			items: t,
			truncated: !0
		};
	}, [e]), "xp"), r = s(() => new Map((t.data?.items ?? []).map((e) => [e.bindingId, e])), [t.data]), i = t.error === null ? null : ur(t.error);
	return {
		status: t.data === null ? i === null ? "loading" : "failed" : "ready",
		byBinding: r,
		truncated: t.data?.truncated ?? !1,
		failure: i,
		refresh: t.refresh
	};
}
function fr(e, t) {
	if (e.status === "loading") return { status: "loading" };
	if (e.status === "failed") return {
		status: "failed",
		failure: e.failure ?? "unavailable"
	};
	let n = e.byBinding.get(t) ?? null;
	return n === null && e.truncated === !0 ? {
		status: "failed",
		failure: "unavailable"
	} : {
		status: "ready",
		summary: n
	};
}
// ui/src/work/useXpHistory.ts
var pr = (e, t) => t.createdAtMs - e.createdAtMs || (e.entryId < t.entryId ? 1 : e.entryId > t.entryId ? -1 : 0);
function mr(e) {
	let t = kt(), r = n(async (n) => Re(await t.getJson(gt(e ?? "", 50, n))), [t, e]), i = lr({
		key: e === null ? null : `xp:${e}`,
		fetchPage: r,
		idOf: (e) => e.entryId,
		order: pr
	}), a = i.error instanceof G && i.error.error === "unknown_binding" && i.firstPage === null;
	return {
		status: e === null ? "idle" : a ? "gone" : i.firstPage === null ? i.error === null ? "loading" : "failed" : "ready",
		summary: i.firstPage?.summary ?? null,
		entries: i.items,
		hasOlder: i.hasOlder,
		loadingOlder: i.loadingOlder,
		olderFailed: i.olderFailed,
		failure: i.error === null ? null : ur(i.error),
		loadOlder: i.loadOlder,
		refresh: i.refresh
	};
}
// ui/src/work/ProgressionPanel.tsx
function hr({ bindingId: e, botName: t, total: n }) {
	let r = mr(e);
	if (r.status === "loading" || r.status === "idle") return /* @__PURE__ */ d("p", {
		role: "status",
		children: Oe.loading
	});
	if (r.status === "gone") return /* @__PURE__ */ d("p", {
		role: "status",
		children: Oe.gone
	});
	if (r.status === "failed" || r.summary === null) return r.failure === "unsupported" ? /* @__PURE__ */ d(Ce, {
		title: Oe.unsupportedTitle,
		body: Oe.unsupportedBody
	}) : /* @__PURE__ */ d(we, {
		title: Oe.failedTitle,
		body: U.failed,
		onRetry: r.refresh
	});
	let i = n ?? r.summary;
	return /* @__PURE__ */ f("section", {
		className: "sa-work-progression",
		"aria-label": `${Oe.label}: ${t}`,
		children: [
			/* @__PURE__ */ f("div", {
				className: "sa-work-progression__head",
				children: [
					/* @__PURE__ */ f("p", {
						className: "sa-work-xp-amount",
						children: [
							U.levelWord(i.level),
							" · ",
							i.totalXp,
							" ",
							U.unit
						]
					}),
					/* @__PURE__ */ d(Ue, { summary: i }),
					/* @__PURE__ */ d("p", {
						className: "sa-help",
						children: U.policy(i.policyVersion, i.levelTableVersion)
					}),
					/* @__PURE__ */ d("p", {
						className: "sa-help",
						children: De
					}),
					/* @__PURE__ */ d("p", {
						className: "sa-help",
						children: Oe.basis
					})
				]
			}),
			r.entries.length === 0 ? /* @__PURE__ */ d("p", { children: Oe.empty }) : /* @__PURE__ */ d("ol", {
				className: "sa-work-ledger",
				"aria-label": Oe.entries,
				children: r.entries.map((e) => /* @__PURE__ */ f("li", {
					className: "sa-work-ledger__entry",
					children: [
						/* @__PURE__ */ d("strong", {
							className: "sa-work-xp-amount",
							children: Ve(e.amount)
						}),
						/* @__PURE__ */ d("span", { children: Ae(e.kind) }),
						/* @__PURE__ */ d("span", {
							className: "sa-work-ledger__title",
							children: e.workTitle
						}),
						/* @__PURE__ */ f("span", {
							className: "sa-help",
							children: [
								/* @__PURE__ */ d(B, { ms: e.createdAtMs }),
								" · ",
								U.entryPolicy(e.policyVersion)
							]
						})
					]
				}, e.entryId))
			}),
			r.olderFailed && /* @__PURE__ */ d("p", {
				className: "sa-error",
				role: "alert",
				children: Oe.olderFailed
			}),
			r.hasOlder && /* @__PURE__ */ d(H, {
				disabled: r.loadingOlder,
				onClick: r.loadOlder,
				children: r.loadingOlder ? Oe.loadingOlder : Oe.loadOlder
			})
		]
	});
}
// ui/src/observatory/TokenStat.tsx
function gr({ reading: e }) {
	return /* @__PURE__ */ f("section", {
		className: "sa-card sa-tokens",
		"aria-label": A.heading,
		children: [
			/* @__PURE__ */ d("h3", { children: A.heading }),
			/* @__PURE__ */ d("p", {
				className: "sa-help",
				children: A.note
			}),
			e === null ? /* @__PURE__ */ f("p", { children: [
				A.notCollected,
				". ",
				A.notCollectedWhy
			] }) : /* @__PURE__ */ f("dl", {
				className: "sa-counts",
				children: [
					/* @__PURE__ */ d("dt", { children: A.inUse }),
					/* @__PURE__ */ d("dd", { children: M(e.used, e.window) }),
					/* @__PURE__ */ d("dt", { children: A.read }),
					/* @__PURE__ */ d("dd", { children: /* @__PURE__ */ d(B, { ms: e.observedAt }) })
				]
			})
		]
	});
}
// ui/src/observatory/BotDetail.tsx
var _r = [
	{
		name: "attempts",
		label: "Attempts"
	},
	{
		name: "activity",
		label: "Activity"
	},
	{
		name: "progression",
		label: "Progression"
	},
	{
		name: "specter",
		label: "Specter"
	},
	{
		name: "source",
		label: "Source details"
	}
];
function vr({ item: e, collector: t, rosterRevision: n, attempts: r, xp: i, specter: o, specters: s, onAssign: c, onLoadOlder: p, onRetry: m }) {
	let [h, g] = l("attempts"), _ = a(), v = `${_}-panel`, y = r.status === "ready" ? r.data : null, b = null;
	return b = h === "source" ? /* @__PURE__ */ d(Je, {
		item: e,
		collector: t,
		rosterRevision: n,
		attempts: y
	}) : h === "progression" ? /* @__PURE__ */ d(hr, {
		bindingId: e.bindingId,
		botName: L(e),
		total: i.status === "ready" ? i.summary : null
	}) : h === "specter" ? /* @__PURE__ */ d(ar, {
		bot: e,
		specter: o,
		specters: s,
		onAssign: c,
		progression: /* @__PURE__ */ d(or, {
			summary: i.status === "ready" ? i.summary ?? void 0 : void 0,
			unavailable: i.status === "ready" ? void 0 : i.status === "loading" ? "loading" : "failed"
		})
	}) : r.status === "ready" ? h === "activity" ? /* @__PURE__ */ f(u, { children: [/* @__PURE__ */ d(ye, { activity: r.data.activity }), /* @__PURE__ */ d(gr, { reading: ae(e) })] }) : /* @__PURE__ */ d(Te, {
		items: r.items,
		hasOlder: r.hasOlder,
		loadingOlder: r.loadingOlder,
		olderFailed: r.olderFailed,
		onLoadOlder: p
	}) : r.status === "idle" ? null : /* @__PURE__ */ d(Ee, {
		state: r,
		onRetry: m
	}), /* @__PURE__ */ f("div", {
		className: "sa-detail",
		children: [
			/* @__PURE__ */ d(qe, {
				item: e,
				xp: i
			}),
			/* @__PURE__ */ d(sr, {
				label: "Bot detail sections",
				tabs: _r,
				value: h,
				panelId: v,
				tabId: (e) => `${_}-tab-${e}`,
				onChange: g
			}),
			/* @__PURE__ */ d("div", {
				role: "tabpanel",
				id: v,
				"aria-labelledby": `${_}-tab-${h}`,
				tabIndex: 0,
				children: b
			})
		]
	});
}
// ui/src/observatory/OperationalLegend.tsx
function yr({ open: e, onToggle: t }) {
	let n = a();
	return /* @__PURE__ */ f("div", {
		className: "sa-legend",
		children: [/* @__PURE__ */ f("button", {
			type: "button",
			className: "sa-legend__toggle",
			"aria-expanded": e,
			"aria-controls": n,
			onClick: t,
			children: ["What the states mean", /* @__PURE__ */ d("span", {
				"aria-hidden": "true",
				children: e ? "Hide" : "Show"
			})]
		}), e && /* @__PURE__ */ d("dl", {
			id: n,
			className: "sa-legend__items",
			children: D.map((e) => /* @__PURE__ */ f("div", { children: [/* @__PURE__ */ d("dt", { children: e.term }), /* @__PURE__ */ d("dd", { children: e.meaning })] }, e.term))
		})]
	});
}
// ui/src/observatory/RosterKpis.tsx
function br({ items: e }) {
	let t = [
		["Tracked bots", e.length],
		["Working now", e.filter((e) => e.condition.state === "working").length],
		["Coverage gaps", e.filter((e) => e.coverage.state === "gap").length]
	];
	return /* @__PURE__ */ d("div", {
		role: "group",
		"aria-label": "Roster summary",
		children: /* @__PURE__ */ d("dl", {
			className: "sa-kpis",
			children: t.map(([e, t]) => /* @__PURE__ */ f("div", {
				className: "sa-kpi",
				children: [/* @__PURE__ */ d("dt", { children: e }), /* @__PURE__ */ d("dd", { children: t })]
			}, e))
		})
	});
}
// ui/src/observatory/Initials.tsx
function xr({ item: e }) {
	return /* @__PURE__ */ d("span", {
		className: "sa-initials",
		"aria-hidden": "true",
		children: se(e)
	});
}
// ui/src/observatory/RosterList.tsx
function Sr(e, t, n) {
	return e === "ArrowDown" ? Math.min(n, t + 1) : e === "ArrowUp" ? Math.max(0, t - 1) : e === "Home" ? 0 : e === "End" ? n : null;
}
function Cr({ items: e, selectedId: t, watched: n, watchListFull: r, specters: i, unassigned: a, onAssign: o, onSelect: s, onToggleWatch: u }) {
	let p = c(/* @__PURE__ */ new Map()), [m, h] = l(null), g = (t) => t !== null && e.some((e) => e.bindingId === t), _ = g(m) ? m : g(t) ? t : e[0]?.bindingId ?? null;
	return /* @__PURE__ */ d("ul", {
		className: "sa-roster",
		"aria-label": "Bots",
		onKeyDown: (t) => {
			let n = e.findIndex((e) => e.bindingId === _), r = Sr(t.key, Math.max(0, n), e.length - 1), i = r === null ? void 0 : e[r];
			i !== void 0 && (t.preventDefault(), h(i.bindingId), p.current.get(i.bindingId)?.focus());
		},
		children: e.map((e) => {
			let c = e.bindingId === _, l = n.has(e.bindingId), m = i?.get(e.bindingId), g = a?.has(e.bindingId) === !0;
			return /* @__PURE__ */ f("li", {
				className: "sa-row",
				children: [
					/* @__PURE__ */ f("button", {
						type: "button",
						className: "sa-row__select",
						"data-binding-id": e.bindingId,
						ref: (t) => {
							t ? p.current.set(e.bindingId, t) : p.current.delete(e.bindingId);
						},
						tabIndex: c ? 0 : -1,
						"aria-current": e.bindingId === t ? "true" : void 0,
						onFocus: () => h(e.bindingId),
						onClick: () => s(e.bindingId),
						children: [
							m !== void 0 && /* @__PURE__ */ d(Wn, {
								specter: m,
								size: "sm",
								decorative: !0,
								active: e.condition.state === "working"
							}),
							/* @__PURE__ */ d(xr, { item: e }),
							/* @__PURE__ */ f("span", {
								className: "sa-row__copy",
								children: [
									/* @__PURE__ */ d("strong", { children: L(e) }),
									/* @__PURE__ */ d(be, { view: P(e.condition) }),
									/* @__PURE__ */ d("span", {
										className: "sa-chips",
										children: ie(e.workers).map((e) => /* @__PURE__ */ d("span", {
											className: `sa-chip sa-chip--${e.key}`,
											children: e.text
										}, e.key))
									}),
									m !== void 0 && /* @__PURE__ */ f("span", {
										className: "sa-row__specter",
										children: ["Specter: ", m.displayName]
									}),
									m === void 0 && g && /* @__PURE__ */ d("span", {
										className: "sa-row__specter sa-row__specter--none",
										children: "No Specter yet"
									})
								]
							})
						]
					}),
					/* @__PURE__ */ d("button", {
						type: "button",
						className: "sa-row__watch",
						tabIndex: c ? 0 : -1,
						"aria-pressed": l,
						"aria-label": `Watch ${L(e)}`,
						disabled: !l && r,
						onClick: () => u(e.bindingId),
						children: l ? "Watching" : "Watch"
					}),
					m === void 0 && g && o !== void 0 && /* @__PURE__ */ d("button", {
						type: "button",
						className: "sa-row__assign",
						tabIndex: c ? 0 : -1,
						"aria-label": `Assign a Specter to ${L(e)}`,
						onClick: () => o(e.bindingId),
						children: Nn.assign
					})
				]
			}, e.bindingId);
		})
	});
}
// ui/src/observatory/useRoster.ts
var wr = 200;
function Tr(e) {
	return e instanceof G ? e.status === 403 ? "expired" : e.status === 503 ? e.error === "store_not_ready" ? "store-not-ready" : "store-unavailable" : "unknown" : "offline";
}
function Er() {
	let e = kt(), t = Yn(n(async () => {
		let t = async (t) => {
			let n = [], r = null, i = null, a = 0;
			do {
				let o = await e.getJson(t(wr, i));
				r ??= o, n.push(...o.items), i = o.nextCursor, a += 1;
			} while (i !== null && a < 10);
			let o = i !== null;
			return {
				items: ce(n),
				collector: r.collector,
				notes: r.notes,
				rosterRevision: r.rosterRevision,
				truncated: o,
				complete: !o,
				fetchedAtMs: Date.now()
			};
		};
		try {
			return await t($e);
		} catch (e) {
			if (e instanceof G && e.status === 403) throw e;
			return t(Qe);
		}
	}, [e]), "roster"), r = t.error === null ? null : Tr(t.error), i;
	return i = t.data === null ? r === null ? {
		status: "loading",
		data: null,
		failure: null
	} : {
		status: "failed",
		data: null,
		failure: r
	} : {
		status: "ready",
		data: t.data,
		failure: r
	}, {
		state: i,
		refresh: t.refresh
	};
}
// ui/src/observatory/useAttempts.ts
var Dr = 50, Or = (e) => ({
	id: e,
	items: [],
	cursor: void 0,
	busy: !1,
	failed: !1
}), kr = (e) => e instanceof G && e.status === 404;
function Ar(e) {
	let t = kt(), r = Yn(s(() => e === null ? null : () => t.getJson(et(e, Dr)), [t, e]), e ?? ""), [i, a] = l(Or("")), o = i.id === e ? i : Or(e ?? ""), c = r.data?.nextCursor ?? null, u = o.cursor === void 0 ? c : o.cursor, d = n(() => {
		e === null || u === null || o.busy || (a({
			...o,
			id: e,
			busy: !0,
			failed: !1
		}), t.getJson(et(e, Dr, u)).then((t) => a((n) => ({
			id: e,
			items: pe(n.id === e ? n.items : [], t.items),
			cursor: t.nextCursor,
			busy: !1,
			failed: !1
		})), () => a((t) => ({
			...t.id === e ? t : Or(e),
			busy: !1,
			failed: !0
		}))));
	}, [
		t,
		e,
		u,
		o
	]), f;
	return f = e === null ? { status: "idle" } : kr(r.error) ? { status: "gone" } : r.data === null ? r.error === null ? { status: "loading" } : {
		status: "failed",
		failure: Tr(r.error)
	} : {
		status: "ready",
		data: r.data,
		items: pe(r.data.items, o.items),
		hasOlder: u !== null,
		loadingOlder: o.busy,
		olderFailed: o.failed,
		failure: r.error === null ? null : Tr(r.error)
	}, {
		state: f,
		loadOlder: d,
		refresh: r.refresh
	};
}
// ui/src/observatory/observatory.css?inline
var jr = ".specter-arena-root{--ink:#141020;--panel:#211a33;--raised:#2c2340;--line:#45375f;--text:#f7f3ff;--muted:#c5bdd6;--violet:#b49aff;--amber:#ffd080;--cyan:#88dde6;--success:#92dfb8;--danger:#ff9bae;box-sizing:border-box;min-width:320px;color:var(--text);background:radial-gradient(circle at 80% -10%, #5d39852e, transparent 35%), var(--ink);font-synthesis:none;padding:20px;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;font-size:14px;line-height:1.45}.specter-arena-root *,.specter-arena-root :before,.specter-arena-root :after{box-sizing:border-box}.specter-arena-root h1,.specter-arena-root h2,.specter-arena-root h3,.specter-arena-root p,.specter-arena-root ul,.specter-arena-root ol,.specter-arena-root dl,.specter-arena-root dd{margin:0}.specter-arena-root ul,.specter-arena-root ol{padding:0;list-style:none}.specter-arena-root button,.specter-arena-root a,.specter-arena-root input,.specter-arena-root select,.specter-arena-root textarea{outline:none;font-family:inherit}.specter-arena-root button:focus-visible,.specter-arena-root a:focus-visible,.specter-arena-root input:focus-visible,.specter-arena-root select:focus-visible,.specter-arena-root textarea:focus-visible,.specter-arena-root [tabindex=\"0\"]:focus-visible{box-shadow:0 0 0 3px var(--ink), 0 0 0 5px var(--violet);outline:none}.specter-arena-root [tabindex=\"-1\"]:focus-visible{outline:none}.specter-arena-root a{color:var(--cyan);text-underline-offset:2px;text-decoration:underline}@media (forced-colors:active){.specter-arena-root button:focus-visible,.specter-arena-root a:focus-visible,.specter-arena-root input:focus-visible,.specter-arena-root select:focus-visible,.specter-arena-root textarea:focus-visible,.specter-arena-root [tabindex=\"0\"]:focus-visible{outline-offset:2px;outline:2px solid highlight}}.specter-arena-root button{cursor:pointer}.specter-arena-root button:disabled{cursor:not-allowed;opacity:.45}.specter-arena-root .sa-visually-hidden{clip:rect(0, 0, 0, 0);white-space:nowrap;border:0;width:1px;height:1px;margin:-1px;padding:0;position:absolute;overflow:hidden}.specter-arena-root .sa-panel{background:linear-gradient(145deg,#261d37f5,#1b1528f5);border:1px solid #b49aff24;border-radius:16px;padding:18px;box-shadow:0 18px 48px #07040d33}.specter-arena-root .sa-page{gap:16px;max-width:1180px;margin:0 auto;display:grid}.specter-arena-root .sa-header{gap:12px;display:grid}.specter-arena-root .sa-header__top{flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;display:flex}.specter-arena-root .sa-header h1{font-size:24px}.specter-arena-root .sa-header__actions{min-width:0;max-width:100%;color:var(--muted);flex-wrap:wrap;align-items:center;gap:12px;font-size:12px;display:flex}.specter-arena-root .sa-collector{background:#88dde60f;border:1px solid #88dde638;border-radius:10px;padding:10px 12px}.specter-arena-root .sa-notes{color:var(--muted);gap:4px;font-size:12px;display:grid}.specter-arena-root .sa-banner{border:1px solid var(--danger);background:#ff9bae14;border-radius:10px;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;display:flex}.specter-arena-root .sa-layout{grid-template-columns:360px minmax(0,1fr);align-items:start;gap:16px;display:grid}.specter-arena-root .sa-tabs{background:#1a1526;border:1px solid #3a304a;border-radius:10px;padding:3px;display:flex}.specter-arena-root .sa-tab{color:#a99fb8;background:0 0;border:0;border-radius:7px;flex:1;min-height:36px;padding:0 11px;font-size:12px}.specter-arena-root .sa-tab[aria-selected=true]{background:var(--raised);color:var(--text);box-shadow:0 1px 4px #00000040}.specter-arena-root .sa-toolbar{gap:10px;margin-bottom:8px;display:grid}.specter-arena-root .sa-search{min-height:42px;color:var(--muted);background:#241c35;border:1px solid #514165;border-radius:8px;grid-template-columns:24px 1fr;align-items:center;padding-left:10px;display:grid}.specter-arena-root .sa-search:focus-within{box-shadow:0 0 0 3px var(--ink), 0 0 0 5px var(--violet)}.specter-arena-root .sa-search input{min-width:0;min-height:40px;color:var(--text);background:0 0;border:0;padding:0 11px 0 4px;font-size:14px}.specter-arena-root .sa-search input:focus-visible{box-shadow:none}.specter-arena-root .sa-result-count{color:var(--muted);margin:10px 0 8px;font-size:12px}.specter-arena-root .sa-button{min-height:42px;color:var(--text);border:1px solid #0000;border-radius:9px;justify-content:center;align-items:center;gap:8px;padding:0 15px;font-size:13px;font-weight:650;display:inline-flex}.specter-arena-root .sa-button--secondary{background:var(--raised);border-color:#52436b}.specter-arena-root .sa-button--secondary:hover{background:#382c4e}.specter-arena-root .sa-button--ghost{color:var(--muted);background:0 0}.specter-arena-root .sa-button--ghost:hover{background:var(--raised);color:var(--text)}.specter-arena-root .sa-roster{display:grid}.specter-arena-root .sa-row{border-top:1px solid #3a2f49;align-items:stretch;display:flex}.specter-arena-root .sa-row__select{min-width:0;min-height:64px;color:var(--text);text-align:left;background:0 0;border:0;flex:1;align-items:center;gap:12px;padding:8px 10px;display:flex}.specter-arena-root .sa-row__select:hover{background:#261e37}.specter-arena-root .sa-row__select[aria-current=true]{box-shadow:inset 3px 0 var(--violet);background:#2b213f}.specter-arena-root .sa-row__select[aria-current=true]:focus-visible{box-shadow:inset 3px 0 var(--violet), 0 0 0 3px var(--ink), 0 0 0 5px var(--violet)}.specter-arena-root .sa-row__watch{min-height:36px;color:var(--muted);background:0 0;border:1px solid #52436b;border-radius:8px;align-self:center;margin:0 6px;padding:0 10px;font-size:12px}.specter-arena-root .sa-row__watch[aria-pressed=true]{background:var(--raised);color:var(--text);border-color:var(--violet)}.specter-arena-root .sa-row__copy{flex:1;gap:4px;min-width:0;display:grid}.specter-arena-root .sa-row__copy strong{text-overflow:ellipsis;white-space:nowrap;font-size:14px;overflow:hidden}.specter-arena-root .sa-chips{flex-wrap:wrap;gap:6px;display:flex}.specter-arena-root .sa-chip{background:#2c2440;border:1px solid #4d4060;border-radius:999px;padding:2px 8px;font-size:12px}.specter-arena-root .sa-chip--working{color:var(--success)}.specter-arena-root .sa-chip--unknown{color:var(--amber)}.specter-arena-root .sa-initials{background:var(--raised);width:38px;height:38px;color:var(--violet);border-radius:10px;flex:none;place-items:center;font-weight:800;display:grid}.specter-arena-root .sa-status{color:#dcd5e7;white-space:nowrap;background:#2c2440;border:1px solid #4d4060;border-radius:999px;align-items:center;gap:6px;width:fit-content;min-height:25px;padding:0 8px;font-size:12px;display:inline-flex}.specter-arena-root .sa-status__dot{background:0 0;border:2px solid;border-radius:50%;width:10px;height:10px}.specter-arena-root .sa-status--working{color:var(--success)}.specter-arena-root .sa-status--working .sa-status__dot{background:currentColor}.specter-arena-root .sa-status--settled{color:var(--muted)}.specter-arena-root .sa-status--unknown{color:var(--amber)}.specter-arena-root .sa-status--unknown .sa-status__dot{border-style:dashed}.specter-arena-root .sa-status--ended{color:var(--muted)}.specter-arena-root .sa-status--ended .sa-status__dot{border-radius:2px}.specter-arena-root .sa-legend{background:#1b1629;border:1px solid #3b304d;border-radius:10px}.specter-arena-root .sa-legend__toggle{width:100%;min-height:40px;color:var(--text);background:0 0;border:0;justify-content:space-between;align-items:center;padding:0 12px;font-size:13px;display:flex}.specter-arena-root .sa-legend__items{border-top:1px solid #3b304d;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;padding:10px 12px;display:grid}.specter-arena-root .sa-legend__items dt{font-size:13px;font-weight:650}.specter-arena-root .sa-legend__items dd{color:var(--muted);font-size:12px}.specter-arena-root .sa-cards{grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;display:grid}.specter-arena-root .sa-card{background:#1b1629;border:1px solid #3a2f49;border-radius:10px;gap:4px;padding:12px;display:grid}.specter-arena-root .sa-kpis{grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:0 0 12px;display:grid}.specter-arena-root .sa-kpi{background:#1b1629;border:1px solid #3a2f49;border-radius:10px;gap:2px;padding:10px 12px;display:grid}.specter-arena-root .sa-kpi dt{color:var(--muted);font-size:12px;font-weight:650}.specter-arena-root .sa-kpi dd{margin:0;font-size:22px;font-weight:700}.specter-arena-root .sa-card h3{color:var(--muted);font-size:12px;font-weight:650}.specter-arena-root .sa-detail{gap:14px;display:grid}.specter-arena-root .sa-detail h2{font-size:20px}.specter-arena-root .sa-facts{color:var(--muted);gap:4px;font-size:13px;display:grid}.specter-arena-root .sa-state{text-align:center;max-width:360px;margin:24px auto}.specter-arena-root .sa-state__icon{background:var(--raised);width:52px;height:52px;color:var(--violet);border:1px solid #504064;border-radius:15px;place-items:center;margin:0 auto 14px;display:grid}.specter-arena-root .sa-state h3{font-size:17px}.specter-arena-root .sa-state p{color:var(--muted);margin:7px auto 16px;font-size:13px;line-height:1.6}.specter-arena-root .sa-state--error .sa-state__icon{color:var(--danger)}.specter-arena-root .sa-attempts{gap:12px;display:grid}.specter-arena-root .sa-attempts ol{display:grid}.specter-arena-root .sa-attempt{border-top:1px solid #3a2f49;gap:4px;padding:12px 0;display:grid}.specter-arena-root .sa-attempt p{font-size:13px}.specter-arena-root .sa-activity{gap:12px;display:grid}.specter-arena-root .sa-counts{grid-template-columns:minmax(0,1fr) auto;gap:4px 16px;font-size:13px;display:grid}.specter-arena-root .sa-counts dd{text-align:right}.specter-arena-root .sa-source{gap:14px;display:grid}.specter-arena-root .sa-source h3{margin-bottom:8px;font-size:14px}.specter-arena-root .sa-source .sa-counts>div{display:contents}.specter-arena-root .sa-glossary summary{cursor:pointer;color:var(--violet);font-size:13px}.specter-arena-root .sa-glossary dl{gap:8px;margin-top:8px;display:grid}.specter-arena-root .sa-glossary dt{font-size:13px;font-weight:650}.specter-arena-root .sa-glossary dd{color:var(--muted);font-size:12px}@media (width<=900px){.specter-arena-root .sa-layout{grid-template-columns:minmax(0,1fr)}}@media (width<=520px){.specter-arena-root{padding:12px}.specter-arena-root .sa-header h1{font-size:20px}.specter-arena-root .sa-legend__items{grid-template-columns:minmax(0,1fr)}.specter-arena-root .sa-tabs{flex-wrap:wrap}.specter-arena-root .sa-tab{flex:auto}}@media (prefers-reduced-motion:reduce){.specter-arena-root,.specter-arena-root *,.specter-arena-root :before,.specter-arena-root :after{scroll-behavior:auto!important;transition-duration:.001ms!important;animation-duration:.001ms!important;animation-iteration-count:1!important}}.specter-arena-root .sa-status--waiting{color:var(--amber)}.specter-arena-root .sa-status--waiting .sa-status__dot{background:linear-gradient(90deg,#0000 1px,currentColor 1px 2px,#0000 2px 4px,currentColor 4px 5px,#0000 5px);border-radius:2px}.specter-arena-root .sa-tokens{margin-top:12px}";
// ui/src/observatory/useInjectedStyle.ts
function Mr() {
	o(() => {
		let e = document.createElement("style");
		return e.setAttribute("data-specter-arena", ""), e.textContent = jr, document.head.appendChild(e), () => {
			e.remove();
		};
	}, []);
}
// ui/src/observatory/watched.ts
var Nr = "specter-arena:watched:v1", Pr = /^[A-Za-z0-9_-]{1,64}$/;
function Fr(e) {
	if (e === null) return [];
	try {
		let t = JSON.parse(e);
		if (typeof t != "object" || !t) return [];
		let { v: n, ids: r } = t;
		if (n !== 1 || !Array.isArray(r)) return [];
		let i = [];
		for (let e of r) if (typeof e == "string" && Pr.test(e) && !i.includes(e) && i.push(e), i.length === 500) break;
		return i;
	} catch {
		return [];
	}
}
function Ir() {
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}
function Lr() {
	try {
		return Fr(Ir()?.getItem("specter-arena:watched:v1") ?? null);
	} catch {
		return [];
	}
}
function Rr(e) {
	try {
		let t = Ir();
		return t !== null && (t.setItem(Nr, JSON.stringify({
			v: 1,
			ids: [...e]
		})), !0);
	} catch {
		return !1;
	}
}
var zr = (e, t) => new Set([...e].filter((e) => t.has(e)));
function Br(e) {
	let [t, r] = l(() => new Set(Lr())), [a, o] = l(!1), s = n((e) => {
		r(e), o(!Rr(e));
	}, []);
	return i(() => {
		if (e?.complete !== !0) return;
		let n = zr(t, e.ids);
		n.size !== t.size && s(n);
	}, [
		e,
		t,
		s
	]), i(() => {
		let e = (e) => {
			(e.key === "specter-arena:watched:v1" || e.key === null) && r(new Set(Lr()));
		};
		return window.addEventListener("storage", e), () => window.removeEventListener("storage", e);
	}, []), {
		watched: t,
		toggle: n((e) => {
			let n = new Set(t);
			if (!n.delete(e)) {
				if (n.size >= 500) return;
				n.add(e);
			}
			s(n);
		}, [t, s]),
		clear: n(() => s(/* @__PURE__ */ new Set()), [s]),
		persistFailed: a,
		full: t.size >= 500
	};
}
// ui/src/specters/HeroChoice.tsx
function Vr({ name: e, label: t, heroes: n, value: r, onChange: i, size: a, disabled: o = !1 }) {
	return /* @__PURE__ */ d("div", {
		role: "radiogroup",
		"aria-label": t,
		className: "sa-hero-choice",
		children: n.map((t) => /* @__PURE__ */ f("label", {
			className: "sa-hero-choice__item",
			"data-hero-id": t.heroId,
			children: [
				/* @__PURE__ */ d("input", {
					type: "radio",
					name: e,
					value: t.heroId,
					checked: t.heroId === r,
					disabled: o,
					onChange: () => i(t.heroId),
					className: "sa-hero-choice__input"
				}),
				/* @__PURE__ */ d("span", {
					className: "sa-portrait sa-portrait--md",
					"aria-hidden": "true",
					children: /* @__PURE__ */ d(_n, {
						heroId: t.heroId,
						name: t.name,
						size: a
					})
				}),
				/* @__PURE__ */ d("span", {
					className: "sa-hero-choice__name",
					children: t.name
				}),
				" ",
				/* @__PURE__ */ d("span", {
					className: "sa-hero-choice__held",
					children: K.held(t.assignedCount)
				})
			]
		}, t.heroId))
	});
}
// ui/src/specters/AssignDialog.tsx
function Hr({ bots: e, queue: t, specters: n, heroes: r, onClose: s }) {
	let u = c(null), p = c(null), m = c(null), h = c(!0), g = a(), _ = a(), v = a(), [y, b] = l(0), [x, ee] = l(/* @__PURE__ */ new Set()), [S, te] = l(null), [C, w] = l(!1), [T, E] = l(null), [D, O] = l(null);
	o(() => {
		let e = u.current;
		return e?.showModal(), () => {
			e?.open && e.close();
		};
	}, []), i(() => (h.current = !0, () => {
		h.current = !1;
	}), []);
	let k = t[y], A = k === void 0, j = e.find((e) => e.bindingId === k), M = r.items === null ? [] : mn(r.items), N = S ?? M[0]?.heroId ?? null, ne = M.find((e) => e.heroId === N), re = C || T !== null;
	i(() => {
		!re && k !== void 0 && n.byBinding.has(k) && (te(null), O(null), b((e) => t[e] === k ? e + 1 : e));
	}, [
		re,
		k,
		t,
		n.byBinding
	]), i(() => {
		A ? m.current?.focus() : p.current?.focus();
	}, [y, A]);
	let P = () => s(t), F = async () => {
		if (k === void 0 || N === null) return;
		w(!0), O(null);
		let e = await n.assign(k, N);
		h.current && (w(!1), e.kind === "failed" ? O(e.code) : r.refresh());
	}, I = () => {
		te(null), O(null), b((e) => e + 1);
	}, ie = async () => {
		let e = t.filter((e) => !n.byBinding.has(e)), i = /* @__PURE__ */ new Set();
		E({
			done: 0,
			total: e.length
		}), O(null);
		for (let [t, r] of e.entries()) {
			if ((await n.assign(r, null)).kind === "failed" && i.add(r), !h.current) return;
			E({
				done: t + 1,
				total: e.length
			});
		}
		r.refresh(), n.refresh(), ee(i), E(null), te(null), b(t.length);
	}, ae = t.filter((e) => n.byBinding.has(e)).length, oe = t.filter((e) => !n.byBinding.has(e) && x.has(e)).length, se = t.length - ae - oe, ce = j === void 0 ? null : L(j);
	return /* @__PURE__ */ d("dialog", {
		ref: u,
		className: "sa-assign-dialog",
		"aria-labelledby": g,
		"aria-describedby": _,
		onCancel: (e) => {
			e.preventDefault(), re || P();
		},
		children: A ? /* @__PURE__ */ f("div", {
			className: "sa-assign-dialog__body",
			children: [
				/* @__PURE__ */ d("h2", {
					id: g,
					ref: p,
					tabIndex: -1,
					children: K.summaryTitle
				}),
				/* @__PURE__ */ d("p", {
					id: _,
					role: "status",
					children: K.summary(ae, se, oe)
				}),
				se + oe > 0 && /* @__PURE__ */ d("p", {
					className: "sa-help",
					children: K.skippedHint
				}),
				/* @__PURE__ */ d("div", {
					className: "sa-actions",
					children: /* @__PURE__ */ d(H, {
						ref: m,
						onClick: P,
						children: K.done
					})
				})
			]
		}) : /* @__PURE__ */ f("div", {
			className: "sa-assign-dialog__body",
			children: [
				/* @__PURE__ */ d("p", {
					className: "sa-assign-dialog__step",
					children: K.step(y + 1, t.length)
				}),
				/* @__PURE__ */ d("h2", {
					id: g,
					ref: p,
					tabIndex: -1,
					children: ce === null ? K.botGone : K.title(ce)
				}),
				/* @__PURE__ */ d("p", {
					id: _,
					className: "sa-help",
					children: K.note
				}),
				ce !== null && (r.items === null ? /* @__PURE__ */ d("p", {
					className: "sa-help",
					role: r.status === "failed" ? "alert" : "status",
					children: r.status === "failed" ? K.heroesFailed : K.heroesLoading
				}) : /* @__PURE__ */ d(Vr, {
					name: v,
					label: K.heroesLabel,
					heroes: M,
					value: N,
					onChange: te,
					size: 96,
					disabled: re
				})),
				D !== null && /* @__PURE__ */ d("p", {
					className: "sa-error",
					role: "alert",
					children: En(D)
				}),
				T !== null && /* @__PURE__ */ d("p", {
					className: "sa-help",
					role: "status",
					children: K.progress(T.done, T.total)
				}),
				/* @__PURE__ */ f("div", {
					className: "sa-actions",
					children: [
						ce !== null && /* @__PURE__ */ d(H, {
							disabled: re || ne === void 0,
							onClick: () => void F(),
							children: C ? K.assigning : K.assign(ne?.name ?? "")
						}),
						/* @__PURE__ */ d(H, {
							variant: "ghost",
							disabled: re,
							onClick: I,
							children: K.skip
						}),
						/* @__PURE__ */ d(H, {
							variant: "ghost",
							disabled: re,
							onClick: () => void ie(),
							children: K.randomize
						}),
						/* @__PURE__ */ d(H, {
							variant: "ghost",
							disabled: re,
							onClick: P,
							children: K.close
						})
					]
				})
			]
		})
	});
}
// ui/src/arena/heroCombat.ts
var Ur = {
	reeve: {
		attack: 620,
		cast: 900,
		attackImpact: 320,
		castImpact: 560
	},
	vell: {
		attack: 560,
		cast: 950,
		attackImpact: 300,
		castImpact: 610
	},
	stitch: {
		attack: 650,
		cast: 1050,
		attackImpact: 360,
		castImpact: 680
	},
	poly: {
		attack: 600,
		cast: 1e3,
		attackImpact: 350,
		castImpact: 640
	},
	rattle: {
		attack: 620,
		cast: 1e3,
		attackImpact: 340,
		castImpact: 650
	},
	ember: {
		attack: 520,
		cast: 950,
		attackImpact: 290,
		castImpact: 590
	},
	shard: {
		attack: 650,
		cast: 1100,
		attackImpact: 390,
		castImpact: 710
	},
	tide: {
		attack: 580,
		cast: 1050,
		attackImpact: 330,
		castImpact: 680
	},
	lume: {
		attack: 600,
		cast: 1100,
		attackImpact: 340,
		castImpact: 700
	},
	moss: {
		attack: 600,
		cast: 1150,
		attackImpact: 340,
		castImpact: 720
	},
	bur: {
		attack: 680,
		cast: 1200,
		attackImpact: 390,
		castImpact: 760
	}
}, Wr = (e) => Object.hasOwn(Ur, e) ? Ur[e] : null, Gr = {
	reeve: "rgb(203, 185, 255)",
	vell: "rgb(225, 212, 255)",
	stitch: "rgb(255, 208, 128)",
	poly: "rgb(136, 221, 230)",
	rattle: "rgb(237, 232, 214)",
	ember: "rgb(255, 150, 70)",
	shard: "rgb(150, 230, 255)",
	tide: "rgb(112, 188, 232)",
	lume: "rgb(200, 255, 240)",
	moss: "rgb(146, 223, 184)",
	bur: "rgb(200, 235, 255)"
}, Kr = (e) => Object.hasOwn(Gr, e) ? Gr[e] : "rgb(255, 208, 128)";
function qr(e, t) {
	let n = Math.atan2(t, Math.abs(e)) * 180 / Math.PI;
	return Math.max(-35, Math.min(35, n));
}
var Jr = {
	patchling: {
		attack: 520,
		impact: 260
	},
	patchbrute: {
		attack: 700,
		impact: 340
	}
};
// ui/src/arena/SceneSvgs.tsx
function Yr({ title: e, decorative: t = !1, className: n, viewBox: r, children: i }) {
	let o = a(), s = `${o}-title`;
	return /* @__PURE__ */ f("svg", {
		xmlns: "http://www.w3.org/2000/svg",
		viewBox: r,
		className: n,
		role: t ? void 0 : "img",
		"aria-hidden": t ? "true" : void 0,
		"aria-labelledby": t ? void 0 : s,
		focusable: "false",
		children: [!t && /* @__PURE__ */ d("title", {
			id: s,
			children: e
		}), i(o)]
	});
}
function Xr(e) {
	return /* @__PURE__ */ d(Yr, {
		...e,
		viewBox: "0 0 24 24",
		children: () => /* @__PURE__ */ f(u, { children: [/* @__PURE__ */ d("path", {
			d: "m8 3 8 0 5 5v8l-5 5H8l-5-5V8Z",
			fill: "#4a2536",
			stroke: "#ff9bae",
			strokeWidth: "1.8"
		}), /* @__PURE__ */ d("path", {
			d: "M7 12h10",
			stroke: "#fff0f4",
			strokeWidth: "2.5",
			strokeLinecap: "round"
		})] })
	});
}
function Zr(e) {
	return /* @__PURE__ */ d(Yr, {
		...e,
		viewBox: "0 0 24 24",
		children: () => /* @__PURE__ */ f(u, { children: [
			/* @__PURE__ */ d("path", {
				d: "M5 3h10l4 4v13H5Z",
				fill: "#273a46",
				stroke: "#88dde6",
				strokeWidth: "1.8",
				strokeLinejoin: "round"
			}),
			/* @__PURE__ */ d("path", {
				d: "M15 3v5h4M8 11h6M8 15h4",
				fill: "none",
				stroke: "#edfaff",
				strokeWidth: "1.6",
				strokeLinecap: "round"
			}),
			/* @__PURE__ */ d("circle", {
				cx: "16.5",
				cy: "16.5",
				r: "3",
				fill: "#211a33",
				stroke: "#ffd080",
				strokeWidth: "1.5"
			}),
			/* @__PURE__ */ d("path", {
				d: "m18.7 18.7 2 2",
				stroke: "#ffd080",
				strokeWidth: "1.5",
				strokeLinecap: "round"
			})
		] })
	});
}
function Qr(e) {
	return /* @__PURE__ */ d(Yr, {
		...e,
		viewBox: "0 0 24 24",
		children: () => /* @__PURE__ */ f(u, { children: [
			/* @__PURE__ */ d("path", {
				d: "M4 16a10 10 0 0 1 16 0",
				fill: "none",
				stroke: "#c5bdd6",
				strokeWidth: "2",
				strokeLinecap: "round",
				strokeDasharray: "5 3"
			}),
			/* @__PURE__ */ d("path", {
				d: "M7.5 18.5a6 6 0 0 1 9 0",
				fill: "none",
				stroke: "#c5bdd6",
				strokeWidth: "2",
				strokeLinecap: "round",
				strokeDasharray: "3 3"
			}),
			/* @__PURE__ */ d("circle", {
				cx: "12",
				cy: "20",
				r: "1.5",
				fill: "#c5bdd6"
			}),
			/* @__PURE__ */ d("path", {
				d: "m5 5 14 14",
				stroke: "#ff9bae",
				strokeWidth: "1.5",
				strokeLinecap: "round"
			})
		] })
	});
}
function $r(e) {
	return /* @__PURE__ */ d(Yr, {
		...e,
		viewBox: "0 0 24 24",
		children: () => /* @__PURE__ */ f(u, { children: [
			/* @__PURE__ */ d("path", {
				d: "M5 4h14v16H5Z",
				fill: "#2c2340",
				stroke: "#b49aff",
				strokeWidth: "1.8"
			}),
			/* @__PURE__ */ d("path", {
				d: "M9 8v8m6-8v8",
				stroke: "#f7f3ff",
				strokeWidth: "2",
				strokeLinecap: "round"
			}),
			/* @__PURE__ */ d("circle", {
				cx: "12",
				cy: "12",
				r: "8.5",
				fill: "none",
				stroke: "#88dde6",
				strokeWidth: "1.2",
				strokeDasharray: "2 3"
			})
		] })
	});
}
function ei(e) {
	return /* @__PURE__ */ d(Yr, {
		...e,
		viewBox: "0 0 24 24",
		children: () => /* @__PURE__ */ f(u, { children: [/* @__PURE__ */ d("path", {
			d: "m12 2 7 3 3 7-3 7-7 3-7-3-3-7 3-7Z",
			fill: "#234036",
			stroke: "#92dfb8",
			strokeWidth: "1.8"
		}), /* @__PURE__ */ d("path", {
			d: "m7.5 12.5 3 3 6-7",
			fill: "none",
			stroke: "#effff7",
			strokeWidth: "2.2",
			strokeLinecap: "round",
			strokeLinejoin: "round"
		})] })
	});
}
function ti(e) {
	return /* @__PURE__ */ d(Yr, {
		...e,
		viewBox: "0 0 24 24",
		children: () => /* @__PURE__ */ f(u, { children: [
			/* @__PURE__ */ d("circle", {
				cx: "7",
				cy: "12",
				r: "4",
				fill: "#2b3a4b",
				stroke: "#88dde6",
				strokeWidth: "1.8"
			}),
			/* @__PURE__ */ d("circle", {
				cx: "17",
				cy: "12",
				r: "4",
				fill: "#3b3151",
				stroke: "#b49aff",
				strokeWidth: "1.8"
			}),
			/* @__PURE__ */ d("path", {
				d: "M10 10.5h4m-4 3h4",
				stroke: "#f7f3ff",
				strokeWidth: "1.6",
				strokeLinecap: "round"
			})
		] })
	});
}
function ni(e) {
	return /* @__PURE__ */ d(Yr, {
		...e,
		viewBox: "0 0 96 96",
		children: (e) => /* @__PURE__ */ f(u, { children: [
			/* @__PURE__ */ f("defs", { children: [/* @__PURE__ */ f("linearGradient", {
				id: `${e}-shell`,
				x1: "0",
				y1: "0",
				x2: "1",
				y2: "1",
				children: [/* @__PURE__ */ d("stop", {
					offset: "0",
					stopColor: "#554064"
				}), /* @__PURE__ */ d("stop", {
					offset: "1",
					stopColor: "#21172d"
				})]
			}), /* @__PURE__ */ f("radialGradient", {
				id: `${e}-core`,
				children: [/* @__PURE__ */ d("stop", {
					offset: "0",
					stopColor: "#fff2b8"
				}), /* @__PURE__ */ d("stop", {
					offset: "1",
					stopColor: "#e78b4f"
				})]
			})] }),
			/* @__PURE__ */ d("ellipse", {
				cx: "48",
				cy: "78",
				rx: "30",
				ry: "8",
				fill: "#120c19",
				opacity: ".4"
			}),
			/* @__PURE__ */ d("path", {
				d: "m25 68-12 8m16-19-15-3m57 14 12 8M67 57l15-3M34 72l-9 11m37-11 9 11",
				fill: "none",
				stroke: "#2b1e36",
				strokeWidth: "7",
				strokeLinecap: "round"
			}),
			/* @__PURE__ */ d("path", {
				d: "M22 58c0-21 12-35 26-35s26 14 26 35c0 13-10 22-26 22S22 71 22 58Z",
				fill: `url(#${e}-shell)`,
				stroke: "#6c5175",
				strokeWidth: "4"
			}),
			/* @__PURE__ */ d("path", {
				d: "m31 31-8-14 16 9m26 5 8-14-16 9",
				fill: "#3b2948",
				stroke: "#6c5175",
				strokeWidth: "3",
				strokeLinejoin: "round"
			}),
			/* @__PURE__ */ d("path", {
				d: "M48 43c9 0 15 8 10 16-2 4-6 8-10 12-4-4-8-8-10-12-5-8 1-16 10-16Z",
				fill: `url(#${e}-core)`
			}),
			/* @__PURE__ */ d("circle", {
				cx: "37",
				cy: "39",
				r: "3",
				fill: "#d8cced"
			}),
			/* @__PURE__ */ d("circle", {
				cx: "59",
				cy: "39",
				r: "3",
				fill: "#d8cced"
			})
		] })
	});
}
function ri(e) {
	return /* @__PURE__ */ d(Yr, {
		...e,
		viewBox: "0 0 160 140",
		children: (e) => /* @__PURE__ */ f(u, { children: [
			/* @__PURE__ */ f("defs", { children: [/* @__PURE__ */ f("linearGradient", {
				id: `${e}-shell`,
				x1: "0",
				y1: "0",
				x2: "1",
				y2: "1",
				children: [/* @__PURE__ */ d("stop", {
					offset: "0",
					stopColor: "#684c72"
				}), /* @__PURE__ */ d("stop", {
					offset: "1",
					stopColor: "#25182f"
				})]
			}), /* @__PURE__ */ f("radialGradient", {
				id: `${e}-core`,
				children: [
					/* @__PURE__ */ d("stop", {
						offset: "0",
						stopColor: "#fff1a8"
					}),
					/* @__PURE__ */ d("stop", {
						offset: ".65",
						stopColor: "#e7884f"
					}),
					/* @__PURE__ */ d("stop", {
						offset: "1",
						stopColor: "#893c45"
					})
				]
			})] }),
			/* @__PURE__ */ d("ellipse", {
				cx: "80",
				cy: "120",
				rx: "58",
				ry: "13",
				fill: "#120b18",
				opacity: ".45"
			}),
			/* @__PURE__ */ d("path", {
				d: "m39 98-17 22m42-14-8 22m65-30 17 22m-42-14 8 22",
				fill: "none",
				stroke: "#281a31",
				strokeWidth: "13",
				strokeLinecap: "round"
			}),
			/* @__PURE__ */ d("path", {
				d: "M28 80c0-31 21-52 52-52s52 21 52 52c0 26-21 39-52 39S28 106 28 80Z",
				fill: `url(#${e}-shell)`,
				stroke: "#76577d",
				strokeWidth: "5"
			}),
			/* @__PURE__ */ d("path", {
				d: "m45 44-14-28 30 18 19-25 19 25 30-18-14 28-35 10Z",
				fill: "#3b2947",
				stroke: "#76577d",
				strokeWidth: "4",
				strokeLinejoin: "round"
			}),
			/* @__PURE__ */ d("path", {
				d: "M49 62 80 45l31 17-8 36H57Z",
				fill: "#31203c",
				stroke: "#7f5a78",
				strokeWidth: "4",
				strokeLinejoin: "round"
			}),
			/* @__PURE__ */ d("path", {
				d: "m80 62 15 15-15 27-15-27Z",
				fill: `url(#${e}-core)`
			}),
			/* @__PURE__ */ d("path", {
				d: "m36 75-20-10 12 24m96-14 20-10-12 24",
				fill: "#4a3457",
				stroke: "#76577d",
				strokeWidth: "4",
				strokeLinejoin: "round"
			}),
			/* @__PURE__ */ d("circle", {
				cx: "55",
				cy: "57",
				r: "4",
				fill: "#d9cbed"
			}),
			/* @__PURE__ */ d("circle", {
				cx: "105",
				cy: "57",
				r: "4",
				fill: "#d9cbed"
			})
		] })
	});
}
function ii(e) {
	return /* @__PURE__ */ d(Yr, {
		...e,
		viewBox: "0 0 160 160",
		children: (e) => /* @__PURE__ */ f(u, { children: [
			/* @__PURE__ */ f("defs", { children: [/* @__PURE__ */ f("linearGradient", {
				id: `${e}-stone`,
				x1: "0",
				y1: "0",
				x2: "0.8",
				y2: "1",
				children: [/* @__PURE__ */ d("stop", {
					offset: "0",
					stopColor: "#f1eaff"
				}), /* @__PURE__ */ d("stop", {
					offset: "1",
					stopColor: "#9c8ab9"
				})]
			}), /* @__PURE__ */ f("linearGradient", {
				id: `${e}-light`,
				x1: "0",
				y1: "0",
				x2: "0",
				y2: "1",
				children: [/* @__PURE__ */ d("stop", {
					offset: "0",
					stopColor: "#d8c8ff"
				}), /* @__PURE__ */ d("stop", {
					offset: "1",
					stopColor: "#8065bd"
				})]
			})] }),
			/* @__PURE__ */ d("ellipse", {
				cx: "80",
				cy: "137",
				rx: "54",
				ry: "14",
				fill: "#171022",
				opacity: ".35"
			}),
			/* @__PURE__ */ d("path", {
				d: "M34 126 43 65 80 34l37 31 9 61-17 10H51Z",
				fill: `url(#${e}-stone)`,
				stroke: "#5d4d78",
				strokeWidth: "4",
				strokeLinejoin: "round"
			}),
			/* @__PURE__ */ d("path", {
				d: "M53 66 80 43l27 23-6 8H59Z",
				fill: "#c7b9db"
			}),
			/* @__PURE__ */ d("path", {
				d: "M62 128V91c0-13 8-22 18-22s18 9 18 22v37Z",
				fill: "#39284f",
				stroke: "#655080",
				strokeWidth: "3"
			}),
			/* @__PURE__ */ d("path", {
				d: "M69 126V93c0-8 5-14 11-14s11 6 11 14v33Z",
				fill: `url(#${e}-light)`
			}),
			/* @__PURE__ */ d("path", {
				d: "M43 73h18v58H39Zm56 0h18l4 58h-22Z",
				fill: "#b8a8ce",
				stroke: "#65547d",
				strokeWidth: "3",
				strokeLinejoin: "round"
			}),
			/* @__PURE__ */ d("path", {
				d: "M36 127h88l-9 12H46Z",
				fill: "#79658f",
				stroke: "#514166",
				strokeWidth: "3",
				strokeLinejoin: "round"
			}),
			/* @__PURE__ */ d("circle", {
				cx: "80",
				cy: "55",
				r: "5",
				fill: "#b49aff"
			})
		] })
	});
}
function ai(e) {
	return /* @__PURE__ */ d(Yr, {
		...e,
		viewBox: "0 0 160 160",
		children: (e) => /* @__PURE__ */ f(u, { children: [
			/* @__PURE__ */ f("defs", { children: [/* @__PURE__ */ f("linearGradient", {
				id: `${e}-shell`,
				x1: "0",
				y1: "0",
				x2: "1",
				y2: "1",
				children: [/* @__PURE__ */ d("stop", {
					offset: "0",
					stopColor: "#49345f"
				}), /* @__PURE__ */ d("stop", {
					offset: "1",
					stopColor: "#21172e"
				})]
			}), /* @__PURE__ */ f("radialGradient", {
				id: `${e}-core`,
				children: [
					/* @__PURE__ */ d("stop", {
						offset: "0",
						stopColor: "#fff0b0"
					}),
					/* @__PURE__ */ d("stop", {
						offset: ".55",
						stopColor: "#ffb45f"
					}),
					/* @__PURE__ */ d("stop", {
						offset: "1",
						stopColor: "#b84d45"
					})
				]
			})] }),
			/* @__PURE__ */ d("ellipse", {
				cx: "80",
				cy: "137",
				rx: "57",
				ry: "14",
				fill: "#120b1c",
				opacity: ".45"
			}),
			/* @__PURE__ */ d("path", {
				d: "m28 128 13-67 24 12L80 27l15 46 24-12 13 67-20 12H48Z",
				fill: `url(#${e}-shell)`,
				stroke: "#6e526f",
				strokeWidth: "4",
				strokeLinejoin: "round"
			}),
			/* @__PURE__ */ d("path", {
				d: "m41 61 8-28 18 37-15 13Zm78 0-8-28-18 37 15 13Z",
				fill: "#594066",
				stroke: "#8a6175",
				strokeWidth: "3",
				strokeLinejoin: "round"
			}),
			/* @__PURE__ */ d("path", {
				d: "M60 130V91l20-18 20 18v39Z",
				fill: "#1a1226",
				stroke: "#805266",
				strokeWidth: "3"
			}),
			/* @__PURE__ */ d("path", {
				d: "m80 88 12 14-12 23-12-23Z",
				fill: `url(#${e}-core)`
			}),
			/* @__PURE__ */ d("path", {
				d: "m30 128 28-6 22 14 22-14 30 6-17 13H45Z",
				fill: "#33223f",
				stroke: "#66465b",
				strokeWidth: "3",
				strokeLinejoin: "round"
			}),
			/* @__PURE__ */ d("path", {
				d: "m78 29 5 22-7 14 5 12",
				fill: "none",
				stroke: "#b27772",
				strokeWidth: "3",
				strokeLinecap: "round"
			})
		] })
	});
}
function oi(e) {
	return /* @__PURE__ */ d(Yr, {
		...e,
		viewBox: "0 0 100 100",
		children: (e) => /* @__PURE__ */ f(u, { children: [
			/* @__PURE__ */ d("defs", { children: /* @__PURE__ */ f("linearGradient", {
				id: `${e}-stone`,
				x1: "0",
				y1: "0",
				x2: "1",
				y2: "1",
				children: [/* @__PURE__ */ d("stop", {
					offset: "0",
					stopColor: "#b9abd0"
				}), /* @__PURE__ */ d("stop", {
					offset: "1",
					stopColor: "#564568"
				})]
			}) }),
			/* @__PURE__ */ d("ellipse", {
				cx: "50",
				cy: "73",
				rx: "37",
				ry: "15",
				fill: "#191123",
				opacity: ".35"
			}),
			/* @__PURE__ */ d("ellipse", {
				cx: "50",
				cy: "68",
				rx: "34",
				ry: "13",
				fill: "none",
				stroke: "#a889db",
				strokeWidth: "5"
			}),
			/* @__PURE__ */ d("path", {
				d: "m31 67 8-24 14 7-2 21Zm22 4-2-30 15-8 8 34-9 8Z",
				fill: `url(#${e}-stone)`,
				stroke: "#574568",
				strokeWidth: "3",
				strokeLinejoin: "round"
			}),
			/* @__PURE__ */ d("path", {
				d: "m43 62 7-11 8 10-7 10Z",
				fill: "#d5c5ff"
			}),
			/* @__PURE__ */ d("circle", {
				cx: "18",
				cy: "60",
				r: "4",
				fill: "#88dde6"
			}),
			/* @__PURE__ */ d("circle", {
				cx: "82",
				cy: "58",
				r: "4",
				fill: "#ffd080"
			})
		] })
	});
}
// ui/src/arena/AnimatedMinion.tsx
var si = {
	patchling: {
		idle: 1650,
		engaged: 1100,
		hit: 320,
		attack: Jr.patchling.attack,
		defeat: 650
	},
	patchbrute: {
		idle: 2200,
		engaged: 1400,
		hit: 420,
		attack: Jr.patchbrute.attack,
		defeat: 900
	}
};
function ci({ minionType: e }) {
	return /* @__PURE__ */ f("span", {
		className: `sa-minion-impact sa-minion-impact--${e}`,
		"aria-hidden": "true",
		children: [
			/* @__PURE__ */ d("i", { className: "sa-minion-impact__flash" }),
			/* @__PURE__ */ d("i", { className: "sa-minion-impact__chip sa-minion-impact__chip--one" }),
			/* @__PURE__ */ d("i", { className: "sa-minion-impact__chip sa-minion-impact__chip--two" })
		]
	});
}
function li({ minionType: e }) {
	return /* @__PURE__ */ f("span", {
		className: `sa-minion-collapse sa-minion-collapse--${e}`,
		"aria-hidden": "true",
		children: [
			/* @__PURE__ */ d("i", { className: "sa-minion-collapse__dust" }),
			/* @__PURE__ */ d("i", { className: "sa-minion-collapse__mote sa-minion-collapse__mote--one" }),
			/* @__PURE__ */ d("i", { className: "sa-minion-collapse__mote sa-minion-collapse__mote--two" })
		]
	});
}
function ui({ minionType: e, animation: t, animate: n, spriteReady: r, defeated: a = !1, facing: o = "left", requestId: s = 0, recoil: l = 1, strong: u = !1, lunge: p = 1, onAnimationComplete: m }) {
	let h = c(m);
	h.current = m;
	let g = t === "hit" || t === "attack" || t === "defeat";
	i(() => {
		if (!g) return;
		if (!n) {
			h.current?.(s);
			return;
		}
		let r = window.setTimeout(() => h.current?.(s), si[e][t]);
		return () => window.clearTimeout(r);
	}, [
		g,
		n,
		t,
		e,
		s
	]);
	let _ = [
		"sa-minion",
		`sa-minion--${e}`,
		`sa-is-${t}`,
		n ? "sa-is-animated" : "sa-is-static"
	];
	a && _.push("sa-is-defeated"), t === "hit" && u && _.push("sa-is-strong");
	let v = t === "hit" ? {
		"--sa-recoil": l,
		"--sa-recoil-mag": u ? 1.8 : 1
	} : t === "attack" ? { "--sa-lunge": p } : void 0;
	return /* @__PURE__ */ f("span", {
		className: _.join(" "),
		style: v,
		"data-minion": e,
		"data-facing": o,
		"aria-hidden": "true",
		children: [
			r ? /* @__PURE__ */ d("span", { className: "sa-minion__art" }) : d(e === "patchbrute" ? ri : ni, {
				title: "",
				decorative: !0,
				className: "sa-minion__fallback"
			}),
			t === "hit" && /* @__PURE__ */ d(ci, { minionType: e }),
			t === "defeat" && /* @__PURE__ */ d(li, { minionType: e })
		]
	}, `${t}:${s}`);
}
// ui/src/arena/HeroEffects.tsx
var di = ({ root: e, names: t }) => /* @__PURE__ */ d(u, { children: t.map((t) => /* @__PURE__ */ d("i", { className: `sa-fx-${e}__${t}` }, t)) }), fi = ({ name: e, children: t }) => /* @__PURE__ */ d("span", {
	className: `sa-fx-${e} sa-fx-directional`,
	"aria-hidden": "true",
	children: t
}), pi = ({ name: e, children: t }) => /* @__PURE__ */ d("span", {
	className: `sa-fx-${e}`,
	"aria-hidden": "true",
	children: t
}), mi = ({ box: e, paths: t }) => /* @__PURE__ */ d("svg", {
	viewBox: e,
	children: t.map(([e, t]) => /* @__PURE__ */ d("path", {
		className: e,
		d: t
	}, e))
}), hi = (e) => ({ "--sa-spore-index": e });
function gi({ heroId: e }) {
	switch (e) {
		case "reeve": return /* @__PURE__ */ d(fi, {
			name: "reeve-slash",
			children: /* @__PURE__ */ d(mi, {
				box: "0 0 72 52",
				paths: [["sa-fx-reeve-slash__trail", "M9 43 Q34 4 65 13"], ["sa-fx-reeve-slash__edge", "M16 45 Q39 10 66 17"]]
			})
		});
		case "vell": return /* @__PURE__ */ d(fi, {
			name: "vell-wave",
			children: /* @__PURE__ */ d(mi, {
				box: "0 0 76 54",
				paths: [["sa-fx-vell-wave__trail", "M8 44 Q30 5 69 17 Q44 23 25 49"], ["sa-fx-vell-wave__edge", "M13 45 Q34 11 67 19"]]
			})
		});
		case "stitch": return /* @__PURE__ */ d(fi, {
			name: "stitch-shockwave",
			children: /* @__PURE__ */ d(mi, {
				box: "0 0 78 42",
				paths: [["sa-fx-stitch-shockwave__arc", "M7 34 Q39 4 71 34"], ["sa-fx-stitch-shockwave__marks", "M25 24l-3-5M39 18v-6M53 24l3-5"]]
			})
		});
		case "poly": return /* @__PURE__ */ d(fi, {
			name: "poly-beam",
			children: /* @__PURE__ */ d(di, {
				root: "poly-beam",
				names: ["glow", "core"]
			})
		});
		case "rattle": return /* @__PURE__ */ f(fi, {
			name: "rattle-impact",
			children: [/* @__PURE__ */ d("i", { className: "sa-fx-rattle-impact__burst" }), [
				"one",
				"two",
				"three"
			].map((e) => /* @__PURE__ */ d("i", { className: `sa-fx-rattle-impact__bone sa-fx-rattle-impact__bone--${e}` }, e))]
		});
		case "ember": return /* @__PURE__ */ d(fi, {
			name: "ember-bolt",
			children: /* @__PURE__ */ d(di, {
				root: "ember-bolt",
				names: ["trail", "orb"]
			})
		});
		case "shard": return /* @__PURE__ */ d(fi, {
			name: "shard-volley",
			children: [
				"one",
				"two",
				"three"
			].map((e) => /* @__PURE__ */ d("i", { className: `sa-fx-shard-volley__projectile sa-fx-shard-volley__projectile--${e}` }, e))
		});
		case "tide": return /* @__PURE__ */ f(fi, {
			name: "tide-lash",
			children: [/* @__PURE__ */ d(mi, {
				box: "0 0 76 48",
				paths: [["sa-fx-tide-lash__trail", "M8 38 Q35 3 69 18 Q47 19 22 43"], ["sa-fx-tide-lash__edge", "M12 39 Q38 9 68 20"]]
			}), [
				"one",
				"two",
				"three"
			].map((e) => /* @__PURE__ */ d("i", { className: `sa-fx-tide-lash__drop sa-fx-tide-lash__drop--${e}` }, e))]
		});
		case "lume": return /* @__PURE__ */ d(fi, {
			name: "lume-burst",
			children: /* @__PURE__ */ d(di, {
				root: "lume-burst",
				names: ["cone", "core"]
			})
		});
		case "moss": return /* @__PURE__ */ d(fi, {
			name: "moss-puff",
			children: Array.from({ length: 5 }, (e, t) => /* @__PURE__ */ d("i", { style: hi(t) }, t))
		});
		case "bur": return /* @__PURE__ */ f(fi, {
			name: "bur-frost-impact",
			children: [/* @__PURE__ */ d("i", { className: "sa-fx-bur-frost-impact__crescent" }), [
				"one",
				"two",
				"three",
				"four"
			].map((e) => /* @__PURE__ */ d("i", { className: `sa-fx-bur-frost-impact__chunk sa-fx-bur-frost-impact__chunk--${e}` }, e))]
		});
		default: return null;
	}
}
var J = (e, t, n) => n.map((n) => /* @__PURE__ */ d("i", { className: `sa-fx-${e}__${t} sa-fx-${e}__${t}--${n}` }, `${t}-${n}`));
function _i({ heroId: e }) {
	switch (e) {
		case "reeve": return /* @__PURE__ */ f(pi, {
			name: "reeve-aura",
			children: [J("reeve-aura", "ring", ["outer", "inner"]), J("reeve-aura", "mote", [
				"one",
				"two",
				"three"
			])]
		});
		case "vell": return /* @__PURE__ */ f(pi, {
			name: "vell-ward",
			children: [/* @__PURE__ */ d("i", { className: "sa-fx-vell-ward__clasp" }), J("vell-ward", "ring", ["outer", "inner"])]
		});
		case "stitch": return /* @__PURE__ */ f(pi, {
			name: "stitch-rewire",
			children: [
				J("stitch-rewire", "arc", ["left", "right"]),
				J("stitch-rewire", "particle", [
					"one",
					"two",
					"three"
				]),
				/* @__PURE__ */ d("i", { className: "sa-fx-stitch-rewire__ring" })
			]
		});
		case "poly": return /* @__PURE__ */ f(pi, {
			name: "poly-scan",
			children: [
				/* @__PURE__ */ d("i", { className: "sa-fx-poly-scan__eye" }),
				J("poly-scan", "ring", ["one", "two"]),
				J("poly-scan", "ray", [
					"one",
					"two",
					"three"
				])
			]
		});
		case "rattle": return /* @__PURE__ */ f(pi, {
			name: "rattle-resonance",
			children: [
				J("rattle-resonance", "rib", ["left", "right"]),
				J("rattle-resonance", "ring", ["one", "two"]),
				J("rattle-resonance", "mote", [
					"one",
					"two",
					"three"
				])
			]
		});
		case "ember": return /* @__PURE__ */ f(pi, {
			name: "ember-flare",
			children: [/* @__PURE__ */ d("i", { className: "sa-fx-ember-flare__aura" }), J("ember-flare", "mote", [
				"one",
				"two",
				"three"
			])]
		});
		case "shard": return /* @__PURE__ */ f(pi, {
			name: "shard-prism",
			children: [
				J("shard-prism", "glint", ["one", "two"]),
				/* @__PURE__ */ d("i", { className: "sa-fx-shard-prism__ring" }),
				J("shard-prism", "ray", [
					"one",
					"two",
					"three",
					"four"
				])
			]
		});
		case "tide": return /* @__PURE__ */ f(pi, {
			name: "tide-undertow",
			children: [/* @__PURE__ */ d(di, {
				root: "tide-undertow",
				names: ["ripple", "wave"]
			}), J("tide-undertow", "bubble", [
				"one",
				"two",
				"three",
				"four"
			])]
		});
		case "lume": return /* @__PURE__ */ f(pi, {
			name: "lume-beacon",
			children: [/* @__PURE__ */ d(di, {
				root: "lume-beacon",
				names: ["halo", "ring"]
			}), J("lume-beacon", "mote", [
				"one",
				"two",
				"three",
				"four"
			])]
		});
		case "moss": return /* @__PURE__ */ f(pi, {
			name: "moss-bloom",
			children: [
				/* @__PURE__ */ d("i", { className: "sa-fx-moss-bloom__ring" }),
				J("moss-bloom", "tendril", ["one", "two"]),
				Array.from({ length: 5 }, (e, t) => /* @__PURE__ */ d("i", {
					className: "sa-fx-moss-bloom__spore",
					style: {
						"--sa-spore-index": t,
						"--sa-spore-left": `${20 + t * 14}%`,
						"--sa-spore-top": `${t % 2 ? 73 : 55}%`
					}
				}, t))
			]
		});
		case "bur": return /* @__PURE__ */ f(pi, {
			name: "bur-avalanche",
			children: [/* @__PURE__ */ d(di, {
				root: "bur-avalanche",
				names: [
					"mist",
					"wave",
					"sparkle"
				]
			}), J("bur-avalanche", "flake", [
				"one",
				"two",
				"three",
				"four"
			])]
		});
		default: return null;
	}
}
// ui/src/arena/AnimatedSpecter.tsx
var vi = 44;
function yi({ heroId: e, animate: t, initials: n, animation: r = "idle", angle: i = 0, flip: a = 1 }) {
	let o = nn(rn(e));
	if (o.status !== "ready") return /* @__PURE__ */ d("span", {
		className: "sa-token__placeholder",
		"aria-hidden": "true",
		"data-initials": n
	});
	let [s, c] = fn(e), l = t && r !== "idle" && Wr(e) !== null ? r : "idle", u = {
		"--sa-ax": s,
		"--sa-idle-ms": `${pn(e)}ms`,
		"--sa-flinch": -a,
		transformOrigin: `${(s * 100).toFixed(2)}% ${(c * 100).toFixed(2)}%`
	}, p = {
		"--sa-fx-angle": `${i.toFixed(1)}deg`,
		"--sa-fx-flip": a
	};
	return /* @__PURE__ */ f("span", {
		className: `sa-hero sa-hero--${e} sa-is-${l} ${t ? "sa-is-animated" : "sa-is-static"}`,
		"aria-hidden": "true",
		"data-hero": e,
		"data-animation": l,
		style: u,
		children: [/* @__PURE__ */ d("img", {
			className: "sa-hero__img",
			src: o.art.url,
			alt: "",
			width: vi,
			height: vi,
			draggable: !1
		}), (l === "attack" || l === "cast") && /* @__PURE__ */ d("span", {
			className: "sa-hero__fx",
			style: p,
			children: d(l === "attack" ? gi : _i, { heroId: e })
		})]
	});
}
var bi = 2500, xi = () => ({
	nextId: 1,
	due: /* @__PURE__ */ new Map(),
	active: [],
	enemyFreeAtMs: /* @__PURE__ */ new Map()
});
function Si(e) {
	let t = 2166136261;
	for (let n = 0; n < e.length; n += 1) t ^= e.charCodeAt(n), t = Math.imul(t, 16777619);
	return t >>> 0 || 1;
}
function Ci(e) {
	return Math.imul(e >>> 0, 1664525) + 1013904223 >>> 0;
}
var wi = (e) => bi + Math.floor(e / 4294967296 * 1501), Ti = (e) => e === "encounter" ? "patchbrute" : "patchling";
function Ei(e) {
	let t = new Map(e.enemies.filter((e) => !e.defeated).map((e) => [e.workId, e])), n = [];
	for (let r of e.specters) if (r.condition === "working" && r.heroId !== null && Wr(r.heroId) !== null) for (let e of r.engagedWorkIds) {
		let i = t.get(e);
		i !== void 0 && n.push({
			key: `${r.bindingId}:${e}`,
			bindingId: r.bindingId,
			heroId: r.heroId,
			workId: e,
			minionType: Ti(i.size)
		});
	}
	return n;
}
var Di = (e) => ({
	pairs: Ei(e),
	liveWorkIds: new Set(e.enemies.filter((e) => !e.defeated).map((e) => e.workId))
}), Oi = (e) => e.filter((e) => e.kind !== "recoil").length;
function ki(e, t, n, r, i, a, o) {
	let s = n === null ? null : Wr(n.heroId), c = s === null ? 0 : t === "cast" ? s.cast : s.attack, l = s === null ? 280 : t === "cast" ? s.castImpact : s.attackImpact, u = a + l + si[i].hit, d = u + 120, f = d + Jr[i].impact, p = d + Jr[i].attack, m = f + 360, h = s !== null;
	return {
		id: e,
		kind: s === null ? "recoil" : t,
		bindingId: s === null ? null : n?.bindingId ?? null,
		heroId: s === null ? null : n?.heroId ?? null,
		workId: r,
		minionType: i,
		startMs: a,
		impactMs: a + l,
		heroEndMs: a + c,
		hitEndMs: u,
		counterStartMs: h ? d : u,
		counterImpactMs: h ? f : u,
		counterEndMs: h ? p : u,
		flinchEndMs: h ? m : u,
		endMs: h ? Math.max(p, m) : u,
		strong: o
	};
}
function Ai(e, t, n) {
	let r = new Set(t.pairs.map((e) => e.key)), i = new Set(t.pairs.map((e) => e.bindingId)), a = e.active.filter((e) => e.endMs > n && t.liveWorkIds.has(e.workId) && (e.bindingId === null || i.has(e.bindingId)) && (e.kind === "recoil" || r.has(`${e.bindingId}:${e.workId}`))), o = new Map(e.enemyFreeAtMs);
	for (let t of e.active) a.includes(t) || o.set(t.workId, Math.max(o.get(t.workId) ?? 0, Math.min(t.endMs, n) + 300));
	let s = /* @__PURE__ */ new Map();
	for (let r of t.pairs) {
		let t = e.due.get(r.key);
		if (t !== void 0) s.set(r.key, t);
		else {
			let e = Ci(Si(r.key));
			s.set(r.key, {
				atMs: n + wi(e),
				seed: e
			});
		}
	}
	return {
		nextId: e.nextId,
		due: s,
		active: a,
		enemyFreeAtMs: o
	};
}
function ji(e, t, n) {
	let r = Ai(e, t, n), i = new Map(r.due), a = new Map(r.enemyFreeAtMs), o = [...r.active], s = r.nextId, c = new Map(t.pairs.map((e) => [e.key, e])), l = [...i.entries()].filter(([, e]) => e.atMs <= n).sort((e, t) => e[1].atMs - t[1].atMs || (e[0] < t[0] ? -1 : 1));
	for (let [e, t] of l) {
		let r = c.get(e);
		if (r === void 0) continue;
		let l = Math.max(a.get(r.workId) ?? 0, ...o.filter((e) => e.workId === r.workId).map((e) => e.endMs + 300)), u = Math.max(0, ...o.filter((e) => e.bindingId === r.bindingId).map((e) => e.flinchEndMs));
		if (l > n || u > n) {
			i.set(e, {
				atMs: Math.max(l, u, n + 1),
				seed: t.seed
			});
			continue;
		}
		if (Oi(o) >= 8) {
			let r = Ci(t.seed);
			i.set(e, {
				atMs: n + wi(r),
				seed: r
			});
			continue;
		}
		let d = ki(s, "attack", r, r.workId, r.minionType, n, !1);
		s += 1, o = [...o, d];
		let f = Ci(t.seed);
		i.set(e, {
			atMs: d.heroEndMs + wi(f),
			seed: f
		});
	}
	return r = {
		nextId: s,
		due: i,
		active: o,
		enemyFreeAtMs: a
	}, {
		state: r,
		nextWakeMs: Mi(r, n)
	};
}
function Mi(e, t) {
	let n = [];
	for (let t of e.due.values()) n.push(t.atMs);
	for (let t of e.active) n.push(t.heroEndMs, t.impactMs, t.hitEndMs, t.counterStartMs, t.counterImpactMs, t.counterEndMs, t.flinchEndMs, t.endMs);
	let r = n.filter((e) => e > t);
	return r.length === 0 ? null : Math.min(...r);
}
function Ni(e, t, n, r) {
	let i = Ai(e, t, r);
	if (!t.liveWorkIds.has(n)) return i;
	let a = t.pairs.filter((e) => e.workId === n).sort((e, t) => e.bindingId < t.bindingId ? -1 : +(e.bindingId > t.bindingId)), o = i.active.filter((e) => e.workId !== n), s = a.find((e) => !o.some((t) => t.bindingId === e.bindingId && t.flinchEndMs > r)), c = s !== void 0 && Oi(o) < 8 ? "cast" : "recoil", l = a[0]?.minionType ?? "patchling", u = ki(i.nextId, c, c === "cast" ? s ?? null : null, n, l, r, !0), d = new Map(i.due);
	return c === "cast" && s !== void 0 && d.set(s.key, {
		atMs: u.heroEndMs + wi(Ci(i.due.get(s.key)?.seed ?? Si(s.key))),
		seed: Ci(i.due.get(s.key)?.seed ?? Si(s.key))
	}), {
		nextId: i.nextId + 1,
		due: d,
		active: [...o, u],
		enemyFreeAtMs: i.enemyFreeAtMs
	};
}
var Pi = {
	heroes: /* @__PURE__ */ new Map(),
	enemies: /* @__PURE__ */ new Map(),
	counters: /* @__PURE__ */ new Map(),
	flinches: /* @__PURE__ */ new Map(),
	layers: 0
};
function Fi(e, t) {
	let n = /* @__PURE__ */ new Map(), r = /* @__PURE__ */ new Map(), i = /* @__PURE__ */ new Map(), a = /* @__PURE__ */ new Map(), o = 0;
	for (let s of e.active) s.kind !== "recoil" && s.bindingId !== null && t >= s.startMs && t < s.heroEndMs && (n.set(s.bindingId, {
		exchangeId: s.id,
		kind: s.kind,
		workId: s.workId
	}), o += 1), t >= s.impactMs && t < s.hitEndMs && r.set(s.workId, {
		exchangeId: s.id,
		strong: s.strong,
		bindingId: s.bindingId
	}), s.kind !== "recoil" && s.bindingId !== null && (t >= s.counterStartMs && t < s.counterEndMs && i.set(s.workId, {
		exchangeId: s.id,
		bindingId: s.bindingId
	}), t >= s.counterImpactMs && t < s.flinchEndMs && a.set(s.bindingId, {
		exchangeId: s.id,
		workId: s.workId
	}));
	return {
		heroes: n,
		enemies: r,
		counters: i,
		flinches: a,
		layers: o
	};
}
var Ii = (e) => [...e.heroes].map(([e, t]) => `h${e}=${t.exchangeId}`).join(",") + "|" + [...e.enemies].map(([e, t]) => `e${e}=${t.exchangeId}`).join(",") + "|" + [...e.counters].map(([e, t]) => `c${e}=${t.exchangeId}`).join(",") + "|" + [...e.flinches].map(([e, t]) => `f${e}=${t.exchangeId}`).join(","), Li = "practice-hero", Ri = "practice-target";
function zi(e, t, r) {
	let [a, o] = l(null), [s, u] = l(Pi), d = c(1);
	i(() => {
		o(null), u(Pi);
	}, [e, r]), i(() => {
		if (a === null) return;
		let e = {
			...xi(),
			active: [a]
		}, t, n = () => {
			let r = Date.now();
			if (r >= a.endMs) {
				u(Pi), o(null);
				return;
			}
			u(Fi(e, r));
			let i = [
				a.impactMs,
				a.heroEndMs,
				a.hitEndMs,
				a.counterStartMs,
				a.counterImpactMs,
				a.counterEndMs,
				a.flinchEndMs,
				a.endMs
			], s = Math.min(...i.filter((e) => e > r));
			t = window.setTimeout(n, Math.max(0, s - Date.now()));
		};
		return n(), () => window.clearTimeout(t);
	}, [a]);
	let f = n((n) => {
		if (!r || e === void 0 || a !== null || Wr(e) === null) return;
		let i = d.current;
		d.current += 1, o(ki(i, n, {
			key: `${Li}:${Ri}`,
			bindingId: Li,
			heroId: e,
			workId: Ri,
			minionType: t
		}, Ri, t, Date.now(), n === "cast"));
	}, [
		r,
		e,
		a,
		t
	]);
	return {
		snapshot: s,
		playing: a !== null,
		play: f
	};
}
// ui/src/specters/avatarPack.ts
var Bi = "https://github.com/burlabs/specter-arena/blob/main/avatar-packs/packs/", Vi = (e) => `${Bi}specters-${encodeURIComponent(e)}.pack.json`, Hi = 2.5, Ui = (e, t, n) => Math.min(n, Math.max(t, e));
function Wi(e, t, n = 1, r = {
	x: 0,
	y: 0
}) {
	if (![
		e.width,
		e.height,
		t.width,
		t.height
	].every((e) => Number.isFinite(e) && e > 0)) throw Error("Viewport and intrinsic dimensions must be finite and greater than zero.");
	let i = Ui(n, 1, Hi), a = Math.min(e.width / t.width, e.height / t.height), o = a * i, s = {
		width: t.width * o,
		height: t.height * o
	}, c = {
		x: (e.width - s.width) / 2,
		y: (e.height - s.height) / 2
	}, l = {
		x: Math.max(0, (s.width - e.width) / 2),
		y: Math.max(0, (s.height - e.height) / 2)
	};
	return {
		viewport: e,
		intrinsic: t,
		zoom: i,
		fitScale: a,
		scale: o,
		offset: c,
		pan: {
			x: Ui(r.x, -l.x, l.x),
			y: Ui(r.y, -l.y, l.y)
		},
		displayed: s
	};
}
function Gi(e, t) {
	return {
		x: (e.x - t.offset.x - t.pan.x) / (t.intrinsic.width * t.scale),
		y: (e.y - t.offset.y - t.pan.y) / (t.intrinsic.height * t.scale)
	};
}
function Ki(e) {
	let t = Gi({
		x: 0,
		y: 0
	}, e), n = Gi({
		x: e.viewport.width,
		y: e.viewport.height
	}, e), r = Ui(t.x, 0, 1), i = Ui(t.y, 0, 1), a = Ui(n.x, 0, 1), o = Ui(n.y, 0, 1);
	return {
		x: r,
		y: i,
		width: Math.max(0, a - r),
		height: Math.max(0, o - i)
	};
}
// ui/src/arena/mapLayout.ts
var qi = {
	width: 1672,
	height: 941
}, Ji = {
	alliedBase: {
		id: "allied-base",
		x: .16208133971291866,
		y: .711996,
		label: "Allied base"
	},
	farBase: {
		id: "far-base",
		x: .8205741626794258,
		y: .1594048884165781,
		label: "Far base"
	},
	paths: [
		{
			id: "path-1",
			points: [
				{
					x: .24043062200956938,
					y: .6354941551540914
				},
				{
					x: .17763157894736842,
					y: .5217853347502657
				},
				{
					x: .2326555023923445,
					y: .38575982996811903
				},
				{
					x: .42105263157894735,
					y: .27948990435706694
				},
				{
					x: .5927033492822966,
					y: .16046758767268862
				},
				{
					x: .7440191387559809,
					y: .18703506907545164
				}
			]
		},
		{
			id: "path-2",
			points: [
				{
					x: .24043062200956938,
					y: .6354941551540914
				},
				{
					x: .3576555023923445,
					y: .5429968119022317
				},
				{
					x: .520933014354067,
					y: .4197662061636557
				},
				{
					x: .6441387559808612,
					y: .3007438894792774
				},
				{
					x: .7440191387559809,
					y: .18703506907545164
				}
			]
		},
		{
			id: "path-3",
			points: [
				{
					x: .24043062200956938,
					y: .6354941551540914
				},
				{
					x: .4216507177033493,
					y: .7481402763018066
				},
				{
					x: .6046650717703349,
					y: .5589798087141339
				},
				{
					x: .7488038277511961,
					y: .5111583421891605
				},
				{
					x: .7864832535885168,
					y: .32201912858660997
				},
				{
					x: .7440191387559809,
					y: .18703506907545164
				}
			]
		}
	],
	clearings: [
		{
			id: "west-clearing",
			x: .32954545454545453,
			y: .4208289054197662,
			label: "West clearing"
		},
		{
			id: "east-clearing",
			x: .6644736842105263,
			y: .4570669500531349,
			label: "East clearing"
		},
		{
			id: "south-grove",
			x: .48086124401913877,
			y: .6365568544102019,
			label: "South grove"
		}
	],
	crossings: [
		{
			id: "upper-bridge",
			x: .42105263157894735,
			y: .27948990435706694,
			label: "Upper bridge"
		},
		{
			id: "central-bridge",
			x: .520933014354067,
			y: .4197662061636557,
			label: "Central bridge"
		},
		{
			id: "lower-bridge",
			x: .6046650717703349,
			y: .5589798087141339,
			label: "Lower bridge"
		}
	]
}, Yi = [
	"path-1",
	"path-2",
	"path-3",
	"clearings"
], Xi = qi.width, Zi = qi.height, Qi = (e) => ({
	x: e.x * Xi,
	y: e.y * Zi
}), $i = (e, t) => {
	let n = Math.hypot(e, t);
	return n === 0 ? {
		x: 1,
		y: 0
	} : {
		x: e / n,
		y: t / n
	};
};
function ea(e, t) {
	let n = t.map(Qi), r = [], i = 0;
	for (let e = 1; e < n.length; e += 1) {
		let t = n[e - 1], a = n[e];
		i += Math.hypot(a.x - t.x, a.y - t.y), r.push(i);
	}
	let a = [];
	for (let t = 110; t <= i - 110 + 1e-9; t += 160) {
		let i = r.findIndex((e) => e >= t);
		i === -1 && (i = r.length - 1);
		let o = n[i], s = n[i + 1], c = i === 0 ? 0 : r[i - 1], l = Ui((t - c) / (r[i] - c), 0, 1);
		a.push({
			point: {
				x: (o.x + (s.x - o.x) * l) / Xi,
				y: (o.y + (s.y - o.y) * l) / Zi
			},
			region: e,
			toward: $i(s.x - o.x, s.y - o.y)
		});
	}
	return a;
}
var ta = null;
function na() {
	if (ta !== null) return ta;
	let e = Qi(Ji.farBase), t = [], [n, r, i] = Ji.paths;
	t.push(...ea("path-1", n.points), ...ea("path-2", r.points), ...ea("path-3", i.points));
	for (let n of Ji.clearings) {
		let r = Qi(n);
		t.push({
			point: {
				x: n.x,
				y: n.y
			},
			region: "clearings",
			toward: $i(e.x - r.x, e.y - r.y)
		});
	}
	let a = t.filter((e) => e.region === "clearings");
	for (let e of t) e.region !== "clearings" && a.every((t) => Math.hypot(Qi(e.point).x - Qi(t.point).x, Qi(e.point).y - Qi(t.point).y) >= 105) && a.push(e);
	return ta = [...a.filter((e) => e.region !== "clearings"), ...a.filter((e) => e.region === "clearings")], ta;
}
var ra = [
	100,
	130,
	160,
	190,
	220,
	250
], ia = {
	left: -53,
	right: 53,
	top: -105,
	bottom: 25
}, aa = {
	left: -35,
	right: 35,
	top: -56,
	bottom: 14
}, oa = {
	min: .03,
	max: .97
}, sa = (e, t, n, r, i, a) => t + e.right <= i + r.left || i + r.right <= t + e.left || n + e.bottom <= a + r.top || a + r.bottom <= n + e.top, ca = (e, t) => sa(aa, 0, 0, aa, (t.x - e.x) * Xi, (t.y - e.y) * Zi), la = (e, t) => sa(ia, 0, 0, aa, (t.x - e.x) * Xi, (t.y - e.y) * Zi);
function ua(e, t) {
	let n = [], r = [], i = [0];
	for (let e = 15; e <= 90; e += 15) i.push(e, -e);
	for (let a of ra) for (let o of i) {
		let i = o * Math.PI / 180, s = (t.x * Math.cos(i) - t.y * Math.sin(i)) * a, c = (t.x * Math.sin(i) + t.y * Math.cos(i)) * a, l = {
			x: e.x + s / Xi,
			y: e.y + c / Zi
		};
		l.x >= oa.min && l.x <= oa.max && l.y >= oa.min && l.y <= oa.max && sa(ia, 0, 0, aa, s, c) && r.every((e) => sa(aa, e.x, e.y, aa, s, c)) && (n.push(l), r.push({
			x: s,
			y: c
		}));
	}
	return n;
}
var da = (e) => {
	let t = Qi(Ji.farBase), n = Qi(e);
	return $i(t.x - n.x, t.y - n.y);
};
function fa(e) {
	return na().find((t) => Math.abs(t.point.x - e.x) < 1e-9 && Math.abs(t.point.y - e.y) < 1e-9)?.toward ?? da(e);
}
// ui/src/arena/sceneLayout.ts
var pa = {
	x: .135,
	y: .16
}, ma = {
	x: .065,
	y: .1235
}, ha = 7, ga = .06, _a = .95, va = 15, ya = 6, ba = .06, xa = .08, Sa = .03, Ca = .97, wa = (e) => ({
	x: Ui(e.x, Sa, Ca),
	y: Ui(e.y, Sa, Ca)
});
function Ta(e, t, n) {
	let r = n.x - t.x, i = n.y - t.y, a = r * r + i * i, o = a === 0 ? 0 : Ui(((e.x - t.x) * r + (e.y - t.y) * i) / a, 0, 1);
	return Math.hypot(e.x - (t.x + o * r), e.y - (t.y + o * i));
}
function Ea(e) {
	let t = Infinity;
	for (let n of Ji.paths) for (let r = 1; r < n.points.length; r += 1) t = Math.min(t, Ta(e, n.points[r - 1], n.points[r]));
	return t;
}
var Da = null;
function Oa() {
	if (Da !== null) return Da;
	let e = [];
	for (let t = 0; t < ya; t += 1) for (let n = 0; n < va; n += 1) e.push({
		x: ba + n * ma.x,
		y: xa + t * ma.y
	});
	let t = e.map((e, t) => ({
		point: e,
		index: t,
		distance: Ea(e)
	}));
	return t.sort((e, t) => e.distance - t.distance || e.index - t.index), Da = t.map((e) => wa(e.point)), Da;
}
function ka(e, t = []) {
	let n = [...e], r = [...t], i = /* @__PURE__ */ new Set();
	return Oa().forEach((e, t) => {
		n.every((t) => la(t, e)) && r.every((t) => ca(t, e)) || i.add(t);
	}), i;
}
function Aa(e, t, n = 90, r = /* @__PURE__ */ new Set()) {
	let i = /* @__PURE__ */ new Map(), a = new Set(r);
	for (let r of t) {
		let t = e.get(r);
		t !== void 0 && t < n && !a.has(t) && (i.set(r, t), a.add(t));
	}
	let o = 0;
	for (let e of t) if (!i.has(e)) {
		for (; a.has(o);) o += 1;
		if (o >= n) break;
		i.set(e, o), a.add(o);
	}
	return i;
}
function ja(e, t) {
	return e.engagedBy.find((e) => t.has(e)) ?? null;
}
function Ma(e, t, n) {
	let r = /* @__PURE__ */ new Map();
	for (let e of t.enemies) {
		let t = ja(e, n);
		t !== null && r.set(t, [...r.get(t) ?? [], e.workId]);
	}
	let i = [...n.values()], a = [], o = /* @__PURE__ */ new Map(), s = [...r.keys()].sort((e, t) => e < t ? -1 : +(e > t));
	for (let t of s) {
		let s = n.get(t), c = ua(s, fa(s)), l = (e) => {
			let t = c[e];
			return i.every((e) => e === s || la(e, t)) && a.every((e) => ca(e, t));
		}, u = r.get(t), d = /* @__PURE__ */ new Set(), f = (e, t) => {
			o.set(e, t), d.add(t), a.push(c[t]);
		}, p = [];
		for (let t of u) {
			let n = e.get(t);
			n !== void 0 && n < c.length && !d.has(n) && l(n) ? f(t, n) : p.push(t);
		}
		for (let e of p) {
			let t = c.findIndex((e, t) => !d.has(t) && l(t));
			t !== -1 && f(e, t);
		}
	}
	return o;
}
function Na(e, t, n) {
	let r = [];
	for (let i of e.enemies) {
		let e = n.get(i.workId), a = ja(i, t), o = a === null ? void 0 : t.get(a), s = o === void 0 || e === void 0 ? void 0 : ua(o, fa(o))[e];
		s !== void 0 && r.push(s);
	}
	return r;
}
function Pa(e, t = /* @__PURE__ */ new Map()) {
	return e.enemies.filter((e) => !t.has(e.workId)).map((e) => e.workId);
}
function Fa(e) {
	let t = e % ha, n = Math.floor(e / ha);
	return wa({
		x: ga + t * pa.x,
		y: _a - n * pa.y
	});
}
function Ia(e, t, n = /* @__PURE__ */ new Map(), r = /* @__PURE__ */ new Map()) {
	let i = Oa(), a = {
		x: .5,
		y: .5
	}, o = /* @__PURE__ */ new Map();
	e.specters.forEach((e, t) => o.set(e.bindingId, n.get(e.bindingId) ?? Fa(t)));
	let s = /* @__PURE__ */ new Map();
	for (let n of e.enemies) {
		let e = ja(n, o), c = r.get(n.workId), l = e === null ? void 0 : o.get(e), u = l !== void 0 && c !== void 0 ? ua(l, fa(l))[c] : void 0, d = t.get(n.workId);
		s.set(n.workId, u ?? (d === void 0 ? a : i[d] ?? a));
	}
	return {
		specters: o,
		enemies: s
	};
}
// ui/src/arena/minionSize.ts
var La = {
	small: .8,
	medium: 1,
	large: 1.3
}, Ra = 36.4, za = .95;
function Ba(e, t) {
	return Math.min(44, e * pa.x * za, t * pa.y * za);
}
function Va(e) {
	return Math.min(Ra, e * ma.x * za / La.large);
}
// ui/src/specters/showcaseStage.ts
var Ha = {
	left: -1.46,
	right: 5.11,
	top: -1.73,
	bottom: 2.21
}, Ua = .25, Wa = {
	width: Ha.right - Ha.left + 2 * Ua,
	height: Ha.bottom - Ha.top + 2 * Ua + .55
};
function Ga(e) {
	let t = Math.max(1, e) / Wa.width, n = (Ua - Ha.left) * t, r = (Ua - Ha.top) * t;
	return {
		zoom: t / 44,
		heightPx: Wa.height * t,
		hero: {
			left: n,
			top: r
		},
		target: {
			left: n + 3 * t,
			top: r + (1 - Ra / 44) * t
		}
	};
}
// ui/src/specters/SpectersView.tsx
function Ka({ bots: e, specters: t, heroes: n, pendingCount: r, onAssign: s, onShowInRoster: c }) {
	let u = Vn(), p = a(), m = a(), [h, g] = l(null), [_, v] = l(!1), y = n.items, b = e.map((e) => t.byBinding.get(e.bindingId)?.heroId).find((e) => e !== void 0), x = y?.find((e) => e.heroId === (h ?? b)) ?? y?.[0], ee = x?.heroId, S = zi(ee, "patchling", u), te = nn("minion-patchling-sprite"), [C, w] = l(null), [T, E] = l(600);
	o(() => {
		if (C === null) return;
		let e = C.getBoundingClientRect().width;
		if (e > 0 && E(e), typeof ResizeObserver > "u") return;
		let t = new ResizeObserver((e) => {
			let t = e[0]?.contentRect.width;
			t !== void 0 && t > 0 && E(t);
		});
		return t.observe(C), () => t.disconnect();
	}, [C]);
	let D = Ga(T);
	if (i(() => {
		v(!1);
	}, [ee]), t.status === "loading") return /* @__PURE__ */ d(Se, {
		label: q.label,
		children: /* @__PURE__ */ d("p", {
			role: "status",
			children: On
		})
	});
	if (t.status === "failed") return /* @__PURE__ */ d(Se, {
		label: q.label,
		children: t.failure === "unsupported" ? /* @__PURE__ */ d(Ce, {
			title: "Specters are not supported here",
			body: Dn
		}) : /* @__PURE__ */ d(we, {
			title: "Could not load Specters",
			body: En(t.failure === "offline" ? "offline" : "store_unavailable"),
			onRetry: t.refresh
		})
	});
	let O = e.flatMap((e) => {
		let n = t.byBinding.get(e.bindingId);
		return n !== void 0 && n.heroId === ee ? [{
			bot: e,
			specter: n
		}] : [];
	}), k = S.playing, A = S.snapshot.heroes.get(Li), j = A === void 0 ? S.snapshot.flinches.has("practice-hero") ? "flinch" : "idle" : A.kind, M = S.snapshot.enemies.get(Ri), N = S.snapshot.counters.get(Ri), ne = {
		height: `${D.heightPx.toFixed(1)}px`,
		"--sa-sprite-patchling": te.status === "ready" ? `url("${te.art.url}")` : void 0
	};
	return /* @__PURE__ */ d(Se, {
		label: q.label,
		children: /* @__PURE__ */ f("div", {
			className: "sa-showcase",
			children: [
				/* @__PURE__ */ f("header", {
					className: "sa-showcase__head",
					children: [/* @__PURE__ */ f("div", { children: [/* @__PURE__ */ d("h2", { children: q.heading }), /* @__PURE__ */ d("p", {
						className: "sa-help",
						children: q.intro
					})] }), r > 0 && /* @__PURE__ */ d(H, {
						onClick: s,
						children: q.assignButton(r)
					})]
				}),
				y === null ? n.status === "loading" ? /* @__PURE__ */ d("p", {
					className: "sa-help",
					role: "status",
					children: q.heroesLoading
				}) : /* @__PURE__ */ f("p", {
					className: "sa-collection-note",
					role: "alert",
					children: [/* @__PURE__ */ d("span", { children: n.failure === "unsupported" ? q.heroesUnsupported : q.heroesFailed }), n.failure !== "unsupported" && /* @__PURE__ */ d(H, {
						variant: "ghost",
						onClick: n.refresh,
						children: q.retry
					})]
				}) : /* @__PURE__ */ d(Vr, {
					name: `${m}-heroes`,
					label: "Heroes",
					heroes: y,
					value: ee ?? null,
					onChange: g,
					size: 96
				}),
				x !== void 0 && /* @__PURE__ */ f("div", {
					className: "sa-showcase__main",
					children: [/* @__PURE__ */ f("div", {
						ref: w,
						className: "sa-showcase__stage",
						role: "img",
						"aria-label": q.stageLabel(x.name),
						style: ne,
						children: [/* @__PURE__ */ d("span", {
							className: "sa-showcase__spot",
							style: {
								left: D.hero.left,
								top: D.hero.top
							},
							children: /* @__PURE__ */ d("span", {
								className: "sa-showcase__zoom",
								style: { zoom: D.zoom },
								children: /* @__PURE__ */ d(yi, {
									heroId: x.heroId,
									animate: u,
									initials: gn(x.name),
									animation: j
								})
							})
						}), /* @__PURE__ */ f("span", {
							className: "sa-showcase__spot sa-showcase__target",
							style: {
								left: D.target.left,
								top: D.target.top
							},
							children: [/* @__PURE__ */ d("span", {
								className: "sa-showcase__zoom sa-showcase__zoom--target",
								style: { zoom: D.zoom },
								children: /* @__PURE__ */ d(ui, {
									minionType: "patchling",
									animation: M === void 0 ? N === void 0 ? "idle" : "attack" : "hit",
									animate: u,
									spriteReady: te.status === "ready",
									facing: "left",
									requestId: M?.exchangeId ?? N?.exchangeId ?? 0,
									recoil: 1,
									strong: M?.strong ?? !1,
									lunge: -1
								})
							}), /* @__PURE__ */ d("span", {
								className: "sa-showcase__caption",
								children: q.practiceTarget
							})]
						})]
					}), /* @__PURE__ */ f("div", {
						className: "sa-showcase__copy",
						children: [
							/* @__PURE__ */ d("h3", { children: x.name }),
							/* @__PURE__ */ d("p", {
								className: "sa-showcase__epithet",
								children: x.epithet
							}),
							/* @__PURE__ */ d("p", { children: x.personality }),
							/* @__PURE__ */ f("div", {
								className: "sa-actions",
								children: [/* @__PURE__ */ d(H, {
									"aria-disabled": k,
									disabled: !u,
									"aria-describedby": u ? void 0 : p,
									onClick: () => S.play("attack"),
									children: q.attack
								}), /* @__PURE__ */ d(H, {
									"aria-disabled": k,
									disabled: !u,
									"aria-describedby": u ? void 0 : p,
									onClick: () => S.play("cast"),
									children: q.cast
								})]
							}),
							!u && /* @__PURE__ */ d("p", {
								id: p,
								className: "sa-help",
								children: q.motionOff
							}),
							/* @__PURE__ */ d("p", {
								className: "sa-help",
								children: q.previewNote
							}),
							/* @__PURE__ */ f("div", {
								className: "sa-showcase__pack",
								children: [
									/* @__PURE__ */ d("p", { children: q.avatarPackLine }),
									/* @__PURE__ */ d("a", {
										href: Vi(x.heroId),
										target: "_blank",
										rel: "noopener noreferrer",
										children: q.avatarPackLink(x.name)
									}),
									/* @__PURE__ */ f("p", {
										className: "sa-help",
										children: [
											q.avatarPackCopy,
											" ",
											/* @__PURE__ */ d("code", { children: Vi(x.heroId) })
										]
									})
								]
							}),
							/* @__PURE__ */ d(H, {
								"aria-expanded": _,
								"aria-controls": m,
								onClick: () => v((e) => !e),
								children: q.holders(O.length)
							}),
							/* @__PURE__ */ d("div", {
								id: m,
								className: "sa-showcase__holders",
								hidden: !_,
								children: O.length === 0 ? /* @__PURE__ */ d("p", {
									className: "sa-help",
									children: q.noHolders(x.name)
								}) : /* @__PURE__ */ d("ul", { children: O.map(({ bot: e, specter: t }) => /* @__PURE__ */ d("li", { children: /* @__PURE__ */ f("button", {
									type: "button",
									className: "sa-showcase__holder",
									onClick: () => c(e.bindingId),
									children: [
										/* @__PURE__ */ d("strong", { children: L(e) }),
										" ",
										/* @__PURE__ */ d("span", { children: t.displayName }),
										" ",
										/* @__PURE__ */ d("span", {
											className: "sa-visually-hidden",
											children: q.showInRoster
										})
									]
								}) }, e.bindingId)) })
							})
						]
					})]
				})
			]
		})
	});
}
// ui/src/specters/onboarding.ts
var qa = "specter-arena:onboarding:v1", Ja = /^[A-Za-z0-9_-]{1,64}$/;
function Ya(e) {
	if (e === null) return [];
	try {
		let t = JSON.parse(e);
		if (typeof t != "object" || !t) return [];
		let { v: n, offered: r } = t;
		if (n !== 1 || !Array.isArray(r)) return [];
		let i = [];
		for (let e of r) if (typeof e == "string" && Ja.test(e) && !i.includes(e) && i.push(e), i.length === 500) break;
		return i;
	} catch {
		return [];
	}
}
function Xa() {
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}
function Za() {
	try {
		return Ya(Xa()?.getItem("specter-arena:onboarding:v1") ?? null);
	} catch {
		return [];
	}
}
function Qa(e) {
	try {
		let t = Xa();
		if (t === null) return !1;
		let n = [...Za().filter((t) => ![...e].includes(t)), ...[...e].filter((e) => Ja.test(e))];
		return t.setItem(qa, JSON.stringify({
			v: 1,
			offered: n.slice(-500)
		})), !0;
	} catch {
		return !1;
	}
}
// ui/src/specters/useAssignFlow.ts
function $a({ ready: e, bots: t, unassigned: r }) {
	let [a, o] = l(null), u = c(!1), d = s(() => {
		let e = new Set(r);
		return t.filter((t) => e.has(t.bindingId)).map((e) => e.bindingId);
	}, [t, r]);
	return i(() => {
		if (!e || u.current) return;
		u.current = !0;
		let t = new Set(Za()), n = d.filter((e) => !t.has(e));
		n.length > 0 && o(n);
	}, [e, d]), {
		pending: d,
		queue: a,
		open: n((e) => {
			if (d.length === 0) return;
			let t = e === void 0 ? -1 : d.indexOf(e);
			o(t > 0 ? [...d.slice(t), ...d.slice(0, t)] : d);
		}, [d]),
		close: n((e) => {
			Qa(e), o(null);
		}, [])
	};
}
var eo = class extends Error {}, to = (e) => typeof e == "string";
function no(e) {
	if (typeof e != "object" || !e) return !1;
	let t = e;
	return to(t.heroId) && to(t.name) && to(t.epithet) && to(t.personality) && typeof t.assigned == "boolean" && typeof t.assignedCount == "number" && Number.isInteger(t.assignedCount) && t.assignedCount >= 0;
}
function ro(e) {
	let t = e, n = t?.items;
	if (t?.contractVersion !== 1 || !Array.isArray(n) || n.length !== 11 || !n.every(no)) throw new eo("unexpected heroes body");
	return n;
}
function io(e) {
	return e instanceof eo ? "unexpected" : e instanceof G ? e.status === 404 ? "unsupported" : "unavailable" : "offline";
}
function ao() {
	let e = kt(), t = Yn(n(async () => ro(await e.getJson(rt)), [e]), "heroes"), r = t.data, i = s(() => t.error === null ? null : io(t.error), [t.error]);
	return {
		status: r === null ? i === null ? "loading" : "failed" : "ready",
		items: r,
		failure: i,
		refresh: t.refresh
	};
}
// ui/src/specters/specters.css?inline
var oo = ".specter-arena-root .sa-portrait{background:var(--raised);border-radius:10px;flex:none;place-items:center;display:inline-grid;position:relative;overflow:hidden}.specter-arena-root .sa-portrait--sm{width:32px;height:32px}.specter-arena-root .sa-portrait--md{width:96px;height:96px}.specter-arena-root .sa-portrait--lg{width:160px;height:160px}.specter-arena-root .sa-portrait__img{object-fit:contain;width:100%;height:100%}.specter-arena-root .sa-portrait__token{border:1px dashed var(--muted);border-radius:inherit;background:hsl(var(--sa-hue,270) 45% 28%);color:#fff;place-items:center;width:100%;height:100%;font-size:14px;font-weight:800;display:grid}.specter-arena-root .sa-portrait__token[data-initials]:before{content:attr(data-initials)}.specter-arena-root .sa-portrait--lg .sa-portrait__token{font-size:40px}.specter-arena-root .sa-portrait--md .sa-portrait__token{font-size:26px}.specter-arena-root .sa-portrait-wrap{justify-items:start;gap:6px;max-width:100%;display:inline-grid}.specter-arena-root .sa-caption{color:var(--muted);font-size:12px}.specter-arena-root .sa-portrait--loading{background:linear-gradient(135deg, var(--raised), var(--panel))}.specter-arena-root .sa-portrait--float{animation:4s ease-in-out infinite sa-float}.specter-arena-root .sa-portrait--active:after{content:\"\";border-radius:inherit;box-shadow:inset 0 0 0 2px var(--success);animation:1.6s ease-out infinite sa-pulse;position:absolute;inset:0}@keyframes sa-float{0%,to{transform:translateY(0)}50%{transform:translateY(-2px)}}@keyframes sa-pulse{0%{opacity:.9}to{opacity:0}}.specter-arena-root .sa-row__specter,.specter-arena-root .sa-profile h2,.specter-arena-root .sa-profile p{overflow-wrap:anywhere;min-width:0}.specter-arena-root .sa-row__specter{color:var(--violet);font-size:12px}.specter-arena-root .sa-row__select>.sa-portrait{margin-right:-4px}.specter-arena-root .sa-profile{grid-template-columns:minmax(0,1fr);gap:14px;display:grid}.specter-arena-root .sa-profile__head{flex-wrap:wrap;align-items:flex-start;gap:16px;display:flex}.specter-arena-root .sa-profile__head>div{flex:1;grid-template-columns:minmax(0,1fr);gap:4px;min-width:0;display:grid}.specter-arena-root .sa-profile h2{font-size:22px}.specter-arena-root .sa-profile dl{gap:10px;display:grid}.specter-arena-root .sa-field dt{color:var(--muted);font-size:12px}.specter-arena-root .sa-field dd{overflow-wrap:anywhere;white-space:pre-wrap}.specter-arena-root .sa-actions{flex-wrap:wrap;gap:8px;display:flex}.specter-arena-root .sa-form{background:#14102066;border:1px solid #3a304a;border-radius:12px;gap:12px;padding:14px;display:grid}.specter-arena-root .sa-form h3{font-size:16px}.specter-arena-root .sa-form label,.specter-arena-root .sa-form legend{gap:4px;font-size:13px;display:grid}.specter-arena-root .sa-form fieldset{border:0;gap:8px;margin:0;padding:0;display:grid}.specter-arena-root .sa-form input[type=text],.specter-arena-root .sa-form textarea{width:100%;min-width:0;color:var(--text);background:#241c35;border:1px solid #514165;border-radius:8px;padding:8px 10px;font-size:14px}.specter-arena-root .sa-counter,.specter-arena-root .sa-help{color:var(--muted);font-size:12px}.specter-arena-root .sa-error{border:1px solid var(--danger);background:#ff9bae14;border-radius:10px;padding:10px 12px}.specter-arena-root .sa-gallery{grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;display:grid}.specter-arena-root .sa-gallery__item{text-align:center;overflow-wrap:anywhere;border:1px solid #3a304a;border-radius:10px;justify-items:center;gap:6px;padding:8px;font-size:12px;display:grid}.specter-arena-root .sa-gallery__item:has(input:checked){border-color:var(--violet);background:#2b213f}.specter-arena-root .sa-gallery__item:focus-within{box-shadow:0 0 0 3px var(--ink), 0 0 0 5px var(--violet)}.specter-arena-root .sa-row__specter--none{color:var(--muted)}.specter-arena-root .sa-row__assign{min-width:64px;color:var(--violet);background:0 0;border:0;border-left:1px solid #3a2f49;flex:none;padding:0 12px;font-weight:700}.specter-arena-root .sa-row__assign:hover{background:#261e37}.specter-arena-root .sa-hero-choice{grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:10px;display:grid}.specter-arena-root .sa-hero-choice__item{text-align:center;cursor:pointer;background:#1b1629;border:1px solid #3a304a;border-radius:12px;justify-items:center;gap:4px;padding:8px;display:grid;position:relative}.specter-arena-root .sa-hero-choice__item:hover{background:#261e37}.specter-arena-root .sa-hero-choice__item:has(input:checked){border-color:var(--violet);box-shadow:inset 0 0 0 1px var(--violet);background:#2b213f}.specter-arena-root .sa-hero-choice__item:focus-within{box-shadow:0 0 0 3px var(--ink), 0 0 0 5px var(--violet)}.specter-arena-root .sa-hero-choice__item .sa-portrait{aspect-ratio:1;width:100%;max-width:96px;height:auto}.specter-arena-root .sa-hero-choice__input{z-index:1;opacity:0;cursor:pointer;width:100%;height:100%;margin:0;position:absolute;inset:0}.specter-arena-root .sa-hero-choice__name{overflow-wrap:anywhere;font-weight:700}.specter-arena-root .sa-hero-choice__held{color:var(--muted);font-size:12px}.specter-arena-root .sa-showcase{gap:16px;display:grid}.specter-arena-root .sa-showcase__head{flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:12px;display:flex}.specter-arena-root .sa-showcase__head h2,.specter-arena-root .sa-showcase__head p{margin:0}.specter-arena-root .sa-showcase__main{grid-template-columns:minmax(0,1fr);align-items:start;gap:20px;display:grid}.specter-arena-root .sa-showcase__stage{border:1px solid var(--line);background:radial-gradient(circle at 38% 46%,#b49aff2b,#0000 48%),#171020;border-radius:14px;width:100%;max-width:900px;min-height:160px;position:relative;overflow:hidden}.specter-arena-root .sa-showcase__spot{display:block;position:absolute}.specter-arena-root .sa-showcase__zoom{width:44px;height:44px;display:block}.specter-arena-root .sa-showcase__zoom--target{width:36.4px;height:36.4px}.specter-arena-root .sa-showcase__caption{color:var(--muted);white-space:nowrap;background:#141020b8;border-radius:4px;margin-top:6px;padding:1px 6px;font-size:12px;position:absolute;top:100%;left:50%;transform:translate(-50%)}.specter-arena-root .sa-showcase__copy{justify-items:start;gap:10px;min-width:0;display:grid}.specter-arena-root .sa-showcase__copy h3{letter-spacing:-.03em;margin:0;font-size:clamp(28px,4vw,44px)}.specter-arena-root .sa-showcase__copy p{overflow-wrap:anywhere;margin:0}.specter-arena-root .sa-showcase__epithet{color:var(--violet);font-weight:650}.specter-arena-root .sa-showcase__pack{justify-items:start;gap:6px;min-width:0;display:grid}.specter-arena-root .sa-showcase__pack a{color:var(--violet);font-weight:650}.specter-arena-root .sa-showcase__pack code{-webkit-user-select:all;user-select:all;overflow-wrap:anywhere}.specter-arena-root .sa-showcase__holders{width:100%}.specter-arena-root .sa-showcase__holders ul{gap:6px;margin:0;padding:0;list-style:none;display:grid}.specter-arena-root .sa-showcase__holder{width:100%;color:var(--text);text-align:left;background:#1b1629;border:1px solid #3a2f49;border-radius:10px;flex-wrap:wrap;gap:4px 12px;padding:10px 12px;display:flex}.specter-arena-root .sa-showcase__holder:hover{background:#261e37}.specter-arena-root .sa-showcase__holder span{color:var(--violet)}.specter-arena-root .sa-collection-note{flex-wrap:wrap;align-items:center;gap:8px;margin:0;display:flex}.specter-arena-root .sa-assign-dialog{border:1px solid var(--line);background:var(--panel);width:min(760px,100vw - 16px);height:fit-content;max-height:calc(100vh - 16px);color:var(--text);border-radius:14px;margin:auto;padding:20px;position:fixed;inset:0;overflow:auto}.specter-arena-root .sa-assign-dialog::backdrop{background:#0a0614b8}.specter-arena-root .sa-assign-dialog__body{gap:14px;display:grid}.specter-arena-root .sa-assign-dialog h2,.specter-arena-root .sa-assign-dialog p{overflow-wrap:anywhere;margin:0}.specter-arena-root .sa-assign-dialog__step{color:var(--muted);font-size:12px}@media (width<=900px){.specter-arena-root .sa-showcase__main{grid-template-columns:minmax(0,1fr)}}@media (width<=520px){.specter-arena-root .sa-hero-choice{grid-template-columns:repeat(auto-fill,minmax(96px,1fr))}.specter-arena-root .sa-assign-dialog{padding:14px}.specter-arena-root .sa-gallery{grid-template-columns:repeat(2,minmax(0,1fr))}.specter-arena-root .sa-row__select>.sa-portrait{display:none}}@media (forced-colors:active){.specter-arena-root .sa-hero-choice__item,.specter-arena-root .sa-showcase__holder,.specter-arena-root .sa-assign-dialog{border:1px solid canvastext}.specter-arena-root .sa-hero-choice__item:focus-within{outline:2px solid highlight}.specter-arena-root .sa-portrait__token{color:canvastext;background:canvas;border:1px solid canvastext}}@media (prefers-reduced-motion:reduce){.specter-arena-root .sa-portrait--float,.specter-arena-root .sa-portrait--active:after{animation:none!important}}.specter-arena-root .sa-progression{gap:4px;min-width:0;display:grid}.specter-arena-root .sa-progression strong{font-size:13px}.specter-arena-root .sa-progression small{color:var(--muted);font-size:12px}.specter-arena-root .sa-progression--compact{grid-template-columns:auto minmax(40px,1fr);align-items:center;gap:2px 8px}.specter-arena-root .sa-progression--compact small{grid-column:1/-1}";
// ui/src/specters/useSpecterStyle.ts
function so() {
	o(() => {
		let e = document.createElement("style");
		return e.setAttribute("data-specter-arena-specters", ""), e.textContent = oo, document.head.appendChild(e), () => {
			e.remove();
		};
	}, []);
}
// ui/src/lifecycle/model.ts
var co = class extends Error {}, lo = [
	30,
	90,
	180,
	365
], uo = (e) => typeof e == "object" && !!e && !Array.isArray(e), Y = (e) => typeof e == "number" && Number.isInteger(e) && e >= 0, fo = (e) => typeof e == "string", po = (e) => e === null || Y(e), mo = (e) => e === null || typeof e == "number" && lo.includes(e);
function ho(e) {
	return uo(e) && Y(e.observations) && Y(e.quarantine) && Y(e.attempts) && Y(e.assets);
}
var go = ["purge", "asset-cleanup"], _o = [
	"running",
	"completed",
	"interrupted",
	"failed"
];
function vo(e) {
	return uo(e) && fo(e.kind) && go.includes(e.kind) && fo(e.state) && _o.includes(e.state) && Y(e.cutoffMs) && Y(e.startedMs) && po(e.endedMs) && ho(e.deleted);
}
var yo = /^[0-9a-f]{64}$/, bo = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
function xo(e) {
	return uo(e) && fo(e.fileName) && bo.test(e.fileName) && Y(e.byteLength) && fo(e.sha256) && yo.test(e.sha256) && Y(e.createdMs);
}
var So = (e, t) => e === null || t(e);
function Co(e) {
	if (!uo(e) || e.contractVersion !== 1) throw new co("unexpected data body");
	let { retention: t, preview: n, uploads: r, exports: i } = e;
	if (!Y(e.asOfMs) || !uo(t) || !mo(t.retentionDays) || !po(t.changedAtMs) || !Y(t.revision) || !po(e.horizonMs) || !(n === null || uo(n) && Y(n.cutoffMs) && Y(n.observations) && Y(n.quarantine) && Y(n.attempts)) || !So(e.running, vo) || !So(e.lastPurge, vo) || !So(e.lastCleanup, vo) || !So(e.lastExport, xo) || !uo(r) || !Y(r.stored) || !Y(r.cap) || !Y(r.unused) || !Array.isArray(i) || i.length > 20 || !i.every(xo) || typeof e.paused != "boolean") throw new co("unexpected data body");
	return e;
}
function wo(e) {
	if (!uo(e) || e.contractVersion !== 1 || typeof e.paused != "boolean" || !Y(e.revision) || !Y(e.changedAtMs) || !fo(e.state)) throw new co("unexpected collector body");
	return e;
}
function To(e) {
	if (e < 1024) return `${e} B`;
	let t = [
		"KB",
		"MB",
		"GB",
		"TB"
	], n = e / 1024, r = 0;
	for (; n >= 1024 && r < t.length - 1;) n /= 1024, r += 1;
	return `${n >= 100 ? Math.round(n) : Math.round(n * 10) / 10} ${t[r]}`;
}
var Eo = (e) => e.observations + e.quarantine + e.attempts, Do = (e, t, n) => `${e.toLocaleString("en-US")} ${e === 1 ? t : n}`, Oo = (e) => Do(e, "observation", "observations"), ko = (e) => Do(e, "quarantined record", "quarantined records"), Ao = (e) => Do(e, "attempt record", "attempt records"), jo = (e) => Do(e, "uploaded image", "uploaded images"), Mo = {
	LIVE: "LIVE",
	FIXTURE: "FIXTURE — demo data. Nothing here changes your real data.",
	RECORDED: "RECORDED — not live"
}, No = {
	label: "Data",
	heading: "Data and collection",
	loading: "Loading data controls…",
	unsupportedTitle: "This version of the app has no data controls",
	unsupportedBody: "The app backend does not offer them yet. Update the app in Crew, then reload.",
	failureTitle: "Could not load the data controls",
	stale: "Showing the last data that loaded."
}, Po = {
	heading: "Collection",
	pausedNote: "While collection is paused nothing new is recorded. That time is kept as a gap in coverage, never as no activity.",
	runningNote: "Pausing records a gap in coverage until you resume.",
	pause: "Pause collection",
	resume: "Resume collection",
	notPaused: "Collection is not paused.",
	pausedDone: "Collection paused.",
	resumedDone: "Collection resumed."
}, Fo = {
	heading: "History",
	label: "Keep history for",
	keepEverything: "Keep everything",
	save: "Save setting",
	saved: "Retention setting saved. Nothing was deleted.",
	help: "Choosing a window deletes nothing by itself. History older than the window is removed only when you press Purge and confirm.",
	keepNote: "Keep everything is selected, so nothing is ever purged.",
	unsavedNote: "Save the setting before you purge. A purge always uses the saved window.",
	daysLabel: (e) => `${e} days`,
	kept: "A purge never touches bot identity, hero assignment, avatars, work items, decisions or XP.",
	backup: "Before it deletes anything the app writes a backup in data/store/backups/. If the backup fails, nothing is deleted. Only the newest purge backup is kept.",
	noShrink: "The database file does not shrink after a purge. The space is reused by later writes, and deleted content can stay in unused pages until then."
}, Io = {
	heading: "Purge old history",
	open: "Purge…",
	confirmHeading: "Purge old history",
	confirm: "Purge history",
	cancel: "Cancel",
	nothing: "Nothing is older than the saved window, so there is nothing to purge.",
	none: "Choose a window and save it to see what a purge would delete.",
	running: "A purge is running. Wait for it to finish.",
	working: "Purging…",
	done: "Purge finished.",
	horizon: (e) => `History before ${e} was purged. Coverage for that time is unknown.`
}, Lo = {
	heading: "Export",
	help: "Writes a consistent copy of the whole store to your computer. It is not sent anywhere, and the app never deletes an export.",
	action: "Export the store",
	working: "Exporting…",
	none: "No export has been written yet.",
	saved: (e) => `Saved to data/exports/${e} in the app folder.`,
	listLabel: "Exports"
}, Ro = {
	heading: "Uploaded images",
	usage: (e, t) => `${e.toLocaleString("en-US")} of ${t.toLocaleString("en-US")} uploaded images stored.`,
	atCap: "The upload limit is reached. Remove unused uploads, or reuse an image already stored.",
	unused: (e) => `${jo(e)} ${e === 1 ? "is" : "are"} not used by any avatar, current or past.`,
	noneUnused: "Every uploaded image is used by an avatar.",
	help: "Only uploads older than one hour that no avatar uses are removed. Bundled art is never removed. A backup is written first.",
	open: "Remove unused uploads…",
	confirmHeading: "Remove unused uploads",
	confirm: "Remove unused uploads",
	working: "Removing…",
	done: "Unused uploads removed."
}, zo = {
	purge: "purge",
	"asset-cleanup": "upload cleanup"
};
function Bo(e, t) {
	return e === "asset-cleanup" ? `removed ${jo(t.assets)}` : `deleted ${Oo(t.observations)}, ${ko(t.quarantine)} and ${Ao(t.attempts)}`;
}
function Vo(e, t) {
	let n = zo[e.kind] ?? e.kind;
	return e.state === "completed" ? `Last ${n} finished ${t}: ${Bo(e.kind, e.deleted)}.` : e.state === "interrupted" ? `The last ${n} was interrupted (${t}) after it ${Bo(e.kind, e.deleted)}. What it deleted stays deleted. Run it again to finish.` : e.state === "failed" ? `The last ${n} failed (${t}). ${e.kind === "purge" ? "Check the counts below before you try again." : "Try again."}` : `A ${n} is running (started ${t}). Wait for it to finish.`;
}
var Ho = {
	invalid_body: "The app did not accept that request. Reload the page and try again.",
	lifecycle_busy: "Another data action is already running. Wait for it to finish, then try again.",
	retention_not_set: "Choose and save a retention setting first.",
	retention_mismatch: "The saved setting is different from the one on screen. The panel was refreshed. Check it, then try again.",
	backup_failed: "The safety backup could not be written, so nothing was deleted.",
	export_failed: "The export could not be written. Nothing in the store changed.",
	store_unavailable: "The app's database is unavailable. Nothing was changed. Retry in a moment.",
	store_not_ready: "The app is still starting. Retry in a moment.",
	collector_unavailable: "The collector is not available, so collection could not be paused or resumed.",
	offline: "Could not reach the app backend. Nothing was changed.",
	unexpected: "The app backend sent a reply this page does not understand. Nothing was changed. Reload the page."
}, Uo = (e) => Ho[e] ?? `The request failed (${e}). Nothing was changed.`;
// ui/src/lifecycle/CollectionSection.tsx
function Wo({ paused: e, busy: t, onSet: n }) {
	let [r, i] = l(null), a = e ? ee("paused", null) : Po.notPaused;
	return /* @__PURE__ */ f("section", {
		className: "sa-data-section",
		"aria-labelledby": "sa-data-collection",
		children: [
			/* @__PURE__ */ d("h3", {
				id: "sa-data-collection",
				children: Po.heading
			}),
			/* @__PURE__ */ d("p", {
				className: "sa-data-state",
				"data-paused": e ? "true" : "false",
				children: a
			}),
			/* @__PURE__ */ d("p", {
				className: "sa-help",
				children: e ? Po.pausedNote : Po.runningNote
			}),
			/* @__PURE__ */ d("div", {
				className: "sa-data-actions",
				children: /* @__PURE__ */ d(H, {
					onClick: async () => {
						t || (i(null), i(await n(!e)));
					},
					"aria-disabled": t || void 0,
					children: e ? Po.resume : Po.pause
				})
			}),
			r !== null && /* @__PURE__ */ d("p", {
				className: "sa-data-error",
				role: "alert",
				children: r
			})
		]
	});
}
// ui/src/lifecycle/useFormatTime.ts
function Go() {
	let e = r(ge);
	return (t) => ue(t, e);
}
// ui/src/lifecycle/ExportSection.tsx
function Ko({ data: e, actions: t, submit: n }) {
	let r = Go(), [i, a] = l(null), o = e.lastExport, s = e.running !== null;
	return /* @__PURE__ */ f("section", {
		className: "sa-data-section",
		"aria-labelledby": "sa-data-export",
		children: [
			/* @__PURE__ */ d("h3", {
				id: "sa-data-export",
				children: Lo.heading
			}),
			/* @__PURE__ */ d("p", {
				className: "sa-help",
				children: Lo.help
			}),
			/* @__PURE__ */ d("div", {
				className: "sa-data-actions",
				children: /* @__PURE__ */ d(H, {
					onClick: async () => {
						t.busy || (a(null), a(await n(t.exportStore(), "Export written.")));
					},
					disabled: s,
					"aria-disabled": t.busy || void 0,
					children: t.busy ? Lo.working : Lo.action
				})
			}),
			i !== null && /* @__PURE__ */ d("p", {
				className: "sa-data-error",
				role: "alert",
				children: i
			}),
			/* @__PURE__ */ d("p", { children: o === null ? Lo.none : Lo.saved(o.fileName) }),
			e.exports.length > 0 && /* @__PURE__ */ d("ul", {
				className: "sa-data-exports",
				"aria-label": Lo.listLabel,
				children: e.exports.map((e) => /* @__PURE__ */ f("li", { children: [
					/* @__PURE__ */ d("code", { children: e.fileName }),
					/* @__PURE__ */ f("span", { children: [
						To(e.byteLength),
						" · ",
						r(e.createdMs)
					] }),
					/* @__PURE__ */ f("span", {
						className: "sa-data-hash",
						children: ["SHA-256 ", e.sha256]
					})
				] }, e.fileName))
			})
		]
	});
}
// ui/src/lifecycle/ConfirmPanel.tsx
function qo({ heading: e, confirmLabel: t, cancelLabel: n, busy: r, error: o, children: s, onConfirm: l, onCancel: u }) {
	let p = a(), m = c(null);
	return i(() => {
		m.current?.focus();
	}, []), /* @__PURE__ */ f("div", {
		className: "sa-data-confirm",
		role: "group",
		"aria-labelledby": p,
		onKeyDown: (e) => {
			e.key === "Escape" && !r && (e.stopPropagation(), u());
		},
		children: [
			/* @__PURE__ */ d("h4", {
				id: p,
				ref: m,
				tabIndex: -1,
				children: e
			}),
			s,
			o !== null && /* @__PURE__ */ d("p", {
				className: "sa-data-error",
				role: "alert",
				children: o
			}),
			/* @__PURE__ */ f("div", {
				className: "sa-data-actions",
				children: [/* @__PURE__ */ d(H, {
					onClick: r ? void 0 : l,
					"aria-disabled": r || void 0,
					children: t
				}), /* @__PURE__ */ d(H, {
					variant: "ghost",
					onClick: r ? void 0 : u,
					"aria-disabled": r || void 0,
					children: n
				})]
			})
		]
	});
}
// ui/src/lifecycle/HistorySection.tsx
var Jo = (e) => lo.find((t) => String(t) === e) ?? null;
function Yo({ data: e, actions: t, submit: n }) {
	let r = Go(), a = e.retention.retentionDays, [o, s] = l(void 0), u = o === void 0 ? a : o, p = u !== a, [m, h] = l(null), [g, _] = l(null), [v, y] = l(null), [b, x] = l(0), [ee, S] = l(0), te = c(null), C = c(null), w = m !== null && m === a;
	i(() => {
		b > 0 && C.current?.focus();
	}, [b]), i(() => {
		ee > 0 && te.current?.focus();
	}, [ee]);
	let T = e.running !== null, E = e.preview, D = E !== null && Eo(E) === 0, O = a !== null && !p && E !== null && !D && !T && !t.busy, k = async () => {
		if (t.busy) return;
		_(null);
		let e = await n(t.setRetention(u), Fo.saved);
		e === null ? s(void 0) : _(e);
	}, A = () => {
		h(null), y(null), S((e) => e + 1);
	}, j = async () => {
		if (m === null) return;
		y(null);
		let e = await n(t.purge(m), Io.done);
		e === null ? (h(null), x((e) => e + 1)) : y(e);
	}, M;
	M = a === null ? p ? Fo.unsavedNote : Fo.keepNote : p ? Fo.unsavedNote : E === null || D ? Io.nothing : `A purge now would delete history before ${r(E.cutoffMs)}: ${Oo(E.observations)}, ${ko(E.quarantine)} and ${Ao(E.attempts)}.`;
	let N = e.running ?? e.lastPurge;
	return /* @__PURE__ */ f("section", {
		className: "sa-data-section",
		"aria-labelledby": "sa-data-history",
		children: [
			/* @__PURE__ */ d("h3", {
				id: "sa-data-history",
				children: Fo.heading
			}),
			e.horizonMs !== null && /* @__PURE__ */ d("p", {
				className: "sa-data-horizon",
				children: Io.horizon(r(e.horizonMs))
			}),
			/* @__PURE__ */ f("div", {
				className: "sa-data-field",
				children: [
					/* @__PURE__ */ d("label", {
						htmlFor: "sa-data-retention",
						children: Fo.label
					}),
					/* @__PURE__ */ f("select", {
						id: "sa-data-retention",
						value: u === null ? "" : String(u),
						disabled: T || t.busy || w,
						"aria-describedby": "sa-data-retention-help",
						onChange: (e) => s(Jo(e.target.value)),
						children: [/* @__PURE__ */ d("option", {
							value: "",
							children: Fo.keepEverything
						}), lo.map((e) => /* @__PURE__ */ d("option", {
							value: String(e),
							children: Fo.daysLabel(e)
						}, e))]
					}),
					/* @__PURE__ */ d(H, {
						onClick: k,
						disabled: T || !p,
						"aria-disabled": t.busy || void 0,
						children: Fo.save
					})
				]
			}),
			/* @__PURE__ */ d("p", {
				className: "sa-help",
				id: "sa-data-retention-help",
				children: Fo.help
			}),
			g !== null && /* @__PURE__ */ d("p", {
				className: "sa-data-error",
				role: "alert",
				children: g
			}),
			/* @__PURE__ */ d("h4", { children: Io.heading }),
			/* @__PURE__ */ d("p", { children: M }),
			!w && /* @__PURE__ */ d("div", {
				className: "sa-data-actions",
				children: /* @__PURE__ */ d(H, {
					ref: te,
					onClick: () => h(a),
					disabled: !O,
					children: Io.open
				})
			}),
			w && E !== null && /* @__PURE__ */ f(qo, {
				heading: Io.confirmHeading,
				confirmLabel: Io.confirm,
				cancelLabel: Io.cancel,
				busy: t.busy,
				error: v,
				onConfirm: j,
				onCancel: A,
				children: [
					/* @__PURE__ */ f("p", { children: [
						"This deletes history before ",
						r(E.cutoffMs),
						": ",
						Oo(E.observations),
						", ",
						ko(E.quarantine),
						" and ",
						Ao(E.attempts),
						". It cannot be undone from this page."
					] }),
					/* @__PURE__ */ d("p", { children: Fo.kept }),
					/* @__PURE__ */ d("p", { children: Fo.backup }),
					/* @__PURE__ */ d("p", { children: Fo.noShrink })
				]
			}),
			!w && /* @__PURE__ */ f("p", {
				className: "sa-help",
				children: [
					Fo.kept,
					" ",
					Fo.noShrink
				]
			}),
			/* @__PURE__ */ d("p", {
				className: "sa-data-result",
				ref: C,
				tabIndex: -1,
				children: N === null ? "" : Vo(N, r(N.endedMs ?? N.startedMs))
			})
		]
	});
}
// ui/src/lifecycle/UploadsSection.tsx
function Xo({ data: e, actions: t, submit: n }) {
	let r = Go(), { stored: a, cap: o, unused: s } = e.uploads, [u, p] = l(!1), [m, h] = l(null), [g, _] = l(0), [v, y] = l(0), b = c(null), x = c(null);
	i(() => {
		g > 0 && x.current?.focus();
	}, [g]), i(() => {
		v > 0 && b.current?.focus();
	}, [v]);
	let ee = e.running !== null, S = e.lastCleanup;
	return /* @__PURE__ */ f("section", {
		className: "sa-data-section",
		"aria-labelledby": "sa-data-uploads",
		children: [
			/* @__PURE__ */ d("h3", {
				id: "sa-data-uploads",
				children: Ro.heading
			}),
			/* @__PURE__ */ d("p", { children: Ro.usage(a, o) }),
			a >= o && /* @__PURE__ */ d("p", {
				className: "sa-data-note",
				children: Ro.atCap
			}),
			/* @__PURE__ */ d("p", { children: s === 0 ? Ro.noneUnused : Ro.unused(s) }),
			/* @__PURE__ */ d("p", {
				className: "sa-help",
				children: Ro.help
			}),
			!u && /* @__PURE__ */ d("div", {
				className: "sa-data-actions",
				children: /* @__PURE__ */ d(H, {
					ref: b,
					onClick: () => p(!0),
					disabled: ee || s === 0,
					children: Ro.open
				})
			}),
			u && /* @__PURE__ */ d(qo, {
				heading: Ro.confirmHeading,
				confirmLabel: Ro.confirm,
				cancelLabel: "Cancel",
				busy: t.busy,
				error: m,
				onConfirm: async () => {
					h(null);
					let e = await n(t.cleanupUploads(), Ro.done);
					e === null ? (p(!1), _((e) => e + 1)) : h(e);
				},
				onCancel: () => {
					p(!1), h(null), y((e) => e + 1);
				},
				children: /* @__PURE__ */ f("p", { children: [
					"This removes up to ",
					jo(s),
					" that no avatar uses. ",
					Ro.help
				] })
			}),
			/* @__PURE__ */ d("p", {
				className: "sa-data-result",
				ref: x,
				tabIndex: -1,
				children: S === null ? "" : Vo(S, r(S.endedMs ?? S.startedMs))
			})
		]
	});
}
// ui/src/lifecycle/useData.ts
function Zo(e) {
	return e instanceof co ? "unexpected" : e instanceof G ? e.status === 404 ? "unsupported" : "unavailable" : "offline";
}
function Qo() {
	let e = kt(), t = Yn(n(async () => Co(await e.getJson(_t)), [e]), "data"), r = t.error === null ? null : Zo(t.error), i;
	return i = t.data === null ? r === null ? {
		status: "loading",
		data: null,
		failure: null
	} : {
		status: "failed",
		data: null,
		failure: r
	} : {
		status: "ready",
		data: t.data,
		failure: r
	}, {
		state: i,
		refresh: t.refresh
	};
}
// ui/src/lifecycle/useDataActions.ts
var $o = (e) => e instanceof co ? "unexpected" : e instanceof G ? e.error ?? `http_${e.status}` : "offline";
function es() {
	let e = kt(), [t, n] = l(!1), r = c(!1), i = async (e) => {
		if (r.current) return {
			ok: !1,
			code: "busy"
		};
		r.current = !0, n(!0);
		try {
			return await e();
		} catch (e) {
			return {
				ok: !1,
				code: $o(e)
			};
		} finally {
			r.current = !1, n(!1);
		}
	}, a = (e) => i(async () => ({
		ok: !0,
		data: Co(await e())
	}));
	return {
		busy: t,
		setRetention: (t) => a(() => e.postJson(vt, { retentionDays: t })),
		purge: (t) => a(() => e.postJson(yt, { retentionDays: t })),
		exportStore: () => a(() => e.postJson(bt, {})),
		cleanupUploads: () => a(() => e.postJson(xt, {})),
		setPaused: (t) => i(async () => ({
			ok: !0,
			control: wo(await e.postJson(St, { paused: t }))
		}))
	};
}
// ui/src/lifecycle/DataView.tsx
var ts = {
	unsupported: No.unsupportedBody,
	offline: Uo("offline"),
	unavailable: Uo("store_unavailable"),
	unexpected: Uo("unexpected")
};
function ns() {
	let e = Pt(), { state: t, refresh: n } = Qo(), r = es(), [a, o] = l(null), [s, c] = l(null), [u, p] = l(""), m = t.data;
	i(() => {
		o(null), c(null);
	}, [m]);
	let h = async (e, t) => {
		let r = await e;
		return n(), r.ok ? (o(r.data), p(t), null) : Uo(r.code);
	}, g = async (e) => {
		let t = await r.setPaused(e);
		return n(), t.ok ? (c(t.control.paused), p(t.control.paused ? Po.pausedDone : Po.resumedDone), null) : Uo(t.code);
	}, _ = /* @__PURE__ */ f("div", {
		className: "sa-data-header",
		children: [/* @__PURE__ */ d("h2", { children: No.heading }), /* @__PURE__ */ d("span", {
			role: "status",
			className: `sa-data-mode sa-data-mode--${e.toLowerCase()}`,
			"data-mode": e,
			children: Mo[e]
		})]
	});
	if (t.status === "loading") return /* @__PURE__ */ f(Se, {
		label: No.label,
		children: [_, /* @__PURE__ */ d("p", {
			role: "status",
			children: No.loading
		})]
	});
	if (t.status === "failed") return /* @__PURE__ */ f(Se, {
		label: No.label,
		children: [_, t.failure === "unsupported" ? /* @__PURE__ */ d(we, {
			title: No.unsupportedTitle,
			body: ts.unsupported
		}) : /* @__PURE__ */ d(we, {
			title: No.failureTitle,
			body: ts[t.failure],
			onRetry: n
		})]
	});
	let v = a ?? t.data, y = s ?? v.paused, b = {
		data: v,
		actions: r,
		submit: h
	};
	return /* @__PURE__ */ f(Se, {
		label: No.label,
		children: [
			_,
			t.failure !== null && /* @__PURE__ */ f("div", {
				className: "sa-banner",
				role: "alert",
				children: [/* @__PURE__ */ f("span", { children: [
					No.stale,
					" ",
					ts[t.failure]
				] }), /* @__PURE__ */ d(H, {
					onClick: n,
					children: "Retry"
				})]
			}),
			/* @__PURE__ */ f("div", {
				className: "sa-data",
				children: [
					/* @__PURE__ */ d(Wo, {
						paused: y,
						busy: r.busy,
						onSet: g
					}),
					/* @__PURE__ */ d(Yo, { ...b }),
					/* @__PURE__ */ d(Ko, { ...b }),
					/* @__PURE__ */ d(Xo, { ...b })
				]
			}),
			/* @__PURE__ */ d("p", {
				className: "sa-visually-hidden",
				role: "status",
				"aria-live": "polite",
				children: u
			})
		]
	});
}
// ui/src/lifecycle/data.css?inline
var rs = ".specter-arena-root .sa-data-header{flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px 16px;margin-bottom:14px;display:flex}.specter-arena-root .sa-data-mode{border:1px solid var(--line);color:var(--text);border-radius:999px;align-items:center;padding:3px 10px;font-size:12px;font-weight:700;display:inline-flex}.specter-arena-root .sa-data-mode--fixture{border-color:var(--amber);color:var(--amber)}.specter-arena-root .sa-data-mode--live{border-color:var(--success);color:var(--success)}.specter-arena-root .sa-data-mode--recorded{border-color:var(--cyan);color:var(--cyan)}.specter-arena-root .sa-data{grid-template-columns:repeat(auto-fit,minmax(300px,1fr));align-items:start;gap:16px;display:grid}.specter-arena-root .sa-data>*{min-width:0}.specter-arena-root .sa-data-section{border:1px solid var(--line);overflow-wrap:anywhere;background:#14102066;border-radius:12px;gap:10px;padding:14px;display:grid}.specter-arena-root .sa-data-section h3{font-size:16px}.specter-arena-root .sa-data-section h4{margin-top:4px;font-size:14px}.specter-arena-root .sa-data-state{font-weight:650}.specter-arena-root .sa-data-state[data-paused=true]{color:var(--amber)}.specter-arena-root .sa-data-horizon{border:1px solid var(--amber);color:var(--amber);border-radius:10px;padding:8px 10px}.specter-arena-root .sa-data-field{flex-wrap:wrap;align-items:end;gap:8px 12px;display:flex}.specter-arena-root .sa-data-field label{color:var(--muted);flex-basis:100%;font-size:12px;display:grid}.specter-arena-root .sa-data select{border:1px solid var(--line);background:var(--raised);min-width:0;max-width:100%;min-height:42px;color:var(--text);border-radius:8px;padding:7px 10px;font-size:14px}.specter-arena-root .sa-data-actions{flex-wrap:wrap;gap:8px;display:flex}.specter-arena-root .sa-data-confirm{border:1px solid var(--amber);background:#ffd0800f;border-radius:12px;gap:10px;padding:12px;display:grid}.specter-arena-root .sa-data-confirm h4{margin:0;font-size:15px}.specter-arena-root .sa-data-error{border:1px solid var(--danger);background:#ff9bae14;border-radius:10px;padding:10px 12px}.specter-arena-root .sa-data-note{color:var(--amber)}.specter-arena-root .sa-data-result:empty{display:none}.specter-arena-root .sa-data-exports{gap:8px;margin:0;padding:0;list-style:none;display:grid}.specter-arena-root .sa-data-exports li{border:1px solid var(--line);background:var(--raised);border-radius:10px;gap:2px;padding:8px 10px;display:grid}.specter-arena-root .sa-data-hash{color:var(--muted);word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}.specter-arena-root .sa-data .sa-button:disabled,.specter-arena-root .sa-data .sa-button[aria-disabled=true],.specter-arena-root .sa-data select:disabled{cursor:not-allowed;opacity:.6}@media (width<=520px){.specter-arena-root .sa-data{grid-template-columns:minmax(0,1fr)}}@media (prefers-reduced-motion:reduce){.specter-arena-root .sa-data-section,.specter-arena-root .sa-data-confirm{transition:none!important;animation:none!important}}";
// ui/src/lifecycle/useDataStyle.ts
function is() {
	o(() => {
		let e = document.createElement("style");
		return e.setAttribute("data-specter-arena-data", ""), e.textContent = rs, document.head.appendChild(e), () => {
			e.remove();
		};
	}, []);
}
// ui/src/tasks/copy.ts
var as = "Auto-credited when the task ended cleanly.", os = {
	"bot-turn": "Bot turn",
	worker: "Worker task"
}, ss = {
	open: "Open",
	credited: "Credited",
	"not-credited": "Not credited"
}, cs = {
	open: "open",
	credited: "accepted",
	"not-credited": "cancelled"
}, ls = {
	"unknown-terminal": "Not credited: this task ended in a way the app could not read as a clean end.",
	"coverage-gap": "Not credited: a collection gap overlapped this task.",
	"waiting-at-end": "Not credited: an approval or a question was still pending when it ended."
}, us = {
	small: "Small, ran under 2 minutes",
	medium: "Medium, ran 2 to under 15 minutes",
	large: "Large, ran 15 minutes or more"
}, ds = {
	small: "Small",
	medium: "Medium",
	large: "Large"
};
function fs(e) {
	if (e.state === "credited") return as;
	if (e.state === "not-credited") {
		let t = e.closeReason;
		return t === null || t === "clean-end" ? "Not credited." : ls[t] ?? `Not credited (${String(t)}).`;
	}
	return e.attemptState === "working" ? "Open: still running. It closes by itself when it ends." : e.attemptState === "unknown" ? "Open: the app can no longer observe this task, so it cannot be closed yet." : "Open: it has ended and is waiting to be closed out.";
}
function ps(e) {
	let t = Math.floor(e / 1e3);
	if (t < 60) return `${t} s`;
	let n = Math.floor(t / 60);
	if (n < 60) return `${n} min`;
	let r = Math.floor(n / 60), i = n % 60;
	return i === 0 ? `${r} h` : `${r} h ${i} min`;
}
var ms = (e) => `${os[e.kind] ?? e.kind} · ${ps(e.runMs)}`, X = {
	heading: "Task evidence",
	evidenceHelp: "Observed by this app from the bot's own turns and the worker sessions it started. The app closes a task by itself; nobody clicks anything.",
	kind: "Kind",
	started: "Started",
	ended: "Ended",
	stillRunning: "Still running",
	notObserved: "Not observed",
	runTime: "Run time",
	sizeClass: "Size class",
	sizeNote: "Size follows how long the task has run. It does not show progress, health or remaining effort.",
	closeOut: "Close-out",
	xp: "XP credited",
	policy: "Policy",
	bot: "Bot",
	attempt: "Attempt",
	noXp: "No XP",
	noXpYet: "No XP yet",
	xpLine: (e, t) => `${e} XP (${t})`,
	invariant: "XP follows what the app observed. It is not a check that the outcome was right.",
	rewardHeading: "Reward",
	listColumns: {
		task: "Task",
		closeOut: "Close-out",
		size: "Size and run time",
		bot: "Bot",
		xp: "XP"
	},
	listCaption: "Tasks",
	sizeAndRun: (e) => `${ds[e.sizeClass]} · ${ps(e.runMs)}`
};
// ui/src/arena/CollapsedLabel.tsx
function hs({ glyph: e, text: t }) {
	return /* @__PURE__ */ f(u, { children: [/* @__PURE__ */ d("span", {
		className: "sa-arena-pane__glyph",
		"aria-hidden": "true",
		children: e
	}), /* @__PURE__ */ d("span", {
		className: "sa-arena-pane__text",
		"aria-hidden": "true",
		children: t
	})] });
}
// ui/src/arena/copy.ts
var gs = {
	defeated: "Defeated",
	notCredited: "Not credited",
	running: "Running",
	open: "Open"
}, _s = {
	unknown: "Progress unknown",
	milestones: (e, t) => `${e} of ${t} milestones`
}, Z = {
	region: "Arena",
	loading: "Loading the arena…",
	mapLabel: "Arena map",
	mapPlate: "Map art is not available. Positions are still correct.",
	listLabel: "Arena list",
	listHeading: "Everyone on the field",
	railLabel: "Specters",
	noSpecterYet: "No Specter yet",
	assign: "Assign",
	assignFor: (e) => `Assign a Specter to ${e}`,
	specterLoading: "Specters are loading.",
	specterUnavailable: "Specters could not be read, so no hero is drawn yet.",
	minimapLabel: "Arena overview",
	selectionLabel: "Selection",
	selectionEmpty: "Select a Specter or a minion in the map, the rail or the list.",
	coverage: (e, t) => `Coverage: ${e} ${e === 1 ? "bot has" : "bots have"} a collection gap, ${t} ${t === 1 ? "bot is" : "bots are"} unknown`,
	asOf: "As of",
	statsLabel: "Arena summary",
	botsObserved: "Bots observed",
	coverageUnknown: "Coverage unknown",
	committedXp: "Committed XP",
	botsOnField: "Bots on the field",
	botsOnFieldNone: "No bots are on the field.",
	emptyRosterTitle: "No bots are on the roster yet",
	emptyRosterBody: "The collector has not seen any Kiro Crew bots. Create or open a bot in Crew, then refresh.",
	noWork: "No tasks are on the field.",
	staleBanner: "Showing data from",
	retry: "Retry",
	unsupportedTitle: "Tasks are not available on this backend",
	unsupportedBody: "This version of the app backend does not support tasks, so the arena has no minions to draw.",
	forbiddenTitle: "Not permitted",
	forbiddenBody: "The host did not allow this app to read tasks.",
	offlineTitle: "Could not reach the app backend",
	offlineBody: "Check that the app is running, then retry.",
	unavailableTitle: "Tasks could not be loaded",
	unavailableBody: "The backend answered with an error. Retry in a moment.",
	unexpectedTitle: "Tasks answered in a form this page does not know",
	unexpectedBody: "The backend returned something unexpected. Nothing was changed.",
	overflow: (e) => `${e} more open ${e === 1 ? "task is" : "tasks are"} listed below and not drawn in the scene.`,
	truncated: "The arena read the first 8 pages of open tasks, so counts may be higher than shown.",
	closedNote: "Credited and not-credited tasks come from the 25 most recently updated of each, so an older one closed today may be missing here.",
	notDrawn: "Not drawn in the scene",
	attemptsBadge: (e) => `×${e} attempts`,
	linked: (e) => `${e} open ${e === 1 ? "attempt" : "attempts"}`,
	level: (e) => `Lv. ${e}`,
	xpAward: (e) => `+${e} XP`,
	xpCommitted: (e) => `${e} XP`,
	attackLegend: "Attacks show live activity, not progress. A waiting marker is Crew's own flag. A minion's size follows how long its task has run. It never means progress or remaining effort. Each hero keeps its spot on the map's lanes and jungle; position means nothing about the bot.",
	xpLoading: "Loading",
	xpUnavailable: "Unavailable",
	noXp: "No XP",
	selected: (e, t) => `Selected ${e}, ${t}`,
	unknownCondition: "Coverage unknown",
	atRest: "No turn running",
	engaging: "Working"
}, Q = {
	label: "Map controls",
	fit: "Fit map",
	reset: "Reset view",
	zoomIn: "Zoom in",
	zoomOut: "Zoom out",
	zoom: "Zoom",
	pause: "Pause animation",
	paused: "Animation paused",
	resume: "Resume animation",
	minimapShow: "Show overview",
	minimapHide: "Hide overview",
	railShow: "Show Specter rail",
	railHide: "Hide Specter rail",
	inspectorShow: "Show inspector",
	inspectorHide: "Hide inspector"
}, vs = {
	LIVE: "LIVE",
	FIXTURE: "FIXTURE — demo data, not Crew activity",
	RECORDED: "RECORDED — not live"
}, ys = [
	{
		value: "all",
		label: "All"
	},
	{
		value: "working",
		label: "Running"
	},
	{
		value: "credited",
		label: "Credited"
	},
	{
		value: "not-credited",
		label: "Not credited"
	},
	{
		value: "unknown",
		label: "Unknown"
	}
], bs = {
	eyebrow: "Task closed",
	title: "Task credited"
}, $ = {
	region: "Encounter inspector",
	close: "Close inspector",
	loading: "Loading evidence…",
	goneTitle: "This item is no longer available",
	goneBody: "It was removed, or this app can no longer see it. Nothing shown earlier is kept.",
	forbiddenTitle: "Not permitted",
	forbiddenBody: "The host did not allow this app to read it. Nothing shown earlier is kept.",
	failedTitle: "Evidence could not be loaded",
	failedBody: "Nothing shown earlier is kept. Retry in a moment.",
	retry: "Retry",
	defeated: "Defeated",
	committedXp: (e) => `${e} XP credited`,
	handoffHeading: "Reach Crew",
	summaryHeading: "Diagnostic summary",
	copyButton: "Copy diagnostic summary",
	copied: "Copied.",
	copyRefused: "Copy was refused. Select the text below.",
	summaryLabel: "Diagnostic summary text",
	summaryHelp: "Ids, states, times and counts only. No notes, names, links or message text.",
	specterFiction: "Fiction, written for this Specter",
	openWork: "Open tasks",
	noOpenWork: "No open task is linked to this Specter.",
	attempts: "Attempts",
	coverage: "Coverage",
	xpLedger: "XP ledger",
	noXp: "No XP entries yet.",
	loadOlder: "Load older entries",
	loadingOlder: "Loading older entries…",
	olderFailed: "Older entries could not be loaded.",
	source: "Source details",
	forBot: (e) => `for ${e}`,
	entryLine: (e, t, n) => `${e} ${t} · ${n}`
};
function xs(e, t, n, r = "") {
	return e === "loading" ? Z.xpLoading : e === "failed" ? Z.xpUnavailable : `${Z.level(t)} · ${Z.xpCommitted(n)}${r}`;
}
// ui/src/arena/CopySummary.tsx
function Ss({ build: e }) {
	let [t, n] = l({ kind: "idle" }), r = c(null), o = a();
	i(() => {
		t.kind === "refused" && (r.current?.focus(), r.current?.select());
	}, [t]);
	let s = async () => {
		let t = e();
		try {
			if (typeof navigator > "u" || navigator.clipboard === void 0) throw Error("clipboard unavailable");
			await navigator.clipboard.writeText(t), n({ kind: "copied" });
		} catch {
			n({
				kind: "refused",
				text: t
			});
		}
	};
	return /* @__PURE__ */ f("div", {
		className: "sa-arena-copy",
		children: [
			/* @__PURE__ */ d(H, {
				onClick: () => void s(),
				children: $.copyButton
			}),
			/* @__PURE__ */ d("p", {
				role: "status",
				className: "sa-help",
				children: t.kind === "copied" ? $.copied : t.kind === "refused" ? $.copyRefused : ""
			}),
			t.kind === "refused" && /* @__PURE__ */ f(u, { children: [/* @__PURE__ */ d("label", {
				htmlFor: o,
				className: "sa-visually-hidden",
				children: $.summaryLabel
			}), /* @__PURE__ */ d("textarea", {
				id: o,
				ref: r,
				className: "sa-arena-copy__text",
				readOnly: !0,
				rows: 8,
				value: t.text
			})] })
		]
	});
}
// ui/src/arena/handoff.ts
var Cs = [{
	id: "open-bots",
	label: "Open Bots in Crew",
	evidencePath: "docs/compatibility/handoff-routes.md#open-bots",
	buildHref: () => "/members"
}], ws = "Opens the Bots page in Crew. It cannot open this bot's chat or approvals directly.";
// ui/src/arena/HandoffRow.tsx
function Ts({ buildSummary: e }) {
	let t = Nt(), n = (e, n) => {
		e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || (e.preventDefault(), t(n));
	};
	return /* @__PURE__ */ f("section", {
		className: "sa-arena-section",
		"aria-label": $.handoffHeading,
		children: [
			/* @__PURE__ */ d("h3", { children: $.handoffHeading }),
			/* @__PURE__ */ d("ul", {
				className: "sa-arena-plain",
				children: Cs.map((e) => {
					let t = e.buildHref();
					return /* @__PURE__ */ d("li", { children: /* @__PURE__ */ d("a", {
						href: t,
						"data-handoff": e.id,
						onClick: (e) => n(e, t),
						children: e.label
					}) }, e.id);
				})
			}),
			/* @__PURE__ */ d("p", {
				className: "sa-help",
				children: ws
			}),
			/* @__PURE__ */ d(Ss, { build: e }),
			/* @__PURE__ */ d("p", {
				className: "sa-help",
				children: $.summaryHelp
			})
		]
	});
}
// ui/src/arena/specterShape.ts
var Es = (e) => ({
	contractVersion: 2,
	...e
}), Ds = "[truncated]", Os = "[removed]", ks = [
	/\bAuthorization\s*:\s*\S+(?:\s+\S+)?/gi,
	/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
	/\bBasic\s+(?=[A-Za-z0-9+/]*[0-9=+/])[A-Za-z0-9+/]{8,}={0,2}/g,
	/\b(?:Set-)?Cookie\s*:\s*[^\n]+/gi,
	/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+@\S+/gi,
	/\bhttps?:\/\/\S+/gi,
	/(?<![A-Za-z0-9])(?:[A-Za-z0-9]+[_-])*(?:token|secret|key|password|passwd|credential|session|cookie|auth)(?:[_-][A-Za-z0-9]+)*["']?\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s"',;]+)/gi,
	/\bsk-[A-Za-z0-9_-]{8,}/g,
	/\bgh[pousr]_[A-Za-z0-9]{8,}/g,
	/\bxox[abprs]-[A-Za-z0-9-]{8,}/g,
	/\bAKIA[0-9A-Z]{16}\b/g,
	/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*)?/g
];
function As(e) {
	return ks.reduce((e, t) => e.replace(t, Os), e);
}
var js = (e) => e.replace(/\s+/g, " ").trim(), Ms = (e) => e === null || !Number.isFinite(e) ? "unknown" : new Date(e).toISOString();
function Ns(e) {
	return [
		`bindingId: ${e.bindingId}`,
		`condition: ${js(e.condition.state)} (${js(e.condition.reasonCode)})`,
		`presence: ${js(e.presence)}`,
		`coverage: ${js(e.coverage.state)}, open gaps ${e.coverage.openGapCount}`,
		`lastObservedAt: ${Ms(e.lastObservedAtMs)}`,
		`workers: running ${e.workers.running}, seen ${e.workers.seen}, unknown ${e.workers.unknown}`
	];
}
function Ps(e) {
	return [
		`taskId: ${e.taskId}`,
		`attemptId: ${e.attemptId}`,
		`bindingId: ${e.bindingId}`,
		`kind: ${js(e.kind)}`,
		`state: ${js(e.state)}, closeReason ${e.closeReason === null ? "none" : js(e.closeReason)}, attempt ${js(e.attemptState)}`,
		`startedAt: ${Ms(e.startedAtMs)}, endedAt ${Ms(e.endedAtMs)}, closedAt ${Ms(e.closedAtMs)}`,
		`runMs: ${e.runMs}, sizeClass ${js(e.sizeClass)}`,
		`xpCredited: ${e.xpCredited === null ? "none" : e.xpCredited}, policy ${js(e.policyVersion)}`
	];
}
function Fs(e) {
	let { selection: t, model: n, bot: r, work: i, xp: a } = e, o = [
		r === null ? null : `roster-item v${r.contractVersion}`,
		i === null ? null : `task-item v${i.contractVersion}`,
		a === null ? null : `xp-summary v${a.contractVersion}`
	].filter((e) => e !== null), s = As([
		"Specter Arena diagnostic summary",
		`mode: ${vs[n.mode]}`,
		`asOf: ${Ms(n.asOfMs)}`,
		`selection: ${t.kind}`,
		`coverage: ${n.coverage.gaps} bots with a gap, ${n.coverage.unknownBots} bots unknown`,
		`field: ${n.enemies.length} drawn, ${n.overflow.enemies} not drawn${n.overflow.truncated ? ", counts are a minimum" : ""}`,
		...r === null ? [] : Ns(r),
		...a === null ? [] : [`level: ${a.level}, totalXp ${a.totalXp}, policy ${a.policyVersion}`],
		...i === null ? [] : Ps(i),
		`contracts: ${o.length === 0 ? "none read" : o.join(", ")}`
	].join("\n"));
	if (s.length <= 4e3) return s;
	let c = s.slice(0, 3988);
	return `${c.slice(0, Math.max(0, c.lastIndexOf("\n")))}\n${Ds}`;
}
// ui/src/arena/SpecterInspector.tsx
function Is(e, t) {
	return [...t.values()].filter((t) => t.bindingId === e && t.state === "open").sort((e, t) => t.startedAtMs - e.startedAtMs || (e.taskId < t.taskId ? -1 : 1));
}
function Ls({ specter: e, bot: t, record: n, summary: r, headingRef: i, list: a, collector: o, rosterRevision: s, items: c, onSelect: l, onClose: u }) {
	let p = Ar(e.bindingId), m = mr(e.bindingId), h = Is(e.bindingId, c), g = p.state.status === "ready" ? p.state.data : null, _ = e.specterName ?? e.displayName;
	return /* @__PURE__ */ f("div", {
		className: "sa-arena-inspector__body",
		children: [
			/* @__PURE__ */ f("div", {
				className: "sa-arena-inspector__head",
				children: [n !== void 0 && /* @__PURE__ */ d(Wn, {
					specter: Es(n),
					size: "md"
				}), /* @__PURE__ */ f("div", { children: [/* @__PURE__ */ d("h2", {
					ref: i,
					tabIndex: -1,
					children: _
				}), e.specterName !== null && /* @__PURE__ */ d("p", { children: $.forBot(e.displayName) })] })]
			}),
			/* @__PURE__ */ f("p", {
				className: "sa-arena-inspector__state",
				children: [/* @__PURE__ */ d(be, { view: P(t.condition) }), /* @__PURE__ */ d("span", { children: xs(e.xpReading, e.level, e.xpTotal, " committed") })]
			}),
			/* @__PURE__ */ d("p", {
				className: "sa-help",
				children: P(t.condition).reason
			}),
			n !== void 0 && /* @__PURE__ */ f("figure", {
				className: "sa-arena-fiction",
				children: [
					/* @__PURE__ */ d("figcaption", { children: $.specterFiction }),
					/* @__PURE__ */ d("p", { children: n.epithet }),
					/* @__PURE__ */ d("p", { children: n.personality })
				]
			}),
			/* @__PURE__ */ f("section", {
				className: "sa-arena-section",
				"aria-label": $.openWork,
				children: [/* @__PURE__ */ d("h3", { children: $.openWork }), h.length === 0 ? /* @__PURE__ */ d("p", { children: $.noOpenWork }) : /* @__PURE__ */ d("ul", {
					className: "sa-arena-plain",
					children: h.map((e) => /* @__PURE__ */ d("li", { children: /* @__PURE__ */ d(H, {
						variant: "ghost",
						onClick: () => l({
							kind: "work",
							workId: e.taskId
						}),
						children: ms(e)
					}) }, e.taskId))
				})]
			}),
			/* @__PURE__ */ f("section", {
				className: "sa-arena-section",
				"aria-label": $.attempts,
				children: [/* @__PURE__ */ d("h3", { children: $.attempts }), p.state.status === "ready" ? /* @__PURE__ */ d(Te, {
					items: p.state.items,
					hasOlder: p.state.hasOlder,
					loadingOlder: p.state.loadingOlder,
					olderFailed: p.state.olderFailed,
					onLoadOlder: p.loadOlder
				}) : p.state.status === "idle" ? null : /* @__PURE__ */ d(Ee, {
					state: p.state,
					onRetry: p.refresh
				})]
			}),
			/* @__PURE__ */ f("section", {
				className: "sa-arena-section",
				"aria-label": $.coverage,
				children: [
					/* @__PURE__ */ d("h3", { children: $.coverage }),
					/* @__PURE__ */ d("p", { children: E[t.coverage.state] ?? t.coverage.state }),
					p.state.status === "ready" && /* @__PURE__ */ d(ye, { activity: p.state.data.activity })
				]
			}),
			/* @__PURE__ */ f("section", {
				className: "sa-arena-section",
				"aria-label": $.xpLedger,
				children: [
					/* @__PURE__ */ d("h3", { children: $.xpLedger }),
					m.status === "ready" && m.entries.length === 0 && /* @__PURE__ */ d("p", { children: $.noXp }),
					m.entries.length > 0 && /* @__PURE__ */ d("ul", {
						className: "sa-arena-plain",
						"aria-label": $.xpLedger,
						children: m.entries.map((e) => /* @__PURE__ */ f("li", { children: [
							/* @__PURE__ */ d("span", { children: $.entryLine(Ae(e.kind), Ve(e.amount), e.workTitle) }),
							" ",
							/* @__PURE__ */ d(B, { ms: e.createdAtMs })
						] }, e.entryId))
					}),
					m.olderFailed && /* @__PURE__ */ d("p", {
						role: "alert",
						children: $.olderFailed
					}),
					m.hasOlder && /* @__PURE__ */ d(H, {
						onClick: m.loadOlder,
						disabled: m.loadingOlder,
						children: m.loadingOlder ? $.loadingOlder : $.loadOlder
					})
				]
			}),
			/* @__PURE__ */ f("section", {
				className: "sa-arena-section",
				"aria-label": $.source,
				children: [/* @__PURE__ */ d("h3", { children: $.source }), /* @__PURE__ */ d(Je, {
					item: t,
					collector: o,
					rosterRevision: s,
					attempts: g
				})]
			}),
			/* @__PURE__ */ d(Ts, { buildSummary: () => Fs({
				selection: {
					kind: "specter",
					bindingId: e.bindingId
				},
				model: a,
				bot: t,
				work: null,
				xp: r ?? null
			}) }),
			/* @__PURE__ */ d("div", {
				className: "sa-actions",
				children: /* @__PURE__ */ d(H, {
					variant: "ghost",
					onClick: u,
					children: $.close
				})
			})
		]
	});
}
// ui/src/tasks/TaskStateBadge.tsx
function Rs({ state: e }) {
	return /* @__PURE__ */ f("span", {
		className: `sa-work-badge sa-work-badge--${cs[e]}`,
		children: [/* @__PURE__ */ d("span", {
			className: "sa-status__dot",
			"aria-hidden": "true"
		}), ss[e]]
	});
}
var zs = (e) => e < 12e4 ? "small" : e < 9e5 ? "medium" : "large", Bs = ["bot-turn", "worker"], Vs = [
	"open",
	"credited",
	"not-credited"
], Hs = [
	"working",
	"ended",
	"unknown"
], Us = [
	"clean-end",
	"unknown-terminal",
	"coverage-gap",
	"waiting-at-end"
], Ws = [
	"small",
	"medium",
	"large"
], Gs = /^tsk_[0-9a-f]{24}$/, Ks = /^att_[0-9a-f]{24}$/, qs = /^bnd_[0-9a-f]{24}$/, Js = /^[a-z][a-z0-9-]{0,31}$/, Ys = (e) => typeof e == "object" && !!e && !Array.isArray(e), Xs = (e) => typeof e == "number" && Number.isSafeInteger(e) && e >= 0, Zs = (e, t) => typeof e == "string" && t.includes(e), Qs = (e, t) => typeof e == "string" && t.test(e), $s = (e) => e === null || Xs(e);
function ec(e) {
	if (!Ys(e)) return !1;
	let t = e;
	if (Object.keys(t).some((e) => !(e in qn)) || t.contractVersion !== 1 || !Qs(t.taskId, Gs) || !Qs(t.bindingId, qs) || !Qs(t.attemptId, Ks) || !Zs(t.kind, Bs) || !Zs(t.state, Vs) || !Zs(t.attemptState, Hs) || !(t.closeReason === null || Zs(t.closeReason, Us)) || !Xs(t.startedAtMs) || !$s(t.endedAtMs) || !$s(t.closedAtMs) || !Xs(t.updatedAtMs) || !Xs(t.runMs) || !Zs(t.sizeClass, Ws) || !(t.xpCredited === null || typeof t.xpCredited == "number" && Number.isInteger(t.xpCredited) && t.xpCredited >= 1 && t.xpCredited <= 30) || !Qs(t.policyVersion, Js)) return !1;
	let n = t.state === "credited";
	return n !== (t.closeReason === "clean-end") || n !== (t.xpCredited !== null) || t.state === "open" != (t.closeReason === null) ? !1 : t.sizeClass === zs(t.runMs);
}
function tc(e) {
	if (!ec(e)) throw new Me("unexpected task body");
	return e;
}
function nc(e) {
	let t = Ys(e) ? e : null;
	if (t === null || t.contractVersion !== 1 || !Array.isArray(t.items) || t.items.length > 25 || !t.items.every(ec) || t.nextCursor !== null && typeof t.nextCursor != "string" || !Xs(t.asOfMs)) throw new Me("unexpected tasks body");
	return {
		contractVersion: 1,
		items: t.items,
		nextCursor: t.nextCursor,
		asOfMs: t.asOfMs
	};
}
// ui/src/arena/useTaskEvidence.ts
function rc(e) {
	let t = kt(), n = Yn(s(() => e === null ? null : async () => tc(await t.getJson(ht(e))), [t, e]), e ?? ""), r = n.error, i;
	return i = e === null ? { status: "idle" } : r instanceof G && (r.error === "unknown_task" || r.status === 404) ? { status: "gone" } : r instanceof G && r.status === 403 ? { status: "forbidden" } : r === null ? n.data === null ? { status: "loading" } : {
		status: "ready",
		item: n.data
	} : {
		status: "failed",
		failure: ur(r)
	}, {
		state: i,
		refresh: n.refresh
	};
}
// ui/src/arena/TaskInspector.tsx
function ic({ headingRef: e, title: t, body: n, onRetry: r, onClose: i }) {
	return /* @__PURE__ */ f("div", {
		className: "sa-arena-inspector__body",
		children: [
			/* @__PURE__ */ d("h2", {
				ref: e,
				tabIndex: -1,
				children: t
			}),
			/* @__PURE__ */ d("p", {
				role: "status",
				children: n
			}),
			/* @__PURE__ */ f("div", {
				className: "sa-actions",
				children: [r !== void 0 && /* @__PURE__ */ d(H, {
					onClick: r,
					children: $.retry
				}), /* @__PURE__ */ d(H, {
					variant: "ghost",
					onClick: i,
					children: $.close
				})]
			})
		]
	});
}
var ac = (e) => e.state === "credited" && e.xpCredited !== null ? X.xpLine(e.xpCredited, e.policyVersion) : e.state === "open" ? X.noXpYet : X.noXp;
function oc({ taskId: e, headingRef: t, list: n, bots: r, known: i, onClose: a }) {
	let { state: o, refresh: s } = rc(e);
	if (o.status === "gone") return /* @__PURE__ */ d(ic, {
		headingRef: t,
		title: $.goneTitle,
		body: $.goneBody,
		onClose: a
	});
	if (o.status === "forbidden") return /* @__PURE__ */ d(ic, {
		headingRef: t,
		title: $.forbiddenTitle,
		body: $.forbiddenBody,
		onClose: a
	});
	if (o.status === "failed") return /* @__PURE__ */ d(ic, {
		headingRef: t,
		title: $.failedTitle,
		body: $.failedBody,
		onRetry: s,
		onClose: a
	});
	if (o.status !== "ready") return /* @__PURE__ */ f("div", {
		className: "sa-arena-inspector__body",
		children: [/* @__PURE__ */ d("h2", {
			ref: t,
			tabIndex: -1,
			children: i === void 0 ? "Task" : ms(i)
		}), /* @__PURE__ */ d("p", {
			role: "status",
			children: $.loading
		})]
	});
	let c = o.item;
	return /* @__PURE__ */ f("div", {
		className: "sa-arena-inspector__body",
		children: [
			/* @__PURE__ */ d("h2", {
				ref: t,
				tabIndex: -1,
				children: ms(c)
			}),
			/* @__PURE__ */ f("p", {
				className: "sa-arena-inspector__state",
				children: [
					/* @__PURE__ */ d(Rs, { state: c.state }),
					c.state === "credited" && /* @__PURE__ */ d("strong", { children: $.defeated }),
					c.state === "credited" && c.xpCredited !== null && /* @__PURE__ */ d("span", { children: $.committedXp(c.xpCredited) })
				]
			}),
			/* @__PURE__ */ d("p", { children: fs(c) }),
			/* @__PURE__ */ f("section", {
				className: "sa-arena-section",
				"aria-label": X.heading,
				children: [
					/* @__PURE__ */ d("h3", { children: X.heading }),
					/* @__PURE__ */ f("dl", {
						className: "sa-work-facts",
						children: [
							/* @__PURE__ */ d("dt", { children: X.kind }),
							/* @__PURE__ */ d("dd", { children: os[c.kind] }),
							/* @__PURE__ */ d("dt", { children: X.bot }),
							/* @__PURE__ */ d("dd", { children: ze(r, c.bindingId) }),
							/* @__PURE__ */ d("dt", { children: X.started }),
							/* @__PURE__ */ d("dd", { children: /* @__PURE__ */ d(B, { ms: c.startedAtMs }) }),
							/* @__PURE__ */ d("dt", { children: X.ended }),
							/* @__PURE__ */ d("dd", { children: c.endedAtMs === null ? c.attemptState === "unknown" ? X.notObserved : X.stillRunning : /* @__PURE__ */ d(B, { ms: c.endedAtMs }) }),
							/* @__PURE__ */ d("dt", { children: X.runTime }),
							/* @__PURE__ */ d("dd", { children: ps(c.runMs) }),
							/* @__PURE__ */ d("dt", { children: X.sizeClass }),
							/* @__PURE__ */ d("dd", { children: us[c.sizeClass] }),
							/* @__PURE__ */ d("dt", { children: X.closeOut }),
							/* @__PURE__ */ d("dd", { children: ss[c.state] }),
							/* @__PURE__ */ d("dt", { children: X.attempt }),
							/* @__PURE__ */ d("dd", { children: je(c.attemptId) })
						]
					}),
					/* @__PURE__ */ d("p", {
						className: "sa-help",
						children: X.sizeNote
					}),
					/* @__PURE__ */ d("p", {
						className: "sa-help",
						children: X.evidenceHelp
					})
				]
			}),
			/* @__PURE__ */ f("section", {
				className: "sa-arena-section",
				"aria-label": X.rewardHeading,
				children: [
					/* @__PURE__ */ d("h3", { children: X.rewardHeading }),
					/* @__PURE__ */ f("dl", {
						className: "sa-work-facts",
						children: [
							/* @__PURE__ */ d("dt", { children: X.xp }),
							/* @__PURE__ */ d("dd", { children: ac(c) }),
							/* @__PURE__ */ d("dt", { children: X.policy }),
							/* @__PURE__ */ d("dd", { children: c.policyVersion })
						]
					}),
					/* @__PURE__ */ d("p", {
						className: "sa-help",
						children: X.invariant
					})
				]
			}),
			/* @__PURE__ */ d(Ts, { buildSummary: () => Fs({
				selection: {
					kind: "work",
					workId: e
				},
				model: n,
				bot: null,
				work: c,
				xp: null
			}) }),
			/* @__PURE__ */ d("div", {
				className: "sa-actions",
				children: /* @__PURE__ */ d(H, {
					variant: "ghost",
					onClick: a,
					children: $.close
				})
			})
		]
	});
}
// ui/src/arena/selection.ts
var sc = (e) => e.kind === "specter" ? e.bindingId : e.workId, cc = (e, t, n) => e !== null && e.kind === t && sc(e) === n, lc = (e) => e === null ? "" : `${e.kind}:${sc(e)}`;
function uc({ selection: e, list: t, bots: n, collector: r, rosterRevision: a, specters: o, xp: s, items: l, open: u, onToggle: p, onSelect: m, onClose: h }) {
	let g = c(null), _ = c(null), v = c(!1), y = lc(e);
	i(() => {
		if (e === null) v.current && _.current?.isConnected && _.current.focus(), v.current = !1, _.current = null;
		else {
			if (!v.current) {
				let e = document.activeElement;
				_.current = e instanceof HTMLElement && e !== document.body ? e : null, v.current = !0;
			}
			g.current?.focus();
		}
	}, [y]);
	let b = (t) => {
		t.key === "Escape" && e !== null && (t.stopPropagation(), h());
	}, x;
	if (e === null) x = /* @__PURE__ */ d("p", { children: Z.selectionEmpty });
	else if (e.kind === "work") x = /* @__PURE__ */ d(oc, {
		taskId: e.workId,
		headingRef: g,
		list: t,
		bots: n,
		known: l.get(e.workId),
		onClose: h
	}, e.workId);
	else {
		let i = t.specters.find((t) => t.bindingId === e.bindingId), c = n.find((t) => t.bindingId === e.bindingId);
		x = i === void 0 || c === void 0 ? /* @__PURE__ */ f("div", {
			className: "sa-arena-inspector__body",
			children: [
				/* @__PURE__ */ d("h2", {
					ref: g,
					tabIndex: -1,
					children: $.goneTitle
				}),
				/* @__PURE__ */ d("p", {
					role: "status",
					children: $.goneBody
				}),
				/* @__PURE__ */ d(H, {
					variant: "ghost",
					onClick: h,
					children: $.close
				})
			]
		}) : /* @__PURE__ */ d(Ls, {
			specter: i,
			bot: c,
			record: o.get(e.bindingId),
			summary: s.get(e.bindingId),
			headingRef: g,
			list: t,
			collector: r,
			rosterRevision: a,
			items: l,
			onSelect: m,
			onClose: h
		}, e.bindingId);
	}
	return /* @__PURE__ */ f("aside", {
		className: `sa-arena-inspector${u ? "" : " sa-is-collapsed"}`,
		"aria-label": $.region,
		onKeyDown: b,
		children: [/* @__PURE__ */ d(H, {
			variant: "ghost",
			"aria-expanded": u,
			"aria-controls": "sa-arena-inspector-body",
			"aria-label": u ? void 0 : Q.inspectorShow,
			onClick: p,
			children: u ? Q.inspectorHide : /* @__PURE__ */ d(hs, {
				glyph: "‹",
				text: Q.inspectorShow
			})
		}), /* @__PURE__ */ d("div", {
			id: "sa-arena-inspector-body",
			className: "sa-arena-inspector__panel",
			hidden: !u,
			children: x
		})]
	});
}
// ui/src/arena/ModeBadge.tsx
function dc({ mode: e }) {
	return /* @__PURE__ */ d("span", {
		role: "status",
		className: `sa-mode sa-mode--${e.toLowerCase()}`,
		"data-mode": e,
		children: vs[e]
	});
}
// ui/src/arena/ArenaListView.tsx
var fc = (e, t) => t === "all" || t === "working" && e.condition === "working" || t === "unknown" && e.condition === "unknown", pc = (e, t, n) => n === "all" || n === "working" && t || n === "credited" && e.state === "credited" || n === "not-credited" && e.state === "not-credited" || n === "unknown" && e.state === "open" && e.attemptState === "unknown", mc = (e, t) => t.updatedAtMs - e.updatedAtMs || (e.taskId < t.taskId ? 1 : e.taskId > t.taskId ? -1 : 0);
function hc({ model: e, bots: t, items: n, drawn: r, selection: i, onSelect: a }) {
	let [o, s] = l("all"), c = new Map(t.map((e) => [e.bindingId, e])), u = e.specters.filter((e) => fc(e, o)), p = [];
	for (let t of e.enemies) {
		let e = n.get(t.workId);
		e !== void 0 && p.push({
			task: e,
			engaged: t.engagedBy.length > 0
		});
	}
	for (let e of [...n.values()].filter((e) => e.state === "not-credited").sort(mc)) p.push({
		task: e,
		engaged: !1
	});
	let m = p.filter(({ task: e, engaged: t }) => pc(e, t, o)), h = e.enemies.filter((e) => !r.has(e.workId)).length;
	return /* @__PURE__ */ f("section", {
		className: "sa-arena-list",
		"aria-label": Z.listLabel,
		children: [
			/* @__PURE__ */ f("header", {
				className: "sa-arena-list__head",
				children: [/* @__PURE__ */ d("h2", { children: Z.listHeading }), /* @__PURE__ */ d(dc, { mode: e.mode })]
			}),
			/* @__PURE__ */ d("div", {
				className: "sa-arena-filters",
				role: "group",
				"aria-label": "Filter the list",
				children: ys.map((e) => /* @__PURE__ */ d("button", {
					type: "button",
					className: "sa-chip sa-arena-filter",
					"aria-pressed": o === e.value,
					onClick: () => s(e.value),
					children: e.label
				}, e.value))
			}),
			h > 0 && /* @__PURE__ */ d("p", {
				className: "sa-help",
				children: Z.overflow(h)
			}),
			e.overflow.truncated && /* @__PURE__ */ d("p", {
				className: "sa-help",
				children: Z.truncated
			}),
			/* @__PURE__ */ d("p", {
				className: "sa-help",
				children: Z.closedNote
			}),
			/* @__PURE__ */ f("table", {
				className: "sa-arena-table",
				children: [
					/* @__PURE__ */ d("caption", { children: "Specters" }),
					/* @__PURE__ */ d("thead", { children: /* @__PURE__ */ f("tr", { children: [
						/* @__PURE__ */ d("th", {
							scope: "col",
							children: "Specter"
						}),
						/* @__PURE__ */ d("th", {
							scope: "col",
							children: "Condition"
						}),
						/* @__PURE__ */ d("th", {
							scope: "col",
							children: "Open attempts"
						}),
						/* @__PURE__ */ d("th", {
							scope: "col",
							children: "Level and XP"
						})
					] }) }),
					/* @__PURE__ */ d("tbody", { children: u.map((e) => {
						let t = c.get(e.bindingId);
						return /* @__PURE__ */ f("tr", { children: [
							/* @__PURE__ */ f("th", {
								scope: "row",
								children: [/* @__PURE__ */ d("button", {
									type: "button",
									className: "sa-arena-table__select",
									"aria-current": cc(i, "specter", e.bindingId) ? "true" : void 0,
									onClick: () => a({
										kind: "specter",
										bindingId: e.bindingId
									}),
									children: e.displayName
								}), e.specterName !== null && /* @__PURE__ */ d("span", {
									className: "sa-help",
									children: `Specter: ${e.specterName}`
								})]
							}),
							/* @__PURE__ */ d("td", { children: t !== void 0 && /* @__PURE__ */ d(be, { view: P(t.condition) }) }),
							/* @__PURE__ */ d("td", { children: e.openAttemptIds.length }),
							/* @__PURE__ */ d("td", { children: xs(e.xpReading, e.level, e.xpTotal) })
						] }, e.bindingId);
					}) })
				]
			}),
			/* @__PURE__ */ f("table", {
				className: "sa-arena-table",
				children: [
					/* @__PURE__ */ d("caption", { children: X.listCaption }),
					/* @__PURE__ */ d("thead", { children: /* @__PURE__ */ f("tr", { children: [
						/* @__PURE__ */ d("th", {
							scope: "col",
							children: X.listColumns.task
						}),
						/* @__PURE__ */ d("th", {
							scope: "col",
							children: X.listColumns.closeOut
						}),
						/* @__PURE__ */ d("th", {
							scope: "col",
							children: X.listColumns.size
						}),
						/* @__PURE__ */ d("th", {
							scope: "col",
							children: X.listColumns.bot
						}),
						/* @__PURE__ */ d("th", {
							scope: "col",
							children: X.listColumns.xp
						})
					] }) }),
					/* @__PURE__ */ d("tbody", { children: m.map(({ task: e }) => /* @__PURE__ */ f("tr", { children: [
						/* @__PURE__ */ f("th", {
							scope: "row",
							children: [
								/* @__PURE__ */ d("button", {
									type: "button",
									className: "sa-arena-table__select",
									"aria-current": cc(i, "work", e.taskId) ? "true" : void 0,
									onClick: () => a({
										kind: "work",
										workId: e.taskId
									}),
									children: ms(e)
								}),
								/* @__PURE__ */ f("span", {
									className: "sa-help",
									children: [`${X.started} `, /* @__PURE__ */ d(B, { ms: e.startedAtMs })]
								}),
								e.state === "open" && !r.has(e.taskId) && /* @__PURE__ */ d("span", {
									className: "sa-help",
									children: Z.notDrawn
								})
							]
						}),
						/* @__PURE__ */ f("td", { children: [/* @__PURE__ */ d(Rs, { state: e.state }), /* @__PURE__ */ d("span", {
							className: "sa-help",
							children: fs(e)
						})] }),
						/* @__PURE__ */ d("td", { children: X.sizeAndRun(e) }),
						/* @__PURE__ */ d("td", { children: ze(t, e.bindingId) }),
						/* @__PURE__ */ d("td", { children: e.xpCredited === null ? e.state === "open" ? X.noXpYet : X.noXp : Z.xpCommitted(e.xpCredited) })
					] }, e.taskId)) })
				]
			})
		]
	});
}
// ui/src/arena/ArenaRail.tsx
function gc({ model: e, bots: t, specters: n, xp: r, selection: i, onSelect: a, open: o, onToggle: s, specterStatus: c = "ready", unassigned: l, onAssign: u }) {
	let p = new Map(t.map((e) => [e.bindingId, e])), m = e.specters.filter((e) => e.heroId !== null), h = e.specters.filter((e) => e.heroId === null), g = (e) => u !== void 0 && (l === void 0 || l.has(e)), _ = (e) => {
		let t = n.get(e.bindingId), o = p.get(e.bindingId);
		return /* @__PURE__ */ f("button", {
			type: "button",
			className: "sa-arena-rail__row",
			"aria-pressed": cc(i, "specter", e.bindingId),
			onClick: () => a({
				kind: "specter",
				bindingId: e.bindingId
			}),
			children: [t === void 0 ? /* @__PURE__ */ d("span", {
				className: "sa-token__placeholder",
				"aria-hidden": "true",
				children: gn(e.displayName)
			}) : /* @__PURE__ */ d(Wn, {
				specter: Es(t),
				size: "sm",
				decorative: !0
			}), /* @__PURE__ */ f("span", {
				className: "sa-arena-rail__copy",
				children: [
					/* @__PURE__ */ d("strong", { children: e.specterName ?? e.displayName }),
					e.specterName !== null && /* @__PURE__ */ d("span", {
						className: "sa-help",
						children: `for ${e.displayName}`
					}),
					o !== void 0 && /* @__PURE__ */ d(be, { view: P(o.condition) }),
					/* @__PURE__ */ d(or, {
						compact: !0,
						summary: r.get(e.bindingId),
						unavailable: e.xpReading === "ready" ? void 0 : e.xpReading
					}),
					e.heroId !== null && /* @__PURE__ */ d("span", {
						className: "sa-help",
						children: Z.linked(e.openAttemptIds.length)
					})
				]
			})]
		});
	};
	return /* @__PURE__ */ f("aside", {
		className: `sa-arena-rail${o ? "" : " sa-is-collapsed"}`,
		"aria-label": Z.railLabel,
		children: [/* @__PURE__ */ d(H, {
			variant: "ghost",
			"aria-expanded": o,
			"aria-controls": "sa-arena-rail-body",
			"aria-label": o ? void 0 : Q.railShow,
			onClick: s,
			children: o ? Q.railHide : /* @__PURE__ */ d(hs, {
				glyph: "›",
				text: Q.railShow
			})
		}), /* @__PURE__ */ f("div", {
			id: "sa-arena-rail-body",
			className: "sa-arena-rail__body",
			hidden: !o,
			children: [/* @__PURE__ */ d("ul", {
				className: "sa-arena-rail__list",
				children: m.map((e) => /* @__PURE__ */ d("li", { children: _(e) }, e.bindingId))
			}), c === "ready" ? h.length > 0 && /* @__PURE__ */ f("section", {
				className: "sa-arena-rail__unassigned",
				"aria-labelledby": "sa-arena-rail-unassigned",
				children: [/* @__PURE__ */ d("h3", {
					id: "sa-arena-rail-unassigned",
					children: `${Z.noSpecterYet} (${h.length})`
				}), /* @__PURE__ */ d("ul", {
					className: "sa-arena-rail__list",
					children: h.map((e) => /* @__PURE__ */ f("li", {
						className: "sa-arena-rail__unassigned-row",
						children: [_(e), g(e.bindingId) && u !== void 0 && /* @__PURE__ */ d(H, {
							onClick: () => u(e.bindingId),
							"aria-label": Z.assignFor(e.displayName),
							children: Z.assign
						})]
					}, e.bindingId))
				})]
			}) : /* @__PURE__ */ d("p", {
				className: "sa-help",
				role: "status",
				children: c === "loading" ? Z.specterLoading : Z.specterUnavailable
			})]
		})]
	});
}
// ui/src/arena/ArenaStats.tsx
function _c({ botsObserved: e, coverageUnknown: t, committedXp: n, xpReading: r = "ready" }) {
	let i = [
		[Z.botsObserved, e],
		[Z.coverageUnknown, t],
		[Z.committedXp, r === "loading" ? Z.xpLoading : r === "failed" ? Z.xpUnavailable : n]
	];
	return /* @__PURE__ */ d("div", {
		role: "group",
		"aria-label": Z.statsLabel,
		children: /* @__PURE__ */ d("dl", {
			className: "sa-arena-stats",
			children: i.map(([e, t]) => /* @__PURE__ */ f("div", {
				className: "sa-arena-stat",
				children: [/* @__PURE__ */ d("dt", { children: e }), /* @__PURE__ */ d("dd", { children: t })]
			}, e))
		})
	});
}
// ui/src/arena/ArenaMinimap.tsx
var vc = (e) => `${(e * 100).toFixed(2)}%`, yc = [
	{
		id: "sanctum",
		point: Ji.alliedBase,
		node: /* @__PURE__ */ d(ii, {
			title: "",
			decorative: !0
		})
	},
	{
		id: "citadel",
		point: Ji.farBase,
		node: /* @__PURE__ */ d(ai, {
			title: "",
			decorative: !0
		})
	},
	{
		id: "camp",
		point: Ji.clearings[2],
		node: /* @__PURE__ */ d(oi, {
			title: "",
			decorative: !0
		})
	}
];
function bc({ placement: e, view: t, hasMap: n, open: r, onToggle: i }) {
	let o = a();
	return /* @__PURE__ */ f("div", {
		className: "sa-arena-minimap",
		children: [/* @__PURE__ */ d(H, {
			variant: "ghost",
			"aria-expanded": r,
			"aria-controls": o,
			onClick: i,
			children: r ? Q.minimapHide : Q.minimapShow
		}), /* @__PURE__ */ d("div", {
			id: o,
			hidden: !r,
			children: /* @__PURE__ */ f("div", {
				className: `sa-arena-minimap__frame${n ? " sa-has-art" : ""}`,
				role: "img",
				"aria-label": Z.minimapLabel,
				children: [
					/* @__PURE__ */ d("svg", {
						className: "sa-arena-minimap__paths",
						viewBox: "0 0 100 100",
						preserveAspectRatio: "none",
						"aria-hidden": "true",
						children: Ji.paths.map((e) => /* @__PURE__ */ d("polyline", {
							className: "sa-arena-minimap__path",
							points: e.points.map((e) => `${e.x * 100},${e.y * 100}`).join(" ")
						}, e.id))
					}),
					yc.map((e) => /* @__PURE__ */ d("span", {
						className: "sa-arena-minimap__structure",
						"data-structure": e.id,
						style: {
							left: vc(e.point.x),
							top: vc(e.point.y)
						},
						"aria-hidden": "true",
						children: e.node
					}, e.id)),
					[...e.enemies].map(([e, t]) => /* @__PURE__ */ d("i", {
						className: "sa-arena-minimap__dot sa-arena-minimap__dot--enemy",
						style: {
							left: vc(t.x),
							top: vc(t.y)
						}
					}, e)),
					[...e.specters].map(([e, t]) => /* @__PURE__ */ d("i", {
						className: "sa-arena-minimap__dot sa-arena-minimap__dot--specter",
						style: {
							left: vc(t.x),
							top: vc(t.y)
						}
					}, e)),
					/* @__PURE__ */ d("span", {
						className: "sa-arena-minimap__view",
						style: {
							left: vc(t.x),
							top: vc(t.y),
							width: vc(t.width),
							height: vc(t.height)
						}
					})
				]
			})
		})]
	});
}
var xc = {
	set: (e, t) => window.setTimeout(e, t),
	clear: (e) => window.clearTimeout(e)
};
function Sc(e = xc) {
	let t = /* @__PURE__ */ new Map();
	return {
		schedule(n, r, i) {
			let a = t.get(n);
			a !== void 0 && e.clear(a), t.set(n, e.set(() => {
				t.delete(n), i();
			}, r));
		},
		cancelAll() {
			for (let n of t.values()) e.clear(n);
			t.clear();
		},
		pendingCount: () => t.size
	};
}
function Cc({ cue: e, particles: t, onComplete: n }) {
	let r = s(() => Sc(), []);
	return i(() => (r.schedule(e.id, e.durationMs, () => n(e.id)), () => r.cancelAll()), [
		r,
		e.id,
		e.durationMs,
		n
	]), /* @__PURE__ */ f("div", {
		className: "sa-cue",
		"data-cue": e.workId,
		children: [
			/* @__PURE__ */ d("span", { className: "sa-cue__ring" }),
			/* @__PURE__ */ d("span", {
				className: "sa-cue__particles",
				children: Array.from({ length: t }, (e, t) => /* @__PURE__ */ d("i", { style: { "--sa-particle": t } }, t))
			}),
			/* @__PURE__ */ d("span", {
				className: "sa-cue__eyebrow",
				children: bs.eyebrow
			}),
			/* @__PURE__ */ d("strong", { children: bs.title }),
			/* @__PURE__ */ d("small", { children: e.committedXp === null ? e.title : `${e.title} · +${e.committedXp} XP` })
		]
	});
}
function wc({ cues: e, onComplete: t }) {
	let n = e.slice(0, 4), r = n.length === 0 ? 0 : Math.floor(24 / n.length);
	return /* @__PURE__ */ d("div", {
		className: "sa-cue-layer",
		"aria-hidden": "true",
		children: n.map((e) => /* @__PURE__ */ d(Cc, {
			cue: e,
			particles: Math.min(r, 8),
			onComplete: t
		}, e.id))
	});
}
// ui/src/arena/StrikeLayer.tsx
function Tc({ shots: e }) {
	return /* @__PURE__ */ d("div", {
		className: "sa-strike-layer",
		"aria-hidden": "true",
		children: e.map((e) => {
			let t = Wr(e.heroId);
			if (t === null) return null;
			let { from: n, to: r, stageWidth: i, stageHeight: a } = e.geometry, o = (r.x - n.x) * i, s = (r.y - n.y) * a - -4, c = e.kind === "cast" ? t.castImpact : t.attackImpact, l = {
				left: `${n.x * 100}%`,
				top: `${n.y * 100}%`,
				"--sa-sx": `${o.toFixed(1)}px`,
				"--sa-sy": `${s.toFixed(1)}px`,
				"--sa-strike-ms": `${c}ms`,
				"--sa-strike-color": Kr(e.heroId),
				"--sa-strike-angle": `${(Math.atan2(s, o) * 180 / Math.PI).toFixed(1)}deg`
			};
			return /* @__PURE__ */ f("span", {
				className: `sa-strike sa-strike--${e.kind}`,
				"data-strike": e.heroId,
				style: l,
				children: [/* @__PURE__ */ d("i", { className: "sa-strike__bolt" }), /* @__PURE__ */ d("i", { className: "sa-strike__head" })]
			}, e.key);
		})
	});
}
function Ec(e, t, n, r, i) {
	let a = [];
	for (let [o, s] of e.heroes) {
		let e = t(o), c = n(o), l = r(s.workId);
		e !== null && c !== void 0 && l !== void 0 && a.push({
			key: `${o}:${s.exchangeId}`,
			heroId: e,
			kind: s.kind,
			geometry: {
				from: c,
				to: l,
				stageWidth: i.width,
				stageHeight: i.height
			}
		});
	}
	return a;
}
// ui/src/arena/effectMap.ts
function Dc(e) {
	return e.condition === "unknown" ? "coverage-unknown" : e.condition === "working" ? "engaging" : "at-rest";
}
function Oc(e) {
	return e.kind === "milestones" ? _s.milestones(e.done, e.total) : _s.unknown;
}
function kc(e) {
	return e.defeated ? "outcome-accepted" : null;
}
function Ac(e) {
	return {
		pose: e.defeated ? "defeated" : e.engagedBy.length > 0 ? "engaged" : "idle",
		marker: kc(e),
		progressText: Oc(e.progress),
		stateText: e.defeated ? gs.defeated : e.state === "not-credited" ? gs.notCredited : e.engagedBy.length > 0 ? gs.running : gs.open
	};
}
// ui/src/arena/heroPlacement.ts
var jc = 24301, Mc = .04;
function Nc(e) {
	let t = e >>> 0;
	return () => {
		t = t + 1831565813 >>> 0;
		let e = Math.imul(t ^ t >>> 15, t | 1);
		return e ^= e + Math.imul(e ^ e >>> 7, e | 61), ((e ^ e >>> 14) >>> 0) / 4294967296;
	};
}
var Pc = (e, t) => Math.hypot((e.x - t.x) * qi.width, (e.y - t.y) * qi.height), Fc = (e, t) => t.every((t) => Pc(e, t) >= 100), Ic = (e) => Number.isFinite(e.x) && Number.isFinite(e.y) && e.x >= .03 && e.x <= .97 && e.y >= .03 && e.y <= .97, Lc = (e, t) => e < t ? -1 : +(e > t), Rc = (e, t) => Math.abs(e.x - t.x) < 1e-9 && Math.abs(e.y - t.y) < 1e-9, zc = (e, t) => t.find((t) => Rc(t.point, e))?.region ?? null;
function Bc(e, t, n = jc) {
	let r = na(), i = [...new Set(t)].sort(Lc), a = /* @__PURE__ */ new Map(), o = [], s = new Map(Yi.map((e) => [e, 0])), c = (e) => {
		let t = zc(e, r);
		t !== null && s.set(t, (s.get(t) ?? 0) + 1);
	};
	for (let t of i) {
		let n = e.get(t);
		n !== void 0 && Ic(n) && Fc(n, o) && (a.set(t, n), o.push(n), c(n));
	}
	for (let e of i.filter((e) => !a.has(e))) {
		let t = Nc(Si(`${n >>> 0}:${e}`)), i = (e) => r.filter((t) => t.region === e && Fc(t.point, o)), l = Yi.filter((e) => i(e).length > 0), u = null;
		if (l.length > 0) {
			let e = Math.min(...l.map((e) => s.get(e) ?? 0)), n = l.filter((t) => (s.get(t) ?? 0) === e), r = n[Math.floor(t() * n.length)], a = i(r);
			u = a[Math.floor(t() * a.length)].point;
		} else {
			let e = Math.min(...Yi.map((e) => s.get(e) ?? 0)), n = Yi.filter((t) => (s.get(t) ?? 0) === e), i = n[Math.floor(t() * n.length)], a = r.filter((e) => e.region === i);
			for (let e = 0; e < 12 && u === null; e += 1) {
				let e = a[Math.floor(t() * a.length)].point, n = {
					x: e.x + (t() * 2 - 1) * Mc,
					y: e.y + (t() * 2 - 1) * Mc
				};
				Ic(n) && Fc(n, o) && (u = n);
			}
			for (let e = 0; e < 21 && u === null; e += 1) {
				let t = Fa(e);
				Fc(t, o) && (u = t);
			}
		}
		let d = u ?? Fa(o.length);
		a.set(e, d), o.push(d), c(d);
	}
	return a;
}
// ui/src/arena/useElementSize.ts
var Vc = {
	width: 800,
	height: 450
};
function Hc(e) {
	let [t, n] = l(Vc);
	return i(() => {
		let t = e.current;
		if (t === null || typeof ResizeObserver > "u") return;
		let r = new ResizeObserver((e) => {
			let t = e[0]?.contentRect;
			t !== void 0 && t.width > 0 && t.height > 0 && n((e) => e.width === t.width && e.height === t.height ? e : {
				width: t.width,
				height: t.height
			});
		});
		return r.observe(t), () => r.disconnect();
	}, [e]), t;
}
// ui/src/arena/BattlefieldScene.tsx
var Uc = .25;
function Wc({ kind: e }) {
	return d(e === "blocked" ? Xr : e === "awaiting-approval" ? $r : e === "evidence" ? Zr : e === "outcome-accepted" ? ei : e === "assistance" ? ti : Qr, {
		title: "",
		decorative: !0,
		className: "sa-token__marker"
	});
}
var Gc = (e) => e.heroId !== null && e.specterName !== null;
function Kc(e) {
	return `${e.openAttemptIds.length > 1 ? `${e.specterName} ${Z.attemptsBadge(e.openAttemptIds.length)}` : e.specterName} for ${e.displayName}`;
}
function qc(e, t) {
	let n = [
		Kc(e),
		t,
		e.xpReading === "ready" ? `Level ${e.level}` : null
	];
	return e.openAttemptIds.length > 0 && n.push(Z.linked(e.openAttemptIds.length)), n.filter((e) => e !== null).join(", ");
}
function Jc(e) {
	let t = Ac(e), n = [
		e.title,
		t.stateText,
		t.progressText
	];
	return e.defeated && e.committedXp !== null && n.push(Z.xpAward(e.committedXp)), n.push(e.size === "encounter" ? "encounter" : "task"), n.join(", ");
}
function Yc({ specter: e, position: t, selected: n, roving: r, animate: i, animation: a, angle: o, flip: s, onSelect: c, register: l }) {
	let p = Dc(e), m = e.condition === "waiting" ? h.waiting : p === "coverage-unknown" ? Z.unknownCondition : p === "engaging" ? Z.engaging : Z.atRest, g = {
		left: `${t.x * 100}%`,
		top: `${t.y * 100}%`
	};
	return /* @__PURE__ */ f("button", {
		type: "button",
		ref: l,
		className: `sa-token sa-token--specter sa-is-${p}${n ? " sa-is-selected" : ""}`,
		style: g,
		"data-sprite": "specter",
		"data-scene-node": "specter",
		"data-token": e.bindingId,
		"aria-pressed": n,
		"aria-label": qc(e, m),
		tabIndex: r ? 0 : -1,
		onClick: c,
		children: [
			/* @__PURE__ */ d(yi, {
				heroId: e.heroId,
				animate: i,
				animation: a,
				angle: o,
				flip: s,
				initials: gn(e.specterName)
			}),
			/* @__PURE__ */ d("span", {
				className: "sa-token__label",
				"aria-hidden": "true",
				children: e.specterName
			}),
			e.openAttemptIds.length > 1 && /* @__PURE__ */ f(u, { children: [" ", /* @__PURE__ */ d("span", {
				className: "sa-token__badge",
				"aria-hidden": "true",
				children: Z.attemptsBadge(e.openAttemptIds.length)
			})] }),
			p === "coverage-unknown" && /* @__PURE__ */ d(Wc, { kind: "coverage-unknown" }),
			e.waitingReason === "approval-pending" && /* @__PURE__ */ d(Wc, { kind: "awaiting-approval" })
		]
	});
}
function Xc({ enemy: e, position: t, selected: n, roving: r, animate: i, celebrating: a, spriteReady: o, facing: s, hit: c, counter: l, onSelect: p, register: m }) {
	let h = Ac(e), g = {
		left: `${t.x * 100}%`,
		top: `${t.y * 100}%`,
		"--sa-minion-scale": La[e.sizeClass]
	};
	return /* @__PURE__ */ f("button", {
		type: "button",
		ref: m,
		className: `sa-token sa-token--enemy sa-token--${e.size} sa-is-${h.pose}${n ? " sa-is-selected" : ""}${e.blocked ? " sa-is-blocked" : ""}`,
		style: g,
		"data-sprite": "enemy",
		"data-size-class": e.sizeClass,
		"data-scene-node": "enemy",
		"data-token": e.workId,
		"aria-pressed": n,
		"aria-label": Jc(e),
		tabIndex: r ? 0 : -1,
		onClick: p,
		children: [
			/* @__PURE__ */ d(ui, {
				minionType: e.size === "encounter" ? "patchbrute" : "patchling",
				animation: a ? "defeat" : c !== null && !e.defeated ? "hit" : l !== null && !e.defeated ? "attack" : h.pose === "engaged" ? "engaged" : "idle",
				animate: i,
				spriteReady: o,
				defeated: e.defeated,
				facing: s,
				requestId: c?.exchangeId ?? l?.exchangeId ?? 0,
				recoil: c?.recoil ?? 1,
				lunge: l?.lunge ?? 1,
				strong: c?.strong ?? !1
			}),
			/* @__PURE__ */ d("span", {
				className: "sa-token__label",
				"aria-hidden": "true",
				children: e.title
			}),
			" ",
			/* @__PURE__ */ f("span", {
				className: "sa-token__meta",
				"aria-hidden": "true",
				children: [
					h.stateText,
					" · ",
					h.progressText
				]
			}),
			e.defeated && e.committedXp !== null && /* @__PURE__ */ f(u, { children: [" ", /* @__PURE__ */ d("span", {
				className: "sa-token__xp",
				"aria-hidden": "true",
				children: Z.xpAward(e.committedXp)
			})] }),
			h.marker !== null && /* @__PURE__ */ d(Wc, { kind: h.marker })
		]
	});
}
function Zc(e, t) {
	let n = t.enemies.get(e.workId), r = e.engagedBy[0], i = r === void 0 ? void 0 : t.specters.get(r);
	return n !== void 0 && i !== void 0 && i.x > n.x ? "right" : "left";
}
var Qc = (e) => e.length > 2e6 ? null : `url("${e}")`;
function $c({ model: e, selection: t, onSelect: n, motion: r, cues: i, celebrating: a, onCueComplete: o, exchanges: u = Pi, collectorPaused: p = !1 }) {
	let m = s(() => ({
		...e,
		specters: e.specters.filter(Gc)
	}), [e]), h = nn("arena-map"), g = nn("minion-patchling-sprite"), _ = nn("minion-patchbrute-sprite"), v = c(null), y = Hc(v), [b, x] = l(1), [S, te] = l({
		x: 0,
		y: 0
	}), [C, w] = l(!0), T = c(null), E = h.status === "ready" ? h.art.width : qi.width, D = h.status === "ready" ? h.art.height : qi.height, O = s(() => Wi(y, {
		width: E,
		height: D
	}, b, S), [
		y,
		E,
		D,
		b,
		S
	]), k = c(/* @__PURE__ */ new Map()), A = s(() => m.specters.map((e) => e.bindingId), [m]), j = s(() => {
		let e = Bc(k.current, A);
		return k.current = e, e;
	}, [A]), M = c(/* @__PURE__ */ new Map()), N = s(() => {
		let e = Ma(M.current, m, j);
		return M.current = e, e;
	}, [m, j]), ne = c(/* @__PURE__ */ new Map()), re = s(() => Pa(m, N), [m, N]), P = s(() => {
		let e = Aa(ne.current, re, void 0, ka(j.values(), Na(m, j, N)));
		return ne.current = e, e;
	}, [
		re,
		j,
		m,
		N
	]), F = s(() => Ia(m, P, j, N), [
		m,
		P,
		j,
		N
	]), I = s(() => Ki(O), [O]), ie = s(() => [...m.specters.map((e) => e.bindingId), ...m.enemies.map((e) => e.workId)], [m]), [ae, oe] = l(null), L = ae !== null && ie.includes(ae) ? ae : ie[0] ?? null, se = c(/* @__PURE__ */ new Map()), ce = (e) => (t) => {
		t === null ? se.current.delete(e) : se.current.set(e, t);
	}, le = (e) => {
		let t = ie.indexOf(e.target.getAttribute("data-token") ?? "");
		if (t === -1) return;
		let n = ie.length - 1, r = e.key === "ArrowRight" || e.key === "ArrowDown" ? Math.min(n, t + 1) : e.key === "ArrowLeft" || e.key === "ArrowUp" ? Math.max(0, t - 1) : e.key === "Home" ? 0 : e.key === "End" ? n : null, i = r === null ? void 0 : ie[r];
		i !== void 0 && (e.preventDefault(), oe(i), se.current.get(i)?.focus());
	}, ue = (e) => {
		e.target.closest("[data-scene-node]") === null && (T.current = {
			x: e.clientX,
			y: e.clientY,
			pan: O.pan
		});
	}, de = (e) => {
		let t = T.current;
		t !== null && te({
			x: t.pan.x + e.clientX - t.x,
			y: t.pan.y + e.clientY - t.y
		});
	}, fe = () => {
		T.current = null;
	}, pe = (e) => x((t) => Ui(Math.round((t + e) * 100) / 100, 1, Hi)), R = () => {
		x(1), te({
			x: 0,
			y: 0
		});
	}, z = new Map(m.enemies.map((e) => [e.workId, e])), me = m.specters.flatMap((e) => e.engagedWorkIds.flatMap((t) => {
		let n = F.specters.get(e.bindingId), r = F.enemies.get(t);
		return n !== void 0 && r !== void 0 && z.has(t) ? [{
			key: `${e.bindingId}:${t}`,
			from: n,
			to: r
		}] : [];
	})), he = (e) => {
		let t = u.heroes.get(e), n = F.specters.get(e), r = u.flinches.get(e);
		if (t === void 0 && r !== void 0 && n !== void 0) {
			let e = F.enemies.get(r.workId);
			return e === void 0 ? {
				animation: "idle",
				angle: 0,
				flip: 1
			} : {
				animation: "flinch",
				angle: 0,
				flip: e.x < n.x ? -1 : 1
			};
		}
		let i = t === void 0 ? void 0 : F.enemies.get(t.workId);
		if (t === void 0 || n === void 0 || i === void 0) return {
			animation: "idle",
			angle: 0,
			flip: 1
		};
		let a = (i.x - n.x) * qi.width, o = (i.y - n.y) * qi.height;
		return {
			animation: t.kind,
			angle: qr(a, o),
			flip: a < 0 ? -1 : 1
		};
	}, ge = (e) => {
		let t = u.enemies.get(e.workId);
		if (t === void 0) return null;
		let n = F.enemies.get(e.workId), r = t.bindingId === null ? void 0 : F.specters.get(t.bindingId);
		return {
			exchangeId: t.exchangeId,
			strong: t.strong,
			recoil: n !== void 0 && r !== void 0 && n.x < r.x ? -1 : 1
		};
	}, B = (e) => {
		let t = u.counters.get(e.workId);
		if (t === void 0) return null;
		let n = F.enemies.get(e.workId), r = F.specters.get(t.bindingId);
		return n !== void 0 && r !== void 0 ? {
			exchangeId: t.exchangeId,
			lunge: r.x < n.x ? -1 : 1
		} : null;
	}, _e = new Map(m.specters.map((e) => [e.bindingId, e.heroId])), ve = Ec(u, (e) => _e.get(e) ?? null, (e) => F.specters.get(e), (e) => F.enemies.get(e), O.displayed), ye = {}, be = h.status === "ready" ? Qc(h.art.url) : null, V = g.status === "ready" ? Qc(g.art.url) : null, xe = _.status === "ready" ? Qc(_.art.url) : null;
	be !== null && (ye["--sa-map"] = be), V !== null && (ye["--sa-sprite-patchling"] = V), xe !== null && (ye["--sa-sprite-patchbrute"] = xe);
	let Se = {
		left: O.offset.x + O.pan.x,
		top: O.offset.y + O.pan.y,
		width: O.displayed.width,
		height: O.displayed.height,
		"--sa-minion-base": `${Va(O.displayed.width).toFixed(2)}px`,
		"--sa-hero-size": `${Ba(O.displayed.width, O.displayed.height).toFixed(2)}px`
	};
	return /* @__PURE__ */ f("section", {
		className: `sa-arena-scene ${r.animate ? "sa-is-animated" : "sa-is-static"}`,
		"aria-label": "Arena scene",
		style: ye,
		children: [
			/* @__PURE__ */ f("div", {
				className: "sa-arena-hud",
				role: "toolbar",
				"aria-label": Q.label,
				children: [
					/* @__PURE__ */ d(H, {
						onClick: R,
						children: Q.fit
					}),
					/* @__PURE__ */ d(H, {
						onClick: () => te({
							x: 0,
							y: 0
						}),
						children: Q.reset
					}),
					/* @__PURE__ */ d(H, {
						onClick: () => pe(-.25),
						disabled: O.zoom <= 1,
						"aria-label": Q.zoomOut,
						children: "−"
					}),
					/* @__PURE__ */ d("output", {
						className: "sa-arena-zoom",
						"aria-live": "polite",
						"aria-label": Q.zoom,
						children: `${O.zoom.toFixed(2)}×`
					}),
					/* @__PURE__ */ d(H, {
						onClick: () => pe(Uc),
						disabled: O.zoom >= Hi,
						"aria-label": Q.zoomIn,
						children: "+"
					}),
					/* @__PURE__ */ d(H, {
						"aria-pressed": r.paused,
						onClick: r.togglePause,
						children: r.paused ? Q.resume : Q.pause
					})
				]
			}),
			/* @__PURE__ */ d("div", {
				className: "sa-arena-frame",
				children: /* @__PURE__ */ f("div", {
					ref: v,
					className: "sa-arena-viewport",
					role: "group",
					"aria-label": Z.mapLabel,
					onKeyDown: le,
					onPointerDown: ue,
					onPointerMove: de,
					onPointerUp: fe,
					onPointerCancel: fe,
					onPointerLeave: fe,
					children: [
						/* @__PURE__ */ f("div", {
							className: "sa-arena-stage",
							style: Se,
							children: [
								/* @__PURE__ */ d("span", {
									className: `sa-arena-map${be === null ? "" : " sa-has-art"}`,
									"data-map": h.status,
									"aria-hidden": "true"
								}),
								/* @__PURE__ */ d("svg", {
									className: "sa-arena-lines",
									viewBox: "0 0 100 100",
									preserveAspectRatio: "none",
									"aria-hidden": "true",
									children: me.map((e) => /* @__PURE__ */ d("line", {
										className: "sa-arena-engage",
										"data-engage": e.key,
										x1: e.from.x * 100,
										y1: e.from.y * 100,
										x2: e.to.x * 100,
										y2: e.to.y * 100,
										vectorEffect: "non-scaling-stroke"
									}, e.key))
								}),
								m.specters.map((e) => /* @__PURE__ */ d(Yc, {
									specter: e,
									position: F.specters.get(e.bindingId) ?? {
										x: .5,
										y: .5
									},
									selected: cc(t, "specter", e.bindingId),
									roving: L === e.bindingId,
									animate: r.animate,
									...he(e.bindingId),
									onSelect: () => n({
										kind: "specter",
										bindingId: e.bindingId
									}),
									register: ce(e.bindingId)
								}, e.bindingId)),
								m.enemies.map((e) => /* @__PURE__ */ d(Xc, {
									enemy: e,
									position: F.enemies.get(e.workId) ?? {
										x: .5,
										y: .5
									},
									selected: cc(t, "work", e.workId),
									roving: L === e.workId,
									animate: r.animate && (!e.defeated || a.has(e.workId)),
									celebrating: a.has(e.workId),
									spriteReady: (e.size === "encounter" ? _ : g).status === "ready",
									facing: Zc(e, F),
									hit: ge(e),
									counter: B(e),
									onSelect: () => n({
										kind: "work",
										workId: e.workId
									}),
									register: ce(e.workId)
								}, e.workId)),
								/* @__PURE__ */ d(Tc, { shots: ve })
							]
						}),
						(h.status === "failed" || h.status === "ready" && be === null) && /* @__PURE__ */ d("p", {
							className: "sa-arena-plate",
							children: Z.mapPlate
						}),
						p && /* @__PURE__ */ d("p", {
							className: "sa-arena-plate sa-arena-plate--paused",
							role: "status",
							children: ee("paused", null)
						}),
						/* @__PURE__ */ d(wc, {
							cues: i,
							onComplete: o
						})
					]
				})
			}),
			/* @__PURE__ */ d(bc, {
				placement: F,
				view: I,
				hasMap: be !== null,
				open: C,
				onToggle: () => w((e) => !e)
			})
		]
	});
}
// ui/src/arena/BotsOnField.tsx
function el({ bots: e, specters: t }) {
	return /* @__PURE__ */ d(Se, {
		label: Z.botsOnField,
		children: /* @__PURE__ */ f("details", {
			className: "sa-bots-on-field",
			children: [/* @__PURE__ */ d("summary", { children: Z.botsOnField }), e.length === 0 ? /* @__PURE__ */ d("p", {
				className: "sa-help",
				children: Z.botsOnFieldNone
			}) : /* @__PURE__ */ d("ul", {
				className: "sa-bots-on-field__list",
				children: e.map((e) => {
					let n = t.get(e.bindingId);
					return /* @__PURE__ */ f("li", { children: [
						n === void 0 ? /* @__PURE__ */ d("span", {
							className: "sa-token__placeholder",
							"aria-hidden": "true",
							children: gn(L(e))
						}) : /* @__PURE__ */ d(Wn, {
							specter: Es(n),
							size: "sm",
							decorative: !0
						}),
						/* @__PURE__ */ f("span", {
							className: "sa-bots-on-field__names",
							children: [/* @__PURE__ */ d("strong", { children: n?.displayName ?? L(e) }), n !== void 0 && /* @__PURE__ */ d("span", {
								className: "sa-help",
								children: `for ${L(e)}`
							})]
						}),
						/* @__PURE__ */ d(be, { view: P(e.condition) })
					] }, e.bindingId);
				})
			})]
		})
	});
}
// ui/src/arena/marks.ts
var tl = {
	dataReady: "arena:data-ready",
	firstRender: "arena:first-render",
	updateStart: "arena:update-start",
	updateEnd: "arena:update-end"
};
function nl(e) {
	typeof performance < "u" && typeof performance.mark == "function" && performance.mark(e);
}
var rl = (e) => e.condition.state === "waiting" && (e.condition.reasonCode === "approval-pending" || e.condition.reasonCode === "question-pending") ? e.condition.reasonCode : null, il = (e) => {
	let t = e.condition.state;
	return t === "working" || t === "settled" || t === "waiting" ? t : "unknown";
}, al = (e, t) => e < t ? -1 : +(e > t), ol = (e, t) => al(e.workId, t.workId), sl = (e, t) => t.updatedAtMs - e.updatedAtMs || al(t.taskId, e.taskId), cl = (e) => e.state === "credited" ? e.xpCredited : null;
function ll(e, t, n) {
	let r = e.get(t);
	r === void 0 ? e.set(t, /* @__PURE__ */ new Set([n])) : r.add(n);
}
var ul = (e) => e === void 0 ? [] : [...e].sort();
function dl(e, t = 80) {
	let n = new Map(e.roster.map((e) => [e.bindingId, e])), r = new Map(e.specters.map((e) => [e.bindingId, e])), i = new Map(e.xp.map((e) => [e.bindingId, e])), a = e.tasks.filter((e) => e.state === "open"), o = e.tasks.filter((t) => t.state === "credited" && (t.closedAtMs ?? t.updatedAtMs) >= e.nowMs - 864e5).sort((e, t) => (t.closedAtMs ?? t.updatedAtMs) - (e.closedAtMs ?? e.updatedAtMs) || al(e.taskId, t.taskId)).slice(0, 12), s = Math.max(0, t - o.length), c = [...a].sort(sl).slice(0, s), l = [...o, ...c], u = new Set(l.map((e) => e.taskId)), d = /* @__PURE__ */ new Map(), f = /* @__PURE__ */ new Map(), p = /* @__PURE__ */ new Map();
	for (let e of a) {
		let t = n.get(e.bindingId);
		t !== void 0 && e.attemptState !== "ended" && (ll(f, t.bindingId, e.attemptId), u.has(e.taskId) && e.attemptState === "working" && (ll(d, e.taskId, t.bindingId), ll(p, t.bindingId, e.taskId)));
	}
	let m = [...e.roster].sort((e, t) => al(e.bindingId, t.bindingId)).map((t) => {
		let n = r.get(t.bindingId), a = i.get(t.bindingId);
		return {
			bindingId: t.bindingId,
			displayName: L(t),
			specterName: n?.displayName ?? null,
			heroId: n?.heroId ?? null,
			portraitAssetId: n?.portrait.assetId ?? null,
			condition: il(t),
			openAttemptIds: ul(f.get(t.bindingId)),
			engagedWorkIds: ul(p.get(t.bindingId)),
			xpTotal: a?.totalXp ?? 0,
			level: a?.level ?? 1,
			xpReading: a === void 0 ? e.xpStatus ?? "ready" : "ready",
			waitingReason: rl(t)
		};
	}), h = (e, t) => ({
		workId: e.taskId,
		parentId: null,
		title: ms(e),
		size: "minion",
		state: e.state,
		sizeClass: e.sizeClass,
		runMs: e.runMs,
		progress: { kind: "unknown" },
		parts: null,
		blocked: !1,
		engagedBy: t,
		defeated: e.state === "credited",
		committedXp: cl(e)
	}), g = l.map((e) => h(e, ul(d.get(e.taskId)))).sort(ol);
	return {
		mode: e.mode,
		asOfMs: e.nowMs,
		specters: m,
		enemies: g,
		overflow: {
			enemies: a.length - c.length,
			truncated: e.tasksTruncated === !0
		},
		coverage: {
			gaps: e.roster.filter((e) => e.coverage.state === "gap").length,
			unknownBots: e.roster.filter((e) => e.coverage.state === "unknown" || il(e) === "unknown").length
		}
	};
}
// ui/src/arena/useArenaExchanges.ts
function fl(e, t, n) {
	let r = c(xi()), a = c(/* @__PURE__ */ new Set()), o = c("|||"), [u, d] = l(Pi), f = s(() => e === null ? null : Di(e), [e]);
	return i(() => {
		if (!t || f === null) {
			r.current = xi(), a.current = /* @__PURE__ */ new Set(), o.current = "|||", d((e) => e === Pi ? e : Pi);
			return;
		}
		let e, i = () => {
			let t = Date.now(), n = ji(r.current, f, t);
			r.current = n.state;
			let a = Fi(n.state, t), s = Ii(a);
			s !== o.current && (o.current = s, d(a)), e = n.nextWakeMs === null ? void 0 : window.setTimeout(i, Math.max(0, n.nextWakeMs - Date.now()));
		}, s = n.filter((e) => !a.current.has(e.id));
		if (s.length > 0) for (let e of s) r.current = Ni(r.current, f, e.workId, Date.now());
		return a.current = new Set(n.map((e) => e.id)), i(), () => window.clearTimeout(e);
	}, [
		t,
		f,
		n
	]), u;
}
// ui/src/arena/useArenaMotion.ts
function pl() {
	let e = Vn(), [t, n] = l(!1);
	return {
		animate: e && !t,
		paused: t,
		togglePause: () => n((e) => !e)
	};
}
function ml(e, t, n) {
	if (e === null || !n.visibleSincePrev || n.gapMs > 2 * n.pollMs || t.asOfMs < e.asOfMs) return [];
	let r = new Set(e.enemies.filter((e) => !e.defeated).map((e) => e.workId));
	return t.enemies.filter((e) => e.defeated && r.has(e.workId)).map((e) => e.workId).sort().slice(0, 3);
}
function hl(e, t, n) {
	if (e === null || !n.visibleSincePrev || n.gapMs > 2 * n.pollMs || t.asOfMs < e.asOfMs) return [];
	let r = new Map(e.enemies.map((e) => [e.workId, e.progress]));
	return t.enemies.filter((e) => {
		let t = r.get(e.workId);
		return !e.defeated && e.progress.kind === "milestones" && t?.kind === "milestones" && e.progress.done > t.done;
	}).map((e) => e.workId).sort().slice(0, 3);
}
// ui/src/arena/useArenaScene.ts
var gl = 1800;
function _l(e, t, r) {
	let a = c(null), o = c(!1), [u, d] = l([]), [f, p] = l([]);
	i(() => {
		let e = () => {
			document.visibilityState === "hidden" && (o.current = !0);
		};
		return e(), document.addEventListener("visibilitychange", e), () => document.removeEventListener("visibilitychange", e);
	}, []), i(() => {
		if (e === null || t === null) return;
		let n = a.current;
		if (a.current = {
			model: e,
			receivedAtMs: t
		}, n === null || n.receivedAtMs === t) return;
		let i = !o.current;
		o.current = !1;
		let s = {
			visibleSincePrev: i,
			gapMs: t - n.receivedAtMs,
			pollMs: Jn
		}, c = ml(n.model, e, s), l = hl(n.model, e, s);
		if (r && l.length > 0 && p(l.map((e) => ({
			id: `${e}@${t}`,
			workId: e
		}))), !r || c.length === 0) return;
		let u = c.flatMap((n) => {
			let r = e.enemies.find((e) => e.workId === n);
			return r === void 0 ? [] : [{
				id: `${n}@${t}`,
				workId: n,
				title: r.title,
				committedXp: r.committedXp,
				durationMs: gl
			}];
		});
		d((e) => [...e, ...u]);
	}, [
		e,
		t,
		r
	]), i(() => {
		r || (d((e) => e.length === 0 ? e : []), p((e) => e.length === 0 ? e : []));
	}, [r]);
	let m = n((e) => d((t) => t.filter((t) => t.id !== e)), []);
	return {
		cues: u,
		celebrating: s(() => new Set(u.map((e) => e.workId)), [u]),
		complete: m,
		rises: f
	};
}
function vl(e) {
	return e instanceof Me ? "unexpected" : e instanceof G ? e.status === 404 ? "unsupported" : e.status === 403 ? "forbidden" : "unavailable" : "offline";
}
function yl() {
	let e = kt(), t = Yn(n(async () => {
		let t = 0, n = !1, r = async (r, i) => {
			let a = [], o = null;
			for (let n = 0; n < i; n += 1) {
				let n = nc(await e.getJson(mt({
					state: r,
					limit: 25,
					cursor: o
				})));
				if (a.push(...n.items), t = Math.max(t, n.asOfMs), o = n.nextCursor, o === null) return a;
			}
			return r === "open" && (n = !0), a;
		}, i = await Promise.all([
			r("open", 8),
			r("credited", 1),
			r("not-credited", 1)
		]), a = /* @__PURE__ */ new Map();
		for (let e of i.flat()) {
			let t = a.get(e.taskId);
			(t === void 0 || t.updatedAtMs < e.updatedAtMs) && a.set(e.taskId, e);
		}
		return {
			items: [...a.values()],
			asOfMs: t,
			truncated: n,
			receivedAtMs: Date.now()
		};
	}, [e]), "arena-work"), r = t.error === null ? null : vl(t.error);
	return {
		state: t.data === null ? r === null ? {
			status: "loading",
			snapshot: null,
			failure: null
		} : {
			status: "failed",
			snapshot: null,
			failure: r
		} : {
			status: "ready",
			snapshot: t.data,
			failure: r
		},
		refresh: t.refresh
	};
}
// ui/src/arena/ArenaView.tsx
var bl = "(max-width: 600px)", xl = () => typeof window.matchMedia != "function" || !window.matchMedia(bl).matches, Sl = {
	unsupported: {
		title: Z.unsupportedTitle,
		body: Z.unsupportedBody
	},
	forbidden: {
		title: Z.forbiddenTitle,
		body: Z.forbiddenBody
	},
	offline: {
		title: Z.offlineTitle,
		body: Z.offlineBody
	},
	unavailable: {
		title: Z.unavailableTitle,
		body: Z.unavailableBody
	},
	unexpected: {
		title: Z.unexpectedTitle,
		body: Z.unexpectedBody
	}
};
function Cl({ bots: e, complete: t, collector: n, rosterRevision: r, specters: a, specterStatus: o = "ready", xp: p, xpStatus: m = "ready", unassigned: h, onAssign: g }) {
	let _ = Pt(), { state: v, refresh: y } = yl(), b = pl(), [x, S] = l(null), [te, C] = l(xl), [w, T] = l(xl), E = (e) => {
		S(e), T(!0);
	}, D = v.snapshot, O = c("none"), k = c(null);
	D !== null && D !== k.current && (O.current = k.current === null ? "first" : "update", nl(O.current === "first" ? tl.dataReady : tl.updateStart), k.current = D), i(() => {
		O.current === "first" && nl(tl.firstRender), O.current === "update" && nl(tl.updateEnd), O.current = "none";
	}, [D]);
	let A = s(() => {
		if (D === null) return null;
		let t = {
			mode: _,
			nowMs: D.asOfMs,
			roster: e,
			specters: [...a.values()],
			xp: [...p.values()],
			tasks: D.items,
			tasksTruncated: D.truncated,
			xpStatus: m
		};
		return {
			scene: dl(t),
			list: dl(t, Infinity)
		};
	}, [
		D,
		_,
		e,
		a,
		p,
		m
	]), j = _l(A?.scene ?? null, D?.receivedAtMs ?? null, b.animate), M = n.state === "paused", N = fl(A?.scene ?? null, b.animate && !M, j.rises), ne = s(() => new Map((D?.items ?? []).map((e) => [e.taskId, e])), [D]), re = s(() => new Set(A?.scene.enemies.map((e) => e.workId) ?? []), [A]), P = x?.kind === "specter" ? A?.list.specters.find((e) => e.bindingId === x.bindingId) ?? null : null, F = x?.kind === "work" ? A?.list.enemies.find((e) => e.workId === x.workId) ?? null : null, I = x?.kind === "work" ? ne.get(x.workId) : void 0, ie = x?.kind === "work" ? F?.title ?? (I === void 0 ? null : ms(I)) : null, ae = P === null ? F === null ? ie === null ? "" : Z.selected(ie, "not on the field") : Z.selected(F.title, Ac(F).stateText) : Z.selected(P.specterName ?? P.displayName, Z.linked(P.openAttemptIds.length)), oe = /* @__PURE__ */ f("header", {
		className: "sa-arena-header",
		children: [
			/* @__PURE__ */ f("div", {
				className: "sa-arena-header__top",
				children: [
					/* @__PURE__ */ d("h2", { children: "Arena" }),
					/* @__PURE__ */ d(dc, { mode: _ }),
					D !== null && /* @__PURE__ */ f("span", { children: [`${Z.asOf} `, /* @__PURE__ */ d(B, { ms: D.asOfMs })] })
				]
			}),
			/* @__PURE__ */ d("p", {
				className: "sa-help",
				children: ee(n.state, n.reasonCode)
			}),
			/* @__PURE__ */ d("p", {
				className: "sa-help",
				children: Z.attackLegend
			}),
			A !== null && /* @__PURE__ */ d("p", {
				className: "sa-help",
				children: Z.coverage(A.scene.coverage.gaps, A.scene.coverage.unknownBots)
			}),
			!t && /* @__PURE__ */ d("p", {
				className: "sa-help",
				children: "The roster is partial, so some bot names may show as unknown."
			})
		]
	}), L;
	if (v.status === "loading") L = /* @__PURE__ */ d("p", {
		role: "status",
		children: Z.loading
	});
	else if (v.status === "failed") {
		let e = Sl[v.failure];
		L = v.failure === "unsupported" ? /* @__PURE__ */ d(Ce, {
			title: e.title,
			body: e.body
		}) : /* @__PURE__ */ d(we, {
			title: e.title,
			body: e.body,
			onRetry: y
		});
	} else if (e.length === 0 && t) L = /* @__PURE__ */ d(Ce, {
		title: Z.emptyRosterTitle,
		body: Z.emptyRosterBody
	});
	else if (A !== null) {
		let t = v.failure === null ? null : Sl[v.failure];
		L = /* @__PURE__ */ f(u, { children: [
			t !== null && D !== null && /* @__PURE__ */ f("div", {
				className: "sa-banner",
				role: "alert",
				children: [/* @__PURE__ */ f("span", { children: [
					`${Z.staleBanner} `,
					/* @__PURE__ */ d(B, { ms: D.receivedAtMs }),
					`. ${t.title}.`
				] }), /* @__PURE__ */ d(H, {
					onClick: y,
					children: Z.retry
				})]
			}),
			/* @__PURE__ */ d(_c, {
				botsObserved: e.length,
				coverageUnknown: A.scene.coverage.unknownBots,
				committedXp: [...p.values()].reduce((e, t) => e + t.totalXp, 0),
				xpReading: m
			}),
			/* @__PURE__ */ d(el, {
				bots: e,
				specters: a
			}),
			/* @__PURE__ */ f("div", {
				className: `sa-arena-layout${te ? "" : " sa-is-rail-collapsed"}${w ? "" : " sa-is-inspector-collapsed"}`,
				children: [
					/* @__PURE__ */ d(gc, {
						model: A.scene,
						bots: e,
						specters: a,
						xp: p,
						selection: x,
						onSelect: E,
						open: te,
						onToggle: () => C((e) => !e),
						specterStatus: o,
						unassigned: h,
						onAssign: g
					}),
					/* @__PURE__ */ d($c, {
						model: A.scene,
						selection: x,
						onSelect: E,
						motion: b,
						cues: j.cues,
						celebrating: j.celebrating,
						onCueComplete: j.complete,
						exchanges: N,
						collectorPaused: M
					}),
					/* @__PURE__ */ d(uc, {
						selection: x,
						list: A.list,
						bots: e,
						collector: n,
						rosterRevision: r,
						specters: a,
						xp: p,
						items: ne,
						open: w,
						onToggle: () => T((e) => !e),
						onSelect: E,
						onClose: () => S(null)
					})
				]
			}),
			/* @__PURE__ */ d(hc, {
				model: A.list,
				bots: e,
				items: ne,
				drawn: re,
				selection: x,
				onSelect: E
			})
		] });
	}
	return /* @__PURE__ */ f("div", {
		className: "sa-arena",
		role: "region",
		"aria-label": Z.region,
		children: [
			oe,
			L,
			/* @__PURE__ */ d("p", {
				className: "sa-visually-hidden",
				role: "status",
				"aria-live": "polite",
				children: ae
			})
		]
	});
}
// ui/src/arena/arena.css?inline
var wl = ".specter-arena-root .sa-arena{grid-template-columns:minmax(0,1fr);gap:16px;display:grid}.specter-arena-root .sa-arena-header{gap:6px;display:grid}.specter-arena-root .sa-arena-header__top{flex-wrap:wrap;align-items:center;gap:12px;display:flex}.specter-arena-root .sa-arena-header__top h2{font-size:20px}.specter-arena-root .sa-mode{border:1px solid var(--line);color:var(--text);background:var(--raised);letter-spacing:.02em;border-radius:999px;align-items:center;padding:3px 10px;font-size:12px;font-weight:600;display:inline-flex}.specter-arena-root .sa-mode--fixture{border-color:var(--amber);color:var(--amber)}.specter-arena-root .sa-mode--live{border-color:var(--success);color:var(--success)}.specter-arena-root .sa-mode--recorded{border-color:var(--cyan);color:var(--cyan)}.specter-arena-root .sa-page:has(.sa-arena){max-width:1480px}.specter-arena-root .sa-arena-layout{--sa-rail-width:200px;--sa-inspector-width:300px;grid-template-columns:var(--sa-rail-width) minmax(0, 1fr) var(--sa-inspector-width);align-items:start;gap:12px;display:grid}.specter-arena-root .sa-arena-layout.sa-is-rail-collapsed{--sa-rail-width:56px}.specter-arena-root .sa-arena-layout.sa-is-inspector-collapsed{--sa-inspector-width:56px}@media (width<=1100px){.specter-arena-root .sa-arena-layout{grid-template-columns:minmax(0,1fr)}.specter-arena-root .sa-arena-scene{order:-1}}.specter-arena-root .sa-arena-rail{border:1px solid var(--line);background:var(--panel);border-radius:10px;gap:8px;padding:10px;display:grid}.specter-arena-root .sa-arena-rail__list{gap:6px;max-height:520px;margin:0;padding:0;list-style:none;display:grid;overflow-y:auto}.specter-arena-root .sa-arena-rail__body,.specter-arena-root .sa-arena-inspector__panel{gap:8px;min-width:0;display:grid}.specter-arena-root .sa-arena-rail__body[hidden],.specter-arena-root .sa-arena-inspector__panel[hidden]{display:none}.specter-arena-root .sa-arena-rail.sa-is-collapsed,.specter-arena-root .sa-arena-inspector.sa-is-collapsed{justify-items:center;padding:6px}.specter-arena-root .sa-arena-pane__text{display:none}@media (width<=1100px){.specter-arena-root .sa-arena-rail.sa-is-collapsed,.specter-arena-root .sa-arena-inspector.sa-is-collapsed{justify-items:start}.specter-arena-root .sa-arena-pane__glyph{display:none}.specter-arena-root .sa-arena-pane__text{display:inline}}.specter-arena-root .sa-arena-rail__unassigned{gap:6px;display:grid}.specter-arena-root .sa-arena-rail__unassigned h3{color:var(--muted);margin:0;font-size:13px}.specter-arena-root .sa-arena-rail__unassigned-row{gap:4px;display:grid}.specter-arena-root .sa-arena-rail__row{width:100%;color:var(--text);background:var(--raised);font:inherit;text-align:left;cursor:pointer;border:1px solid #0000;border-radius:8px;align-items:center;gap:8px;padding:6px 8px;display:flex}.specter-arena-root .sa-arena-rail__row[aria-pressed=true]{border-color:var(--violet)}.specter-arena-root .sa-arena-rail__copy{gap:2px;min-width:0;display:grid}.specter-arena-root .sa-arena-scene{gap:8px;min-width:0;display:grid;position:relative}.specter-arena-root .sa-arena-hud{flex-wrap:wrap;align-items:center;gap:8px;display:flex}.specter-arena-root .sa-arena-zoom{min-width:56px;color:var(--muted);text-align:center}.specter-arena-root .sa-arena-frame{min-width:0;position:relative}.specter-arena-root .sa-arena-viewport{aspect-ratio:1672/941;border:1px solid var(--line);background:var(--ink);touch-action:none;border-radius:10px;height:auto;max-height:78vh;position:relative;overflow:hidden}.specter-arena-root .sa-arena-stage{contain:layout paint;position:absolute}.specter-arena-root .sa-arena-map{background-color:var(--panel);background-position:50%;background-repeat:no-repeat;background-size:100% 100%;position:absolute;inset:0}.specter-arena-root .sa-arena-map.sa-has-art{background-image:var(--sa-map)}.specter-arena-root .sa-arena-lines{pointer-events:none;width:100%;height:100%;position:absolute;inset:0}.specter-arena-root .sa-arena-engage{stroke:var(--amber);stroke-width:2px;stroke-dasharray:6 5;opacity:.85}.specter-arena-root .sa-is-animated .sa-arena-engage{animation:1.2s linear infinite sa-arena-dash}.specter-arena-root .sa-arena-plate{border:1px solid var(--line);max-width:60%;color:var(--muted);background:var(--panel);border-radius:8px;margin:0;padding:6px 10px;font-size:12px;position:absolute;bottom:8px;right:8px}.specter-arena-root .sa-token{min-width:44px;min-height:44px;color:var(--text);font:inherit;contain:layout;cursor:pointer;background:0 0;border:1px solid #0000;border-radius:8px;justify-items:center;gap:2px;padding:2px 4px;display:grid;position:absolute;transform:translate(-50%,-80%)}.specter-arena-root .sa-token:focus-visible{outline:2px solid var(--cyan);outline-offset:2px}.specter-arena-root .sa-token.sa-is-selected{border-color:var(--violet);background:#141020b3}.specter-arena-root .sa-token__label,.specter-arena-root .sa-token__meta{text-overflow:ellipsis;white-space:nowrap;background:#141020b8;border-radius:4px;max-width:5.25rem;padding:0 4px;font-size:12px;line-height:1.25;overflow:hidden}.specter-arena-root .sa-token__meta{color:var(--muted)}@media (width<=600px){.specter-arena-root .sa-token--specter .sa-token__label{visibility:hidden}.specter-arena-root .sa-token--specter:hover .sa-token__label,.specter-arena-root .sa-token--specter:focus-visible .sa-token__label,.specter-arena-root .sa-token--specter.sa-is-selected .sa-token__label{visibility:visible}}.specter-arena-root .sa-token--specter .sa-token__badge{white-space:nowrap;padding:0 4px;position:absolute;top:-8px;left:50%;transform:translate(-50%)}.specter-arena-root .sa-token--enemy .sa-token__label,.specter-arena-root .sa-token--enemy .sa-token__meta,.specter-arena-root .sa-token--enemy .sa-token__xp,.specter-arena-root .sa-token--specter .sa-token__badge{pointer-events:none}.specter-arena-root .sa-token--enemy{min-width:0;min-height:0;padding:0}.specter-arena-root .sa-token--enemy .sa-token__label,.specter-arena-root .sa-token--enemy .sa-token__meta,.specter-arena-root .sa-token--enemy .sa-token__xp{z-index:7;white-space:nowrap;max-width:14rem;display:none;position:absolute;left:50%;transform:translate(-50%)}.specter-arena-root .sa-token--enemy .sa-token__label{top:100%}.specter-arena-root .sa-token--enemy .sa-token__meta{top:calc(100% + 18px)}.specter-arena-root .sa-token--enemy .sa-token__xp{top:calc(100% + 38px)}.specter-arena-root .sa-token--enemy:hover,.specter-arena-root .sa-token--enemy:focus-visible,.specter-arena-root .sa-token--enemy.sa-is-selected{z-index:6}.specter-arena-root .sa-token--enemy:hover .sa-token__label,.specter-arena-root .sa-token--enemy:hover .sa-token__meta,.specter-arena-root .sa-token--enemy:hover .sa-token__xp,.specter-arena-root .sa-token--enemy:focus-visible .sa-token__label,.specter-arena-root .sa-token--enemy:focus-visible .sa-token__meta,.specter-arena-root .sa-token--enemy:focus-visible .sa-token__xp,.specter-arena-root .sa-token--enemy.sa-is-selected .sa-token__label,.specter-arena-root .sa-token--enemy.sa-is-selected .sa-token__meta,.specter-arena-root .sa-token--enemy.sa-is-selected .sa-token__xp{display:block}.specter-arena-root .sa-token__badge,.specter-arena-root .sa-token__xp{color:var(--ink);background:var(--amber);border-radius:999px;padding:0 6px;font-size:12px;font-weight:700}.specter-arena-root .sa-token__xp{background:var(--success)}.specter-arena-root .sa-token__marker{width:16px;height:16px;position:absolute;top:-6px;right:-6px}.specter-arena-root .sa-token__placeholder{border:1px dashed var(--muted);width:32px;height:32px;color:var(--muted);background:var(--raised);border-radius:50%;place-items:center;font-size:12px;font-weight:700;display:inline-grid}.specter-arena-root .sa-token__placeholder:before{content:attr(data-initials)}.specter-arena-root .sa-hero{width:var(--sa-hero-size,44px);height:var(--sa-hero-size,44px);transform:translateX(calc((.5 - var(--sa-ax)) * 100%));display:block;position:relative}.specter-arena-root .sa-hero__img{object-fit:contain;pointer-events:none;filter:drop-shadow(0 3px 4px #00000073);width:100%;height:100%;display:block}.specter-arena-root .sa-hero.sa-is-animated .sa-hero__img{transform-origin:inherit;animation-duration:var(--sa-idle-ms);will-change:transform;animation-timing-function:ease-in-out;animation-iteration-count:infinite}.specter-arena-root .sa-hero--vell.sa-is-animated .sa-hero__img{animation-name:sa-arena-vell-idle}.specter-arena-root .sa-hero--stitch.sa-is-animated .sa-hero__img{animation-name:sa-arena-stitch-idle}.specter-arena-root .sa-hero--reeve.sa-is-animated .sa-hero__img{animation-name:sa-arena-reeve-idle}.specter-arena-root .sa-hero--rattle.sa-is-animated .sa-hero__img{animation-name:sa-arena-rattle-idle}.specter-arena-root .sa-hero--ember.sa-is-animated .sa-hero__img{animation-name:sa-arena-ember-idle}.specter-arena-root .sa-hero--shard.sa-is-animated .sa-hero__img{animation-name:sa-arena-shard-idle}.specter-arena-root .sa-hero--poly.sa-is-animated .sa-hero__img{animation-name:sa-arena-poly-idle}.specter-arena-root .sa-hero--tide.sa-is-animated .sa-hero__img{animation-name:sa-arena-tide-idle}.specter-arena-root .sa-hero--lume.sa-is-animated .sa-hero__img{animation-name:sa-arena-lume-idle}.specter-arena-root .sa-hero--moss.sa-is-animated .sa-hero__img{animation-name:sa-arena-moss-idle}.specter-arena-root .sa-hero--bur.sa-is-animated .sa-hero__img{animation-name:sa-arena-bur-idle}.specter-arena-root .sa-token--specter{z-index:2}.specter-arena-root .sa-token--enemy{z-index:3}:is(.specter-arena-root .sa-token--specter:has(.sa-hero.sa-is-attack),.specter-arena-root .sa-token--specter:has(.sa-hero.sa-is-cast)){z-index:4}.specter-arena-root .sa-token--specter.sa-is-engaging{border-color:var(--amber)}.specter-arena-root .sa-token--specter.sa-is-coverage-unknown{opacity:.85}.specter-arena-root .sa-token--enemy.sa-is-defeated{opacity:.8}.specter-arena-root .sa-token--enemy.sa-is-blocked .sa-token__label{box-shadow:inset 0 -2px 0 var(--danger)}.specter-arena-root .sa-minion{width:calc(var(--sa-minion-base,36.4px) * var(--sa-minion-scale,1));height:calc(var(--sa-minion-base,36.4px) * var(--sa-minion-scale,1));transform-origin:53% 90%;display:block;position:relative}.specter-arena-root .sa-token--encounter .sa-minion{transform-origin:56% 90%;width:34px;height:34px}.specter-arena-root .sa-minion[data-facing=left]{transform:scaleX(-1)}.specter-arena-root .sa-minion__art,.specter-arena-root .sa-minion__fallback{width:100%;height:100%;display:block}.specter-arena-root .sa-minion__art{background-position:bottom;background-repeat:no-repeat;background-size:contain}.specter-arena-root .sa-minion--patchling .sa-minion__art{background-image:var(--sa-sprite-patchling)}.specter-arena-root .sa-minion--patchbrute .sa-minion__art{background-image:var(--sa-sprite-patchbrute)}.specter-arena-root .sa-minion.sa-is-defeated{filter:grayscale(.7);transform:rotate(-8deg)}.specter-arena-root .sa-minion.sa-is-defeated[data-facing=left]{transform:scaleX(-1)rotate(-8deg)}.specter-arena-root .sa-minion.sa-is-animated.sa-is-idle{animation:2.2s ease-in-out infinite sa-arena-bob}.specter-arena-root .sa-minion.sa-is-animated.sa-is-engaged{animation:1.1s ease-in-out infinite sa-arena-engaged}.specter-arena-root .sa-minion--patchling.sa-is-animated.sa-is-hit{animation:.32s cubic-bezier(.25,.05,.25,1) both sa-arena-patchling-hit}.specter-arena-root .sa-minion--patchbrute.sa-is-animated.sa-is-hit{animation:.42s cubic-bezier(.22,.72,.3,1) both sa-arena-patchbrute-hit}.specter-arena-root .sa-minion--patchling.sa-is-animated.sa-is-attack{animation:.52s cubic-bezier(.3,.05,.2,1) both sa-arena-patchling-attack}.specter-arena-root .sa-minion--patchbrute.sa-is-animated.sa-is-attack{animation:.7s cubic-bezier(.3,.05,.2,1) both sa-arena-patchbrute-attack}.specter-arena-root .sa-minion-impact i.sa-minion-impact__flash{border:3px solid var(--amber);width:38px;height:38px;box-shadow:0 0 14px 3px var(--amber);opacity:0;background:#fff0c880;margin:-19px 0 0 -19px}.specter-arena-root .sa-is-strong .sa-minion-impact i.sa-minion-impact__flash{border-width:4px;width:58px;height:58px;margin:-29px 0 0 -29px}.specter-arena-root .sa-minion-impact i.sa-minion-impact__chip{background:var(--text);width:7px;height:7px;box-shadow:0 0 6px var(--amber);opacity:0;border-radius:1px;margin:-3px 0 0 -3px}.specter-arena-root .sa-minion-impact i.sa-minion-impact__chip--one{--sa-chip-x:-20px;--sa-chip-y:-18px}.specter-arena-root .sa-minion-impact i.sa-minion-impact__chip--two{--sa-chip-x:22px;--sa-chip-y:-14px}.specter-arena-root .sa-is-strong .sa-minion-impact i.sa-minion-impact__chip--one{--sa-chip-x:-34px;--sa-chip-y:-28px}.specter-arena-root .sa-is-strong .sa-minion-impact i.sa-minion-impact__chip--two{--sa-chip-x:36px;--sa-chip-y:-24px}.specter-arena-root .sa-minion.sa-is-animated.sa-is-hit .sa-minion-impact i.sa-minion-impact__flash{animation:.38s ease-out both sa-arena-minion-impact}.specter-arena-root .sa-minion.sa-is-animated.sa-is-hit .sa-minion-impact i.sa-minion-impact__chip{animation:.38s ease-out both sa-arena-minion-spark}.specter-arena-root .sa-strike-layer{z-index:4;pointer-events:none;position:absolute;inset:0}.specter-arena-root .sa-strike{width:0;height:0;animation:sa-arena-strike-travel calc(var(--sa-strike-ms) * .7) cubic-bezier(.35, 0, .85, .7) calc(var(--sa-strike-ms) * .3) both, sa-arena-strike-in 80ms ease-out calc(var(--sa-strike-ms) * .3) both, sa-arena-strike-out .14s linear var(--sa-strike-ms) forwards;margin-top:-34px;position:absolute}.specter-arena-root .sa-strike__bolt{background:linear-gradient(90deg, transparent, var(--sa-strike-color));width:34px;height:6px;box-shadow:0 0 10px var(--sa-strike-color);transform-origin:100%;rotate:var(--sa-strike-angle);border-radius:3px;position:absolute;top:-3px;left:-34px}.specter-arena-root .sa-strike__head{background:var(--text);width:14px;height:14px;box-shadow:0 0 8px 3px var(--sa-strike-color), 0 0 18px 6px var(--sa-strike-color);border-radius:50%;position:absolute;top:-7px;left:-7px}.specter-arena-root .sa-strike--cast .sa-strike__bolt{width:56px;height:10px;top:-5px;left:-56px}.specter-arena-root .sa-strike--cast .sa-strike__head{width:24px;height:24px;top:-12px;left:-12px}.specter-arena-root .sa-minion.sa-is-animated.sa-is-defeat{animation:.65s ease-in forwards sa-arena-defeat}.specter-arena-root .sa-minion-impact,.specter-arena-root .sa-minion-collapse{pointer-events:none;position:absolute;inset:0}.specter-arena-root .sa-minion-impact i,.specter-arena-root .sa-minion-collapse i{background:var(--amber);opacity:.7;border-radius:50%;width:10px;height:10px;position:absolute;top:50%;left:50%}.specter-arena-root .sa-arena-minimap{background:#141020ed;border:1px solid #b49aff59;border-radius:9px;justify-items:stretch;gap:6px;width:min(100%,320px);padding:6px;display:grid}.specter-arena-root .sa-arena-minimap__frame{aspect-ratio:1672/941;border:1px solid var(--line);background-color:var(--panel);background-size:100% 100%;border-radius:8px;width:100%;position:relative;overflow:hidden}.specter-arena-root .sa-arena-minimap__frame.sa-has-art{background-image:var(--sa-map)}.specter-arena-root .sa-arena-minimap__paths{width:100%;height:100%;position:absolute;inset:0}.specter-arena-root .sa-arena-minimap__path{fill:none;stroke:var(--line);stroke-width:1px}.specter-arena-root .sa-arena-minimap__structure{pointer-events:none;width:16px;height:16px;position:absolute;transform:translate(-50%,-80%)}.specter-arena-root .sa-arena-minimap__structure svg{width:100%;height:100%;display:block}.specter-arena-root .sa-arena-minimap__dot{z-index:1;border-radius:50%;width:5px;height:5px;position:absolute;transform:translate(-50%,-50%)}.specter-arena-root .sa-arena-minimap__dot--specter{background:var(--cyan)}.specter-arena-root .sa-arena-minimap__dot--enemy{background:var(--violet)}.specter-arena-root .sa-arena-minimap__view{border:1px solid var(--text);pointer-events:none;position:absolute}.specter-arena-root .sa-arena-stats{grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:0;display:grid}.specter-arena-root .sa-arena-stat{border:1px solid var(--line);background:var(--panel);border-radius:10px;gap:2px;padding:10px 12px;display:grid}.specter-arena-root .sa-arena-stat dt{color:var(--muted);font-size:12px;font-weight:650}.specter-arena-root .sa-arena-stat dd{margin:0;font-size:22px;font-weight:700}.specter-arena-root .sa-bots-on-field summary{cursor:pointer;font-weight:650}.specter-arena-root .sa-bots-on-field__list{grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px;margin:10px 0 0;padding:0;list-style:none;display:grid}.specter-arena-root .sa-bots-on-field__list li{align-items:center;gap:8px;min-width:0;display:flex}.specter-arena-root .sa-bots-on-field__names{overflow-wrap:anywhere;flex:1;min-width:0;display:grid}.specter-arena-root .sa-cue-layer{pointer-events:none;align-content:start;justify-items:center;gap:8px;padding-top:16px;display:grid;position:absolute;inset:0}.specter-arena-root .sa-cue{border:1px solid var(--success);background:var(--panel);border-radius:10px;justify-items:center;padding:10px 16px;display:grid;position:relative}.specter-arena-root .sa-cue__eyebrow{color:var(--muted);font-size:12px}.specter-arena-root .sa-cue__particles i{background:var(--success);border-radius:50%;width:6px;height:6px;position:absolute;top:50%;left:50%}.specter-arena-root .sa-is-animated .sa-cue{animation:1.8s ease-out forwards sa-arena-cue}.specter-arena-root .sa-arena-list{border:1px solid var(--line);background:var(--panel);border-radius:10px;gap:10px;min-width:0;padding:12px;display:grid;overflow-x:auto}.specter-arena-root .sa-arena-list__head{flex-wrap:wrap;align-items:center;gap:12px;display:flex}.specter-arena-root .sa-arena-filters{flex-wrap:wrap;gap:6px;display:flex}.specter-arena-root .sa-arena-filter{border:1px solid var(--line);min-height:32px;color:var(--text);background:var(--raised);font:inherit;cursor:pointer;border-radius:999px;padding:2px 12px}.specter-arena-root .sa-arena-filter[aria-pressed=true]{border-color:var(--violet);color:var(--violet)}.specter-arena-root .sa-arena-table{border-collapse:collapse;width:100%}.specter-arena-root .sa-arena-table caption{color:var(--muted);text-align:left;padding:6px 0;font-weight:600}.specter-arena-root .sa-arena-table th,.specter-arena-root .sa-arena-table td{border-top:1px solid var(--line);text-align:left;vertical-align:top;padding:6px 8px}.specter-arena-root .sa-arena-table thead th{color:var(--muted);font-size:12px;font-weight:600}.specter-arena-root .sa-arena-table__select{color:var(--text);font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;padding:2px 0;font-weight:600}.specter-arena-root .sa-arena-table__select[aria-current=true]{color:var(--violet);text-decoration:underline}.specter-arena-root .sa-arena-inspector{border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:10px;gap:10px;padding:12px;font-size:14px;display:grid}.specter-arena-root .sa-arena-inspector__panel{max-height:720px;overflow-y:auto}.specter-arena-root .sa-arena-inspector h2{overflow-wrap:anywhere;margin:0;font-size:16px}.specter-arena-root .sa-arena-inspector h3{color:var(--muted);margin:0 0 4px;font-size:13px}.specter-arena-root .sa-arena-inspector p{overflow-wrap:anywhere;margin:0}.specter-arena-root .sa-arena-inspector__body{gap:12px;display:grid}.specter-arena-root .sa-arena-inspector__head{align-items:center;gap:10px;display:flex}.specter-arena-root .sa-arena-inspector__state{flex-wrap:wrap;align-items:center;gap:8px;display:flex}.specter-arena-root .sa-arena-section{border-top:1px solid var(--line);gap:4px;padding-top:10px;display:grid}.specter-arena-root .sa-arena-plain{gap:6px;margin:0;padding:0;list-style:none;display:grid}.specter-arena-root .sa-arena-plain li{overflow-wrap:anywhere;gap:2px;display:grid}.specter-arena-root .sa-arena-opened{border-left:3px solid var(--violet);background:var(--raised);padding:4px 6px}.specter-arena-root .sa-arena-fiction{border:1px dashed var(--line);color:var(--muted);border-radius:8px;gap:4px;margin:0;padding:8px 10px;font-style:italic;display:grid}.specter-arena-root .sa-arena-fiction figcaption{font-size:12px;font-style:normal}.specter-arena-root .sa-arena-copy{gap:6px;display:grid}.specter-arena-root .sa-arena-copy__text{box-sizing:border-box;border:1px solid var(--line);background:var(--ink);width:100%;color:var(--text);resize:vertical;border-radius:6px;padding:6px;font-family:ui-monospace,monospace;font-size:12px}@keyframes sa-arena-bob{0%,to{translate:0}50%{translate:0 -2px}}@keyframes sa-arena-engaged{0%,to{translate:0}50%{translate:3px -1px}}@keyframes sa-arena-patchling-hit{0%,to{translate:0;rotate:0deg;scale:1}30%{translate:calc(var(--sa-recoil,1) * var(--sa-recoil-mag,1) * 9px) -2px;rotate:calc(var(--sa-recoil,1) * var(--sa-recoil-mag,1) * 4deg);filter:brightness(1.9)saturate(1.4);scale:1.12 .9}60%{translate:calc(var(--sa-recoil,1) * var(--sa-recoil-mag,1) * 4px) 2px;rotate:calc(var(--sa-recoil,1) * var(--sa-recoil-mag,1) * -2deg);scale:.99 1.015}}@keyframes sa-arena-patchbrute-hit{0%,to{translate:0;rotate:0deg;scale:1}30%{translate:calc(var(--sa-recoil,1) * var(--sa-recoil-mag,1) * 8px) 0;rotate:calc(var(--sa-recoil,1) * var(--sa-recoil-mag,1) * 2.5deg);filter:brightness(1.9)saturate(1.4);scale:1.1 .92}55%{translate:calc(var(--sa-recoil,1) * var(--sa-recoil-mag,1) * -2px) 2px;rotate:calc(var(--sa-recoil,1) * var(--sa-recoil-mag,1) * -1deg);scale:.995 1.01}}@keyframes sa-arena-patchling-attack{0%,to{translate:0;rotate:0deg;scale:1}25%{translate:calc(var(--sa-lunge,1) * -4px) 1px;rotate:calc(var(--sa-lunge,1) * -6deg);scale:.94 1.06}50%{translate:calc(var(--sa-lunge,1) * 14px) -3px;rotate:calc(var(--sa-lunge,1) * 8deg);filter:brightness(1.35);scale:1.14 .9}75%{translate:calc(var(--sa-lunge,1) * 5px) 0;rotate:calc(var(--sa-lunge,1) * 2deg);scale:1}}@keyframes sa-arena-patchbrute-attack{0%,to{translate:0;rotate:0deg;scale:1}25%{translate:calc(var(--sa-lunge,1) * -5px) 1px;rotate:calc(var(--sa-lunge,1) * -4deg);scale:.95 1.05}49%{translate:calc(var(--sa-lunge,1) * 16px) -2px;rotate:calc(var(--sa-lunge,1) * 5deg);filter:brightness(1.35);scale:1.12 .92}75%{translate:calc(var(--sa-lunge,1) * 6px) 0;rotate:calc(var(--sa-lunge,1) * 1.5deg);scale:1}}.specter-arena-root .sa-hero.sa-is-flinch{z-index:3}.specter-arena-root .sa-hero.sa-is-flinch.sa-is-animated .sa-hero__img{animation:.36s cubic-bezier(.25,.05,.25,1) both sa-arena-hero-flinch}@keyframes sa-arena-hero-flinch{0%,to{translate:0;rotate:0deg;scale:1}25%{translate:calc(var(--sa-flinch,-1) * 7px) 1px;rotate:calc(var(--sa-flinch,-1) * 5deg);filter:brightness(1.6)saturate(1.3);scale:.95 1.04}60%{translate:calc(var(--sa-flinch,-1) * 3px) 0;rotate:calc(var(--sa-flinch,-1) * 2deg);scale:1}}@keyframes sa-arena-minion-impact{0%{opacity:0;scale:.3}25%{opacity:1;scale:1}to{opacity:0;scale:1.5}}@keyframes sa-arena-minion-spark{0%{opacity:1;translate:0}to{opacity:0;translate:var(--sa-chip-x,0) var(--sa-chip-y,0)}}@keyframes sa-arena-strike-travel{0%{translate:0}to{translate:var(--sa-sx) var(--sa-sy)}}@keyframes sa-arena-strike-in{0%{opacity:0}to{opacity:1}}@keyframes sa-arena-strike-out{0%{opacity:1}to{opacity:0}}@keyframes sa-arena-defeat{to{opacity:.45;translate:0 6px}}@keyframes sa-arena-cue{0%{opacity:0;translate:0 8px}15%,80%{opacity:1;translate:0}to{opacity:0}}@keyframes sa-arena-dash{to{stroke-dashoffset:-22px}}@keyframes sa-arena-vell-idle{0%,to{transform:translate(0,0)rotate(0)scale(1)}30%{transform:translate(-1px,-2px)rotate(-.4deg)scale(1.003)}55%{transform:translateY(-4px)rotate(0)scale(1.006)}80%{transform:translate(1px,-2px)rotate(.4deg)scale(1.003)}}@keyframes sa-arena-stitch-idle{0%,to{transform:translate(0,0)rotate(-.35deg)scaleX(1.008)scaleY(.994)}50%{transform:translateY(-4px)rotate(.35deg)scaleX(.996)scaleY(1.008)}}@keyframes sa-arena-reeve-idle{0%,to{transform:translate(0,0)rotate(-.6deg)scale(1)}25%,75%{transform:translateY(-2px)rotate(0)scale(1.004)}50%{transform:translateY(-5px)rotate(.6deg)scale(1.008)}}@keyframes sa-arena-rattle-idle{0%,to{transform:translate(0,0)rotate(-.45deg)}46%{transform:translateY(-3px)rotate(.35deg)}49%{transform:translate(1.2px,-3px)rotate(.7deg)}52%{transform:translate(-1.2px,-3px)rotate(-.7deg)}55%{transform:translate(.6px,-3px)rotate(.4deg)}72%{transform:translateY(-2px)rotate(.25deg)}}@keyframes sa-arena-ember-idle{0%,to{transform:translate(-1px)rotate(-.5deg)scaleX(1.01)scaleY(.99)}50%{transform:translate(1px,-3px)rotate(.5deg)scaleX(.99)scaleY(1.02)}}@keyframes sa-arena-shard-idle{0%,to{transform:translate(0,0)rotate(-.12deg)}50%{transform:translateY(-3px)rotate(.12deg)}}@keyframes sa-arena-poly-idle{0%,to{transform:translate(-1px)rotate(-.3deg)scale(1)}50%{transform:translate(1px,-3px)rotate(.3deg)scale(1.004)}}@keyframes sa-arena-tide-idle{0%,to{transform:translate(-1px)rotate(-.55deg)}50%{transform:translate(1px,-4px)rotate(.55deg)}}@keyframes sa-arena-lume-idle{0%,to{transform:translate(0,0)rotate(-1deg)}50%{transform:translateY(-2px)rotate(1deg)}}@keyframes sa-arena-moss-idle{0%,to{transform:translate(0,0)rotate(-.7deg)scaleX(1.008)scaleY(.995)}50%{transform:translateY(-3px)rotate(.7deg)scaleX(.995)scaleY(1.012)}}@keyframes sa-arena-bur-idle{0%,to{transform:translateY(2px)scaleX(1.012)scaleY(.99)}46%{transform:translateY(-2px)scaleX(.997)scaleY(1.01)}72%{transform:translate(0,0)scale(1.004)}}.specter-arena-root .sa-arena-plate--paused{color:var(--text);inset:8px auto auto 50%;transform:translate(-50%)}.specter-arena-root .sa-hero__fx{z-index:3;width:31px;height:31px;transform:scale(calc(2.5 * var(--sa-fx-flip,1)), 2.5);transform-origin:50% 0;filter:saturate(1.5)brightness(1.3)drop-shadow(0 0 4px #ffffff8c);pointer-events:none;position:absolute;top:-30px;left:6.5px}.specter-arena-root .sa-hero.sa-is-attack,.specter-arena-root .sa-hero.sa-is-cast{z-index:3}.specter-arena-root .sa-hero--reeve.sa-is-attack.sa-is-animated .sa-hero__img{animation:.62s cubic-bezier(.3,.05,.2,1) both sa-arena-reeve-attack}.specter-arena-root .sa-hero--reeve.sa-is-cast.sa-is-animated .sa-hero__img{animation:.9s ease-in-out both sa-arena-reeve-cast}.specter-arena-root .sa-hero--vell.sa-is-attack.sa-is-animated .sa-hero__img{animation:.56s cubic-bezier(.3,.05,.2,1) both sa-arena-vell-attack}.specter-arena-root .sa-hero--vell.sa-is-cast.sa-is-animated .sa-hero__img{animation:.95s ease-in-out both sa-arena-vell-cast}.specter-arena-root .sa-hero--stitch.sa-is-attack.sa-is-animated .sa-hero__img{animation:.65s cubic-bezier(.3,.05,.2,1) both sa-arena-stitch-attack}.specter-arena-root .sa-hero--stitch.sa-is-cast.sa-is-animated .sa-hero__img{animation:1.05s ease-in-out both sa-arena-stitch-cast}.specter-arena-root .sa-hero--poly.sa-is-attack.sa-is-animated .sa-hero__img{animation:.6s cubic-bezier(.3,.05,.2,1) both sa-arena-poly-attack}.specter-arena-root .sa-hero--poly.sa-is-cast.sa-is-animated .sa-hero__img{animation:1s ease-in-out both sa-arena-poly-cast}.specter-arena-root .sa-hero--rattle.sa-is-attack.sa-is-animated .sa-hero__img{animation:.62s cubic-bezier(.3,.05,.2,1) both sa-arena-rattle-attack}.specter-arena-root .sa-hero--rattle.sa-is-cast.sa-is-animated .sa-hero__img{animation:1s ease-in-out both sa-arena-rattle-cast}.specter-arena-root .sa-hero--ember.sa-is-attack.sa-is-animated .sa-hero__img{animation:.52s cubic-bezier(.3,.05,.2,1) both sa-arena-ember-attack}.specter-arena-root .sa-hero--ember.sa-is-cast.sa-is-animated .sa-hero__img{animation:.95s ease-in-out both sa-arena-ember-cast}.specter-arena-root .sa-hero--shard.sa-is-attack.sa-is-animated .sa-hero__img{animation:.65s cubic-bezier(.3,.05,.2,1) both sa-arena-shard-attack}.specter-arena-root .sa-hero--shard.sa-is-cast.sa-is-animated .sa-hero__img{animation:1.1s ease-in-out both sa-arena-shard-cast}.specter-arena-root .sa-hero--tide.sa-is-attack.sa-is-animated .sa-hero__img{animation:.58s cubic-bezier(.3,.05,.2,1) both sa-arena-tide-attack}.specter-arena-root .sa-hero--tide.sa-is-cast.sa-is-animated .sa-hero__img{animation:1.05s ease-in-out both sa-arena-tide-cast}.specter-arena-root .sa-hero--lume.sa-is-attack.sa-is-animated .sa-hero__img{animation:.6s cubic-bezier(.3,.05,.2,1) both sa-arena-lume-attack}.specter-arena-root .sa-hero--lume.sa-is-cast.sa-is-animated .sa-hero__img{animation:1.1s ease-in-out both sa-arena-lume-cast}.specter-arena-root .sa-hero--moss.sa-is-attack.sa-is-animated .sa-hero__img{animation:.6s cubic-bezier(.3,.05,.2,1) both sa-arena-moss-attack}.specter-arena-root .sa-hero--moss.sa-is-cast.sa-is-animated .sa-hero__img{animation:1.15s ease-in-out both sa-arena-moss-cast}.specter-arena-root .sa-hero--bur.sa-is-attack.sa-is-animated .sa-hero__img{animation:.68s cubic-bezier(.3,.05,.2,1) both sa-arena-bur-attack}.specter-arena-root .sa-hero--bur.sa-is-cast.sa-is-animated .sa-hero__img{animation:1.2s ease-in-out both sa-arena-bur-cast}.specter-arena-root .sa-fx-directional{pointer-events:none}.specter-arena-root .sa-fx-reeve-slash{z-index:3;width:48px;height:38px;transform:rotate(var(--sa-fx-angle,0deg));transform-origin:15% 70%;pointer-events:none;position:absolute;top:0;left:45%}.specter-arena-root .sa-fx-reeve-slash svg{width:100%;height:100%;display:block;overflow:visible}.specter-arena-root .sa-fx-reeve-slash path{fill:none;stroke-linecap:round}.specter-arena-root .sa-fx-reeve-slash__trail{stroke:#b49aff61;stroke-width:8px;filter:blur(2px)}.specter-arena-root .sa-fx-reeve-slash__edge{stroke:#e1d4ff;stroke-width:2.6px;filter:drop-shadow(0 0 3px #b49afff2)}.specter-arena-root .sa-fx-reeve-slash svg{animation:.62s ease-out both sa-arena-reeve-slash}.specter-arena-root .sa-fx-reeve-aura{z-index:2;pointer-events:none;position:absolute;inset:0}.specter-arena-root .sa-fx-reeve-aura__ring{border:1px solid #cbb9ffe0;border-radius:50%;position:absolute;top:61%;left:50%;box-shadow:0 0 4px #b49affb3,inset 0 0 4px #b49aff61}.specter-arena-root .sa-fx-reeve-aura__ring--outer{width:35px;height:15px}.specter-arena-root .sa-fx-reeve-aura__ring--inner{--sa-fx-delay:80ms;width:25px;height:10px}.specter-arena-root .sa-fx-reeve-aura__mote{background:#ded0ff;border-radius:50%;width:3px;height:3px;position:absolute;box-shadow:0 0 5px #b49aff}.specter-arena-root .sa-fx-reeve-aura__mote--one{top:54%;left:23%}.specter-arena-root .sa-fx-reeve-aura__mote--two{--sa-fx-delay:90ms;top:42%;left:68%}.specter-arena-root .sa-fx-reeve-aura__mote--three{--sa-fx-delay:.16s;top:66%;left:78%}.specter-arena-root .sa-fx-reeve-aura__ring{animation:.9s ease-out both sa-arena-reeve-aura-ring;animation-delay:var(--sa-fx-delay,0s)}.specter-arena-root .sa-fx-reeve-aura__mote{animation:.9s ease-out both sa-arena-reeve-aura-mote;animation-delay:var(--sa-fx-delay,0s)}.specter-arena-root .sa-fx-vell-wave{z-index:3;width:50px;height:38px;transform:rotate(var(--sa-fx-angle,0deg));transform-origin:14% 68%;position:absolute;top:1px;left:42%}.specter-arena-root .sa-fx-vell-wave svg,.specter-arena-root .sa-fx-stitch-shockwave svg{width:100%;height:100%;display:block;overflow:visible}.specter-arena-root .sa-fx-vell-wave path,.specter-arena-root .sa-fx-stitch-shockwave path{fill:none;stroke-linecap:round}.specter-arena-root .sa-fx-vell-wave path.sa-fx-vell-wave__trail{fill:#b49aff29;stroke:#b49aff59;stroke-width:7px;filter:blur(1.5px)}.specter-arena-root .sa-fx-vell-wave__edge{stroke:#e1d4ffe6;stroke-width:2px}.specter-arena-root .sa-fx-vell-wave svg{animation:.56s ease-out both sa-arena-vell-wave}.specter-arena-root .sa-fx-vell-ward,.specter-arena-root .sa-fx-stitch-rewire,.specter-arena-root .sa-fx-poly-scan{z-index:2;pointer-events:none;position:absolute;inset:0}.specter-arena-root .sa-fx-vell-ward__clasp{z-index:3;background:#ffe2a0;border-radius:50%;width:4px;height:4px;position:absolute;top:42%;left:57%;box-shadow:0 0 4px #ffd080,0 0 8px #ffd080a6}.specter-arena-root .sa-fx-vell-ward__ring{background:#b49aff0d;border:1px solid #cbb9ffc2;border-radius:50%;position:absolute;top:56%;left:50%;box-shadow:0 0 5px #b49aff59}.specter-arena-root .sa-fx-vell-ward__ring--outer{width:43px;height:34px}.specter-arena-root .sa-fx-vell-ward__ring--inner{--sa-fx-delay:90ms;width:32px;height:25px}.specter-arena-root .sa-fx-vell-ward__ring{animation:.95s ease-out both sa-arena-ward-expand;animation-delay:var(--sa-fx-delay,0s)}.specter-arena-root .sa-fx-vell-ward__clasp{animation:.95s ease-in-out both sa-arena-poly-eye-pulse}.specter-arena-root .sa-fx-stitch-shockwave{z-index:3;width:46px;height:25px;transform:rotate(var(--sa-fx-angle,0deg));transform-origin:12% 75%;position:absolute;top:45%;left:42%}.specter-arena-root .sa-fx-stitch-shockwave__arc{stroke:#cbb9ffe6;stroke-width:3px;filter:drop-shadow(0 0 3px #b49affb3)}.specter-arena-root .sa-fx-stitch-shockwave__marks{stroke:#f0e9ff;stroke-width:2px}.specter-arena-root .sa-fx-stitch-shockwave svg{animation:.65s ease-out both sa-arena-stitch-shockwave}.specter-arena-root .sa-fx-stitch-rewire__arc{filter:drop-shadow(0 0 3px #b49aff);border-top:2px solid #d9c9ff;border-bottom:2px solid #b49aff;width:12px;height:22px;position:absolute;top:24%}.specter-arena-root .sa-fx-stitch-rewire__arc--left{left:5%;transform:skewY(-32deg)rotate(-12deg)}.specter-arena-root .sa-fx-stitch-rewire__arc--right{right:3%;transform:skewY(32deg)rotate(12deg)}.specter-arena-root .sa-fx-stitch-rewire__particle{border-top:1px solid #efe8ff;border-bottom:1px solid #efe8ff;width:5px;height:2px;position:absolute}.specter-arena-root .sa-fx-stitch-rewire__particle--one{top:18%;left:18%;transform:rotate(32deg)}.specter-arena-root .sa-fx-stitch-rewire__particle--two{top:48%;right:12%;transform:rotate(-26deg)}.specter-arena-root .sa-fx-stitch-rewire__particle--three{top:4%;left:44%;transform:rotate(80deg)}.specter-arena-root .sa-fx-stitch-rewire__ring{border:1px solid #b49affb3;border-radius:50%;width:38px;height:15px;position:absolute;top:70%;left:50%}.specter-arena-root .sa-fx-stitch-rewire__arc,.specter-arena-root .sa-fx-stitch-rewire__particle{animation:1.05s linear both sa-arena-rewire-electric}.specter-arena-root .sa-fx-stitch-rewire__ring{animation:1.05s ease-out .28s both sa-arena-ward-expand}.specter-arena-root .sa-fx-poly-beam{z-index:3;width:56px;height:8px;transform:rotate(var(--sa-fx-angle,0deg));transform-origin:0;position:absolute;top:43%;left:51%}.specter-arena-root .sa-fx-poly-beam i{transform-origin:0;width:100%;position:absolute;top:50%;left:0}.specter-arena-root .sa-fx-poly-beam__glow{filter:blur(2px);background:linear-gradient(90deg,#b49affcc,#b49aff00);height:7px;transform:translateY(-50%)}.specter-arena-root .sa-fx-poly-beam__core{background:linear-gradient(90deg,#f4efff,#c5afff 55%,#0000);height:2px;transform:translateY(-50%);box-shadow:0 0 3px #e1d4ffe6}.specter-arena-root .sa-fx-poly-beam i{animation:.6s ease-out both sa-arena-poly-beam}.specter-arena-root .sa-fx-poly-scan__eye,.specter-arena-root .sa-fx-poly-scan__ring{border:1px solid #cbb9ffdb;border-radius:50%;position:absolute;top:43%;left:50%;transform:translate(-50%,-50%);box-shadow:0 0 4px #b49aff80}.specter-arena-root .sa-fx-poly-scan__eye{background:radial-gradient(circle,#efe8ff8c,#0000 70%);width:11px;height:11px}.specter-arena-root .sa-fx-poly-scan__ring--one{width:34px;height:34px}.specter-arena-root .sa-fx-poly-scan__ring--two{--sa-fx-delay:.11s;width:47px;height:47px}.specter-arena-root .sa-fx-poly-scan__ray{transform-origin:0;background:linear-gradient(90deg,#cbb9ffcc,#0000);width:21px;height:1px;position:absolute;top:43%;left:50%}.specter-arena-root .sa-fx-poly-scan__ray--two{transform:rotate(120deg)}.specter-arena-root .sa-fx-poly-scan__ray--three{transform:rotate(240deg)}.specter-arena-root .sa-fx-poly-scan__eye{animation:1s ease-in-out both sa-arena-poly-eye-pulse}.specter-arena-root .sa-fx-poly-scan__ring{animation:1s ease-out both sa-arena-poly-scan;animation-delay:var(--sa-fx-delay,0s)}.specter-arena-root .sa-fx-poly-scan__ray{animation:1s ease-out both sa-arena-rewire-electric}.specter-arena-root .sa-fx-rattle-impact{z-index:3;width:43px;height:31px;transform:rotate(var(--sa-fx-angle,0deg));transform-origin:10% 60%;position:absolute;top:22%;left:47%}.specter-arena-root .sa-fx-rattle-impact__burst{background:radial-gradient(circle,#e1d4ff80,#0000 68%);border:2px solid #cbb9ffd9;border-radius:50%;width:15px;height:15px;position:absolute;top:10px;left:23px;box-shadow:0 0 5px #b49affb3}.specter-arena-root .sa-fx-rattle-impact__bone{background:#eee8e5;border-radius:3px;width:8px;height:3px;position:absolute;top:14px;left:27px;box-shadow:-1px 0 #eee8e5,1px 0 #eee8e5}.specter-arena-root .sa-fx-rattle-impact__bone--one{--sa-fragment-x:6px;--sa-fragment-y:-7px;rotate:-28deg}.specter-arena-root .sa-fx-rattle-impact__bone--two{--sa-fragment-x:9px;--sa-fragment-y:1px;rotate:18deg}.specter-arena-root .sa-fx-rattle-impact__bone--three{--sa-fragment-x:4px;--sa-fragment-y:7px;rotate:48deg}.specter-arena-root .sa-fx-rattle-impact__burst{animation:.62s ease-out both sa-arena-rattle-impact}.specter-arena-root .sa-fx-rattle-impact__bone{animation:.62s ease-out both sa-arena-bone-fragment}.specter-arena-root .sa-fx-rattle-resonance,.specter-arena-root .sa-fx-ember-flare,.specter-arena-root .sa-fx-shard-prism{z-index:2;pointer-events:none;position:absolute;inset:0}.specter-arena-root .sa-fx-rattle-resonance__rib{border-top:2px solid #eee8e5e6;border-bottom:2px solid #eee8e5b8;border-radius:50%;width:11px;height:19px;position:absolute;top:35%}.specter-arena-root .sa-fx-rattle-resonance__rib--left{left:12%;rotate:-18deg}.specter-arena-root .sa-fx-rattle-resonance__rib--right{right:10%;rotate:18deg}.specter-arena-root .sa-fx-rattle-resonance__ring{border:1px solid #b49affbf;border-radius:50%;position:absolute;top:56%;left:50%;transform:translate(-50%,-50%)}.specter-arena-root .sa-fx-rattle-resonance__ring--one{width:36px;height:28px}.specter-arena-root .sa-fx-rattle-resonance__ring--two{--sa-fx-delay:.11s;width:47px;height:36px}.specter-arena-root .sa-fx-rattle-resonance__mote{transform-origin:0 10px;background:#eee8e5;border-radius:3px;width:5px;height:2px;position:absolute;top:48%;left:50%}.specter-arena-root .sa-fx-rattle-resonance__mote--one{rotate:20deg}.specter-arena-root .sa-fx-rattle-resonance__mote--two{rotate:140deg}.specter-arena-root .sa-fx-rattle-resonance__mote--three{rotate:260deg}.specter-arena-root .sa-fx-rattle-resonance__rib,.specter-arena-root .sa-fx-rattle-resonance__mote{animation:1s ease-in-out both sa-arena-rewire-electric}.specter-arena-root .sa-fx-rattle-resonance__ring{animation:1s ease-out both sa-arena-ward-expand;animation-delay:var(--sa-fx-delay,0s)}.specter-arena-root .sa-fx-ember-bolt{z-index:3;width:55px;height:12px;transform:rotate(var(--sa-fx-angle,0deg));transform-origin:0;position:absolute;top:42%;left:50%}.specter-arena-root .sa-fx-ember-bolt__trail{filter:blur(1px);background:linear-gradient(90deg,#ffd08000,#b49aff9e);border-radius:50%;width:27px;height:3px;position:absolute;top:5px;left:1px}.specter-arena-root .sa-fx-ember-bolt__orb{background:#ffe2a0;border:2px solid #b49affd1;border-radius:50%;width:8px;height:8px;position:absolute;top:2px;left:21px;box-shadow:0 0 4px #ffd080,0 0 8px #b49affb3}.specter-arena-root .sa-fx-ember-bolt__trail,.specter-arena-root .sa-fx-ember-bolt__orb{animation:.52s ease-out both sa-arena-ember-bolt}.specter-arena-root .sa-fx-ember-flare__aura{background:radial-gradient(circle,#ffd08059,#b49aff1f 58%,#0000 72%);border:1px solid #b49affb3;border-radius:48% 52% 42% 58%;width:44px;height:48px;position:absolute;top:52%;left:50%;box-shadow:0 0 9px #ffd08059}.specter-arena-root .sa-fx-ember-flare__mote{transform-origin:0 14px;background:linear-gradient(#ffe3a4,#9d80ee);border-radius:70% 30% 60% 40%;width:5px;height:8px;position:absolute;top:48%;left:50%}.specter-arena-root .sa-fx-ember-flare__mote--one{rotate:25deg}.specter-arena-root .sa-fx-ember-flare__mote--two{--sa-fx-delay:80ms;rotate:145deg}.specter-arena-root .sa-fx-ember-flare__mote--three{--sa-fx-delay:.15s;rotate:265deg}.specter-arena-root .sa-fx-ember-flare__aura{animation:.95s ease-out both sa-arena-flare-bloom}.specter-arena-root .sa-fx-ember-flare__mote{animation:.95s ease-out both sa-arena-reeve-aura-mote;animation-delay:var(--sa-fx-delay,0s)}.specter-arena-root .sa-fx-shard-volley{z-index:3;width:57px;height:24px;transform:rotate(var(--sa-fx-angle,0deg));transform-origin:0;position:absolute;top:29%;left:56%}.specter-arena-root .sa-fx-shard-volley__projectile{--sa-shard-y:0px;clip-path:polygon(0 50%,72% 0,100% 50%,72% 100%);filter:drop-shadow(0 0 3px #b49affcc);background:linear-gradient(90deg,#f0eaff,#9b7ce9);width:9px;height:4px;position:absolute;top:9px;left:0}.specter-arena-root .sa-fx-shard-volley__projectile--two{--sa-shard-y:-6px;--sa-fx-delay:55ms}.specter-arena-root .sa-fx-shard-volley__projectile--three{--sa-shard-y:6px;--sa-fx-delay:.105s}.specter-arena-root .sa-fx-shard-volley__projectile{animation:.65s ease-out both sa-arena-shard-projectile;animation-delay:var(--sa-fx-delay,0s)}.specter-arena-root .sa-fx-shard-prism__glint{background:#f4efff;border-radius:50%;width:7px;height:7px;position:absolute;box-shadow:0 0 5px #b49aff}.specter-arena-root .sa-fx-shard-prism__glint--one{top:24%;left:59%}.specter-arena-root .sa-fx-shard-prism__glint--two{--sa-fx-delay:90ms;top:42%;left:38%}.specter-arena-root .sa-fx-shard-prism__ring{border:1px solid #cbb9ffc7;width:42px;height:42px;position:absolute;top:52%;left:50%;transform:translate(-50%,-50%)rotate(45deg);box-shadow:0 0 5px #b49aff66}.specter-arena-root .sa-fx-shard-prism__ray{transform-origin:0;background:linear-gradient(90deg,#f0eaffe6,#0000);width:24px;height:1px;position:absolute;top:52%;left:50%}.specter-arena-root .sa-fx-shard-prism__ray--two{rotate:90deg}.specter-arena-root .sa-fx-shard-prism__ray--three{rotate:180deg}.specter-arena-root .sa-fx-shard-prism__ray--four{rotate:270deg}.specter-arena-root .sa-fx-shard-prism__glint,.specter-arena-root .sa-fx-shard-prism__ray{animation:1.1s ease-in-out both sa-arena-rewire-electric;animation-delay:var(--sa-fx-delay,0s)}.specter-arena-root .sa-fx-shard-prism__ring{animation:1.1s ease-out both sa-arena-prism-ring}.specter-arena-root .sa-fx-tide-lash{z-index:3;width:50px;height:36px;transform:rotate(var(--sa-fx-angle,0deg));transform-origin:12% 66%;position:absolute;top:3%;left:43%}.specter-arena-root .sa-fx-tide-lash svg{width:100%;height:100%;display:block;overflow:visible}.specter-arena-root .sa-fx-tide-lash path{fill:none;stroke-linecap:round}.specter-arena-root .sa-fx-tide-lash path.sa-fx-tide-lash__trail{fill:#70bce821;stroke:#70bce873;stroke-width:7px;filter:blur(1.5px)}.specter-arena-root .sa-fx-tide-lash__edge{stroke:#cee2fff2;stroke-width:2px}.specter-arena-root .sa-fx-tide-lash__drop{background:#a8dcf4;border-radius:60% 40% 65% 35%;width:4px;height:6px;position:absolute;top:16px;left:32px}.specter-arena-root .sa-fx-tide-lash__drop--two{--sa-fx-delay:45ms;top:10px;left:39px}.specter-arena-root .sa-fx-tide-lash__drop--three{--sa-fx-delay:90ms;top:24px;left:42px}.specter-arena-root .sa-fx-tide-lash svg,.specter-arena-root .sa-fx-tide-lash__drop{animation:.58s ease-out both sa-arena-water-lash;animation-delay:var(--sa-fx-delay,0s)}.specter-arena-root .sa-fx-tide-undertow,.specter-arena-root .sa-fx-lume-beacon,.specter-arena-root .sa-fx-moss-bloom,.specter-arena-root .sa-fx-bur-avalanche{z-index:2;pointer-events:none;position:absolute;inset:0}.specter-arena-root .sa-fx-tide-undertow__ripple{border:2px solid #70bce8b8;border-radius:50%;width:43px;height:17px;position:absolute;top:72%;left:50%;box-shadow:0 0 5px #b49aff66}.specter-arena-root .sa-fx-tide-undertow__wave{transform-origin:0;width:44px;height:28px;rotate:var(--sa-fx-angle,0deg);border-top:2px solid #b49affbf;border-radius:50%;position:absolute;top:56%;left:50%}.specter-arena-root .sa-fx-tide-undertow__bubble--one{top:54%;left:18%}.specter-arena-root .sa-fx-tide-undertow__bubble--two{--sa-fx-delay:.1s;top:46%;right:12%}.specter-arena-root .sa-fx-tide-undertow__bubble--three{--sa-fx-delay:.19s;top:25%;left:42%}.specter-arena-root .sa-fx-tide-undertow__bubble--four{--sa-fx-delay:.28s;top:18%;right:28%}.specter-arena-root .sa-fx-tide-undertow__ripple,.specter-arena-root .sa-fx-tide-undertow__wave{animation:1.05s ease-out both sa-arena-water-ripple}.specter-arena-root .sa-fx-tide-undertow__bubble{animation:1.05s ease-out both sa-arena-bubble-rise;animation-delay:var(--sa-fx-delay,0s)}.specter-arena-root .sa-fx-lume-burst{z-index:3;width:55px;height:18px;transform:rotate(var(--sa-fx-angle,0deg));transform-origin:0;position:absolute;top:42%;left:51%}.specter-arena-root .sa-fx-lume-burst__cone,.specter-arena-root .sa-fx-lume-burst__core{transform-origin:0;width:100%;position:absolute;top:50%;left:0}.specter-arena-root .sa-fx-lume-burst__cone{clip-path:polygon(0 42%,100% 0,100% 100%,0 58%);filter:blur(1.5px);background:linear-gradient(90deg,#ffda91bf,#b49aff14);height:14px}.specter-arena-root .sa-fx-lume-burst__core{background:linear-gradient(90deg,#ffe4aa,#cfbcff 65%,#0000);height:3px;box-shadow:0 0 4px #ffda91b3}.specter-arena-root .sa-fx-lume-burst__cone,.specter-arena-root .sa-fx-lume-burst__core{animation:.6s ease-out both sa-arena-ghostlight-burst}.specter-arena-root .sa-fx-lume-beacon__halo,.specter-arena-root .sa-fx-lume-beacon__ring{border-radius:50%;position:absolute;top:50%;left:50%}.specter-arena-root .sa-fx-lume-beacon__halo{background:radial-gradient(circle,#ffda916b,#b49aff14 66%,#0000);width:42px;height:42px}.specter-arena-root .sa-fx-lume-beacon__ring{border:1px solid #b49affb8;width:49px;height:49px}.specter-arena-root .sa-fx-lume-beacon__mote{transform-origin:0 16px;background:#ffe4aa;border-radius:50%;width:5px;height:5px;position:absolute;top:50%;left:50%;box-shadow:0 0 5px #ffda91cc}.specter-arena-root .sa-fx-lume-beacon__mote--one{rotate:0deg}.specter-arena-root .sa-fx-lume-beacon__mote--two{--sa-fx-delay:70ms;rotate:90deg}.specter-arena-root .sa-fx-lume-beacon__mote--three{--sa-fx-delay:.14s;rotate:180deg}.specter-arena-root .sa-fx-lume-beacon__mote--four{--sa-fx-delay:.21s;rotate:270deg}.specter-arena-root .sa-fx-lume-beacon__halo{animation:1.1s ease-in-out both sa-arena-ghostlight-pulse}.specter-arena-root .sa-fx-lume-beacon__ring{animation:1.1s ease-out both sa-arena-ward-expand}.specter-arena-root .sa-fx-lume-beacon__mote{animation:1.1s ease-out both sa-arena-reeve-aura-mote;animation-delay:var(--sa-fx-delay,0s)}.specter-arena-root .sa-fx-moss-puff{z-index:3;width:52px;height:24px;transform:rotate(var(--sa-fx-angle,0deg));transform-origin:0;position:absolute;top:41%;left:51%}.specter-arena-root .sa-fx-moss-puff i{left:3px;top:calc(5px + var(--sa-spore-index) * 3px);background:var(--sa-spore-color,#b8d69f);border-radius:50%;width:5px;height:5px;position:absolute;box-shadow:0 0 4px #b49affa6}.specter-arena-root .sa-fx-moss-puff i:nth-child(2n){--sa-spore-color:#c9b8f5}.specter-arena-root .sa-fx-moss-puff i{animation:.6s ease-out both sa-arena-spore-drift;animation-delay:calc(var(--sa-spore-index) * 28ms)}.specter-arena-root .sa-fx-moss-bloom__ring{border:1px solid #9bbe7dbf;border-radius:48% 52% 44% 56%;width:44px;height:22px;position:absolute;top:65%;left:50%;box-shadow:0 0 5px #b49aff59}.specter-arena-root .sa-fx-moss-bloom__tendril{border-left:2px solid #9bbe7db3;border-radius:50%;width:12px;height:20px;position:absolute;bottom:20%}.specter-arena-root .sa-fx-moss-bloom__tendril--one{left:24%;rotate:-18deg}.specter-arena-root .sa-fx-moss-bloom__tendril--two{right:22%;rotate:18deg}.specter-arena-root .sa-fx-moss-bloom__spore{left:var(--sa-spore-left);top:var(--sa-spore-top);background:#c7dcae;border-radius:50%;width:4px;height:4px;position:absolute;box-shadow:0 0 3px #b49aff99}.specter-arena-root .sa-fx-moss-bloom__ring{animation:1.15s ease-out both sa-arena-organic-bloom}.specter-arena-root .sa-fx-moss-bloom__tendril,.specter-arena-root .sa-fx-moss-bloom__spore{animation:1.15s ease-in-out both sa-arena-rewire-electric}.specter-arena-root .sa-fx-bur-frost-impact{z-index:3;width:50px;height:34px;transform:rotate(var(--sa-fx-angle,0deg));transform-origin:8% 60%;position:absolute;top:25%;left:48%}.specter-arena-root .sa-fx-bur-frost-impact__crescent{filter:drop-shadow(0 0 4px #b49affb3);border-top:5px solid #e7e2ffd9;border-radius:50%;width:25px;height:19px;position:absolute;top:7px;left:19px}.specter-arena-root .sa-fx-bur-frost-impact__chunk{background:#eeeaff;width:5px;height:5px;position:absolute;top:15px;left:29px;rotate:45deg}.specter-arena-root .sa-fx-bur-frost-impact__chunk--one{--sa-fragment-x:7px;--sa-fragment-y:-9px}.specter-arena-root .sa-fx-bur-frost-impact__chunk--two{--sa-fragment-x:12px;--sa-fragment-y:-2px}.specter-arena-root .sa-fx-bur-frost-impact__chunk--three{--sa-fragment-x:10px;--sa-fragment-y:7px}.specter-arena-root .sa-fx-bur-frost-impact__chunk--four{--sa-fragment-x:3px;--sa-fragment-y:10px}.specter-arena-root .sa-fx-bur-frost-impact__crescent{animation:.68s ease-out both sa-arena-frost-impact}.specter-arena-root .sa-fx-bur-frost-impact__chunk{animation:.68s ease-out both sa-arena-bone-fragment}.specter-arena-root .sa-fx-bur-avalanche__mist{filter:blur(2px);background:radial-gradient(circle,#ece8ff61,#b49aff1a 62%,#0000 76%);border-radius:50%;width:46px;height:38px;position:absolute;top:47%;left:50%}.specter-arena-root .sa-fx-bur-avalanche__wave{border:2px solid #dcd7ffb8;border-radius:50%;width:52px;height:40px;position:absolute;top:58%;left:50%}.specter-arena-root .sa-fx-bur-avalanche__sparkle{background:#fff;width:2px;height:11px;position:absolute;top:22%;left:65%;box-shadow:0 0 4px #cbb9ff}.specter-arena-root .sa-fx-bur-avalanche__flake{transform-origin:0 18px;border:1px solid #f3efff;width:5px;height:5px;position:absolute;top:48%;left:50%;rotate:45deg}.specter-arena-root .sa-fx-bur-avalanche__flake--one{rotate:20deg}.specter-arena-root .sa-fx-bur-avalanche__flake--two{--sa-fx-delay:80ms;rotate:110deg}.specter-arena-root .sa-fx-bur-avalanche__flake--three{--sa-fx-delay:.16s;rotate:200deg}.specter-arena-root .sa-fx-bur-avalanche__flake--four{--sa-fx-delay:.24s;rotate:290deg}.specter-arena-root .sa-fx-bur-avalanche__mist{animation:1.2s ease-in-out both sa-arena-ghostlight-pulse}.specter-arena-root .sa-fx-bur-avalanche__wave{animation:1.2s ease-out both sa-arena-avalanche-wave}.specter-arena-root .sa-fx-bur-avalanche__sparkle,.specter-arena-root .sa-fx-bur-avalanche__flake{animation:1.2s ease-in-out both sa-arena-rewire-electric;animation-delay:var(--sa-fx-delay,0s)}@keyframes sa-arena-reeve-attack{0%,to{transform:translate(0,0)rotate(0)scale(1)}14%{transform:translate(-2px,1px)rotate(-4deg)scale(.99)}29%{transform:translate(-5px,2px)rotate(-8deg)scale(.985)}45%{transform:translate(7px,-3px)rotate(10deg)scale(1.025)}62%{transform:translate(10px,-3px)rotate(12deg)scale(1.03)}80%{transform:translate(3px,-1px)rotate(3deg)scale(1.01)}}@keyframes sa-arena-reeve-cast{0%,to{transform:translate(0,0)scale(1)rotate(0)}20%{transform:translateY(-2px)scale(1.005)rotate(-1deg)}45%{transform:translateY(-5px)scale(1.02)rotate(0)}65%{transform:translateY(-5px)scale(1.025)rotate(1deg)}82%{transform:translateY(-2px)scale(1.01)rotate(0)}}@keyframes sa-arena-vell-attack{0%,to{transform:translate(0,0)rotate(0)scale(1)}20%{transform:translate(-3px,1px)rotate(-3deg)scale(.99)}45%{transform:translate(8px,-2px)rotate(6deg)scale(1.02)}65%{transform:translate(10px,-2px)rotate(8deg)scale(1.025)}82%{transform:translate(3px)rotate(2deg)scale(1.008)}}@keyframes sa-arena-vell-cast{0%,to{transform:translate(0,0)scale(1)}24%{transform:translateY(-2px)scaleX(1.01)scaleY(1.004)}52%,70%{transform:translateY(-4px)scaleX(1.035)scaleY(1.012)}84%{transform:translateY(-2px)scale(1.006)}}@keyframes sa-arena-stitch-attack{0%,to{transform:translate(0,0)rotate(0)scale(1)}18%{transform:translateY(2px)rotate(-2deg)scaleX(1.03)scaleY(.97)}35%{transform:translate(-3px,1px)rotate(-5deg)scale(1)}55%{transform:translate(10px,-1px)rotate(7deg)scaleX(.98)scaleY(1.03)}68%{transform:translate(8px,2px)rotate(5deg)scaleX(1.045)scaleY(.96)}85%{transform:translate(2px)rotate(1deg)scale(1)}}@keyframes sa-arena-stitch-cast{0%,to{transform:translate(0,0)scale(1)}20%{transform:translateY(1px)scaleX(1.025)scaleY(.98)}38%{transform:translate(-2px,-1px)rotate(-2deg)scale(1.005)}54%{transform:translate(2px,-1px)rotate(2deg)scale(1.015)}66%{transform:translate(-1px)rotate(-1deg)scale(1.008)}82%{transform:translateY(-2px)scale(1.02)}}@keyframes sa-arena-poly-attack{0%,to{transform:translate(0,0)rotate(0)scale(1)}20%{transform:translate(-2px,1px)scale(.985)}38%{transform:translateY(-1px)scale(1.01)}50%,70%{transform:translate(5px,-1px)rotate(2deg)scale(1.02)}}@keyframes sa-arena-poly-cast{0%,to{transform:translate(0,0)scale(1)}25%{transform:translateY(-3px)scale(.992)}48%{transform:translateY(-3px)scale(1.015)}72%{transform:translateY(-1px)scale(1.008)}}@keyframes sa-arena-rattle-attack{0%,to{transform:translate(0,0)rotate(0)scale(1)}24%{transform:translate(-3px,1px)rotate(-5deg)scale(.99)}50%{transform:translate(8px,-1px)rotate(9deg)scaleX(1.025)scaleY(.975)}68%{transform:translate(6px)rotate(6deg)scale(1.008)}82%{transform:translate(1px)rotate(-1deg)scale(.998)}}@keyframes sa-arena-rattle-cast{0%,to{transform:translate(0,0)rotate(0)}24%{transform:translate(-1.2px,-1px)rotate(-1deg)}31%{transform:translate(1.2px,-1px)rotate(1deg)}48%{transform:translate(-1.2px,-3px)rotate(-.8deg)}55%{transform:translate(1.2px,-3px)rotate(.8deg)}76%{transform:translateY(-2px)rotate(0)}}@keyframes sa-arena-ember-attack{0%,to{transform:translate(0,0)scale(1)}28%{transform:translate(-2px,1px)scaleX(.96)scaleY(1.025)}48%{transform:translate(7px,-1px)scaleX(1.055)scaleY(.985)}66%{transform:translate(5px)scaleX(1.025)scaleY(.995)}82%{transform:translate(1px)scale(.995)}}@keyframes sa-arena-ember-cast{0%,to{transform:translate(0,0)scale(1)}28%{transform:translateY(-2px)scale(1.015)}56%,72%{transform:translateY(-4px)scaleX(1.035)scaleY(1.045)}86%{transform:translateY(-2px)scale(1.01)}}@keyframes sa-arena-shard-attack{0%,to{transform:translate(0,0)rotate(0)scale(1)}28%{transform:translate(-2px)rotate(-1.8deg)scale(.995)}48%{transform:translate(4px,-1px)rotate(2deg)scale(1.012)}72%{transform:translate(3px,-1px)rotate(1deg)scale(1.006)}}@keyframes sa-arena-shard-cast{0%,to{transform:translate(0,0)scale(1)}48%,68%{transform:translateY(-3px)scale(1.012)}84%{transform:translateY(-1px)scale(1.005)}}@keyframes sa-arena-tide-attack{0%,to{transform:translate(0,0)rotate(0)scale(1)}25%{transform:translate(-3px,1px)rotate(-4deg)scaleX(1.015)scaleY(.99)}50%{transform:translate(7px,-2px)rotate(8deg)scaleX(.985)scaleY(1.025)}72%{transform:translate(4px,-1px)rotate(3deg)scale(1.008)}86%{transform:translate(1px)rotate(-1deg)}}@keyframes sa-arena-tide-cast{0%,to{transform:translate(0,0)scale(1)}22%{transform:translateY(2px)scaleX(1.015)scaleY(.99)}58%,72%{transform:translateY(-5px)scaleX(.995)scaleY(1.018)}88%{transform:translateY(-2px)scale(1.006)}}@keyframes sa-arena-lume-attack{0%,to{transform:translate(0,0)rotate(0)scale(1)}28%{transform:translate(-2px,1px)rotate(-3deg)scale(.995)}50%{transform:translate(6px,-1px)rotate(5deg)scale(1.018)}76%{transform:translate(2px)rotate(1deg)scale(1.005)}}@keyframes sa-arena-lume-cast{0%,to{transform:translate(0,0)scale(1)}46%,70%{transform:translateY(-3px)scale(1.012)}86%{transform:translateY(-1px)scale(1.004)}}@keyframes sa-arena-moss-attack{0%,to{transform:translate(0,0)rotate(0)scale(1)}28%{transform:translate(-1px,1px)rotate(-2deg)scaleX(1.025)scaleY(.975)}52%{transform:translate(5px,-1px)rotate(5deg)scaleX(.99)scaleY(1.02)}78%{transform:translate(1px)rotate(1deg)}}@keyframes sa-arena-moss-cast{0%,to{transform:translate(0,0)scale(1)}26%{transform:translateY(2px)scaleX(1.015)scaleY(.99)}55%,72%{transform:translate(0,0)scaleX(1.005)scaleY(1.025)}}@keyframes sa-arena-bur-attack{0%,to{transform:translate(0,0)rotate(0)scale(1)}28%{transform:translate(-4px,1px)rotate(-4deg)scale(.99)}56%{transform:translate(10px,1px)rotate(7deg)scaleX(1.035)scaleY(.97)}72%{transform:translate(7px)rotate(4deg)scale(1.012)}88%{transform:translate(1px)rotate(-1deg)}}@keyframes sa-arena-bur-cast{0%,to{transform:translate(0,0)scale(1)}25%{transform:translateY(2px)scaleX(1.025)scaleY(.98)}58%,76%{transform:translateY(-3px)scale(1.018)}}@keyframes sa-arena-reeve-slash{0%,34%{opacity:0;transform:scale(.7)rotate(-15deg)}43%{opacity:1;transform:scale(.86)rotate(-8deg)}62%{opacity:.82;transform:scale(1.15)rotate(12deg)}70%,to{opacity:0;transform:scale(1.18)rotate(14deg)}}@keyframes sa-arena-reeve-aura-ring{0%,18%{opacity:0;transform:translate(-50%,-50%)scale(.65)}50%,65%{opacity:.78;transform:translate(-50%,-50%)scale(1)}to{opacity:0;transform:translate(-50%,-50%)scale(1.2)}}@keyframes sa-arena-reeve-aura-mote{0%,20%{opacity:0;transform:translateY(3px)scale(.7)}52%{opacity:.9}to{opacity:0;transform:translateY(-9px)scale(.3)}}@keyframes sa-arena-vell-wave{0%,34%{opacity:0;transform:scaleX(.55)scaleY(.8)translate(-3px)}48%{opacity:.78}70%{opacity:0;transform:scaleX(1.18)scaleY(1.06)translate(8px)}to{opacity:0}}@keyframes sa-arena-ward-expand{0%,18%{opacity:0;transform:translate(-50%,-50%)scale(.35)}48%,68%{opacity:.7;transform:translate(-50%,-50%)scale(1)}to{opacity:0;transform:translate(-50%,-50%)scale(1.22)}}@keyframes sa-arena-poly-eye-pulse{0%,to{opacity:.12;transform:translate(-50%,-50%)scale(.82)}50%{opacity:.5;transform:translate(-50%,-50%)scale(1.08)}}@keyframes sa-arena-stitch-shockwave{0%,48%{opacity:0;transform:scale(.45)translate(-2px)}62%{opacity:.9}82%,to{opacity:0;transform:scale(1.18)translate(8px)}}@keyframes sa-arena-rewire-electric{0%,20%,to{opacity:0}32%,44%,58%{opacity:.9}38%,51%,72%{opacity:.25}}@keyframes sa-arena-poly-beam{0%,48%{opacity:0;transform:scaleX(.05)}55%{opacity:1;transform:scaleX(1)}72%{opacity:.8;transform:scaleX(1)}78%,to{opacity:0;transform:scaleX(1)}}@keyframes sa-arena-poly-scan{0%,42%{opacity:0;transform:translate(-50%,-50%)scale(.35)}58%{opacity:.8}78%,to{opacity:0;transform:translate(-50%,-50%)scale(1.2)}}@keyframes sa-arena-rattle-impact{0%,42%{opacity:0;transform:scale(.4)}52%{opacity:1;transform:scale(1)}76%,to{opacity:0;transform:scale(1.35)}}@keyframes sa-arena-bone-fragment{0%,42%{opacity:0;translate:0}52%{opacity:.95}78%,to{opacity:0;translate:var(--sa-fragment-x) var(--sa-fragment-y)}}@keyframes sa-arena-ember-bolt{0%,40%{opacity:0;translate:0;scale:.55}48%{opacity:1}76%{opacity:.9;translate:42px;scale:1}86%,to{opacity:0;translate:52px}}@keyframes sa-arena-flare-bloom{0%,26%{opacity:0;transform:translate(-50%,-50%)scale(.45)}58%,72%{opacity:.82;transform:translate(-50%,-50%)scale(1)}to{opacity:0;transform:translate(-50%,-50%)scale(1.22)}}@keyframes sa-arena-shard-projectile{0%,42%{opacity:0;translate:0;scale:.5}50%{opacity:1}84%{opacity:.82;translate:44px var(--sa-shard-y);scale:1}to{opacity:0;translate:51px var(--sa-shard-y)}}@keyframes sa-arena-prism-ring{0%,35%{opacity:0;transform:translate(-50%,-50%)rotate(45deg)scale(.4)}58%{opacity:.82}82%,to{opacity:0;transform:translate(-50%,-50%)rotate(45deg)scale(1.16)}}@keyframes sa-arena-water-lash{0%,36%{opacity:0;transform:scale(.55)translate(-3px)}50%{opacity:.9}76%,to{opacity:0;transform:scale(1.16)translate(7px)}}@keyframes sa-arena-water-ripple{0%,20%{opacity:0;transform:translate(-50%,-50%)scale(.4)}48%{opacity:.75}to{opacity:0;transform:translate(-50%,-50%)scale(1.25)}}@keyframes sa-arena-bubble-rise{0%{opacity:0;translate:0 5px;scale:.65}25%,68%{opacity:.72}to{opacity:0;translate:2px -13px;scale:1}}@keyframes sa-arena-ghostlight-burst{0%,40%{opacity:0;transform:scaleX(.1)}50%{opacity:.95;transform:scaleX(1)}76%,to{opacity:0;transform:scaleX(1.08)}}@keyframes sa-arena-ghostlight-pulse{0%,to{opacity:.22;transform:translate(-50%,-50%)scale(.9)}50%{opacity:.6;transform:translate(-50%,-50%)scale(1.08)}}@keyframes sa-arena-spore-drift{0%,35%{opacity:0;translate:0;scale:.55}48%{opacity:.8}to{opacity:0;translate:calc(22px + var(--sa-spore-index) * 4px) calc((var(--sa-spore-index) - 2) * 3px);scale:1}}@keyframes sa-arena-organic-bloom{0%,25%{opacity:0;transform:translate(-50%,-50%)scale(.45)rotate(-8deg)}58%{opacity:.72}to{opacity:0;transform:translate(-50%,-50%)scale(1.18)rotate(6deg)}}@keyframes sa-arena-frost-impact{0%,42%{opacity:0;transform:scale(.4)}56%{opacity:.9}82%,to{opacity:0;transform:scale(1.25)translate(5px)}}@keyframes sa-arena-avalanche-wave{0%,25%{opacity:0;transform:translate(-50%,-50%)scale(.4)}62%{opacity:.78}to{opacity:0;transform:translate(-50%,-50%)scale(1.3)}}@media (prefers-reduced-motion:reduce){.specter-arena-root .sa-arena-scene *,.specter-arena-root .sa-arena-scene :before,.specter-arena-root .sa-arena-scene :after{transition:none!important;animation:none!important}}";
// ui/src/arena/useArenaStyle.ts
function Tl() {
	o(() => {
		let e = document.createElement("style");
		return e.setAttribute("data-specter-arena-scene", ""), e.textContent = wl, document.head.appendChild(e), () => {
			e.remove();
		};
	}, []);
}
// ui/src/work/work.css?inline
var El = ".specter-arena-root .sa-work-badge{border:1px solid var(--line);border-radius:999px;justify-self:start;align-items:center;gap:6px;padding:2px 10px;font-size:12px;font-weight:600;display:inline-flex}.specter-arena-root .sa-work-badge--open{color:var(--violet);border-color:var(--violet)}.specter-arena-root .sa-work-badge--cancelled{color:var(--muted);border-color:var(--muted);border-style:dotted}.specter-arena-root .sa-work-badge--accepted{color:var(--success);border-color:var(--success)}.specter-arena-root .sa-work-facts{grid-template-columns:max-content minmax(0,1fr);gap:6px 12px;margin:0;display:grid}.specter-arena-root .sa-work-facts dt{color:var(--muted);font-size:13px}.specter-arena-root .sa-work-facts dd{overflow-wrap:anywhere;margin:0}.specter-arena-root .sa-work-text{white-space:pre-wrap}.specter-arena-root .sa-work-plain{gap:4px;display:grid}.specter-arena-root .sa-work-ledger{gap:8px;display:grid}.specter-arena-root .sa-work-xp-amount{font-variant-numeric:tabular-nums;font-weight:700}.specter-arena-root .sa-work-xp-note{color:var(--muted);font-size:12px}.specter-arena-root .sa-xp-meter{gap:4px;display:grid}.specter-arena-root .sa-xp-bar{background:var(--line);border-radius:999px;height:6px;overflow:hidden}.specter-arena-root .sa-xp-bar>span{background:var(--cyan);height:100%;transition:width .42s cubic-bezier(.22,1,.36,1);display:block}.specter-arena-root .sa-work-progression{gap:12px;display:grid}.specter-arena-root .sa-work-progression__head{gap:6px;display:grid}.specter-arena-root .sa-work-ledger__entry{border:1px solid var(--line);border-left:3px solid var(--violet);background:var(--raised);border-radius:8px;gap:2px;padding:8px 10px;display:grid}.specter-arena-root .sa-work-ledger__title{overflow-wrap:anywhere}@media (prefers-reduced-motion:reduce){.specter-arena-root .sa-xp-bar>span{transition:none!important;animation:none!important}}";
// ui/src/work/useWorkStyle.ts
function Dl() {
	o(() => {
		let e = document.createElement("style");
		return e.setAttribute("data-specter-arena-work", ""), e.textContent = El, document.head.appendChild(e), () => {
			e.remove();
		};
	}, []);
}
// ui/src/observatory/ObservatoryPage.tsx
var Ol = [{
	name: "watched",
	label: "Watched"
}, {
	name: "all",
	label: "All bots"
}], kl = [
	{
		name: "arena",
		label: "Arena"
	},
	{
		name: "roster",
		label: "Roster"
	},
	{
		name: "specters",
		label: "Specters"
	},
	{
		name: "data",
		label: "Data"
	}
], Al = [];
function jl(e, t) {
	return e === null ? null : (e.complete ? [...t].some((t) => e.items.some((e) => e.bindingId === t)) : t.size > 0) ? "watched" : "all";
}
var Ml = (e) => e instanceof HTMLElement && (e.isContentEditable || [
	"INPUT",
	"SELECT",
	"TEXTAREA"
].includes(e.tagName));
function Nl() {
	Mr(), so(), Dl(), Tl(), is();
	let { state: e, refresh: t } = Er(), n = ir(), r = ao(), o = dr(), p = e.data, { watched: m, toggle: h, clear: g, persistFailed: _, full: v } = Br(s(() => p === null ? null : {
		ids: new Set(p.items.map((e) => e.bindingId)),
		complete: p.complete
	}, [p])), y = $a({
		ready: p?.complete === !0 && n.status === "ready",
		bots: p?.items ?? Al,
		unassigned: n.unassigned
	}), b = s(() => new Set(y.pending), [y.pending]), [x, C] = l(null), [w, T] = l(""), [E, D] = l(null), [k, A] = l(!1), j = c(null), M = x ?? jl(p, m), N = M ?? "all";
	i(() => {
		x === null && M !== null && C(M);
	}, [x, M]);
	let ne = a(), re = `${ne}-panel`, F = (e) => `${ne}-tab-${e}`, [I, ie] = l("arena"), ae = a(), oe = `${ae}-panel`, se = (e) => `${ae}-tab-${e}`, [ce, ue] = l(!1);
	i(() => {
		E !== null && p !== null && p.complete && (p.items.some((e) => e.bindingId === E) || (D(null), ue(!0)));
	}, [p, E]);
	let de = (e) => {
		ue(!1), D(e);
	}, [fe, pe] = l(null), R = (e) => {
		T(""), N === "watched" && !m.has(e) && C("all"), de(e), ie("roster"), pe(e);
	};
	i(() => {
		if (fe === null || I !== "roster") return;
		let e = [...document.querySelectorAll(".sa-roster [data-binding-id]")].find((e) => e.dataset.bindingId === fe);
		e !== void 0 && (e.focus(), pe(null));
	}, [
		fe,
		I,
		p,
		w,
		x
	]), i(() => {
		let e = (e) => {
			e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || Ml(e.target) || I === "roster" && j.current !== null && (e.preventDefault(), j.current.focus());
		};
		return document.addEventListener("keydown", e), () => document.removeEventListener("keydown", e);
	}, [I]);
	let z = p?.items ?? [], me = s(() => N === "watched" ? z.filter((e) => m.has(e.bindingId)) : z, [
		N,
		z,
		m
	]), ge = s(() => me.filter((e) => le(e, w)), [me, w]), _e = z.find((e) => e.bindingId === E), ve = _e === void 0 ? null : P(_e.condition), ye = Ar(_e?.bindingId ?? null), be = ye.state.status === "ready" ? ye.state.items.filter(he).length : null;
	if (e.status === "loading") return /* @__PURE__ */ f("div", {
		className: "specter-arena-root",
		role: "region",
		"aria-label": "Specters of the Abyss",
		children: [/* @__PURE__ */ d("h1", { children: "Specters of the Abyss" }), /* @__PURE__ */ d("p", {
			role: "status",
			children: "Loading bots…"
		})]
	});
	if (e.status === "failed") {
		let n = O[e.failure];
		return /* @__PURE__ */ f("div", {
			className: "specter-arena-root",
			role: "region",
			"aria-label": "Specters of the Abyss",
			children: [/* @__PURE__ */ d("h1", { children: "Specters of the Abyss" }), /* @__PURE__ */ d(we, {
				title: n.title,
				body: n.body,
				onRetry: t
			})]
		});
	}
	let V = e.data, Te = e.failure === null ? null : O[e.failure], Ee = z.length === 0 ? /* @__PURE__ */ d(Ce, {
		title: "No bots are on the roster yet",
		body: "The collector has not seen any Kiro Crew bots. Create or open a bot in Crew, then refresh."
	}) : ge.length === 0 && w.trim() !== "" && me.length > 0 ? /* @__PURE__ */ d(Ce, {
		title: "No bots match",
		body: "No bot name contains that search.",
		action: /* @__PURE__ */ d(H, {
			onClick: () => T(""),
			children: "Clear search"
		})
	}) : me.length === 0 ? /* @__PURE__ */ d(Ce, {
		title: "No bots watched yet",
		body: "Use Watch on a bot to keep it in this list.",
		action: /* @__PURE__ */ d(H, {
			onClick: () => C("all"),
			children: "Show all bots"
		})
	}) : /* @__PURE__ */ d(Cr, {
		items: ge,
		selectedId: E,
		watched: m,
		watchListFull: v,
		specters: n.byBinding,
		unassigned: b,
		onAssign: y.open,
		onSelect: de,
		onToggleWatch: h
	});
	return /* @__PURE__ */ d("div", {
		className: "specter-arena-root",
		role: "region",
		"aria-label": "Specters of the Abyss",
		children: /* @__PURE__ */ f("div", {
			className: "sa-page",
			children: [
				/* @__PURE__ */ f("header", {
					className: "sa-header",
					children: [
						/* @__PURE__ */ f("div", {
							className: "sa-header__top",
							children: [/* @__PURE__ */ d("h1", { children: "Specters of the Abyss" }), /* @__PURE__ */ f("div", {
								className: "sa-header__actions",
								children: [/* @__PURE__ */ f("span", { children: ["Updated ", /* @__PURE__ */ d(B, { ms: V.fetchedAtMs })] }), /* @__PURE__ */ d(H, {
									onClick: t,
									children: "Refresh"
								})]
							})]
						}),
						/* @__PURE__ */ f("p", {
							className: "sa-collector",
							role: "status",
							children: [ee(V.collector.state, V.collector.reasonCode), V.collector.sinceMs !== null && /* @__PURE__ */ f(u, { children: [
								" ",
								"Since ",
								/* @__PURE__ */ d(B, { ms: V.collector.sinceMs }),
								"."
							] })]
						}),
						/* @__PURE__ */ f("ul", {
							className: "sa-notes",
							"aria-label": "Notes",
							children: [
								V.notes.map((e) => /* @__PURE__ */ d("li", { children: S(e.code, e.count) }, e.code)),
								V.truncated && /* @__PURE__ */ d("li", { children: te(z.length) }),
								_ && /* @__PURE__ */ d("li", { children: "Selection won't be remembered in this browser" })
							]
						}),
						Te !== null && /* @__PURE__ */ f("div", {
							className: "sa-banner",
							role: "alert",
							children: [/* @__PURE__ */ f("span", { children: [
								"Showing data from ",
								/* @__PURE__ */ d(B, { ms: V.fetchedAtMs }),
								". ",
								Te.title,
								"."
							] }), /* @__PURE__ */ d(H, {
								onClick: t,
								children: "Retry"
							})]
						}),
						/* @__PURE__ */ d(yr, {
							open: k,
							onToggle: () => A((e) => !e)
						})
					]
				}),
				/* @__PURE__ */ d(sr, {
					label: "Sections",
					tabs: kl,
					value: I,
					panelId: oe,
					tabId: se,
					onChange: ie
				}),
				/* @__PURE__ */ f("div", {
					role: "tabpanel",
					id: oe,
					"aria-labelledby": se(I),
					children: [
						/* @__PURE__ */ f("div", {
							hidden: I !== "roster",
							children: [/* @__PURE__ */ d(br, { items: z }), /* @__PURE__ */ f("div", {
								className: "sa-layout",
								children: [/* @__PURE__ */ f(Se, {
									label: "Roster",
									children: [/* @__PURE__ */ f("div", {
										className: "sa-toolbar",
										children: [
											/* @__PURE__ */ d(sr, {
												label: "Which bots to show",
												tabs: Ol,
												value: N,
												panelId: re,
												tabId: F,
												onChange: C
											}),
											/* @__PURE__ */ f("label", {
												className: "sa-search",
												children: [
													/* @__PURE__ */ d(xe, { name: "search" }),
													/* @__PURE__ */ d("span", {
														className: "sa-visually-hidden",
														children: "Search bots by name"
													}),
													/* @__PURE__ */ d("input", {
														ref: j,
														type: "search",
														value: w,
														placeholder: "Search bots by name",
														onChange: (e) => T(e.target.value),
														onKeyDown: (e) => {
															e.key === "Escape" && w !== "" && T("");
														}
													})
												]
											}),
											N === "watched" && m.size > 0 && /* @__PURE__ */ d(H, {
												variant: "ghost",
												onClick: () => {
													g(), C("all");
												},
												children: "Unwatch all"
											})
										]
									}), /* @__PURE__ */ f("div", {
										role: "tabpanel",
										id: re,
										"aria-labelledby": F(N),
										children: [/* @__PURE__ */ d("p", {
											className: "sa-result-count",
											children: `${ge.length} of ${z.length} bots`
										}), Ee]
									})]
								}), /* @__PURE__ */ d(Se, {
									label: "Bot detail",
									children: _e === void 0 ? ce || E !== null ? /* @__PURE__ */ d("p", {
										role: "status",
										children: "This bot is no longer on the roster."
									}) : /* @__PURE__ */ d("p", { children: "Select a bot to see its condition and why." }) : /* @__PURE__ */ d(vr, {
										item: _e,
										collector: V.collector,
										rosterRevision: V.rosterRevision,
										attempts: ye.state,
										xp: fr(o, _e.bindingId),
										specter: n.byBinding.get(_e.bindingId) ?? null,
										specters: n,
										onAssign: b.has(_e.bindingId) ? () => y.open(_e.bindingId) : void 0,
										onLoadOlder: ye.loadOlder,
										onRetry: ye.refresh
									}, _e.bindingId)
								})]
							})]
						}),
						I === "specters" && /* @__PURE__ */ d(Ka, {
							bots: z,
							specters: n,
							heroes: r,
							pendingCount: y.pending.length,
							onAssign: () => y.open(),
							onShowInRoster: R
						}),
						I === "data" && /* @__PURE__ */ d(ns, {}),
						I === "arena" && /* @__PURE__ */ d(Cl, {
							bots: z,
							complete: V.complete,
							collector: V.collector,
							rosterRevision: V.rosterRevision,
							specters: n.byBinding,
							specterStatus: n.status,
							xp: o.byBinding,
							xpStatus: o.status,
							unassigned: b,
							onAssign: y.open
						})
					]
				}),
				y.queue !== null && /* @__PURE__ */ d(Hr, {
					bots: z,
					queue: y.queue,
					specters: n,
					heroes: r,
					onClose: y.close
				}),
				/* @__PURE__ */ d("p", {
					className: "sa-visually-hidden",
					role: "status",
					"aria-live": "polite",
					children: _e !== void 0 && ve !== null ? `Showing ${L(_e)}: ${ve.label}${be === null ? "" : `, ${be} open ${be === 1 ? "attempt" : "attempts"}`}` : ""
				})
			]
		})
	});
}
// ui/src/mount.tsx
function Pl() {
	return /* @__PURE__ */ d(Nl, {});
}
export { Pl as default };
