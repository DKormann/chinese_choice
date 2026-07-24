import { OpenRouterContentError, openRouterJson, openRouterSpeech, openRouterSpeechKey } from "./backend/openrouter"
import { createDB, randomUUID, ref, selfRef, table, UUID, type TableRow } from "./sql"
import { array, constant, number, object, string, union, type Infer } from "./schema"
import { serverFunction } from "./typedFunction"

const outcomeSchema = union(constant("correct"), constant("possible"), constant("wrong"))
const ratingOutcomeSchema = union(constant("possible"), constant("wrong"))

export const Symbol = table({
  mandarin_character: string,
  pinyin: string,
  meaning: string,
}, { uniqueIndexes: [{ columns: ["mandarin_character"] }] })

export const Chain = table({
  prev: selfRef({ nullable: true, onDelete: "set null" }),
  symbolID: ref(Symbol, { onDelete: "cascade" }),
  pinyin: string,
  meaning: string,
}, {
  indexes: ["prev", "symbolID"],
  uniqueIndexes: [
    { columns: ["prev", "symbolID"] },
    { columns: ["symbolID"], whereNull: "prev" },
  ],
})

export const User = table({ username: string }, { access: "private" })

export const UserState = table({
  user: ref(User, { onDelete: "cascade" }),
  currentChain: ref(Chain, { nullable: true, onDelete: "set null" }),
}, { access: "private", indexes: ["user"] })

export const UserStateOption = table({
  user: ref(User, { onDelete: "cascade" }),
  chain: ref(Chain, { nullable: true, onDelete: "cascade" }),
  symbol: ref(Symbol, { onDelete: "cascade" }),
  outcome: outcomeSchema,
  position: number,
  nextChain: ref(Chain, { nullable: true, onDelete: "cascade" }),
}, { access: "private", indexes: ["user", "chain", "symbol"] })

export const Attempt = table({
  user: ref(User, { onDelete: "cascade" }),
  chain: ref(Chain, { nullable: true, onDelete: "cascade" }),
  symbol: ref(Symbol, { onDelete: "cascade" }),
  outcome: outcomeSchema,
  createdAt: number,
}, { access: "private", indexes: ["user", "chain", "symbol"] })

export const Speech = table({
  key: string,
  audio: string,
}, { access: "private", indexes: ["key"] })

export const tables = { User, Symbol, Chain, UserState, UserStateOption, Attempt, Speech }

export const UserRow = object(User.columns)
type ChainData = TableRow<typeof Chain>

type DB = ReturnType<typeof createDB<typeof tables>>
type LessonState = { chain: UUID | null; options: UUID[]; known: UUID[] }

const sentenceResponse = object({ sentence: string, pinyin: string, translation: string })
const ratingResponse = object({ ratings: array(object({ character: string, outcome: ratingOutcomeSchema })) })
const symbolAnnotation = object({ pinyin: string, fixed_translation: string })
const chainAnnotation = object({ pinyin: string, translation_or_description: string })
const sentenceHelpResponse = object({ answer: string })
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

async function answerSentenceQuestion(db: DB, user: UUID, chain: UUID, question: string): Promise<string> {
  if (activeChain(db, user) !== chain) throw new Error("This is no longer the current sentence")
  const trimmed = question.trim()
  if (!trimmed) throw new Error("Ask a question about the current sentence")
  if (trimmed.length > 500) throw new Error("Questions must be 500 characters or fewer")
  const current = db.forceGet("Chain", chain)
  const text = chainText(db, chain)
  const result = await openRouterJson(sentenceHelpResponse, [{
    role: "user",
    content: `You are a concise Chinese-learning helper. Answer the learner's question only about the current visible Chinese text. It may be an incomplete prefix, so do not invent or reveal later continuation characters, recommend an answer choice, or introduce a different sentence. Explain vocabulary, grammar, meaning, pinyin, or ambiguity in this text when relevant. If the question is outside this text, say that you can only help with the current sentence.\n\nCurrent text: ${JSON.stringify(text)}\nPinyin: ${JSON.stringify(current.pinyin)}\nEnglish annotation: ${JSON.stringify(current.meaning)}\nLearner question: ${JSON.stringify(trimmed)}`,
  }])
  const answer = result.answer.trim()
  if (!answer) throw new OpenRouterContentError("Sentence helper returned an empty answer")
  return answer
}

function base64(bytes: Uint8Array): string {
  let binary = ""
  for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  return btoa(binary)
}

