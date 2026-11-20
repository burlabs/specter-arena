# Spec ids

Central registry of spec-id prefixes. A prefix is reserved here before any requirements file uses it, so parallel planning workers cannot collide. `scripts/check-spec-ids.mjs` reads this table and every `.kiro/specs/**/*.md`. Its unit test runs it against the repository in the `test` job, and `npm run check:schema` runs it in the `fixtures` job.

## Rules

- A requirement is defined once, as the first cell of a table row in a `requirements.md` (`FP02-REQ-01`), and an acceptance criterion is defined once as a bullet `- **FP-02-AC01:** ...` in the same file. Every other mention is a reference and must resolve to a definition.
- A defined id's prefix must be registered below and its number must fall in the registered range.
- A feature session that has several components writing the same spec folder infixes the component: `CI` crew-integration, `WL` work-ledger, `DEL` delivery. The id grammar has no infix for experience or specter-identity, so their requirements use `REQ` (`FP04-REQ`, `FP0607-REQ`). Acceptance criteria keep the id the intake gave them (`FP-02-AC01`).
- Contract ids are `CT-<schema>-v<N>` and name a file in `contracts/schemas/`; `contracts/OWNERS.md` is their registry and `npm run check:schema` is their check.
- Tracker issues cite ids; they never mint them.

## Prefixes

| Prefix | Meaning | Owner | Numbers | Status |
|---|---|---|---|---|
| `FP01-REQ` | FP-01 requirements | delivery | 1-99 | closed |
| `FP01-DEL` | FP-01 delivery requirements | delivery | 1-99 | closed |
| `FP-01-AC` | FP-01 acceptance criteria | delivery | 1-99 | closed |
| `FP-02-AC` | FP-02 acceptance criteria | delivery | 1-99 | open |
| `FP-03-AC` | FP-03 acceptance criteria | delivery | 1-99 | open |
| `FP02-REQ` | FP-02 requirements, one per criterion | delivery | 1-99 | open |
| `FP03-REQ` | FP-03 requirements, one per criterion | delivery | 1-99 | open |
| `FP0203-CI` | FP-02+03 crew-integration requirements | crew-integration | 1-99 | open |
| `FP0203-WL` | FP-02+03 work-ledger requirements | work-ledger | 1-99 | open |
| `FP0203-DEL` | FP-02+03 delivery requirements | delivery | 1-99 | open |
| `FP-04-AC` | FP-04 acceptance criteria | delivery | 1-99 | open |
| `FP04-REQ` | FP-04 requirements: one per criterion, plus experience and cross-cutting rules | delivery | 1-99 | open |
| `FP04-CI` | FP-04 crew-integration requirements | crew-integration | 1-99 | open |
| `FP04-WL` | FP-04 work-ledger requirements | work-ledger | 1-99 | open |
| `FP04-DEL` | FP-04 delivery requirements | delivery | 1-99 | open |
| `FP-06-AC` | FP-06 acceptance criteria | delivery | 1-99 | open |
| `FP-07-AC` | FP-07 acceptance criteria | delivery | 1-99 | open |
| `FP0607-REQ` | FP-06+07 requirements: one per criterion, plus specter-identity and experience rules | delivery | 1-99 | open |
| `FP0607-CI` | FP-06+07 crew-integration requirements | crew-integration | 1-99 | open |
| `FP0607-WL` | FP-06+07 work-ledger requirements | work-ledger | 1-99 | open |
| `FP0607-DEL` | FP-06+07 delivery requirements | delivery | 1-99 | open |
| `FP-08-AC` | FP-08 acceptance criteria | delivery | 1-99 | open |
| `FP-09-AC` | FP-09 acceptance criteria | delivery | 1-99 | open |
| `FP0809-REQ` | FP-08+09 requirements: one per criterion, plus experience and cross-cutting rules | delivery | 1-99 | open |
| `FP0809-CI` | FP-08+09 crew-integration requirements | crew-integration | 1-99 | open |
| `FP0809-WL` | FP-08+09 work-ledger requirements | work-ledger | 1-99 | open |
| `FP0809-DEL` | FP-08+09 delivery requirements | delivery | 1-99 | open |
| `FP-10-AC` | FP-10 acceptance criteria | delivery | 1-99 | open |
| `FP-11-AC` | FP-11 acceptance criteria | delivery | 1-99 | open |
| `FP1011-REQ` | FP-10+11 requirements: one per criterion, plus specter-identity and experience rules | delivery | 1-99 | open |
| `FP1011-CI` | FP-10+11 crew-integration requirements | crew-integration | 1-99 | open |
| `FP1011-DEL` | FP-10+11 delivery requirements | delivery | 1-99 | open |
| `FP-16-AC` | FP-16 acceptance criteria | delivery | 1-99 | open |
| `FP16-REQ` | FP-16 requirements: one per criterion, plus specter-identity and experience rules | delivery | 1-99 | open |
| `FP16-CI` | FP-16 crew-integration requirements | crew-integration | 1-99 | open |
| `FP16-WL` | FP-16 work-ledger requirements | work-ledger | 1-99 | open |
| `FP16-DEL` | FP-16 delivery requirements | delivery | 1-99 | open |
| `FP17-REQ` | FP-17 requirements: Specters collection search, filter, sort and unassigned heroes | delivery | 1-99 | open |
| `FP17-DEL` | FP-17 delivery requirements | delivery | 1-99 | open |
| `FP18-REQ` | FP-18 experience requirements: the arena, the Work tab and the XP page walk on the new reads | experience | 1-99 | open |
| `FP18-CI` | FP-18 crew-integration requirements | crew-integration | 1-99 | open |
| `FP18-WL` | FP-18 work-ledger requirements | work-ledger | 1-99 | open |
| `FP18-DEL` | FP-18 delivery requirements | delivery | 1-99 | open |
