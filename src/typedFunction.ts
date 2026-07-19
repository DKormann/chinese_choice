import type { createDatabase } from "./sql"
import type { Infer, JsonData, Schema } from "./schema"
import type { tables } from "./tables"

export type FunctionParameters = Record<string, Schema<JsonData>>

export type InferParameters<P extends FunctionParameters> = {
  [K in keyof P]: Infer<P[K]>
}

export type ServerFunction<P extends FunctionParameters, R extends JsonData> = {
  description: string
  parameters: P
  result: Schema<R>
  runner: (db: ReturnType<typeof createDatabase<typeof tables>>, args: InferParameters<P>) => Promise<R> | R
}

export function serverFunction<const P extends FunctionParameters, R extends JsonData>(
  parameters: P,
  result: Schema<R>,
  runner: ServerFunction<P, R>["runner"],
  description = "",
): ServerFunction<P, R> {
  return { parameters, result, runner, description }
}
