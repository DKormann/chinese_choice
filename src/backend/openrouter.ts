import { validate, type Schema } from "../schema"

type Message = {
  role: "system" | "user" | "assistant"
  content: string
}

type ChatResponse = {
  id?: string
  model?: string
  provider?: string
  choices?: { message?: { content?: string } }[]
  error?: { message?: string }
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    cost?: number
  }
}

const endpoint = "https://openrouter.ai/api/v1/chat/completions"

export class OpenRouterContentError extends Error {}
export class OpenRouterRequestError extends Error {
  constructor(message: string, readonly status: number, readonly retryable: boolean) {
    super(message)
  }
}

function resolveModel(model: string): string {
  // OpenRouter exposes the Flash checkpoint with a dated slug, not this tempting alias.
  if (model === "qwen/qwen3.5-flash") return "qwen/qwen3.5-flash-02-23"
  return model
}

function llmLog(requestId: string, event: string, data: Record<string, unknown>): void {
  console.log(JSON.stringify({ scope: "llm", requestId, event, ...data }))
}

export async function openRouterJson<T>(schema: Schema<T>, messages: Message[], model?: string): Promise<T> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured")
  const timeout = Number(process.env.OPENROUTER_TIMEOUT_MS ?? 30_000)
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error("OPENROUTER_TIMEOUT_MS must be a positive number")
  const selectedModel = resolveModel(model ?? process.env.OPENROUTER_MODEL ?? "qwen/qwen3.5-flash-02-23")
  const requestId = crypto.randomUUID()
  const startedAt = performance.now()
  const requestMessages: Message[] = [
    {
      role: "system",
      content: `Return one JSON object matching this schema exactly. Include every required field, even when its value is an empty string. Do not rename fields or add prose. JSON Schema: ${JSON.stringify(schema.json)}`,
    },
    ...messages,
  ]
  llmLog(requestId, "request", {
    model: selectedModel,
    prompt: messages.at(-1)?.content,
  })

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: "POST",
      signal: AbortSignal.timeout(timeout),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-OpenRouter-Title": "Chinese Choice",
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: requestMessages,
        response_format: { type: "json_object" },
        reasoning: { effort: "none", exclude: true },
        max_tokens: 512,
        temperature: 0.7,
      }),
    })
  } catch (error) {
    llmLog(requestId, "network_error", {
      model: selectedModel,
      durationMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    })
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new OpenRouterRequestError(`OpenRouter did not respond within ${Math.round(timeout / 1000)} seconds`, 408, true)
    }
    throw new OpenRouterRequestError(
      `OpenRouter network error: ${error instanceof Error ? error.message : String(error)}`,
      0,
      true,
    )
  }

  const body = await response.json() as ChatResponse
  llmLog(requestId, "response", {
    model: selectedModel,
    status: response.status,
    durationMs: Math.round(performance.now() - startedAt),
    provider: body.provider,
    content: body.choices?.[0]?.message?.content,
    tokens: body.usage?.total_tokens,
    cost: body.usage?.cost,
    error: body.error?.message,
  })
  if (!response.ok) throw new OpenRouterRequestError(
    `OpenRouter request failed: ${body.error?.message ?? response.statusText}`,
    response.status,
    response.status === 408 || response.status === 429 || response.status >= 500,
  )
  const content = body.choices?.[0]?.message?.content
  if (!content) throw new OpenRouterContentError("OpenRouter returned no content")

  try {
    const result = validate(schema, JSON.parse(content))
    return result
  } catch (error) {
    llmLog(requestId, "validation_error", {
      model: selectedModel,
      durationMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
      content,
    })
    throw new OpenRouterContentError(`OpenRouter returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}