async function speakCurrentSentence(db: DB, user: UUID, chain: UUID): Promise<string> {
  if (activeChain(db, user) !== chain) throw new Error("This is no longer the current sentence")
  const text = chainText(db, chain)
  const key = openRouterSpeechKey(text)
  const cached = db.where("Speech", "key", key)[0]
  if (cached) return cached.audio
  const audio = base64(await openRouterSpeech(text))
  db.insert("Speech", { id: randomUUID(), key, audio })
  return audio
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
    && new Set(characters(sentence)).size >= 5
  const normalize = (result: GeneratedSentence): GeneratedSentence => ({
    ...result,
    sentence: normalizeSentence(result.sentence),
    pinyin: result.pinyin.trim(),
    translation: result.translation.trim(),
  })
  const validResult = (result: GeneratedSentence) => valid(result.sentence) && Boolean(result.pinyin && result.translation)

  try {
    const result = normalize(await openRouterJson(sentenceResponse, messages))
    if (!validResult(result)) throw new OpenRouterContentError(`Invalid generated sentence: ${result.sentence}`)
    return result
  } catch (error) {
    if (!(error instanceof OpenRouterContentError)) throw error
    const model = process.env.OPENROUTER_VALIDATOR_MODEL ?? "z-ai/glm-5"
    console.log(JSON.stringify({ scope: "llm", event: "retry", task: "sentence", model, reason: error.message }))
    const result = normalize(await openRouterJson(sentenceResponse, messages, model))
    if (!validResult(result)) throw new Error(`Validator returned invalid sentence: ${result.sentence}`)
    return result
  }
}

function findOrCreateSymbol(db: DB, character: string): UUID {
  const existing = db.where("Symbol", "mandarin_character", character)[0]
  if (existing) return existing.id
  const id = randomUUID()
  db.insert("Symbol", {
    id,
    mandarin_character: character,
    pinyin: character === "。" ? "—" : "",
    meaning: character === "。" ? "sentence end" : "",
  })
  return id
}

function appendSentence(db: DB, generated: GeneratedSentence, prefixChain: UUID | null = null): UUID {
  return db.transaction(() => {
    const prefix = prefixChain ? chainText(db, prefixChain) : ""
    if (!generated.sentence.startsWith(prefix) || generated.sentence === prefix) throw new Error(`Sentence does not extend prefix ${prefix}`)
    let previous = prefixChain
    let first: UUID | null = null
    for (const character of characters(generated.sentence).slice(characters(prefix).length)) {
      const symbolID = findOrCreateSymbol(db, character)
      const existing = db.where("Chain", "prev", previous).find(row => row.symbolID === symbolID)
      const id = existing?.id ?? randomUUID()
      if (!existing) db.insert("Chain", { id, prev: previous, symbolID, pinyin: "", meaning: "" })
      first ??= id
      previous = id
    }
    if (!first || !previous) throw new Error("Sentence produced no chain nodes")
    const sentenceEnd = db.forceGet("Chain", previous)
    db.set("Chain", { ...sentenceEnd, pinyin: generated.pinyin, meaning: generated.translation })
    const dot = findOrCreateSymbol(db, "。")
    const existingDot = db.where("Chain", "prev", previous).find(row => row.symbolID === dot)
    if (existingDot) db.set("Chain", { ...existingDot, pinyin: generated.pinyin, meaning: generated.translation })
    else db.insert("Chain", { id: randomUUID(), prev: previous, symbolID: dot, pinyin: generated.pinyin, meaning: generated.translation })
    return first
  })
}

function isDot(db: DB, chain: { symbolID: UUID }): boolean {
  return db.forceGet("Symbol", chain.symbolID).mandarin_character === "。"
}

async function ensureChildren(db: DB, chain: UUID | null) {
  let children = db.where("Chain", "prev", chain)
  const sentencesToGenerate = Math.max(0, 2 - children.length)
  const prefix = chain ? chainText(db, chain) : ""
  const generated = await Promise.all(Array.from({ length: sentencesToGenerate }, () => generateSentence(prefix)))
  for (const sentence of generated) appendSentence(db, sentence, chain)
  children = db.where("Chain", "prev", chain)
  if (!children.length) throw new Error("Could not generate a valid continuation")
  return children.slice(0, 2)
}

