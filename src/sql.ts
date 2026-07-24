import type Database from "bun:sqlite"
import { boolean, fromJsonSchema, number, validate, type Infer, type Schema } from "./schema"

declare const uuidBrand: unique symbol
export type UUID = string & { readonly [uuidBrand]: true }
export const UUID: Schema<UUID> = fromJsonSchema({ type: "string", format: "uuid" })

export function asUUID(value: string): UUID {
  return validate(UUID, value)
}

export function randomUUID(): UUID {
  return asUUID(crypto.randomUUID())
}

function sqlType(schema: Schema<any>): "TEXT" | "REAL" | "INTEGER" {
  if (schema === number) return "REAL"
  if (schema === boolean) return "INTEGER"
  return "TEXT"
}

function encodeValue<T>(schema: Schema<T>, value: T): string | number | null {
  if (value == null) {
    validate(schema, null)
    return null
  }
  if (schema === number) return value as number
  if (schema === boolean) return value ? 1 : 0
  return JSON.stringify(validate(schema, value))
}

export function decodeValue<T>(schema: Schema<T>, value: unknown): T {
  if (value == null) return validate(schema, null)
  if (schema === number) return Number(value) as T
  if (schema === boolean) return Boolean(value) as T
  return validate(schema, JSON.parse(String(value)))
}

export type Columns = Record<string, Schema<any>> & { id: Schema<UUID> }
export type Row<C extends Columns> = { -readonly [K in keyof C]: Infer<C[K]> }
export type InsertRow<C extends Columns> = Partial<Row<C>>

export type ReferentialAction = "cascade" | "restrict" | "set null" | "set default" | "no action"
export type Access = "public" | "private"
type UniqueIndex<C extends Columns> = {
  columns: readonly (keyof C)[]
  whereNull?: keyof C
}
type Reference = {
  target: Table<any, any, any> | "self"
  onDelete?: ReferentialAction
  onUpdate?: ReferentialAction
}

export type Table<
  C extends Columns = Columns,
  I extends readonly (keyof C)[] = readonly (keyof C)[],
  A extends Access = Access,
> = {
  access: A
  columns: C
  indexes: I
  uniqueIndexes: readonly UniqueIndex<C>[]
}

type ColumnsWithId<C extends Record<string, Schema<any>>> = { readonly id: typeof UUID } & C

export function table<
  const C extends Record<string, Schema<any>>,
  const I extends readonly (keyof ColumnsWithId<C>)[] = readonly [],
  const A extends Access = "public",
>(
  columns: C extends { id: unknown } ? never : C,
  options: {
    access?: A
    indexes?: I
    uniqueIndexes?: readonly UniqueIndex<ColumnsWithId<C>>[]
  } = {},
): Table<ColumnsWithId<C>, I, A> {
  return {
    access: options.access ?? "public" as A,
    columns: { id: UUID, ...columns },
    indexes: options.indexes ?? [] as unknown as I,
    uniqueIndexes: options.uniqueIndexes ?? [],
  }
}

export type Tables = Record<string, Table<any, any, any>>
export type PublicTables<T> = { [K in keyof T as T[K] extends { access: "public" } ? K : never]: T[K] }
export type TableRow<T> = T extends Table<infer C, any, any> ? Row<C> : never
export type TableInsert<T> = T extends Table<infer C, any, any> ? InsertRow<C> : never
export type TableColumns<T> = T extends Table<infer C, any, any> ? C : never

const schemaReferences = new WeakMap<Schema<any>, Reference>()

type RefOptions = {
  nullable?: boolean
  onDelete?: ReferentialAction
  onUpdate?: ReferentialAction
}

export function ref<T extends Table<any, any, any>>(
  target: T,
  options?: RefOptions & { nullable?: false },
): TableColumns<T>["id"]
export function ref<T extends Table<any, any, any>>(
  target: T,
  options: RefOptions & { nullable: true },
): Schema<Infer<TableColumns<T>["id"]> | null>
export function ref<T extends Table<any, any, any>>(target: T, options: RefOptions = {}): Schema<any> {
  const idSchema = target.columns.id
  const schema: Schema<any> = options.nullable
    ? { json: { anyOf: [{ type: "null" }, idSchema.json] } }
    : { json: idSchema.json }
  schemaReferences.set(schema, { target, onDelete: options.onDelete, onUpdate: options.onUpdate })
  return schema
}

