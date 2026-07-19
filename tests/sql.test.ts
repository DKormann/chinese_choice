import { afterEach, describe, expect, test } from "bun:test"
import Database from "bun:sqlite"
import { createDatabase } from "../src/sql"
import { tables } from "../src/tables"

let sqlite: Database | undefined

afterEach(() => sqlite?.close())

describe("SQL database", () => {
  test("sets, reads, queries, and deletes rows", () => {
    sqlite = new Database(":memory:")
    const db = createDatabase(tables, sqlite)
    const item = { id: "one", title: "Example", createdAt: "2026-01-01T00:00:00.000Z" }

    db.set("items", item)
    expect(db.get("items", "one")).toEqual(item)
    expect(db.where("items", "title", "Example")).toEqual([item])
    expect(db.list("items")).toEqual([item])
    db.delete("items", "one")
    expect(db.get("items", "one")).toBeNull()
  })
})
