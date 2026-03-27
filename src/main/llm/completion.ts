import { net } from 'electron'
import { readConfig } from '../gateway/config'

interface LLMCompletionRequest {
  messages: Array<{ role: string; content: string }>
  model?: string
  max_tokens?: number
}

interface LLMCompletionResponse {
  id: string
  model: string
  content: string
  usage: { input_tokens: number; output_tokens: number }
  provider: string
}

/**
 * Calls the LLM provider directly using the user's BYOK key.
 * Replaces the relay's /llm/completions proxy.
 */
export async function llmCompletion(request: LLMCompletionRequest): Promise<LLMCompletionResponse> {
  const config = readConfig()
  if (!config.llm?.apiKey) {
    throw new Error('No LLM API key configured. Add one in Settings.')
  }

  const provider = config.llm.provider
  const apiKey = config.llm.apiKey

  console.log(
    `[llm] Completion request: provider=${provider} model=${request.model || 'default'} messages=${request.messages.length}`
  )

  let result: LLMCompletionResponse
  if (provider === 'anthropic') {
    result = await callAnthropic(request, apiKey)
  } else if (provider === 'openai') {
    result = await callOpenAI(request, apiKey)
  } else if (provider === 'google') {
    result = await callGoogle(request, apiKey)
  } else {
    throw new Error(`Unknown LLM provider: ${provider}`)
  }

  console.log(
    `[llm] Response: model=${result.model} input=${result.usage.input_tokens} output=${result.usage.output_tokens}`
  )
  return result
}

async function callAnthropic(
  request: LLMCompletionRequest,
  apiKey: string
): Promise<LLMCompletionResponse> {
  const model = request.model || 'claude-sonnet-4-6'
  const resp = await net.fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: request.max_tokens || 4096,
      messages: request.messages
    })
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Anthropic API error ${resp.status}: ${err.slice(0, 200)}`)
  }

  const data = (await resp.json()) as {
    id: string
    model: string
    content: Array<{ type: string; text: string }>
    usage: { input_tokens: number; output_tokens: number }
  }

  return {
    id: data.id,
    model: data.model,
    content: data.content.map((c) => c.text).join(''),
    usage: data.usage,
    provider: 'anthropic'
  }
}

async function callOpenAI(
  request: LLMCompletionRequest,
  apiKey: string
): Promise<LLMCompletionResponse> {
  const model = request.model || 'gpt-4o'
  const resp = await net.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      max_tokens: request.max_tokens || 4096,
      messages: request.messages
    })
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`OpenAI API error ${resp.status}: ${err.slice(0, 200)}`)
  }

  const data = (await resp.json()) as {
    id: string
    model: string
    choices: Array<{ message: { content: string } }>
    usage: { prompt_tokens: number; completion_tokens: number }
  }

  return {
    id: data.id,
    model: data.model,
    content: data.choices[0]?.message?.content ?? '',
    usage: {
      input_tokens: data.usage.prompt_tokens,
      output_tokens: data.usage.completion_tokens
    },
    provider: 'openai'
  }
}

async function callGoogle(
  request: LLMCompletionRequest,
  apiKey: string
): Promise<LLMCompletionResponse> {
  const model = request.model || 'gemini-2.0-flash'
  const resp = await net.fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: request.messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        })),
        generationConfig: { maxOutputTokens: request.max_tokens || 4096 }
      })
    }
  )

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Google API error ${resp.status}: ${err.slice(0, 200)}`)
  }

  const data = (await resp.json()) as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>
    usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number }
  }

  return {
    id: `google-${Date.now()}`,
    model,
    content: data.candidates[0]?.content?.parts?.map((p) => p.text).join('') ?? '',
    usage: {
      input_tokens: data.usageMetadata?.promptTokenCount ?? 0,
      output_tokens: data.usageMetadata?.candidatesTokenCount ?? 0
    },
    provider: 'google'
  }
}
