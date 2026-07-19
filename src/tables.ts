import { asUUID, createDB, randomUUID, ref, selfRef, table, UUID } from "./sql"
import { number, object, string } from "./schema"
import { serverFunction, type ServerFunction } from "./typedFunction"

// chinese learning app

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
}, {
  indexes: ["prev", "symbolID"],
})

export const User = table({
  username: string
}, {
  access: "private",
})

export const Knowledge = table({
  symbolID: ref(Symbol, { onDelete: "cascade" }),
  clicked: number,
  correct: number,
  user: ref(User),
}, {
  indexes: ["symbolID"],
})

export const UserState = table({
  user: ref(User),
  currentChain: ref(Chain, { nullable: true }),
})


export const tables = {
  User,
  Symbol,
  Chain,
  Knowledge,
  UserState,
  userStateOption : table({
    user: ref(User),
    symbol: ref(Symbol),
    correct: number,
    position: number,
  }, {
    access: "private",
    indexes: ["user", "symbol"],
  })
}

export const SymbolRow = object(Symbol.columns)
export const ChainRow = object(Chain.columns)
export const KnowledgeRow = object(Knowledge.columns)
export const UserRow = object(User.columns)

export type AppTables = typeof tables



export type FUNCS = {

  requestNewChain : (user: UUID) => {
    chain: UUID
    options: UUID[]
  },

  requestState : (user: UUID) => {
    chain: UUID,
    options: UUID[]
  },

  tryOption : (user: UUID, option: UUID) => {
    correct: true,
    next_chain: UUID
    next_options: UUID[]
  } | {
    correct: false,
  },

}

type FunctionImplementations = {
  [K in keyof FUNCS]: ServerFunction<any, ReturnType<FUNCS[K]>>
}

type DB = ReturnType<typeof createDB<typeof tables>>

const lessonSymbols = [
  ["我", "wǒ", "I"],
  ["想", "xiǎng", "want"],
  ["学", "xué", "to learn"],
  ["中", "zhōng", "Chinese"],
  ["文", "wén", "language"],
  ["喝", "hē", "to drink"],
  ["茶", "chá", "tea"],
  ["你", "nǐ", "you"],
  ["好", "hǎo", "good"],
  ["吗", "ma", "question particle"],
] as const

const symbolIds = lessonSymbols.map((_, index) =>
  asUUID(`10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`),
)

const chainIds = [1, 2, 3, 4].map(index =>
  asUUID(`20000000-0000-4000-8000-${String(index).padStart(12, "0")}`),
)
const fixedOptions = symbolIds.slice(3, 8) as UUID[]

function ensureDummyLesson(db: DB): { chain: UUID; nextChain: UUID } {
  lessonSymbols.forEach(([mandarin_character, pinyin, meaning], index) => {
    const id = symbolIds[index]!
    if (!db.get("Symbol", id)) db.set("Symbol", { id, mandarin_character, pinyin, meaning })
  })
  for (const index of [0, 1, 2, 3]) {
    const symbol = db.forceGet("Symbol", symbolIds[index]!)
    const id = chainIds[index]!
    const prev = index === 0 ? null : chainIds[index - 1]!
    if (!db.get("Chain", id)) db.set("Chain", { id, prev, symbolID: symbol.id, pinyin: symbol.pinyin, meaning: symbol.meaning })
  }
  return { chain: chainIds[2]!, nextChain: chainIds[3]! }
}

export const functions = {

  newUser: serverFunction({name: string}, (db, arg)=>{
    let row = {
      id: randomUUID(),
      username: arg.name
    }
    db.insert("User", row)
    return row
  }),

  requestNewChain: serverFunction(
    { user: ref(User) },
    async (db, _args): Promise<ReturnType<FUNCS["requestNewChain"]>> => {
      const { chain } = ensureDummyLesson(db)
      return { chain, options: fixedOptions }
    },
    "Return a dummy new chain and options.",
  ),

  requestState: serverFunction(
    { user: ref(User) },
    async (db, _args): Promise<ReturnType<FUNCS["requestState"]>> => {
      const { chain } = ensureDummyLesson(db)
      return { chain, options: fixedOptions }
    },
    "Return a dummy current state.",
  ),

  tryOption: serverFunction(
    { user: ref(User), option: ref(Symbol) },
    async (db, { option }): Promise<ReturnType<FUNCS["tryOption"]>> => {
      const { nextChain } = ensureDummyLesson(db)
      if (option !== fixedOptions[0]) return { correct: false }
      return { correct: true, next_chain: nextChain, next_options: fixedOptions }
    },
    "Return a dummy successful option attempt.",
  ),
}



export type ServerFunctions = typeof functions
