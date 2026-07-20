# Chinese Choice

Chinese Choice is a deliberately small Bun, TypeScript, SQLite, and browser application. Prefer direct code, explicit data flow, and a few strong primitives over layers, frameworks, compatibility aliases, or speculative abstractions.

## Philosophy

- Keep the smallest implementation that clearly expresses the product behavior.
- Maintain one source of truth. Do not duplicate schemas, relationships, lesson data, or state between client and server.
- Prefer readable functions and plain objects over classes, dependency injection, registries, and generic infrastructure.
- Remove obsolete APIs instead of preserving compatibility aliases.
- Do not add fallbacks that hide broken backend behavior. Surface errors clearly.

## Core architecture

### Schemas and tables

`src/schema.ts` defines runtime schemas and their inferred TypeScript types. The same schema values define SQLite columns, validate stored values, type database rows, and validate server-function arguments.

Tables live in `src/tables.ts` and are declared with `table({...})`.

- Every table receives an implicit `id: UUID`. Never declare `id` manually.
- `UUID` is a branded TypeScript type and is validated at runtime.
- Use `randomUUID()` for new IDs and `asUUID()` at trusted string boundaries.
- Export named table values so other tables can reference them directly.
- Derive reusable row schemas with `object(Table.columns)`; use names such as `SymbolRow`.

Example:

```ts
export const Symbol = table({
  mandarin_character: string,
  pinyin: string,
  meaning: string,
})
```

### Relationships

Use `ref(Table)` for foreign keys. References always target the table's implicit `id`.

- Use `ref(Table, { nullable: true })` for nullable references.
- Use `selfRef()` for self-referential columns.
- Declare deletion behavior explicitly when it matters.
- Add indexes for foreign-key columns used in queries.
- Prefer a join table for many-to-many relationships. An `array(ref(Table))` is only JSON data and is not a native SQLite foreign key.

SQLite foreign-key enforcement is enabled by `createDB`. Referenced tables must be registered in the exported `tables` object.

### Public and private data

Tables are public by default. Mark server-only tables with:

```ts
table(columns, { access: "private" })
```

Private tables remain available to server functions but are omitted from the typed browser client and rejected by the generic HTTP table endpoints. User records and user-specific state should normally be private.

### Database API

Use `createDB`, not compatibility aliases. The primary operations are:

- `all`, `get`, `forceGet`, and `where` for reads;
- `set`, `insert`, and `delete` for writes;
- `transaction` for atomic work.

Browser code must not mutate tables directly. Application mutations and state transitions belong in server functions.

### Server functions

Define server functions in the exported `functions` object in `src/tables.ts` with `serverFunction(parameters, runner, description?)`.

- Parameter schemas provide runtime validation and client argument types.
- A parameter declared as `ref(User)` is validated as a UUID and checked for existence before the runner executes.
- Return types are inferred from the runner. Do not provide a duplicate result schema.
- Keep runners small. Extract shared logic only when it improves clarity.
- Infer client contracts directly from the implemented server-function map; do not maintain a duplicate `FUNCS` interface.

The backend is authoritative for lesson state and choices. The frontend must use returned IDs to fetch real rows; it must not invent lesson data or silently fall back to local fixtures. Continuation endpoints guarantee exactly five existing `Symbol` choices.

### Learning model

- `Symbol` stores one Chinese character with fixed global pinyin and meaning.
- `Chain` rows are the complete global cache and tree through `prev`; do not duplicate edges or sentence membership in another table. Every direct child is valid because chain edges are created only from generated full sentences. Never traverse descendants to prove validity.
- User lesson state is only the current chain. It does not retain or follow a source sentence.
- Full-sentence generation returns the sentence, full pinyin, and translation. Insert its path and annotate its complete leaf immediately. Annotate intermediate visible prefixes independently without revealing later characters.
- Annotate each missing character in its own context-free call and each chain prefix in its own call. Run independent calls concurrently, but never batch annotations that could influence each other.
- Before returning a challenge, ensure all five option characters and both correct child chains are annotated. A correct click commits and returns the child chain immediately; the browser renders it before separately requesting the next five options.
- At each step, aim for two valid sentence continuations, but do not require two distinct next characters. Generate only the missing number of fresh sentences once. If valid sentences collapse onto one child character, show one correct button and four random buttons; never retry to force linguistic diversity.
- Represent sentence completion structurally with a direct `。` child. Do not store a separate completion field. `。` may appear as a choice; after it is selected, show the completed sentence and start a fresh lesson when options are requested.
- LLMs make linguistic content decisions. Do not include learner mistakes or pedagogy in generation prompts yet. OpenRouter calls must remain server-only.
- Use the cheap default model for generation. Retry with the validator model only when output fails JSON/schema or lesson invariants; do not routinely pay for two calls.
- Log LLM requests, raw responses, timings, validation failures, and retry attempts on the server. Never log API keys or authorization headers.
- Generated chain nodes are globally reusable. A learner's current five options are private and persist until the learner chooses a correct option.
- Every option outcome is exactly `correct`, `possible`, or `wrong`. The two deliberately generated sentence continuations are `correct` and advance. Random characters are rated only as `possible` or `wrong`; possible choices receive gentle feedback but never advance or affect knowledge.
- A wrong attempt is recorded, affects character review state, and does not advance or replace the current options. The learner retries until correct.
- Record every click as an immutable `Attempt`. Derive mistake counts from attempts when scheduling needs them; do not maintain a duplicate summary table.
- The `#tree` browser route is a read-only explorer for the global chain tree. Keep it usable without exposing private learner state.

### Frontend

The browser entry point is `src/web/main.ts`. Build the interface with the helpers in `src/web/html.ts` and inline `style(...)` values.

- Do not put application CSS in `src/index.html`.
- Extend and reuse semantic colors from `html.ts` rather than hard-coding the core palette.
- Preserve the existing light/dark behavior based on `prefers-color-scheme`.
- Use small render functions and direct event handlers. A full component framework is unnecessary.
- Keep account selection local, but fetch lesson content and transitions from the backend.
- Make failures visible; do not replace failed backend data with dummy client data.

## Verification

- Run `bun test` after database, schema, relationship, or server-function changes.
- Add focused tests for invariants, especially UUID validation, foreign keys, private access, reference arguments, and the five-choice guarantee.
- Run TypeScript checking when practical. Distinguish new errors from the repository's known Bun declaration issues.
- Visually check frontend changes in both light and dark modes and exercise the account-to-lesson flow.

## Style

- Use concise names that reflect the domain.
- Prefer early errors over silent coercion.
- Avoid comments that merely restate code; document invariants and non-obvious decisions.
- Avoid broad formatting or unrelated cleanup in feature changes.
- When two designs are equally capable, choose the one with fewer concepts.
