# Bun HTML + SQLite app template

A minimal full-stack Bun project extracted from ETINDI's infrastructure. It contains no ETINDI-specific views, agents, schemas, authentication, or content.

## Included

- Bun development and production servers
- HTML and TypeScript browser entry point
- Typed SQLite table definitions
- Read-only JSON HTTP server for `list`, `get`, and `where`
- Typed, schema-validated server functions for every database mutation
- Cross-platform compiled release builds
- SQL integration test

## Run

```sh
bun install
bun run dev
```

Open <http://localhost:3030>.

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
4. Define mutations in `serverFunctions` in `src/tables.ts`. Each function's
   parameter and result schemas become the typed `client.funcs.*` API; the
   browser cannot directly write database rows.
5. Add authentication and authorization checks inside server functions before
   exposing private or user-specific data publicly.

The sample `items` table is deliberately generic and starts empty.
