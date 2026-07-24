import { describe, expect, test } from "bun:test"
import Database from "bun:sqlite"
import { migrateDatabase } from "../src/backend/migrate"
import { asUUID, createDB } from "../src/sql"
import { tables } from "../src/tables"

const encoded = (value: string) => JSON.stringify(value)
const id = (suffix: string) => asUUID(`00000000-0000-4000-8000-${suffix.padStart(12, "0")}`)

describe("tree migration", () => {
  test("merges duplicate symbols and equivalent chain paths", () => {
    const sqlite = new Database(":memory:")
    sqlite.exec(`
      CREATE TABLE Symbol (id TEXT PRIMARY KEY, mandarin_character TEXT, pinyin TEXT, meaning TEXT);
      CREATE TABLE Chain (id TEXT PRIMARY KEY, prev TEXT, symbolID TEXT, pinyin TEXT, meaning TEXT);
      CREATE TABLE UserState (id TEXT PRIMARY KEY, user TEXT, currentChain TEXT);
      CREATE TABLE UserStateOption (
        id TEXT PRIMARY KEY, user TEXT, symbol TEXT, outcome TEXT, position REAL, nextChain TEXT
      );
    `)

    const symbolOne = id("1")
    const symbolTwo = id("2")
    const happy = id("3")
    const rootOne = id("11")
    const rootTwo = id("12")
    const childOne = id("13")
    const childTwo = id("14")
    sqlite.query("INSERT INTO Symbol VALUES (?, ?, ?, ?)").run(encoded(symbolOne), encoded("我"), encoded("wǒ"), encoded("I"))
    sqlite.query("INSERT INTO Symbol VALUES (?, ?, ?, ?)").run(encoded(symbolTwo), encoded("我"), encoded(""), encoded(""))
    sqlite.query("INSERT INTO Symbol VALUES (?, ?, ?, ?)").run(encoded(happy), encoded("喜"), encoded("xǐ"), encoded("like"))
    sqlite.query("INSERT INTO Chain VALUES (?, NULL, ?, ?, ?)").run(encoded(rootOne), encoded(symbolOne), encoded("wǒ"), encoded("I"))
    sqlite.query("INSERT INTO Chain VALUES (?, NULL, ?, ?, ?)").run(encoded(rootTwo), encoded(symbolTwo), encoded(""), encoded(""))
    sqlite.query("INSERT INTO Chain VALUES (?, ?, ?, ?, ?)").run(encoded(childOne), encoded(rootOne), encoded(happy), encoded(""), encoded(""))
    sqlite.query("INSERT INTO Chain VALUES (?, ?, ?, ?, ?)").run(encoded(childTwo), encoded(rootTwo), encoded(happy), encoded("wǒ xǐ"), encoded("I like"))
    sqlite.query("INSERT INTO UserState VALUES (?, ?, ?)").run(encoded(id("21")), encoded(id("22")), encoded(childTwo))
    sqlite.query("INSERT INTO UserStateOption VALUES (?, ?, ?, ?, ?, ?)").run(
      encoded(id("23")), encoded(id("22")), encoded(happy), encoded("correct"), 0, encoded(childTwo),
    )

    migrateDatabase(sqlite)
    const db = createDB(tables, sqlite)

    expect(db.all("Symbol")).toHaveLength(2)
    expect(db.all("Chain")).toHaveLength(2)
    const root = db.where("Chain", "prev", null)[0]!
    const child = db.where("Chain", "prev", root.id)[0]!
    expect(child.pinyin).toBe("wǒ xǐ")
    expect(sqlite.query("SELECT currentChain FROM UserState").get()).toEqual({ currentChain: encoded(child.id) })
    expect(db.all("UserStateOption")).toEqual([])
    expect(() => db.insert("Symbol", { id: id("31"), mandarin_character: "我", pinyin: "", meaning: "" })).toThrow()
    expect(() => db.insert("Chain", { id: id("32"), prev: root.id, symbolID: child.symbolID, pinyin: "", meaning: "" })).toThrow()
    sqlite.close()
  })
})
