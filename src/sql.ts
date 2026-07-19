import type Database from "bun:sqlite"

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export type Codec<T> = {
  sqlType: "TEXT" | "REAL" | "INTEGER"
  encode(value: T): string | number
  decode(value: unknown): T
}

export const text: Codec<string> = {
  sqlType: "TEXT",
  encode: value => value,
  decode: value => String(value),
}

export const number: Codec<number> = {
  sqlType: "REAL",
  encode: value => value,
  decode: value => Number(value),
}

export const boolean: Codec<boolean> = {
  sqlType: "INTEGER",
  encode: value => value ? 1 : 0,
  decode: value => Boolean(value),
}

export function json<T extends JsonValue>(): Codec<T> {
  return {
    sqlType: "TEXT",
    encode: value => JSON.stringify(value),
    decode: value => JSON.parse(String(value)) as T,
  }
}

export type Columns = Record<string, Codec<unknown>> & { id: Codec<string> }
export type Row<C extends Columns> = { [K in keyof C]: C[K] extends Codec<infer T> ? T : never }

export type Table<C extends Columns = Columns> = {
  columns: C
  indexes: readonly (keyof C)[]
}

export function table<const C extends Columns>(
  columns: C,
  options: { indexes?: readonly (keyof C)[] } = {},
): Table<C> {
  return { columns, indexes: options.indexes ?? [] }
}

export type Tables = Record<string, Table<any>>
export type TableRow<T extends Table<any>> = Row<T["columns"]>

function assertIdentifier(value: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`Invalid SQL identifier: ${value}`)
}

export function createDatabase<const T extends Tables>(tables: T, sqlite: Database) {
  for (const [tableName, definition] of Object.entries(tables)) {
    assertIdentifier(tableName)
    const columns = (Object.entries(definition.columns) as [string, Codec<unknown>][]).map(([name, codec]) => {
      assertIdentifier(name)
      return `${name} ${codec.sqlType}${name === "id" ? " PRIMARY KEY" : ""}`
    })
    sqlite.exec(`CREATE TABLE IF NOT EXISTS ${tableName} (${columns.join(", ")})`)

    for (const index of definition.indexes) {
      assertIdentifier(String(index))
      sqlite.exec(`CREATE INDEX IF NOT EXISTS ${tableName}_${String(index)}_idx ON ${tableName} (${String(index)})`)
    }
  }

  function definition<K extends keyof T>(tableName: K): T[K] {
    const result = tables[tableName]
    if (!result) throw new Error(`Unknown table: ${String(tableName)}`)
    return result
  }

  function decode<C extends Columns>(columns: C, raw: Record<string, unknown>): Row<C> {
    return Object.fromEntries(Object.entries(columns).map(([name, codec]) => [name, codec.decode(raw[name])])) as Row<C>
  }

  return {
    list<K extends keyof T>(tableName: K): TableRow<T[K]>[] {
      const current = definition(tableName)
      const rows = sqlite.query(`SELECT * FROM ${String(tableName)}`).all() as Record<string, unknown>[]
      return rows.map(row => decode(current.columns, row)) as TableRow<T[K]>[]
    },

    get<K extends keyof T>(tableName: K, id: string): TableRow<T[K]> | null {
      const current = definition(tableName)
      const row = sqlite.query(`SELECT * FROM ${String(tableName)} WHERE id = ?`).get(current.columns.id.encode(id)) as Record<string, unknown> | null
      return row ? decode(current.columns, row) as TableRow<T[K]> : null
    },

    where<K extends keyof T>(tableName: K, column: keyof T[K]["columns"], value: unknown): TableRow<T[K]>[] {
      const current = definition(tableName)
      const codec = current.columns[String(column)]
      if (!codec) throw new Error(`Unknown column: ${String(column)}`)
      const rows = sqlite.query(`SELECT * FROM ${String(tableName)} WHERE ${String(column)} = ?`).all(codec.encode(value)) as Record<string, unknown>[]
      return rows.map(row => decode(current.columns, row)) as TableRow<T[K]>[]
    },

    set<K extends keyof T>(tableName: K, row: TableRow<T[K]>): void {
      const current = definition(tableName)
      const names = Object.keys(current.columns)
      const values = names.map(name => current.columns[name]!.encode(row[name] as never))
      sqlite.query(`INSERT OR REPLACE INTO ${String(tableName)} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`).run(...values)
    },

    delete<K extends keyof T>(tableName: K, id: string): void {
      const current = definition(tableName)
      sqlite.query(`DELETE FROM ${String(tableName)} WHERE id = ?`).run(current.columns.id.encode(id))
    },
  }
}
