# Contract versioning

Scope: every object that crosses the wire between the UI and the backend, and every object persisted in the store as JSON. It does not govern Kiro Crew's own frames; those are external, are tolerated or quarantined on arrival, and are mapped into a contract by the adapter.

## Rules

1. **Version marker.** Every contract object carries an integer `contractVersion` (the major version only). It is distinct from the store's schema version (`PRAGMA user_version`, reported as `storeVersion`), which describes SQLite tables, not wire shapes.
2. **Files and ids.** `contracts/schemas/<name>.v<N>.schema.json`, with `$id` `urn:specter-arena:contract:<name>:v<N>`. Draft-07 (`$schema` `http://json-schema.org/draft-07/schema#`). `contractVersion` is declared `{"type": "integer", "const": <N>}` and required.
3. **Within a major version** a change may only add an optional property. A writer emits a closed shape (`additionalProperties: false`); a reader of persisted data written by an older minor change accepts it.
4. **A breaking change** (a removed or renamed property, a changed type, a new required property, a narrowed pattern or enum) is a new file `<name>.v<N+1>.schema.json` with a new `$id`. The old file stays until the oldest store version that can hold it has been migrated.
5. **Persisted data** older than the reader goes through an explicit upcaster, one function per `N -> N+1`, tested with a case from the old version. **Newer-than-known** majors fail closed: the object is quarantined or reported, never guessed at.
6. **`FROZEN` contracts** (see `OWNERS.md`) change only by rule 4. A `DRAFT` contract may change in place until its first consumer merges.
7. **Cases.** Each schema has `contracts/cases/<name>/v<N>/cases.json` and the files it lists under `valid/` and `invalid/`. A change to a schema updates its cases in the same PR. Both the Vitest runner (`ui/src/contracts/contracts.test.ts`) and the pytest runner (`backend/tests/test_contracts.py`) read the same files and compare validity and, for invalid cases that list one, the JSON Pointer of the first error.

## Writing schemas that behave the same in both validators

- No `format` keyword. Use `pattern`. Timestamps are ISO-8601 UTC strings: `^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z$`.
- Ids are strings, never numbers (JavaScript loses integers above 2^53).
- A numeric or boolean `const` or `enum` also declares `type`; Python treats `true == 1`.
- Property names are camelCase letters and digits, so JSON Pointers read the same in both languages.
- Patterns use the common subset of JavaScript and Python regular expressions: anchors, character classes, bounded quantifiers. Add a case with a trailing newline.
- Compose with `$ref` to a closed sub-schema as a property value, never `allOf` with `additionalProperties: false`.
- A float with an integer value (`1.0`) is an integer in both validators; writers still emit plain integers. `NaN` and `Infinity` are not JSON: add an unparseable invalid case where a number is expected.
- Example payloads use obviously fake values. Describe credential formats in prose; the secret scanner reads this tree.
