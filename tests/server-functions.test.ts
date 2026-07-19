import { describe, expect, test } from "bun:test"
import Database from "bun:sqlite"
import { createDatabase } from "../src/sql"
import { serverFunctions, tables } from "../src/tables"

describe("server functions", () => {
  test("are the only mutation layer for items", async () => {
    const sqlite = new Database(":memory:")
    const db = createDatabase(tables, sqlite)

    const item = await serverFunctions.createItem.runner(db, { title: "Server-created" })
    expect(db.get("items", item.id)).toEqual(item)

    await serverFunctions.deleteItem.runner(db, { id: item.id })
    expect(db.get("items", item.id)).toBeNull()
    sqlite.close()
  })
})
