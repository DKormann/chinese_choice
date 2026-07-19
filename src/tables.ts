import { OpenRouterContentError, OpenRouterRequestError, openRouterJson } from "./backend/openrouter"
import { createDB, randomUUID, ref, selfRef, table, UUID } from "./sql"
import { array, number, object, string, type Infer } from "./schema"
import { serverFunction, type ServerFunction } from "./typedFunction"

export const Symbol = table({
  mandarin_character: string,
  pinyin: string,
  meaning: string,
})

// pinyin and meaning describe only this complete root-to-node prefix.
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
  currentSentence: ref(Chain, { nullable: true, onDelete: "set null" }),
}, { access: "private", indexes: ["user"] })

export const UserStateOption = table({
  user: ref(User, { onDelete: "cascade" }),
  symbol: ref(Symbol, { onDelete: "cascade" }),
  outcome: string,
  position: number,
  nextChain: ref(Chain, { nullable: true, onDelete: "cascade" }),
  sentenceLeaf: ref(Chain, { nullable: true, onDelete: "cascade" }),
}, { access: "private", indexes: ["user", "symbol"] })

export const Attempt = table({
  user: ref(User, { onDelete: "cascade" }),
  chain: ref(Chain, { onDelete: "cascade" }),
  symbol: ref(Symbol, { onDelete: "cascade" }),
  outcome: string,
  createdAt: number,
}, { access: "private", indexes: ["user", "chain", "symbol"] })

// status: 0 pending, 1 processing, 2 failed. Successful jobs are removed.
export const AnnotationJob = table({
  kind: string,
  symbol: ref(Symbol, { nullable: true, onDelete: "cascade" }),
  chain: ref(Chain, { nullable: true, onDelete: "cascade" }),
  status: number,
  attempts: number,
}, { access: "private", indexes: ["status", "symbol", "chain"] })

export const tables = { User, Symbol, Chain, Knowledge, UserState, UserStateOption, Attempt, AnnotationJob }

export const SymbolRow = object(Symbol.columns)
export const ChainRow = object(Chain.columns)
export const KnowledgeRow = object(Knowledge.columns)
export const UserRow = object(User.columns)
export type AppTables = typeof tables

export type FUNCS = {
  requestNewChain: (user: UUID) => { chain: UUID; options: UUID[] }
  requestState: (user: UUID) => { chain: UUID; options: UUID[] }
  tryOption: (user: UUID, option: UUID) => {
    correct: true
    outcome: "correct"
    next_chain: UUID
    next_options: UUID[]
  } | { correct: false; outcome: "possible" | "wrong" }
}

type FunctionImplementations = { [K in keyof FUNCS]: ServerFunction<any, ReturnType<FUNCS[K]>> }
type DB = ReturnType<typeof createDB<typeof tables>>

const sentenceResponse = object({ sentence: string })
const ratingResponse = object({
  ratings: array(object({
    character: string,
    outcome: string,
  })),
})
const symbolAnnotations = object({
  annotations: array(object({ character: string, pinyin: string, fixed_translation: string })),
})
const chainAnnotation = object({ pinyin: string, completion: string, translation_or_description: string })
type Ratings = Infer<typeof ratingResponse>

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

function chainText(db: DB, id: UUID): string {
  const result: string[] = []
  let current: UUID | null = id
  while (current) {
    const node: { prev: UUID | null; symbolID: UUID } = db.forceGet("Chain", current)
    result.unshift(db.forceGet("Symbol", node.symbolID).mandarin_character)
    current = node.prev
  }
  return result.join("")
}

function validatorModel(): string {
  return process.env.OPENROUTER_VALIDATOR_MODEL ?? "z-ai/glm-5"
}

