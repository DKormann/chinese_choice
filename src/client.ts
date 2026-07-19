import type { PublicTables, TableRow } from "./sql"
import { functions, tables, type ServerFunctions } from "./tables"
import type { InferParameters } from "./typedFunction"

type TableClient<T extends { id: string }> = {
  all(): Promise<T[]>
  get(id: T["id"]): Promise<T | null>
  where<K extends keyof T>(column: K, value: T[K]): Promise<T[]>
}

type FunctionClient<K extends keyof ServerFunctions> = (
  args: InferParameters<ServerFunctions[K]["parameters"]>,
) => Promise<Awaited<ReturnType<ServerFunctions[K]["runner"]>>>

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(await response.text())
  return response.json() as Promise<T>
}

export function createClient(baseUrl = "") {
  function tableClient<T extends { id: string }>(table: string): TableClient<T> {
    const url = `${baseUrl}/api/db`
    return {
      all: () => fetch(`${url}/all/${table}`).then(responseJson<T[]>),
      get: id => fetch(`${url}/get/${table}/${encodeURIComponent(id)}`).then(responseJson<T | null>),
      where: (column, value) => fetch(`${url}/where/${table}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ column, value }),
      }).then(responseJson<T[]>),
    }
  }

  const funcs = Object.fromEntries(Object.keys(functions).map(name => [name, async (args: unknown) => {
    return fetch(`${baseUrl}/api/db/function/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args }),
    }).then(responseJson)
  }])) as { [K in keyof ServerFunctions]: FunctionClient<K> }

  const publicTables = Object.entries(tables).filter(([, definition]) => definition.access === "public")

  return {
    tables: Object.fromEntries(publicTables.map(([name]) => [name, tableClient(name)])) as {
      [K in keyof PublicTables<typeof tables>]: TableClient<TableRow<PublicTables<typeof tables>[K]>>
    },
    funcs,
  }
}

export type AppClient = ReturnType<typeof createClient>
