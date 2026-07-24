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
      chain,
      symbol,
      outcome: position === 1 ? "correct" : "wrong",
      position,
      nextChain: position === 1 ? child : null,
    }))

    db.assertReferences(functions.askSentence.parameters, { user, chain, question: "What does this mean?" })
    expect(() => db.assertReferences(functions.askSentence.parameters, { user, chain: missing, question: "What does this mean?" })).toThrow()
    await expect(functions.askSentence.runner(db, { user, chain: child, question: "What does this mean?" }))
      .rejects.toThrow("This is no longer the current sentence")
    await expect(functions.askSentence.runner(db, { user, chain, question: "   " }))
      .rejects.toThrow("Ask a question about the current sentence")
    db.assertReferences(functions.speakSentence.parameters, { user, chain })
    await expect(functions.speakSentence.runner(db, { user, chain: child }))
      .rejects.toThrow("This is no longer the current sentence")

    const originalFetch = globalThis.fetch
    const originalApiKey = process.env.OPENROUTER_API_KEY
    let speechRequests = 0
    let speechBody: Record<string, unknown> = {}
    process.env.OPENROUTER_API_KEY = "test-key"
    globalThis.fetch = async (_input, init) => {
      speechRequests++
      speechBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
    }
    try {
      const firstSpeech = await functions.speakSentence.runner(db, { user, chain })
      const secondSpeech = await functions.speakSentence.runner(db, { user, chain })
      expect(secondSpeech).toEqual(firstSpeech)
      expect(speechRequests).toBe(1)
      expect(speechBody).toEqual({
        model: "qwen/qwen-audio-3.0-tts-plus",
        voice: "longanlingxin",
        input: "0",
        response_format: "mp3",
      })
      expect(db.all("Speech")).toHaveLength(1)
    } finally {
      globalThis.fetch = originalFetch
      if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY
      else process.env.OPENROUTER_API_KEY = originalApiKey
    }

    db.insert("Attempt", {
      id: asUUID("50000000-0000-4000-8000-000000000001"), user, chain: child, symbol: symbols[0]!, outcome: "correct", createdAt: 0,
    })

    const result = await functions.requestState.runner(db, { user })
    expect(result).toEqual({ chain, options: symbols, known: [symbols[0]!] })

    const answer = await functions.tryOption.runner(db, { user, option: symbols[0]! })
    expect(answer).toEqual({ outcome: "wrong", nextChain: null })
    expect(db.where("Attempt", "user", user)).toHaveLength(2)
    expect(db.where("UserStateOption", "user", user)).toHaveLength(5)
    expect(db.forceGet("UserState", db.all("UserState")[0]!.id).currentChain).toBe(chain)

    const correct = await functions.tryOption.runner(db, { user, option: symbols[1]! })
    expect(correct).toEqual({ outcome: "correct", nextChain: child })
    expect(db.where("UserStateOption", "user", user)).toHaveLength(5)
    expect(db.forceGet("UserState", db.all("UserState")[0]!.id).currentChain).toBe(child)
    expect(await functions.lessonHistory.runner(db, { user })).toEqual({
      steps: [{
        chain,
        options: symbols.map((symbol, position) => ({
          symbol,
          outcome: position === 1 ? "correct" : "wrong",
          taken: position === 1,
        })),
      }],
    })
    sqlite.close()
  })

  test("an empty lesson chooses its first character", async () => {
    const sqlite = new Database(":memory:")
    const db = createDB(tables, sqlite)
    const user = asUUID("60000000-0000-4000-8000-000000000001")
    const firstChain = asUUID("60000000-0000-4000-8000-000000000002")
    const symbols = [1, 2, 3, 4, 5].map(index => asUUID(`60000000-0000-4000-8000-${String(index + 2).padStart(12, "0")}`))
    db.insert("User", { id: user, username: "empty-lesson" })
    symbols.forEach((id, index) => db.insert("Symbol", {
      id,
      mandarin_character: String(index),
      pinyin: `p${index}`,
      meaning: `m${index}`,
    }))
    db.insert("Chain", { id: firstChain, prev: null, symbolID: symbols[0]!, pinyin: "p0", meaning: "m0" })
    db.insert("UserState", { id: asUUID("60000000-0000-4000-8000-000000000008"), user, currentChain: null })
    symbols.forEach((symbol, position) => db.insert("UserStateOption", {
      id: asUUID(`60000000-0000-4000-8000-${String(position + 9).padStart(12, "0")}`),
      user,
      chain: null,
      symbol,
      outcome: position === 0 ? "correct" : "wrong",
      position,
      nextChain: position === 0 ? firstChain : null,
    }))

    expect(await functions.requestState.runner(db, { user })).toEqual({ chain: null, options: symbols, known: [] })
    expect(await functions.lessonHistory.runner(db, { user })).toEqual({ steps: [] })
    expect(await functions.tryOption.runner(db, { user, option: symbols[0]! })).toEqual({
      outcome: "correct",
      nextChain: firstChain,
    })
    expect(db.forceGet("UserState", db.all("UserState")[0]!.id).currentChain).toBe(firstChain)
    expect((await functions.lessonHistory.runner(db, { user })).steps).toHaveLength(1)
    sqlite.close()
  })
})
