import { afterEach, describe, expect, test } from "bun:test"
import Database from "bun:sqlite"
import { asUUID, createDB, ref, table } from "../src/sql"
import { tables } from "../src/tables"

let sqlite: Database | undefined

afterEach(() => sqlite?.close())

describe("SQL database", () => {
  const id = (suffix: string) => asUUID(`00000000-0000-4000-8000-${suffix.padStart(12, "0")}`)

  test("defaults tables to public and supports private tables", () => {
    expect(tables.Symbol.access).toBe("public")
    expect(tables.User.access).toBe("private")
  })

  test("sets, reads, queries, and deletes rows", () => {
    sqlite = new Database(":memory:")
    const db = createDB(tables, sqlite)
    const symbol = { id: id("1"), mandarin_character: "你", pinyin: "nǐ", meaning: "you" }

    db.set("Symbol", symbol)
    expect(db.get("Symbol", symbol.id)).toEqual(symbol)
    expect(db.where("Symbol", "pinyin", "nǐ")).toEqual([symbol])
    expect(db.all("Symbol")).toEqual([symbol])
    db.delete("Symbol", symbol.id)
    expect(db.get("Symbol", symbol.id)).toBeNull()
    expect(() => asUUID("not-a-uuid")).toThrow()
  })

  test("enforces foreign-key relationships", () => {
    sqlite = new Database(":memory:")
    const parent = table({})
    const child = table(
      { parentId: ref(parent, { onDelete: "cascade" }) },
    )
    const db = createDB({ parent, child }, sqlite)

    const parentId = id("10")
    db.set("parent", { id: parentId })
    db.set("child", { id: id("11"), parentId })
    expect(() => db.set("child", { id: id("12"), parentId: id("99") })).toThrow()
    db.delete("parent", parentId)
    expect(db.all("child")).toEqual([])
  })

  test("supports nullable self-references", () => {
    sqlite = new Database(":memory:")
    const db = createDB(tables, sqlite)
    const symbolId = id("20")
    const firstId = id("21")
    const secondId = id("22")
    db.set("Symbol", { id: symbolId, mandarin_character: "你", pinyin: "nǐ", meaning: "you" })
    db.set("Chain", { id: firstId, prev: null, symbolID: symbolId, pinyin: "nǐ", meaning: "you", completion: "complete" })
    db.set("Chain", { id: secondId, prev: firstId, symbolID: symbolId, pinyin: "hǎo", meaning: "good", completion: "complete" })

    db.set("Symbol", { id: symbolId, mandarin_character: "你", pinyin: "nǐ", meaning: "you (updated)" })
    expect(db.forceGet("Symbol", symbolId).meaning).toBe("you (updated)")
    expect(db.forceGet("Chain", firstId).symbolID).toBe(symbolId)

    db.delete("Chain", firstId)
    expect(db.get("Chain", secondId)?.prev).toBeNull()
    db.delete("Symbol", symbolId)
    expect(db.all("Chain")).toEqual([])
  })
})