async function generateSentence(prefix = "", excludedNext: string[] = []): Promise<string> {
  const messages = [{
    role: "user" as const,
    content: prefix
      ? `Write one natural, ordinary Chinese sentence of 6 to 16 Chinese characters beginning exactly with ${JSON.stringify(prefix)}. Its next character after that prefix must not be any of: ${excludedNext.join(", ")}. Return only the required JSON field.`
      : "Write one natural, ordinary beginner-friendly Chinese sentence of 8 to 16 Chinese characters. Use only Chinese characters, with no punctuation. Return only the required JSON field.",
  }]
  const valid = (sentence: string) => isChineseSentence(sentence)
    && sentence.startsWith(prefix)
    && characters(sentence).length > characters(prefix).length
    && !excludedNext.includes(characters(sentence)[characters(prefix).length] ?? "")

  try {
    const result = await openRouterJson(sentenceResponse, messages)
    const sentence = normalizeSentence(result.sentence)
    if (!valid(sentence)) throw new OpenRouterContentError(`Invalid generated sentence: ${result.sentence}`)
    return sentence
  } catch (error) {
    if (!(error instanceof OpenRouterContentError)) throw error
    console.log(JSON.stringify({ scope: "llm", event: "retry", task: "sentence", model: validatorModel(), reason: error.message }))
    const result = await openRouterJson(sentenceResponse, messages, validatorModel())
    const sentence = normalizeSentence(result.sentence)
    if (!valid(sentence)) throw new Error(`Validator returned invalid sentence: ${result.sentence}`)
    return sentence
  }
}

async function rateCandidates(prefix: string, candidates: string[]): Promise<Ratings> {
  const messages = [{
    role: "user" as const,
    content: `For each candidate, decide whether it could technically be the next character after ${JSON.stringify(prefix)} in some natural ordinary Chinese sentence. Candidates: ${candidates.join(", ")}. Return outcome "possible" when it could fit and "wrong" when it could not. Return every candidate exactly once. Do not generate example sentences. Do not consider pedagogy or learner history.`,
  }]
  const result = await openRouterJson(ratingResponse, messages)
  const ratings = candidates.map(character => {
    const proposed = result.ratings.find(rating => rating.character === character)
    return { character, outcome: proposed?.outcome === "possible" ? "possible" : "wrong" }
  })
  return { ratings }
}

function enqueueSymbol(db: DB, symbol: UUID): void {
  const row = db.forceGet("Symbol", symbol)
  if (row.pinyin && row.meaning) return
  if (db.where("AnnotationJob", "symbol", symbol).some(job => job.kind === "symbol" && job.status !== 2)) return
  db.insert("AnnotationJob", { id: randomUUID(), kind: "symbol", symbol, chain: null, status: 0, attempts: 0 })
}

function enqueueChain(db: DB, chain: UUID): void {
  const row = db.forceGet("Chain", chain)
  if (row.pinyin && row.meaning) return
  if (db.where("AnnotationJob", "chain", chain).some(job => job.kind === "chain" && job.status !== 2)) return
  db.insert("AnnotationJob", { id: randomUUID(), kind: "chain", symbol: null, chain, status: 0, attempts: 0 })
}

function findOrCreateSymbol(db: DB, character: string): UUID {
  const existing = db.where("Symbol", "mandarin_character", character)[0]
  if (existing) return existing.id
  const id = randomUUID()
  db.insert("Symbol", { id, mandarin_character: character, pinyin: "", meaning: "" })
  return id
}

function appendSentence(db: DB, sentence: string, prefixChain: UUID | null = null): { first: UUID; leaf: UUID } {
  const prefix = prefixChain ? chainText(db, prefixChain) : ""
  if (!sentence.startsWith(prefix) || sentence === prefix) throw new Error(`Sentence does not extend prefix ${prefix}`)
  let previous = prefixChain
  let first: UUID | null = null
  for (const character of characters(sentence).slice(characters(prefix).length)) {
    const symbolID = findOrCreateSymbol(db, character)
    const existing = db.where("Chain", "prev", previous).find(row => row.symbolID === symbolID)
    const id = existing?.id ?? randomUUID()
    if (!existing) db.insert("Chain", { id, prev: previous, symbolID, pinyin: "", meaning: "", completion: "unknown" })
    first ??= id
    previous = id
  }
  if (!first || !previous) throw new Error("Sentence produced no chain nodes")
  return { first, leaf: previous }
}

