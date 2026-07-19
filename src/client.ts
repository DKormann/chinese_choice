import type { TableRow } from "./sql"
import { serverFunctions, tables, type ServerFunctions } from "./tables"
import type { Infer } from "./schema"
import type { InferParameters } from "./typedFunction"

type TableClient<T> = {
  list(): Promise<T[]>
  get(id: string): Promise<T | null>
  where<K extends keyof T>(column: K, value: T[K]): Promise<T[]>
}

type FunctionClient<K extends keyof ServerFunctions> = (
  args: InferParameters<ServerFunctions[K]["parameters"]>,
) => Promise<Infer<ServerFunctions[K]["result"]>>

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(await response.text())
  return response.json() as Promise<T>
}

export function createClient(baseUrl = "") {
  function tableClient<T>(table: string): TableClient<T> {
    const url = `${baseUrl}/api/db`
    return {
      list: () => fetch(`${url}/list/${table}`).then(responseJson<T[]>),
      get: id => fetch(`${url}/get/${table}/${encodeURIComponent(id)}`).then(responseJson<T | null>),
      where: (column, value) => fetch(`${url}/where/${table}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ column, value }),
      }).then(responseJson<T[]>),
    }
  }

  const funcs = Object.fromEntries(Object.keys(serverFunctions).map(name => [name, async (args: unknown) => {
    return fetch(`${baseUrl}/api/db/function/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args }),
    }).then(responseJson)
  }])) as { [K in keyof ServerFunctions]: FunctionClient<K> }

  return {
    tables: Object.fromEntries(Object.keys(tables).map(name => [name, tableClient(name)])) as {
      [K in keyof typeof tables]: TableClient<TableRow<typeof tables[K]>>
    },
    funcs,
  }
}

export type AppClient = ReturnType<typeof createClient>