export function selfRef(options: RefOptions = {}): Schema<UUID | null> | Schema<UUID> {
  const schema: Schema<UUID | null> | Schema<UUID> = options.nullable
    ? { json: { anyOf: [{ type: "null" }, UUID.json] } }
    : { json: UUID.json }
  schemaReferences.set(schema, { target: "self", onDelete: options.onDelete, onUpdate: options.onUpdate })
  return schema
}

function assertIdentifier(value: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`Invalid SQL identifier: ${value}`)
}

function decodeRow<C extends Columns>(columns: C, raw: Record<string, unknown>): Row<C> {
  return Object.fromEntries(
    Object.entries(columns).map(([name, schema]) => [name, decodeValue(schema, raw[name])]),
  ) as Row<C>
}

function referenceClause(table: string, reference: Reference): string {
  assertIdentifier(table)
  const onDelete = reference.onDelete ? ` ON DELETE ${reference.onDelete.toUpperCase()}` : ""
  const onUpdate = reference.onUpdate ? ` ON UPDATE ${reference.onUpdate.toUpperCase()}` : ""
  return ` REFERENCES ${table} (id)${onDelete}${onUpdate}`
}

export function createDB<const T extends Tables>(tables: T, sqlite: Database) {
  sqlite.exec("PRAGMA foreign_keys = ON")
  const tableNames = new Map(Object.entries(tables).map(([name, definition]) => [definition, name]))

  for (const [tableName, definition] of Object.entries(tables)) {
    assertIdentifier(tableName)
    const columns = (Object.entries(definition.columns) as [string, Schema<any>][]).map(([name, schema]) => {
      assertIdentifier(name)
      const reference = schemaReferences.get(schema)
      if (reference) {
        const target = reference.target === "self" ? definition : reference.target
        const targetName = reference.target === "self" ? tableName : tableNames.get(target)
        if (!targetName) throw new Error(`Foreign key target for ${tableName}.${name} is not registered in this database`)
        const targetSchema = target.columns.id as Schema<any>
        if (sqlType(schema) !== sqlType(targetSchema)) {
          throw new Error(`Foreign key types do not match: ${tableName}.${name} -> ${targetName}.id`)
        }
        return `${name} ${sqlType(schema)}${name === "id" ? " PRIMARY KEY" : ""}${referenceClause(targetName, reference)}`
      }
      return `${name} ${sqlType(schema)}${name === "id" ? " PRIMARY KEY" : ""}`
    })
    sqlite.exec(`CREATE TABLE IF NOT EXISTS ${tableName} (${columns.join(", ")})`)

    const existingColumns = new Set(
      (sqlite.query(`PRAGMA table_info(${tableName})`).all() as { name: unknown }[])
        .map(row => String(row.name)),
    )
    for (const [name, schema] of Object.entries(definition.columns) as [string, Schema<any>][]) {
      if (!existingColumns.has(name)) sqlite.exec(`ALTER TABLE ${tableName} ADD COLUMN ${name} ${sqlType(schema)}`)
    }

    for (const index of definition.indexes) {
      assertIdentifier(String(index))
      sqlite.exec(`CREATE INDEX IF NOT EXISTS ${tableName}_${String(index)}_idx ON ${tableName} (${String(index)})`)
    }
    for (const index of definition.uniqueIndexes) {
      for (const column of index.columns) assertIdentifier(String(column))
      if (index.whereNull) assertIdentifier(String(index.whereNull))
      const columns = index.columns.map(String)
      const suffix = index.whereNull ? `_where_${String(index.whereNull)}_null` : ""
      const name = `${tableName}_${columns.join("_")}${suffix}_unique_idx`
      const where = index.whereNull ? ` WHERE ${String(index.whereNull)} IS NULL` : ""
      sqlite.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${name} ON ${tableName} (${columns.join(", ")})${where}`)
    }
  }

  function definition<K extends keyof T>(tableName: K): T[K] {
    const result = tables[tableName]
    if (!result) throw new Error(`Unknown table: ${String(tableName)}`)
    return result
  }

  const db = {
    assertReferences(schemas: Record<string, Schema<any>>, values: Record<string, unknown>): void {
      for (const [name, schema] of Object.entries(schemas)) {
        const reference = schemaReferences.get(schema)
        const value = values[name]
        if (!reference || value == null) continue
        if (reference.target === "self") throw new Error(`Self-reference is not valid for function parameter ${name}`)
        const targetName = tableNames.get(reference.target)
        if (!targetName) throw new Error(`Reference target for parameter ${name} is not registered in this database`)
        const encodedId = encodeValue(reference.target.columns.id, value as UUID)
        const exists = sqlite.query(`SELECT 1 FROM ${targetName} WHERE id = ?`).get(encodedId)
        if (!exists) throw new Error(`Referenced ${targetName} row does not exist: ${String(value)}`)
      }
    },

    transaction<R>(runner: () => R): R {
      return sqlite.transaction(runner)()
    },

    all<K extends keyof T>(tableName: K): TableRow<T[K]>[] {
      const current = definition(tableName)
      const rows = sqlite.query(`SELECT * FROM ${String(tableName)}`).all() as Record<string, unknown>[]
      return rows.map(row => decodeRow(current.columns, row)) as TableRow<T[K]>[]
    },

    get<K extends keyof T>(tableName: K, id: TableRow<T[K]>["id"]): TableRow<T[K]> | null {
      const current = definition(tableName)
      const row = sqlite.query(`SELECT * FROM ${String(tableName)} WHERE id = ?`)
        .get(encodeValue(current.columns.id, id)) as Record<string, unknown> | null
      return row ? decodeRow(current.columns, row) as TableRow<T[K]> : null
    },

    forceGet<K extends keyof T>(tableName: K, id: TableRow<T[K]>["id"]): TableRow<T[K]> {
      const row = db.get(tableName, id)
      if (!row) throw new Error(`Row with id ${id} not found in table ${String(tableName)}`)
      return row
    },

    where<K extends keyof T, C extends keyof TableColumns<T[K]>>(
      tableName: K,
      column: C,
      value: Infer<TableColumns<T[K]>[C]>,
    ): TableRow<T[K]>[] {
      const current = definition(tableName)
      const schema = current.columns[column as string]
      if (!schema) throw new Error(`Unknown column: ${String(column)}`)
      assertIdentifier(String(column))
      const encoded = encodeValue(schema, value)
      const rows = (encoded === null
        ? sqlite.query(`SELECT * FROM ${String(tableName)} WHERE ${String(column)} IS NULL`).all()
        : sqlite.query(`SELECT * FROM ${String(tableName)} WHERE ${String(column)} = ?`).all(encoded)
      ) as Record<string, unknown>[]
      return rows.map(row => decodeRow(current.columns, row)) as TableRow<T[K]>[]
    },

    set<K extends keyof T>(tableName: K, row: TableRow<T[K]>): TableRow<T[K]>["id"] {
      const current = definition(tableName)
      const names = Object.keys(current.columns)
      const values = names.map(name => encodeValue(current.columns[name]!, row[name] as never))
      const updates = names.filter(name => name !== "id").map(name => `${name} = excluded.${name}`).join(", ")
      const conflict = updates ? `DO UPDATE SET ${updates}` : "DO NOTHING"
      sqlite.query(`INSERT INTO ${String(tableName)} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")}) ON CONFLICT(id) ${conflict}`).run(...values)
      return row.id as TableRow<T[K]>["id"]
    },

    insert<K extends keyof T>(tableName: K, row: TableInsert<T[K]>): void {
      const current = definition(tableName)
      const names = Object.keys(row)
      if (names.length === 0) throw new Error("Cannot insert an empty row")
      const values = names.map(name => {
        const schema = current.columns[name]
        if (!schema) throw new Error(`Unknown column: ${name}`)
        return encodeValue(schema, row[name] as never)
      })
      sqlite.query(`INSERT INTO ${String(tableName)} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`).run(...values)
    },

    delete<K extends keyof T>(tableName: K, id: TableRow<T[K]>["id"]): void {
      const current = definition(tableName)
      sqlite.query(`DELETE FROM ${String(tableName)} WHERE id = ?`).run(encodeValue(current.columns.id, id))
    },
  }

  return db
}
