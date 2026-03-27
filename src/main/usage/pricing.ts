// Token pricing per 1M tokens (USD)
// Ported from relay-server/src/services/pricing.ts

interface ModelPricing {
  inputPer1M: number
  outputPer1M: number
  cacheWritePer1M: number
  cacheReadPer1M: number
}

const PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-4-6': {
    inputPer1M: 3.0,
    outputPer1M: 15.0,
    cacheWritePer1M: 3.75,
    cacheReadPer1M: 0.3
  },
  'claude-haiku-4-5': {
    inputPer1M: 0.8,
    outputPer1M: 4.0,
    cacheWritePer1M: 1.0,
    cacheReadPer1M: 0.08
  },
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10.0, cacheWritePer1M: 0, cacheReadPer1M: 1.25 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6, cacheWritePer1M: 0, cacheReadPer1M: 0.075 }
}

const DEFAULT_PRICING: ModelPricing = {
  inputPer1M: 3.0,
  outputPer1M: 15.0,
  cacheWritePer1M: 3.75,
  cacheReadPer1M: 0.3
}

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheWriteTokens = 0,
  cacheReadTokens = 0
): number {
  const p = PRICING[model] || DEFAULT_PRICING
  return (
    (inputTokens / 1_000_000) * p.inputPer1M +
    (outputTokens / 1_000_000) * p.outputPer1M +
    (cacheWriteTokens / 1_000_000) * p.cacheWritePer1M +
    (cacheReadTokens / 1_000_000) * p.cacheReadPer1M
  )
}

export function getModelPricing(model: string): ModelPricing {
  return PRICING[model] || DEFAULT_PRICING
}
