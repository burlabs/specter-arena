# Crew handoff routes for the arena inspector (FP-10+11)

Host: Kiro Crew 0.12.2, dashboard build `1.0.0-b659923`. Checked 2026-11-18 by a static read of the installed dashboard bundle. Nothing was clicked on a live host: agents cannot drive the dashboard (`docs/compatibility/host-facts.json`, fact `host-agent-owner-steps-refused`). Machine-readable twin: `handoff-routes.json`. The inspector's `CREW_HANDOFFS` list (`ui/src/arena/handoff.ts`) may only contain ids that this record marks `allowed`; `ui/src/arena/handoff.test.ts` enforces it.

Evidence paths below are inside the installed app at `/Applications/KiroCrew.app/Contents/Resources/backend-dist/kirocrew-backend-arm64/lib/python3.12/site-packages/kiro_crew/static/dist/`. The bundle is minified onto one line, so evidence is a byte offset into `assets/App-B9URHfh3.js` (2,209,394 bytes), found by searching for the quoted string.

## What ships

One handoff: **Open Bots in Crew** (`open-bots`, route `/members`). The app calls it through `useHostNavigate` (`ui/src/host/useHostNavigate.ts`). That hook imports the SDK as a namespace, so a host without `useNavigate` cannot break app load; it uses the host router when present and `window.location.assign` otherwise, and it accepts only the literal `'/members'`.

The route is generic. It cannot open a particular bot's chat or a pending approval, and the inspector says so: "Opens the Bots page in Crew. It cannot open this bot's chat or approvals directly." "Copy diagnostic summary" is always offered beside it.

## Route table

| Handoff | State | Evidence |
|---|---|---|
| `open-bots`: route `/members` (the Bots page) | allowed (static read) | `App-B9URHfh3.js` offset 2205779, `path:` `/members`; page chunk `assets/MembersPage-BUaw6kpn.js` |
| `open-sessions`: route `/sessions` (session list) | allowed (static read), not offered | `App-B9URHfh3.js` offset 2205405; it adds nothing the Bots page does not |
| Route `/tasks` | exists, not a bot or approval view, not used | `App-B9URHfh3.js` offset 2206428 |
| `open-bot-chat`: route `/chat/:slug?`, which the host itself opens as `/chat?sid=<slotKey>` | unsupported for this app: it holds no slot key | `navIntent-BWkdnS-0.js` (`/chat?sid=`); `App-B9URHfh3.js` offset 1003284 builds `/chat?sid=${encodeURIComponent(slotKey)}`; `contracts/schemas/roster-item.v1.schema.json` says a binding id is never a Crew id or slot key; `docs/compatibility/crew-0.12.2.md` line 30 shows the slot key carries an inserted id and cannot be derived from a name |
| `open-bot-by-name`: `/members?member=<name>` | denied by design | the Members page reads a `member` query parameter (`MembersPage-BUaw6kpn.js`) and the host links by display name; joining by name is forbidden by `docs/compatibility/monitoring-scope.md` D-P10 rule 2 |
| `open-approval` | unsupported | no approvals route in the router table; `pending_approval` appears in the bundle only as in-chat state; matrix cell `user-signal-approval` is UNTESTED; nothing may say "waiting on you" |
| `open-session` (one session) | unsupported | the sessions route takes no session id, and the app holds no Crew session id (attempt ids are opaque hashes) |

Router table, from `App-B9URHfh3.js` offsets 2205160 to 2206428: `/agents`, `/apps`, `/apps/-/updates`, `/apps/:name`, `/apps/detail/:name`, `/apps/library`, `/apps/migrate/:name`, `/artifacts`, `/artifacts/:slug`, `/artifacts/deploy`, `/artifacts/remote/:provider/:externalId`, `/capabilities`, `/chat/:slug?`, `/connections`, `/crew-board`, `/deploy`, `/developer`, `/developer/layout-editor`, `/embed/chat/:slug?`, `/embed/sessions`, `/embed/settings`, `/hooks`, `/instances`, `/knowledge`, `/logs`, `/mc-agents`, `/members`, `/notifications`, `/orchestrated/:slug?`, `/overview`, `/popout/artifact/:slug`, `/popout/chat/:slug?`, `/popout/terminal`, `/schedule`, `/session-dashboards`, `/sessions`, `/settings/*`, `/tasks`, `/webhooks`. There is no `/members/:slug`, no approvals route and no session-detail route.

## Navigation mechanisms

| Mechanism | State | Evidence |
|---|---|---|
| Host SDK `useNavigate` | allowed (static read), live click untested | the SDK exports `useNavigate`; `App-B9URHfh3.js` offset 1003058 (`function LG(){return $U().navigate}`); the host passes the router's navigate to the app, so it is an in-page navigation with no path allowlist in the SDK, which is why the app keeps its own literal allowlist |
| Plain `<a href="/members">` | allowed (static read), live click untested | the app is a lazy-imported component in the host document, not an iframe; the gateway answers any non-`/api`, non-`/v1` GET with the SPA shell (`dashboard/token_auth_paths.py` lines 225 to 240); a plain link is a full page load, so the inspector uses it only for modified clicks (new tab) and the SDK function otherwise |
| `useChatLauncher().openChat({ slotKey })` | allowed in the SDK, unusable here | needs a slot key the app does not hold |

## Owner check OA-4 (optional, blocks nothing)

On the installed Crew 0.12.2 app, open the Arena tab, select any enemy or Specter, and click "Open Bots in Crew". Report whether the Bots page opens. Optionally confirm that the arena map (a 2.8 MB response) loads through the real proxy. Record the answer here as one line, `live-clicked` or `live-failed`, with the date and Crew version.

Result: not run. Tracked as issue #124.
