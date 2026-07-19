import { OpenRouterContentError, openRouterJson } from "./backend/openrouter"
import { createDB, randomUUID, ref, selfRef, table, UUID } from "./sql"
import { array, number, object, string, type Infer } from "./schema"
import { serverFunction, type ServerFunction } from "./typedFunction"

export const Symbol = table({
  mandarin_character: string,
  pinyin: string,
  meaning: string,
})

export const Chain = table({
  prev: selfRef({ nullable: true, onDelete: "set null" }),
  symbolID: ref(Symbol, { onDelete: "cascade" }),
  pinyin: string,
  meaning: string,
  completion: string,
}, { indexes: ["prev", "symbolID"] })

export const User = table({ username: string }, { access: "private" })

export const Knowledge = table({
  symbolID: ref(Symbol, { onDelete: "cascade" }),
  clicked: number,
  correct: number,
  user: ref(User, { onDelete: "cascade" }),
}, { access: "private", indexes: ["symbolID", "user"] })

export const UserState = table({
  user: ref(User, { onDelete: "cascade" }),
  currentChain: ref(Chain, { nullable: true, onDelete: "set null" }),
}, { access: "private", indexes: ["user"] })

export const UserStateOption = table({
  user: ref(User, { onDelete: "cascade" }),
  symbol: ref(Symbol, { onDelete: "cascade" }),
  outcome: string,
  position: number,
  nextChain: ref(Chain, { nullable: true, onDelete: "cascade" }),
}, { access: "private", indexes: ["user", "symbol"] })

export const Attempt = table({
  user: ref(User, { onDelete: "cascade" }),
  chain: ref(Chain, { onDelete: "cascade" }),
  symbol: ref(Symbol, { onDelete: "cascade" }),
  outcome: string,
  createdAt: number,
}, { access: "private", indexes: ["user", "chain", "symbol"] })

export const tables = { User, Symbol, Chain, Knowledge, UserState, UserStateOption, Attempt }
export type AppTables = typeof tables

export const SymbolRow = object(Symbol.columns)
export const ChainRow = object(Chain.columns)
export const KnowledgeRow = object(Knowledge.columns)
export const UserRow = object(User.columns)
type ChainData = Infer<typeof ChainRow>

export type FUNCS = {
  requestState: (user: UUID) => { chain: UUID; options: UUID[] }
  tryOption: (user: UUID, option: UUID) => {
    correct: true
    outcome: "correct"
    next_chain: UUID
  } | { correct: false; outcome: "possible" | "wrong" }
}

type FunctionImplementations = { [K in keyof FUNCS]: ServerFunction<any, ReturnType<FUNCS[K]>> }
type DB = ReturnType<typeof createDB<typeof tables>>
type Outcome = "correct" | "possible" | "wrong"

const sentenceResponse = object({ sentence: string, pinyin: string, translation: string })
const ratingResponse = object({ ratings: array(object({ character: string, outcome: string })) })
const symbolAnnotations = object({
  annotations: array(object({ character: string, pinyin: string, fixed_translation: string })),
})
const chainAnnotation = object({ pinyin: string, completion: string, translation_or_description: string })
type GeneratedSentence = Infer<typeof sentenceResponse>

function characters(value: string): string[] {
  return Array.from(value.trim())
}

function normalizeSentence(value: string): string {
  return value.normalize("NFC").replace(/[\p{P}\p{S}\s]/gu, "")
}

function isChineseSentence(value: string): boolean {
  const chars = characters(value)
  return chars.length >= 4 && chars.length <= 24 && chars.every(char => /^\p{Script=Han}$/u.test(char))
}

function chainRows(db: DB, id: UUID): ChainData[] {
  const rows: ChainData[] = []
  let current: UUID | null = id
  while (current) {
    const row: ChainData = db.forceGet("Chain", current)
    rows.unshift(row)
    current = row.prev
  }
  return rows
}

function chainText(db: DB, id: UUID): string {
  return chainRows(db, id).map(row => db.forceGet("Symbol", row.symbolID).mandarin_character).join("")
}