async function rateCandidates(prefix: string, candidates: string[]): Promise<("possible" | "wrong")[]> {
  const result = await openRouterJson(ratingResponse, [{
    role: "user",
    content: `For each candidate, decide whether it could technically be the next character after ${JSON.stringify(prefix)} in some natural ordinary Chinese sentence. Candidates: ${candidates.join(", ")}. Return outcome "possible" when it could fit and "wrong" when it could not. Return every candidate exactly once. Do not generate example sentences. Do not consider pedagogy or learner history.`,
  }])
  return candidates.map(character => result.ratings.find(rating => rating.character === character)?.outcome === "possible" ? "possible" : "wrong")
}

async function annotateSymbol(db: DB, id: UUID): Promise<void> {
  const symbol = db.forceGet("Symbol", id)
  if (symbol.pinyin && symbol.meaning) return
  const annotation = await openRouterJson(symbolAnnotation, [{
    role: "user",
    content: `Annotate only the Chinese character ${JSON.stringify(symbol.mandarin_character)}. Return its standard pinyin and one short fixed English translation. Do not use or imagine sentence context.`,
  }])
  if (!annotation.pinyin.trim() || !annotation.fixed_translation.trim()) throw new OpenRouterContentError(`Empty annotation for ${symbol.mandarin_character}`)
  const current = db.forceGet("Symbol", id)
  if (!current.pinyin || !current.meaning) db.set("Symbol", { ...current, pinyin: annotation.pinyin.trim(), meaning: annotation.fixed_translation.trim() })
}

async function annotateChain(db: DB, id: UUID): Promise<void> {
  const chain = db.forceGet("Chain", id)
  if (chain.pinyin && chain.meaning) return
  const text = chainText(db, id)
  const annotation = await openRouterJson(chainAnnotation, [{
    role: "user",
    content: `Annotate only this Chinese text, without imagining later continuation characters: ${JSON.stringify(text)}. Return its complete pinyin and an independent English translation or clearly unfinished description.`,
  }])
  if (!annotation.pinyin.trim() || !annotation.translation_or_description.trim()) throw new OpenRouterContentError(`Empty chain annotation for ${text}`)
  const current = db.forceGet("Chain", id)
  if (!current.pinyin || !current.meaning) db.set("Chain", { ...current, pinyin: annotation.pinyin.trim(), meaning: annotation.translation_or_description.trim() })
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

type OptionRow = TableRow<typeof UserStateOption>

async function createOptions(db: DB, user: UUID, chain: UUID | null): Promise<UUID[]> {
  const children = await ensureChildren(db, chain)
  const correct = children.map(child => ({ symbol: child.symbolID, outcome: "correct" as const, nextChain: child.id }))
  const randomSymbols = sampleSymbols(db, new Set(correct.map(option => option.symbol)), 5 - correct.length)
  const ratings = await rateCandidates(chain ? chainText(db, chain) : "", randomSymbols.map(id => db.forceGet("Symbol", id).mandarin_character))
  const rows: Omit<OptionRow, "id" | "user" | "chain" | "position">[] = [
    ...correct,
    ...randomSymbols.map((symbol, index) => ({
      symbol,
      outcome: ratings[index]!,
      nextChain: null,
    })),
  ]
  for (let index = rows.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1))
    ;[rows[index], rows[other]] = [rows[other]!, rows[index]!]
  }

  await Promise.all([
    ...[...new Set(rows.map(row => row.symbol))].map(id => annotateSymbol(db, id)),
    ...(chain ? [annotateChain(db, chain)] : []),
    ...children.map(child => annotateChain(db, child.id)),
  ])

  const stored: OptionRow[] = rows.map((row, position) => ({ id: randomUUID(), user, chain, position, ...row }))
  db.transaction(() => {
    for (const old of db.where("UserStateOption", "user", user).filter(option => option.chain === chain)) {
      db.delete("UserStateOption", old.id)
    }
    for (const row of stored) db.insert("UserStateOption", row)
  })
  return stored.map(row => row.symbol)
}

function activeChain(db: DB, user: UUID): UUID | null {
  return db.where("UserState", "user", user)[0]?.currentChain ?? null
}

function lessonState(db: DB, user: UUID, chain: UUID | null, options: UUID[]): LessonState {
  const correct = new Set(db.where("Attempt", "user", user)
    .filter(attempt => attempt.outcome === "correct")
    .map(attempt => attempt.symbol))
  return { chain, options, known: options.filter(option => correct.has(option)) }
}

