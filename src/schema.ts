export type JSONSchema = { [key: string]: JsonData }


export type JsonData = string | null | number | boolean | { [key: string]: JsonData } | JsonData[]

export type Schema<T> = { json: JSONSchema }

export type Infer<S> = S extends Schema<infer T> ? T : never

function check(schema: JSONSchema, value: unknown, path = "$"): void {
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value
  const fail = (message: string): never => { throw new Error(`Validation error at ${path}: ${message}`) }

  if ("const" in schema && !Object.is(value, schema.const)) fail(`expected constant ${JSON.stringify(schema.const)}`)
  if (Array.isArray(schema.anyOf)) {
    let firstError: unknown
    for (const option of schema.anyOf) {
      try { check(option as JSONSchema, value, path); return }
      catch (error) { firstError ??= error }
    }
    throw firstError ?? new Error(`Validation error at ${path}: did not match any allowed schema`)
  }

  if (schema.type === "string") {
    if (type !== "string") fail(`expected string, got ${type}`)
    if (schema.format === "uuid" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value as string)) fail("expected UUID")
  } else if (schema.type === "number") {
    if (type !== "number" || Number.isNaN(value)) fail(`expected number, got ${type}`)
  } else if (schema.type === "boolean") {
    if (type !== "boolean") fail(`expected boolean, got ${type}`)
  } else if (schema.type === "null") {
    if (value !== null) fail(`expected null, got ${type}`)
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) fail(`expected array, got ${type}`)
    if (schema.items) (value as unknown[]).forEach((item, index) => check(schema.items as JSONSchema, item, `${path}[${index}]`))
  } else if (schema.type === "object") {
    if (type !== "object") fail(`expected object, got ${type}`)
    const record = value as Record<string, unknown>
    const properties = (schema.properties ?? {}) as Record<string, JSONSchema>
    for (const key of (schema.required ?? []) as string[]) {
      if (!(key in record)) throw new Error(`Validation error at ${path}.${key}: is required`)
    }
    for (const [key, property] of Object.entries(properties)) if (key in record) check(property, record[key], `${path}.${key}`)
    if (schema.additionalProperties === false) {
      const extra = Object.keys(record).find(key => !(key in properties))
      if (extra) throw new Error(`Validation error at ${path}.${extra}: additional properties are not allowed`)
    }
  } else if (schema.type !== undefined) fail(`unsupported schema type ${JSON.stringify(schema.type)}`)
}

export const validate = <T>(schema: Schema<T>, data: unknown): T => {
  check(schema.json, data)
  return data as T
}

export const fromJsonSchema = <T> (json: JSONSchema): Schema<T> => ({json})

export const string: Schema<string> = fromJsonSchema({type: "string"})
export const number: Schema<number> = fromJsonSchema({type: "number"})
export const boolean: Schema<boolean> = fromJsonSchema({type: "boolean"})
export const array = <T>(itemSchema: Schema<T>): Schema<T[]> => fromJsonSchema({type: "array", items: itemSchema.json})
export const constant = <T extends string | number | boolean>(value: T): Schema<T> => fromJsonSchema({const: value})

export const object = <S extends Record<string, Schema<any>>> (
  shape: S,
  options: { additionalProperties?: boolean } = {},
): Schema<{[K in keyof S]: Infer<S[K]>}> => fromJsonSchema({
  type: "object",
  properties: Object.fromEntries(Object.entries(shape).map(([key, field])=> [key.endsWith ("?")? key.slice(0,-1) : key , field.json])),
  required: Object.keys(shape).filter(k=>!k.endsWith("?")),
  ...(options.additionalProperties === undefined ? {} : { additionalProperties: options.additionalProperties }),
})

export const union = <S extends Schema<any>[]>(...schemas: S): Schema<Infer<S[number]>> => fromJsonSchema({anyOf: schemas.map(s=> s.json)})


export type Writable <T extends JsonData> = {
  get: ()=>T,
  set: (x:T)=>void,
  subscribe: (f:(x:T)=>void, deferred? :boolean)=>void,
  unsubscribe: (f:(x:T)=>void)=>void,
  update: (f:(x:T)=>T)=>void
}

export function mkWritable <T extends JsonData>(value: T) : Writable<T>{
  let json = JSON.stringify(value)
  let listeners: ((x:T)=>void)[] = []

  function set (x:T){
    let newjson = JSON.stringify(x)
    if (newjson == json) { return }
    listeners.forEach(f=>f(x))
    value = x
    json = newjson
  }
  return {
    get: ()=> value, set,
    subscribe (f:(x:T)=>void, deferred=false) {
      if (!deferred) f(value)
      listeners.push(f)
    },
    unsubscribe (f:(x:T)=>void) {
      listeners = listeners.filter(l=>l!=f)
    },
    update(f:(x:T)=>T){set(f(value))}
  }
}