async function generateSentence(prefix = ""): Promise<GeneratedSentence> {
  const messages = [{
    role: "user" as const,
    content: prefix
      ? `Write one natural, ordinary Chinese sentence of 6 to 16 Chinese characters beginning exactly with ${JSON.stringify(prefix)}. You know only this prefix; choose any natural continuation. Also return the full sentence pinyin and English translation.`
      : "Write one natural, ordinary beginner-friendly Chinese sentence of 8 to 16 Chinese characters. Use only Chinese characters, with no punctuation. Also return the full sentence pinyin and English translation.",
  }]
  const valid = (sentence: string) => isChineseSentence(sentence)
    && sentence.startsWith(prefix)
    && characters(sentence).length > characters(prefix).length

  try {
    const result = await openRouterJson(sentenceResponse, messages)
    const sentence = normalizeSentence(result.sentence)
    if (!valid(sentence)) throw new OpenRouterContentError(`Invalid generated sentence: ${result.sentence}`)
    return { ...result, sentence }
  } catch (error) {
    if (!(error instanceof OpenRouterContentError)) throw error
    const model = process.env.OPENROUTER_VALIDATOR_MODEL ?? "z-ai/glm-5"
    console.log(JSON.stringify({ scope: "llm", event: "retry", task: "sentence", model, reason: error.message }))
    const result = await openRouterJson(sentenceResponse, messages, model)
    const sentence = normalizeSentence(result.sentence)
    if (!valid(sentence)) throw new Error(`Validator returned invalid sentence: ${result.sentence}`)
    return { ...result, sentence }
  }
}

function findOrCreateSymbol(db: DB, character: string): UUID {
  const existing = db.where("Symbol", "mandarin_character", character)[0]
  if (existing) return existing.id
  const id = randomUUID()
  db.insert("Symbol", { id, mandarin_character: character, pinyin: "", meaning: "" })
  return id
}

function appendSentence(db: DB, generated: GeneratedSentence, prefixChain: UUID | null = null): { first: UUID; leaf: UUID } {
  const prefix = prefixChain ? chainText(db, prefixChain) : ""
  if (!generated.sentence.startsWith(prefix) || generated.sentence === prefix) throw new Error(`Sentence does not extend prefix ${prefix}`)
  let previous = prefixChain
  let first: UUID | null = null
  for (const character of characters(generated.sentence).slice(characters(prefix).length)) {
    const symbolID = findOrCreateSymbol(db, character)
    const existing = db.where("Chain", "prev", previous).find(row => row.symbolID === symbolID)
    const id = existing?.id ?? randomUUID()
    if (!existing) db.insert("Chain", { id, prev: previous, symbolID, pinyin: "", meaning: "", completion: "unknown" })
    first ??= id
    previous = id
  }
  if (!first || !previous) throw new Error("Sentence produced no chain nodes")
  const leaf = db.forceGet("Chain", previous)
  db.set("Chain", { ...leaf, pinyin: generated.pinyin, meaning: generated.translation, completion: "complete" })
  return { first, leaf: previous }
}

function hasCompleteDescendant(db: DB, chain: UUID): boolean {
  const queue = [chain]
  const visited = new Set<UUID>()
  while (queue.length) {
    const current = queue.shift()!
    if (visited.has(current)) continue
    visited.add(current)
    const row = db.forceGet("Chain", current)
    if (row.completion === "complete" && row.pinyin && row.meaning) return true
    queue.push(...db.where("Chain", "prev", current).map(child => child.id))
  }
  return false
}

function validChildren(db: DB, chain: UUID) {
  return db.where("Chain", "prev", chain).filter(child => hasCompleteDescendant(db, child.id))
}

async function ensureValidChildren(db: DB, chain: UUID) {
  let children = validChildren(db, chain)
  const sentencesToGenerate = Math.max(0, 2 - children.length)
  for (let attempt = 0; attempt < sentencesToGenerate; attempt++) {
    appendSentence(db, await generateSentence(chainText(db, chain)), chain)
  }
  children = validChildren(db, chain)
  if (!children.length) throw new Error("Could not generate a valid continuation")
  return children.slice(0, 2)
}