function nextOnSentence(db: DB, chain: UUID, leaf: UUID): UUID | null {
  let current: UUID | null = leaf
  while (current) {
    const node: { prev: UUID | null } | null = db.get("Chain", current)
    if (!node) return null
    if (node.prev === chain) return current
    current = node.prev
  }
  return null
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
  outcome: "correct" | "possible" | "wrong"
  position: number
  nextChain: UUID | null
  sentenceLeaf: UUID | null
}

async function createOptions(db: DB, user: UUID, chain: UUID, sentenceLeaf: UUID): Promise<UUID[]> {
  let knownNext = nextOnSentence(db, chain, sentenceLeaf)
  if (!knownNext) {
    const extension = appendSentence(db, await generateSentence(chainText(db, chain)), chain)
    knownNext = extension.first
    sentenceLeaf = extension.leaf
  }
  const knownSymbol = db.forceGet("Chain", knownNext).symbolID
  const randomSymbols = sampleSymbols(db, new Set([knownSymbol]), 3)
  const randomCharacters = randomSymbols.map(id => db.forceGet("Symbol", id).mandarin_character)
  const prefix = chainText(db, chain)
  const knownCharacter = db.forceGet("Symbol", knownSymbol).mandarin_character

  const [alternateSentence, ratings] = await Promise.all([
    generateSentence(prefix, [knownCharacter, ...randomCharacters]),
    rateCandidates(prefix, randomCharacters),
  ])
  const alternate = appendSentence(db, alternateSentence, chain)
  const alternateSymbol = db.forceGet("Chain", alternate.first).symbolID

  const rows: Omit<OptionRow, "id" | "user" | "position">[] = [
    { symbol: knownSymbol, outcome: "correct", nextChain: knownNext, sentenceLeaf },
    { symbol: alternateSymbol, outcome: "correct", nextChain: alternate.first, sentenceLeaf: alternate.leaf },
    ...ratings.ratings.map(rating => {
      const symbol = db.where("Symbol", "mandarin_character", rating.character)[0]
      if (!symbol) throw new Error(`Rated symbol is missing: ${rating.character}`)
      const outcome = rating.outcome === "possible" ? "possible" as const : "wrong" as const
      return { symbol: symbol.id, outcome, nextChain: null, sentenceLeaf: null }
    }),
  ]
  for (let index = rows.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1))
    ;[rows[index], rows[other]] = [rows[other]!, rows[index]!]
  }
  const stored: OptionRow[] = rows.map((row, position) => ({ id: randomUUID(), user, position, ...row }))
  db.transaction(() => {
    for (const old of db.where("UserStateOption", "user", user)) db.delete("UserStateOption", old.id)
    for (const row of stored) db.insert("UserStateOption", row)
  })
  enqueueVisibleAnnotations(db, chain, stored.map(row => row.symbol))
  kickAnnotationWorker(db)
  return stored.map(row => row.symbol)
}

let annotationWorker: Promise<void> | null = null

function enqueueVisibleAnnotations(db: DB, chain: UUID, options: UUID[]): void {
  enqueueChain(db, chain)
  let current: UUID | null = chain
  while (current) {
    const node: { prev: UUID | null; symbolID: UUID } = db.forceGet("Chain", current)
    enqueueSymbol(db, node.symbolID)
    current = node.prev
  }
  for (const symbol of options) enqueueSymbol(db, symbol)
}

export function kickAnnotationWorker(db: DB): void {
  if (annotationWorker) return
  annotationWorker = processAnnotationJobs(db).finally(() => { annotationWorker = null })
}

