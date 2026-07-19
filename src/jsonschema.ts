type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[]

type JSONSchema = { [key: string]: JsonValue }

const typeName = (value: unknown): string => {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  return typeof value
}

const pathLabel = (path: string): string => path || "$"

const fail = (path: string, message: string): never => {
  throw new Error(`Validation error at ${pathLabel(path)}: ${message}`)
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const deepEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => deepEqual(value, right[index]))
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    return leftKeys.length === rightKeys.length
      && leftKeys.every(key => key in right && deepEqual(left[key], right[key]))
  }
  return false
}

const appendPath = (path: string, part: string): string =>
  path ? `${path}${part}` : `$${part}`

const validateObject = (schema: JSONSchema, value: unknown, path: string): void => {
  if (!isPlainObject(value)) fail(path, `expected object, got ${typeName(value)}`)
  const objectValue = value as Record<string, unknown>

  const properties = isPlainObject(schema.properties) ? schema.properties : {}
  const required = Array.isArray(schema.required) ? schema.required : []

  for (const key of required) {
    if (typeof key !== "string") continue
    if (!(key in objectValue)) fail(appendPath(path, `.${key}`), "is required")
  }

  for (const [key, propertySchema] of Object.entries(properties)) {
    if (!(key in objectValue)) continue
    if (!isPlainObject(propertySchema)) continue
    validateJsonSchema(propertySchema as JSONSchema, objectValue[key], appendPath(path, `.${key}`))
  }

  const extraKeys = Object.keys(objectValue).filter(key => !(key in properties))
  const additional = schema.additionalProperties
  if (additional === false) {
    if (extraKeys.length > 0) fail(appendPath(path, `.${extraKeys[0]}`), "additional properties are not allowed")
    return
  }

  if (isPlainObject(additional)) {
    for (const key of extraKeys) {
      validateJsonSchema(additional as JSONSchema, objectValue[key], appendPath(path, `.${key}`))
    }
  }
}

const validateArray = (schema: JSONSchema, value: unknown, path: string): void => {
  if (!Array.isArray(value)) fail(path, `expected array, got ${typeName(value)}`)
  const arrayValue = value as unknown[]
  if (!isPlainObject(schema.items)) return
  arrayValue.forEach((item, index) => validateJsonSchema(schema.items as JSONSchema, item, appendPath(path, `[${index}]`)))
}

const validateByType = (schema: JSONSchema, value: unknown, path: string): void => {
  switch (schema.type) {
    case "string":
      if (typeof value !== "string") fail(path, `expected string, got ${typeName(value)}`)
      return
    case "number":
      if (typeof value !== "number" || Number.isNaN(value)) fail(path, `expected number, got ${typeName(value)}`)
      return
    case "boolean":
      if (typeof value !== "boolean") fail(path, `expected boolean, got ${typeName(value)}`)
      return
    case "null":
      if (value !== null) fail(path, `expected null, got ${typeName(value)}`)
      return
    case "array":
      validateArray(schema, value, path)
      return
    case "object":
      validateObject(schema, value, path)
      return
    case undefined:
      return
    default:
      fail(path, `unsupported schema type ${JSON.stringify(schema.type)}`)
  }
}

export const validateJsonSchema = <T>(schema: JSONSchema, value: unknown, path = ""): T => {
  if ("const" in schema && !deepEqual(value, schema.const)) {
    fail(path, `expected constant ${JSON.stringify(schema.const)}`)
  }

  if (Array.isArray(schema.anyOf)) {
    const errors: string[] = []
    for (const option of schema.anyOf) {
      if (!isPlainObject(option)) continue
      try {
        return validateJsonSchema<T>(option as JSONSchema, value, path)
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }
    fail(path, errors[0] ?? "did not match any allowed schema")
  }

  if (Array.isArray(schema.allOf)) {
    for (const option of schema.allOf) {
      if (!isPlainObject(option)) continue
      validateJsonSchema(option as JSONSchema, value, path)
    }
  }

  validateByType(schema, value, path)
  return value as T
}
