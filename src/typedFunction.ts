import type { createDB } from "./sql"
import type { Infer, JsonData, Schema } from "./schema"
import type { tables } from "./tables"

export type FunctionParameters = Record<string, Schema<JsonData>>

export type InferParameters<P extends FunctionParameters> = {
  [K in keyof P]: Infer<P[K]>
}

export type ServerFunction<P extends FunctionParameters, R extends JsonData> = {
  description: string
  parameters: P
  runner: (db: ReturnType<typeof createDB<typeof tables>>, args: InferParameters<P>) => Promise<R> | R
}

export function serverFunction<const P extends FunctionParameters, R extends JsonData>(
  parameters: P,
  runner: ServerFunction<P, R>["runner"],
  description = "",
): ServerFunction<P, R> {
  return { parameters, runner, description }
}
