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

    const chain = asUUID("10000000-0000-4000-8000-000000000001")
    const symbols = [1, 2, 3, 4, 5].map(index => asUUID(`20000000-0000-4000-8000-${String(index).padStart(12, "0")}`))
    symbols.forEach((id, index) => db.set("Symbol", { id, mandarin_character: String(index), pinyin: `p${index}`, meaning: `m${index}` }))
    db.set("Chain", { id: chain, prev: null, symbolID: symbols[0]!, pinyin: "p", meaning: "translation", completion: "complete" })
    db.set("UserState", { id: asUUID("30000000-0000-4000-8000-000000000001"), user, currentChain: chain, currentSentence: chain })
    symbols.forEach((symbol, position) => db.set("UserStateOption", {
      id: asUUID(`40000000-0000-4000-8000-${String(position).padStart(12, "0")}`),
      user,
      symbol,
      outcome: "wrong",
      position,
      nextChain: null,
      sentenceLeaf: null,
    }))

    const result = await functions.requestState.runner(db, { user })
    expect(result).toEqual({ chain, options: symbols })

    const answer = await functions.tryOption.runner(db, { user, option: symbols[0]! })
    expect(answer).toEqual({ correct: false, outcome: "wrong" })
    expect(db.where("Attempt", "user", user)).toHaveLength(1)
    expect(db.where("UserStateOption", "user", user)).toHaveLength(5)
    expect(db.forceGet("UserState", db.all("UserState")[0]!.id).currentChain).toBe(chain)
    sqlite.close()
  })
})
