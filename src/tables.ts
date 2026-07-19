import { randomUUID, ref, selfRef, table } from "./sql"
import { number, object, string } from "./schema"
import { serverFunction } from "./typedFunction"

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

export const User = table({})

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
  })
}

export const SymbolRow = object(Symbol.columns)
export const ChainRow = object(Chain.columns)
export const KnowledgeRow = object(Knowledge.columns)

export type AppTables = typeof tables

export const functions = {
  addSymbol: serverFunction(
    { mandarin_character: string, pinyin: string, meaning: string },
    SymbolRow,
    async (db, values) => {
      const symbol = { id: randomUUID(), ...values }
      db.set("Symbol", symbol)
      return symbol
    },
    "Add a Mandarin symbol.",
  ),
}

export type ServerFunctions = typeof functions
