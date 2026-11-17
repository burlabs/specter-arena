# Contract owners

One row per schema file in `contracts/schemas/`. The owner is the component that writes the shape on the wire or into the store and is accountable for changing it; `delivery` owns the tooling in `scripts/check-schema.mjs`, the layout, and `VERSIONING.md`, not the shapes. `npm run check:schema` fails when a schema has no row or a row has no schema.

Status `DRAFT` means the shape may still change in place. `FROZEN` means it changes only by adding a new `v<N+1>` file (see `VERSIONING.md`); the PR that adds the new version also updates its cases and this table.

| Schema | Version | Owner | Status | Emitted by / consumed by |
|---|---|---|---|---|
| `api-error` | 1 | crew-integration | FROZEN | Error bodies of app routes; UI and tests |
| `page` | 1 | work-ledger | FROZEN | Keyset-paged lists from the store; UI |
| `ready` | 1 | crew-integration | FROZEN | `GET /api/ready`; UI and the readiness check |
| `bot-binding` | 1 | work-ledger | DRAFT | Binding records from the store (`bot_binding_to_wire`); no route emits it yet; FP-05 references `definitions.bindingId` |
| `quarantine-record` | 1 | work-ledger | DRAFT | Redacted summary of a frame the collector would not trust (`quarantine_record_to_wire`); no route emits it yet |
| `observation` | 1 | crew-integration | DRAFT | Built by the collector (`wire.to_wire`), persisted by the store; no wire reader outside tests yet |
| `roster-item` | 1 | crew-integration | DRAFT | One bot in `GET /api/roster` (route merged); FP-04 UI is the first consumer |
| `roster` | 1 | crew-integration | DRAFT | `GET /api/roster` (route merged); FP-04 UI is the first consumer |

## Rules for schema authors

- Owners are component names from `docs/architecture/component-index.md`: `crew-integration`, `work-ledger`, `specter-identity`, `experience`, `delivery`.
- A schema owned by `specter-identity` may not carry a closed list (`enum` with more than one value) without a reviewed entry in `guard-exemptions.json`. A freeform descriptor is prose, not a category (FP-02-AC06).
- A schema that composes another owner's shape does so with `$ref` to its `$id` as a property value. It never copies the other owner's fields.
- Add the row, the schema, and its cases in the same PR.