async function rateCandidates(prefix: string, candidates: string[]): Promise<{ character: string; outcome: "possible" | "wrong" }[]> {
  const result = await openRouterJson(ratingResponse, [{
    role: "user",
    content: `For each candidate, decide whether it could technically be the next character after ${JSON.stringify(prefix)} in some natural ordinary Chinese sentence. Candidates: ${candidates.join(", ")}. Return outcome "possible" when it could fit and "wrong" when it could not. Return every candidate exactly once. Do not generate example sentences. Do not consider pedagogy or learner history.`,
  }])
  return candidates.map(character => ({
    character,
    outcome: result.ratings.find(rating => rating.character === character)?.outcome === "possible" ? "possible" : "wrong",
  }))
}

async function annotateSymbols(db: DB, ids: UUID[]): Promise<void> {
  const symbols = [...new Set(ids)].map(id => db.forceGet("Symbol", id)).filter(symbol => !symbol.pinyin || !symbol.meaning)
  if (!symbols.length) return
  const result = await openRouterJson(symbolAnnotations, [{
    role: "user",
    content: `Annotate these Chinese characters independently: ${symbols.map(symbol => symbol.mandarin_character).join(", ")}. For each, return the character, standard pinyin, and one short fixed English translation. Do not use sentence context. Return every character exactly once.`,
  }])
  for (const symbol of symbols) {
    const annotation = result.annotations.find(item => item.character === symbol.mandarin_character)
    if (!annotation) throw new OpenRouterContentError(`Missing annotation for ${symbol.mandarin_character}`)
    db.set("Symbol", { ...symbol, pinyin: annotation.pinyin, meaning: annotation.fixed_translation })
  }
}

async function annotateChain(db: DB, id: UUID): Promise<void> {
  const chain = db.forceGet("Chain", id)
  if (chain.pinyin && chain.meaning && chain.completion !== "unknown") return
  const text = chainText(db, id)
  const result = await openRouterJson(chainAnnotation, [{
    role: "user",
    content: `Annotate only this Chinese text, without imagining any later continuation: ${JSON.stringify(text)}. Give its complete pinyin. Set completion to "complete" if it can stand naturally as a complete utterance, otherwise "incomplete". For incomplete text, translate it with an ellipsis or provide a literal description that clearly feels unfinished.`,
  }])
  if (result.completion !== "complete" && result.completion !== "incomplete") {
    throw new OpenRouterContentError(`Invalid chain completion: ${result.completion}`)
  }
  db.set("Chain", { ...chain, pinyin: result.pinyin, meaning: result.translation_or_description, completion: result.completion })
}

function sampleSymbols(db: DB, excluded: Set<UUID>, count: number): UUID[] {
  const available = db.all("Symbol").filter(symbol => !excluded.has(symbol.id))
  for (let index = available.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1))
    ;[available[index], available[other]] = [available[other]!, available[index]!]
  }
  if (available.length < count) throw new Error(`Need ${count} random symbols, but only ${available.length} are available`)
  return available.slice(0, count).map(symbol => symbol.id)
}

type OptionRow = {
  id: UUID
  user: UUID
  symbol: UUID
  outcome: Outcome
  position: number
  nextChain: UUID | null
}

async function createOptions(db: DB, user: UUID, chain: UUID): Promise<UUID[]> {
  const children = await ensureValidChildren(db, chain)
  const correct = children.map(child => ({ symbol: child.symbolID, outcome: "correct" as const, nextChain: child.id }))
  const randomSymbols = sampleSymbols(db, new Set(correct.map(option => option.symbol)), 5 - correct.length)
  const ratings = await rateCandidates(chainText(db, chain), randomSymbols.map(id => db.forceGet("Symbol", id).mandarin_character))
  const rows: Omit<OptionRow, "id" | "user" | "position">[] = [
    ...correct,
    ...ratings.map(rating => ({
      symbol: db.where("Symbol", "mandarin_character", rating.character)[0]!.id,
      outcome: rating.outcome,
      nextChain: null,
    })),
  ]
  for (let index = rows.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1))
    ;[rows[index], rows[other]] = [rows[other]!, rows[index]!]
  }

  await Promise.all([
    annotateSymbols(db, rows.map(row => row.symbol)),
    annotateChain(db, chain),
    ...children.map(child => annotateChain(db, child.id)),
  ])

  const stored: OptionRow[] = rows.map((row, position) => ({ id: randomUUID(), user, position, ...row }))
  db.transaction(() => {
    for (const old of db.where("UserStateOption", "user", user)) db.delete("UserStateOption", old.id)
    for (const row of stored) db.insert("UserStateOption", row)
  })
  return stored.map(row => row.symbol)
}