function currentState(db: DB, user: UUID): LessonState | null {
  const userState = db.where("UserState", "user", user)[0]
  if (!userState) return null
  const chain = userState.currentChain
  const options = db.where("UserStateOption", "user", user)
    .filter(option => option.chain === chain)
    .sort((a, b) => a.position - b.position)
  const symbols = options.map(option => option.symbol)
  return options.length === 5 && new Set(symbols).size === 5 ? lessonState(db, user, chain, symbols) : null
}

function setState(db: DB, user: UUID, chain: UUID | null): void {
  const existing = db.where("UserState", "user", user)[0]
  db.set("UserState", { id: existing?.id ?? randomUUID(), user, currentChain: chain })
}

function lessonHistory(db: DB, user: UUID) {
  const chain = activeChain(db, user)
  if (!chain) return { steps: [] }
  const options = db.where("UserStateOption", "user", user)
  const byChain = new Map<UUID | null, OptionRow[]>()
  for (const option of options) byChain.set(option.chain, [...byChain.get(option.chain) ?? [], option])
  const path = chainRows(db, chain)
  const steps = path.flatMap((taken, index) => {
    const previous = path[index - 1]?.id ?? null
    const choices = (byChain.get(previous) ?? []).sort((a, b) => a.position - b.position)
    if (choices.length === 5 && new Set(choices.map(choice => choice.symbol)).size === 5) {
      return [{
        chain: previous,
        options: choices.map(choice => ({
          symbol: choice.symbol,
          outcome: choice.outcome,
          taken: choice.symbol === taken.symbolID,
        })),
      }]
    }
    return []
  })
  return { steps: steps.reverse() }
}

async function newLesson(db: DB, user: UUID): Promise<LessonState> {
  appendSentence(db, await generateSentence())
  setState(db, user, null)
  return lessonState(db, user, null, await createOptions(db, user, null))
}

const stateRequests = new WeakMap<DB, Map<UUID, Promise<LessonState>>>()

function requestState(db: DB, user: UUID): Promise<LessonState> {
  let requests = stateRequests.get(db)
  if (!requests) stateRequests.set(db, requests = new Map())
  const pending = requests.get(user)
  if (pending) return pending
  const request = (async () => {
    const existing = currentState(db, user)
    if (existing) return existing
    const userState = db.where("UserState", "user", user)[0]
    if (!userState || (userState.currentChain && isDot(db, db.forceGet("Chain", userState.currentChain)))) return newLesson(db, user)
    const chain = userState.currentChain
    return lessonState(db, user, chain, await createOptions(db, user, chain))
  })().finally(() => requests.delete(user))
  requests.set(user, request)
  return request
}

export const functions = {
  newUser: serverFunction({ name: string }, (db, arg) => {
    const row = { id: randomUUID(), username: arg.name }
    db.insert("User", row)
    return row
  }),

  requestState: serverFunction(
    { user: ref(User) },
    (db, { user }) => requestState(db, user),
    "Return the current prefix and its five options.",
  ),

  tryOption: serverFunction(
    { user: ref(User), option: ref(Symbol) },
    (db, { user, option }) => {
      const state = currentState(db, user)
      if (!state) throw new Error("User has no active options")
      const selected = db.where("UserStateOption", "user", user)
        .find(row => row.chain === state.chain && row.symbol === option)
      if (!selected) throw new Error("Invalid active option")
      const outcome = selected.outcome
      db.insert("Attempt", { id: randomUUID(), user, chain: state.chain, symbol: option, outcome, createdAt: Date.now() })
      if (outcome !== "correct") return { outcome, nextChain: null }
      if (!selected.nextChain) throw new Error("Correct option has no child chain")
      setState(db, user, selected.nextChain)
      return { outcome, nextChain: selected.nextChain }
    },
    "Advance to a valid child immediately; options load separately.",
  ),

  askSentence: serverFunction(
    { user: ref(User), chain: ref(Chain), question: string },
    async (db, { user, chain, question }) => ({ answer: await answerSentenceQuestion(db, user, chain, question) }),
    "Answer a question using only the learner's current visible sentence.",
  ),

  speakSentence: serverFunction(
    { user: ref(User), chain: ref(Chain) },
    async (db, { user, chain }) => ({ audio: await speakCurrentSentence(db, user, chain) }),
    "Generate Mandarin speech for the learner's current visible sentence.",
  ),

  lessonHistory: serverFunction(
    { user: ref(User) },
    (db, { user }) => lessonHistory(db, user),
    "Return completed five-choice steps in chronological order.",
  ),
}

export type ServerFunctions = typeof functions
