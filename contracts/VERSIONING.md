# Contract versioning

Scope: every object that crosses the wire between the UI and the backend, and every object persisted in the store as JSON. It does not govern Kiro Crew's own frames; those are external, are tolerated or quarantined on arrival, and are mapped into a contract by the adapter.

## Rules

1. **Version marker.** Every contract object carries an integer `contractVersion` (the major version only). It is distinct from the store's schema version (`PRAGMA user_version`, reported as `storeVersion`), which describes SQLite tables, not wire shapes.
2. **Files and ids.** `contracts/schemas/<name>.v<N>.schema.json`, with `$id` `urn:specter-arena:contract:<name>:v<N>`. Draft-07 (`$schema` `http://json-schema.org/draft-07/schema#`). `contractVersion` is declared `{"type": "integer", "const": <N>}` and required.
3. **Within a major version** a change may only add an optional property. A writer emits a closed shape (`additionalProperties: false`); a reader of persisted data written by an older minor change accepts it.
   Adding a member to an `enum`, or a new variant branch to a discriminated shape, is also within a major when the writer and every reader ship in the same build (this app does). A schema that readers must fail closed on (`observation`) records such a change in its `description` and gains a case for the new member.
4. **A breaking change** (a removed or renamed property, a changed type, a new required property, a narrowed pattern or enum) is a new file `<name>.v<N+1>.schema.json` with a new `$id`. The old file stays until the oldest store version that can hold it has been migrated.
5. **Persisted data** older than the reader goes through an explicit upcaster, one function per `N -> N+1`, tested with a case from the old version. **Newer-than-known** majors fail closed: the object is quarantined or reported, never guessed at.
6. **`FROZEN` contracts** (see `OWNERS.md`) change only by rule 4. A `DRAFT` contract may change in place until its first consumer merges.
7. **Cases.** Each schema has `contracts/cases/<name>/v<N>/cases.json` and the files it lists under `valid/` and `invalid/`. A change to a schema updates its cases in the same PR. Both the Vitest runner (`ui/src/contracts/contracts.test.ts`) and the pytest runner (`backend/tests/test_contracts.py`) read the same files and compare validity and, for invalid cases that list one, the JSON Pointer of the first error.
8. **`RETIRED` contracts** (see `OWNERS.md`) are no longer emitted or read by any route or store path. Their schema files, cases and guard exemptions stay as a record of the shape, so a captured body of that version can still be validated. They need no producer test (`backend/tests/test_contract_producers.py` skips them) and no TypeScript type. A retired contract is never revived; a new shape is a new major.

## Writing schemas that behave the same in both validators

- No `format` keyword. Use `pattern`.
- Times are integer epoch milliseconds, `0..9007199254740991`, when the store keeps them as integers (the Pass 2 contracts do). A contract that carries a time as text uses the ISO-8601 UTC pattern `^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z$`.
- Ids are strings, never numbers (JavaScript loses integers above 2^53).
- A numeric or boolean `const` or `enum` also declares `type`; Python treats `true == 1`.
- Property names are camelCase letters and digits, so JSON Pointers read the same in both languages.
- Patterns use the common subset of JavaScript and Python regular expressions: anchors, character classes, bounded quantifiers. Add a case with a trailing newline.
- Compose with `$ref` to a closed sub-schema as a property value, never `allOf` with `additionalProperties: false`.
- A schema that another schema `$ref`s as a whole must not use local `#/definitions/...` refs: inline the shared bodies instead. fastjsonschema 2.22.3 resolves a referenced schema's local refs against the referring schema and fails to compile (`Unresolvable ref: definitions`); Ajv does not. Publishing a `definitions` entry for other schemas to reference by fragment (`urn:...:bot-binding:v1#/definitions/bindingId`) is fine in both.
- A shape that varies by a discriminator is written as closed definitions selected by an `if/then/else` chain. Test the discriminator by `$ref`-ing the property to a closed definition that fixes it with `const` (`{"if": {"properties": {"sourceRef": {"$ref": "#/definitions/sourceRefChatDone"}}}}`); nested `properties` inside an `if` are rejected by the open-object guard. End the chain with a final `else` that applies the last variant, so an unknown discriminator fails at that property. Do not give `instancePath` to cases whose first error can come from the chain: the two validators order those errors differently.
- Every schema has an invalid case whose body has `contractVersion` set to the next major (rule 5); `npm run check:schema` fails without one.
- A float with an integer value (`1.0`) is an integer in both validators; writers still emit plain integers. `NaN` and `Infinity` are not JSON: add an unparseable invalid case where a number is expected.
- Example payloads use obviously fake values. Describe credential formats in prose; the secret scanner reads this tree.