function activeChain(db: DB, user: UUID): UUID | null {
  const chain = db.where("UserState", "user", user)[0]?.currentChain
  return chain && db.get("Chain", chain) ? chain : null
}

function currentState(db: DB, user: UUID): { chain: UUID; options: UUID[] } | null {
  const chain = activeChain(db, user)
  if (!chain) return null
  const options = db.where("UserStateOption", "user", user).sort((a, b) => a.position - b.position)
  return options.length === 5 ? { chain, options: options.map(option => option.symbol) } : null
}

function setState(db: DB, user: UUID, chain: UUID): void {
  const existing = db.where("UserState", "user", user)[0]
  db.set("UserState", { id: existing?.id ?? randomUUID(), user, currentChain: chain })
}

function recordAttempt(db: DB, user: UUID, chain: UUID, symbol: UUID, outcome: Outcome): void {
  db.insert("Attempt", { id: randomUUID(), user, chain, symbol, outcome, createdAt: Date.now() })
  if (outcome === "possible") return
  const knowledge = db.where("Knowledge", "user", user).find(row => row.symbolID === symbol)
  db.set("Knowledge", {
    id: knowledge?.id ?? randomUUID(), user, symbolID: symbol,
    clicked: (knowledge?.clicked ?? 0) + 1,
    correct: (knowledge?.correct ?? 0) + (outcome === "correct" ? 1 : 0),
  })
}

async function newLesson(db: DB, user: UUID): Promise<{ chain: UUID; options: UUID[] }> {
  const sentence = appendSentence(db, await generateSentence())
  const options = await createOptions(db, user, sentence.first)
  setState(db, user, sentence.first)
  return { chain: sentence.first, options }
}

export const functions = {
  newUser: serverFunction({ name: string }, (db, arg) => {
    const row = { id: randomUUID(), username: arg.name }
    db.insert("User", row)
    return row
  }),

  requestState: serverFunction(
    { user: ref(User) },
    async (db, { user }): Promise<ReturnType<FUNCS["requestState"]>> => {
      const existing = currentState(db, user)
      if (existing) return existing
      const chain = activeChain(db, user)
      if (!chain) return newLesson(db, user)
      return { chain, options: await createOptions(db, user, chain) }
    },
    "Return the current prefix and its five options.",
  ),

  tryOption: serverFunction(
    { user: ref(User), option: ref(Symbol) },
    async (db, { user, option }): Promise<ReturnType<FUNCS["tryOption"]>> => {
      const state = currentState(db, user)
      if (!state) throw new Error("User has no active options")
      const selected = db.where("UserStateOption", "user", user).find(row => row.symbol === option)
      if (!selected || !["correct", "possible", "wrong"].includes(selected.outcome)) throw new Error("Invalid active option")
      const outcome = selected.outcome as Outcome
      recordAttempt(db, user, state.chain, option, outcome)
      if (outcome !== "correct") return { correct: false, outcome }
      if (!selected.nextChain) throw new Error("Correct option has no child chain")
      setState(db, user, selected.nextChain)
      for (const old of db.where("UserStateOption", "user", user)) db.delete("UserStateOption", old.id)
      return { correct: true, outcome: "correct", next_chain: selected.nextChain }
    },
    "Advance to a valid child immediately; options load separately.",
  ),
} satisfies FunctionImplementations & Record<string, ServerFunction<any, any>>

export type ServerFunctions = typeof functions
