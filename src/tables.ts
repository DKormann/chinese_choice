import { randomUUID, ref, selfRef, table, UUID } from "./sql"
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
    async (_db, _args): Promise<ReturnType<FUNCS["requestNewChain"]>> => ({
      chain: randomUUID(),
      options: [randomUUID(), randomUUID(), randomUUID()],
    }),
    "Return a dummy new chain and options.",
  ),

  requestState: serverFunction(
    { user: ref(User) },
    async (_db, _args): Promise<ReturnType<FUNCS["requestState"]>> => ({
      chain: randomUUID(),
      options: [randomUUID(), randomUUID(), randomUUID()],
    }),
    "Return a dummy current state.",
  ),

  tryOption: serverFunction(
    { user: ref(User), option: ref(Symbol) },
    async (_db, _args): Promise<ReturnType<FUNCS["tryOption"]>> => ({
      correct: true,
      next_chain: randomUUID(),
      next_options: [randomUUID(), randomUUID(), randomUUID()],
    }),
    "Return a dummy successful option attempt.",
  ),
}



export type ServerFunctions = typeof functions
