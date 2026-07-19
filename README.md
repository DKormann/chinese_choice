# Bun HTML + SQLite app template

A minimal full-stack Bun project extracted from ETINDI's infrastructure. It contains no ETINDI-specific views, agents, schemas, authentication, or content.

## Included

- Bun development and production servers
- HTML and TypeScript browser entry point
- Typed SQLite table definitions
- Read-only JSON HTTP server for `all`, `get`, and `where`
- Schema-validated SQLite rows and foreign-key relationships
- Cross-platform compiled release builds
- SQL integration test

## Run

```sh
bun install
bun run dev
```

Open <http://localhost:3030>.

Create a `.env` file before requesting generated lesson content:

```sh
OPENROUTER_API_KEY=your_key_here
# Optional defaults: cheap generation, stronger retry for invalid output
OPENROUTER_MODEL=qwen/qwen3.5-flash-02-23
OPENROUTER_VALIDATOR_MODEL=z-ai/glm-5
```

The key is read only by the Bun server and is never sent to the browser.
GLM is called only when the default model returns malformed or semantically invalid lesson content.

Use “Explore sentence tree” on the learner screen, or open `/#tree`, to inspect global chain branches and annotation status.

The SQLite database defaults to the platform application-data directory. Set `APP_DATA_DIR` to choose another location, and `PORT` to override port `3030`.

## Commands

```sh
bun run dev       # watch mode
bun run start     # production mode
bun run test      # tests
bun run typecheck # TypeScript checking
bun run build     # standalone executables in build/release
```

## Customize

1. Rename the project in `package.json` and `src/config.ts`.
2. Define application tables in `src/tables.ts`.
3. Build the interface in `src/web/main.ts` and `src/index.html`.
4. Declare indexes and foreign-key relationships in each table's options.
