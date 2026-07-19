import Database from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { appName, dataDirectoryEnvironmentVariable } from "../config"
import { createDatabase } from "../sql"
import { object, validate } from "../schema"
import { serverFunctions, tables } from "../tables"

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
export const db = createDatabase(tables, sqlite)

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}

export async function databaseServer(path: string[], request: Request): Promise<Response> {
  const [operation, tableName, id] = path

  try {
    if (request.method === "POST" && operation === "function" && tableName) {
      const fn = serverFunctions[tableName as keyof typeof serverFunctions]
      if (!fn || id) return json({ error: "Not found" }, 404)
      const body = await request.json() as { args?: unknown }
      const args = validate(object(fn.parameters, { additionalProperties: false }), body.args)
      const result = await fn.runner(db, args as never)
      return json(validate(fn.result, result))
    }

    if (!tableName || !(tableName in tables)) return json({ error: "Not found" }, 404)
    const table = tableName as keyof typeof tables
    if (request.method === "GET" && operation === "list") return json(db.list(table))
    if (request.method === "GET" && operation === "get" && id) return json(db.get(table, id))
    if (request.method === "POST" && operation === "where") {
      const body = await request.json() as { column: string; value: unknown }
      return json(db.where(table, body.column as never, body.value))
    }
  } catch (error) {
    console.error(error)
    return json({ error: error instanceof Error ? error.message : String(error) }, 400)
  }

  return json({ error: "Not found" }, 404)
}
