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

    db.assertReferences(functions.requestState.parameters, { user })
    expect(() => db.assertReferences(functions.requestState.parameters, { user: missing })).toThrow()

    const chain = asUUID("10000000-0000-4000-8000-000000000001")
    const child = asUUID("10000000-0000-4000-8000-000000000002")
    const symbols = [1, 2, 3, 4, 5].map(index => asUUID(`20000000-0000-4000-8000-${String(index).padStart(12, "0")}`))
    symbols.forEach((id, index) => db.set("Symbol", { id, mandarin_character: String(index), pinyin: `p${index}`, meaning: `m${index}` }))
    db.set("Chain", { id: chain, prev: null, symbolID: symbols[0]!, pinyin: "p", meaning: "translation" })
    db.set("Chain", { id: child, prev: chain, symbolID: symbols[1]!, pinyin: "p1", meaning: "next translation" })
    db.set("UserState", { id: asUUID("30000000-0000-4000-8000-000000000001"), user, currentChain: chain })
    symbols.forEach((symbol, position) => db.set("UserStateOption", {
      id: asUUID(`40000000-0000-4000-8000-${String(position).padStart(12, "0")}`),
      user,
      symbol,
      outcome: position === 1 ? "correct" : "wrong",
      position,
      nextChain: position === 1 ? child : null,
    }))

    const result = await functions.requestState.runner(db, { user })
    expect(result).toEqual({ chain, options: symbols })

    const answer = await functions.tryOption.runner(db, { user, option: symbols[0]! })
    expect(answer).toEqual({ outcome: "wrong", nextChain: null })
    expect(db.where("Attempt", "user", user)).toHaveLength(1)
    expect(db.where("UserStateOption", "user", user)).toHaveLength(5)
    expect(db.forceGet("UserState", db.all("UserState")[0]!.id).currentChain).toBe(chain)

    const correct = await functions.tryOption.runner(db, { user, option: symbols[1]! })
    expect(correct).toEqual({ outcome: "correct", nextChain: child })
    expect(db.where("UserStateOption", "user", user)).toHaveLength(0)
    expect(db.forceGet("UserState", db.all("UserState")[0]!.id).currentChain).toBe(child)
    sqlite.close()
  })
})