async function processAnnotationJobs(db: DB): Promise<void> {
  let processed = 0
  while (true) {
    const pending = db.where("AnnotationJob", "status", 0)
    const job = pending[0]
    if (!job) {
      if (processed > 0) console.log(JSON.stringify({ scope: "llm", event: "annotation_queue_complete", processed }))
      return
    }
    const jobs = job.kind === "symbol" ? pending.filter(item => item.kind === "symbol").slice(0, 20) : [job]
    console.log(JSON.stringify({ scope: "llm", event: "annotation_batch", kind: job.kind, count: jobs.length, remaining: pending.length }))
    for (const current of jobs) db.set("AnnotationJob", { ...current, status: 1, attempts: current.attempts + 1 })
    try {
      if (job.kind === "symbol") {
        const symbols = jobs.map(current => {
          if (!current.symbol) throw new Error(`Invalid symbol annotation job ${current.id}`)
          return db.forceGet("Symbol", current.symbol)
        })
        const result = await openRouterJson(symbolAnnotations, [{
          role: "user",
          content: `Annotate these Chinese characters independently: ${symbols.map(symbol => symbol.mandarin_character).join(", ")}. For each, return the character, standard pinyin, and one short fixed English translation. Do not use sentence context. Return every character exactly once.`,
        }])
        if (result.annotations.length !== symbols.length || new Set(result.annotations.map(item => item.character)).size !== symbols.length) {
          throw new OpenRouterContentError("Symbol annotation batch is incomplete or duplicated")
        }
        for (const symbol of symbols) {
          const annotation = result.annotations.find(item => item.character === symbol.mandarin_character)
          if (!annotation) throw new OpenRouterContentError(`Missing annotation for ${symbol.mandarin_character}`)
          db.set("Symbol", { ...symbol, pinyin: annotation.pinyin, meaning: annotation.fixed_translation })
        }
      } else if (job.kind === "chain" && job.chain) {
        const chain = db.forceGet("Chain", job.chain)
        const prefix = chainText(db, job.chain)
        const annotation = await openRouterJson(chainAnnotation, [{
          role: "user",
          content: `Annotate only this Chinese text, without imagining any later continuation: ${JSON.stringify(prefix)}. Give its complete pinyin. Set completion to "complete" if it can stand naturally as a complete utterance, otherwise "incomplete". For incomplete text, translate it with an ellipsis or provide a literal description that clearly feels unfinished.`,
        }])
        if (annotation.completion !== "complete" && annotation.completion !== "incomplete") {
          throw new OpenRouterContentError(`Invalid chain completion: ${annotation.completion}`)
        }
        db.set("Chain", { ...chain, pinyin: annotation.pinyin, meaning: annotation.translation_or_description, completion: annotation.completion })
      } else {
        throw new Error(`Invalid annotation job ${job.id}`)
      }
      for (const current of jobs) db.delete("AnnotationJob", current.id)
      processed += jobs.length
    } catch (error) {
      const attempts = Math.max(...jobs.map(current => current.attempts + 1))
      const retryable = error instanceof OpenRouterContentError
        || (error instanceof OpenRouterRequestError && error.retryable)
      console.error(JSON.stringify({ scope: "llm", event: "annotation_error", kind: job.kind, count: jobs.length, attempts, retryable, error: error instanceof Error ? error.message : String(error) }))
      for (const current of jobs) db.set("AnnotationJob", { ...current, status: retryable && attempts < 3 ? 0 : 2, attempts: current.attempts + 1 })
    }
  }
}

export function resumeAnnotationJobs(db: DB): void {
  for (const job of db.all("AnnotationJob")) db.delete("AnnotationJob", job.id)
  for (const state of db.all("UserState")) {
    if (!state.currentChain) continue
    const options = db.where("UserStateOption", "user", state.user).map(option => option.symbol)
    if (options.length === 5) enqueueVisibleAnnotations(db, state.currentChain, options)
  }
  kickAnnotationWorker(db)
}

function stateFor(db: DB, user: UUID): { chain: UUID; sentenceLeaf: UUID; options: UUID[] } | null {
  const state = db.where("UserState", "user", user)[0]
  if (!state?.currentChain || !state.currentSentence) return null
  if (!db.get("Chain", state.currentChain)) return null
  const sentenceLeaf = db.get("Chain", state.currentSentence)?.id ?? state.currentChain
  const current = db.forceGet("Chain", state.currentChain)
  if (current.prev === null) {
    const latest = db.where("Attempt", "user", user)
      .filter(attempt => attempt.outcome === "correct" && attempt.symbol === current.symbolID && attempt.chain !== current.id)
      .sort((a, b) => b.createdAt - a.createdAt)[0]
    if (latest) {
      db.set("Chain", { ...current, prev: latest.chain })
      console.log(JSON.stringify({ scope: "lesson", event: "repaired_chain_parent", chain: current.id, parent: latest.chain }))
    }
  }
  const options = db.where("UserStateOption", "user", user).sort((a, b) => a.position - b.position)
  return options.length === 5 ? { chain: state.currentChain, sentenceLeaf, options: options.map(option => option.symbol) } : null
}

