import { describe, expect, test } from "bun:test"
import Database from "bun:sqlite"
import { createDB } from "../src/sql"
import { functions, tables } from "../src/tables"

describe("server functions", () => {
  test("addSymbol validates, stores, and returns a symbol", async () => {
    const sqlite = new Database(":memory:")
    const db = createDB(tables, sqlite)

    const symbol = await functions.addSymbol.runner(db, {
      mandarin_character: "你",
      pinyin: "nǐ",
      meaning: "you",
    })

    expect(db.get("Symbol", symbol.id)).toEqual(symbol)
    sqlite.close()
  })
})
