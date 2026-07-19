import Database from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { appName, dataDirectoryEnvironmentVariable } from "../config"
import { createDB } from "../sql"
import { object, validate } from "../schema"
import { functions, tables } from "../tables"

function defaultDataDirectory(): string {
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA ?? homedir(), appName)
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", appName)
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), appName.toLowerCase().replaceAll(" ", "-"))
}

export const dataDirectory = process.env[dataDirectoryEnvironmentVariable] ?? defaultDataDirectory()
mkdirSync(dataDirectory, { recursive: true })

export const databasePath = join(dataDirectory, "app.db")
export const sqlite = new Database(databasePath, { create: true })
sqlite.exec("PRAGMA journal_mode = WAL")
export const db = createDB(tables, sqlite)

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}

export async function databaseServer(path: string[], request: Request): Promise<Response> {
  const [operation, tableName, id] = path

  try {
    if (request.method === "POST" && operation === "function" && tableName) {
      const fn = functions[tableName as keyof typeof functions]
      if (!fn || id) return json({ error: "Not found" }, 404)
      const body = await request.json() as { args?: unknown }
      const args = validate(object(fn.parameters, { additionalProperties: false }), body.args)
      db.assertReferences(fn.parameters, args)
      const result = await fn.runner(db, args as never)
      return json(result)
    }

    if (!tableName || !(tableName in tables)) return json({ error: "Not found" }, 404)
    const table = tableName as keyof typeof tables
    if (tables[table].access === "private") return json({ error: "Not found" }, 404)
    if (request.method === "GET" && operation === "all") return json(db.all(table))
    if (request.method === "GET" && operation === "get" && id) return json(db.get(table, id as never))
    if (request.method === "POST" && operation === "where") {
      const body = await request.json() as { column: string; value: unknown }
      return json(db.where(table, body.column as never, body.value as never))
    }
  } catch (error) {
    console.error(error)
    return json({ error: error instanceof Error ? error.message : String(error) }, 400)
  }

  return json({ error: "Not found" }, 404)
}
