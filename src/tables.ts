import { table, text } from "./sql"
import { nullSchema, object, string } from "./schema"
import { serverFunction } from "./typedFunction"

export const tables = {
  items: table({
    id: text,
    title: text,
    createdAt: text,
  }, { indexes: ["createdAt"] }),
}

const itemSchema = object({ id: string, title: string, createdAt: string }, { additionalProperties: false })

/**
 * The only write operations available to browser clients. Add application
 * mutations here; database access remains entirely on the server.
 */
export const serverFunctions = {
  createItem: serverFunction(
    { title: string },
    itemSchema,
    (db, { title }) => {
      const item = { id: crypto.randomUUID(), title, createdAt: new Date().toISOString() }
      db.set("items", item)
      return item
    },
    "Create an item.",
  ),
  deleteItem: serverFunction(
    { id: string },
    nullSchema,
    (db, { id }) => {
      db.delete("items", id)
      return null
    },
    "Delete an item by ID.",
  ),
}

export type AppTables = typeof tables
export type ServerFunctions = typeof serverFunctions