function setState(db: DB, user: UUID, chain: UUID, sentenceLeaf: UUID): void {
  const existing = db.where("UserState", "user", user)[0]
  db.set("UserState", { id: existing?.id ?? randomUUID(), user, currentChain: chain, currentSentence: sentenceLeaf })
}

function recordAttempt(db: DB, user: UUID, chain: UUID, symbol: UUID, outcome: "correct" | "possible" | "wrong"): void {
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
  const sentence = await generateSentence()
  const built = appendSentence(db, sentence)
  const options = await createOptions(db, user, built.first, built.leaf)
  setState(db, user, built.first, built.leaf)
  return { chain: built.first, options }
}

export const functions = {
  newUser: serverFunction({ name: string }, (db, arg) => {
    const row = { id: randomUUID(), username: arg.name }
    db.insert("User", row)
    return row
  }),

  requestNewChain: serverFunction(
    { user: ref(User) },
    async (db, { user }): Promise<ReturnType<FUNCS["requestNewChain"]>> => newLesson(db, user),
    "Generate a complete sentence, enter its chain, and return five private options.",
  ),

  requestState: serverFunction(
    { user: ref(User) },
    async (db, { user }): Promise<ReturnType<FUNCS["requestState"]>> => {
      const existing = stateFor(db, user)
      if (!existing) return newLesson(db, user)
      enqueueVisibleAnnotations(db, existing.chain, existing.options)
      kickAnnotationWorker(db)
      return { chain: existing.chain, options: existing.options }
    },
    "Return persistent private options or begin a sentence-backed lesson.",
  ),

  tryOption: serverFunction(
    { user: ref(User), option: ref(Symbol) },
    async (db, { user, option }): Promise<ReturnType<FUNCS["tryOption"]>> => {
      const state = stateFor(db, user)
      if (!state) throw new Error("User has no active lesson state")
      const selected = db.where("UserStateOption", "user", user).find(row => row.symbol === option)
      if (!selected) throw new Error("Option is not part of the active lesson")
      if (selected.outcome !== "correct" && selected.outcome !== "possible" && selected.outcome !== "wrong") {
        throw new Error(`Invalid option outcome: ${selected.outcome}`)
      }
      recordAttempt(db, user, state.chain, option, selected.outcome)
      if (selected.outcome !== "correct") return { correct: false, outcome: selected.outcome }
      let nextChain = selected.nextChain ? db.get("Chain", selected.nextChain) : null
      let sentenceLeaf = selected.sentenceLeaf && db.get("Chain", selected.sentenceLeaf) ? selected.sentenceLeaf : null
      if (!nextChain) {
        const selectedCharacter = db.forceGet("Symbol", option).mandarin_character
        const rebuilt = appendSentence(db, await generateSentence(chainText(db, state.chain) + selectedCharacter), state.chain)
        nextChain = db.forceGet("Chain", rebuilt.first)
        sentenceLeaf = rebuilt.leaf
        console.log(JSON.stringify({ scope: "lesson", event: "rebuilt_missing_branch", chain: nextChain.id }))
      }
      if (nextChain.prev !== state.chain) {
        db.set("Chain", { ...nextChain, prev: state.chain })
        console.log(JSON.stringify({ scope: "lesson", event: "repaired_chain_parent", chain: nextChain.id, parent: state.chain }))
      }
      sentenceLeaf ??= nextChain.id
      const nextOptions = await createOptions(db, user, nextChain.id, sentenceLeaf)
      setState(db, user, nextChain.id, sentenceLeaf)
      return { correct: true, outcome: "correct", next_chain: nextChain.id, next_options: nextOptions }
    },
    "Record the attempt and follow the complete sentence associated with a correct option.",
  ),
} satisfies FunctionImplementations & Record<string, ServerFunction<any, any>>

export type ServerFunctions = typeof functions
