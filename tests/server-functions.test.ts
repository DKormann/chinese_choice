import { describe, expect, test } from "bun:test"
import Database from "bun:sqlite"
import { asUUID, createDB } from "../src/sql"
import { functions, tables } from "../src/tables"

describe("server functions", () => {
  test("function references require an existing row", async () => {
    const sqlite = new Database(":memory:")
    const db = createDB(tables, sqlite)

    const user = asUUID("00000000-0000-4000-8000-000000000001")
    const missing = asUUID("00000000-0000-4000-8000-000000000002")
    db.set("User", { id: user, username: "test-user" })

    db.assertReferences(functions.requestNewChain.parameters, { user })
    expect(() => db.assertReferences(functions.requestNewChain.parameters, { user: missing })).toThrow()

    const result = await functions.requestNewChain.runner(db, { user })
    expect(result.options).toHaveLength(3)
    sqlite.close()
  })
})
