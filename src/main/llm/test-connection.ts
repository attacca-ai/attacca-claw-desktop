import { net } from 'electron'

interface TestResult {
  success: boolean
  error?: string
}

export async function testLLMConnection(provider: string, apiKey: string): Promise<TestResult> {
  console.log(`[llm] Testing connection: provider=${provider} key=****${apiKey.slice(-4)}`)
  try {
    switch (provider) {
      case 'anthropic':
        return testAnthropic(apiKey)
      case 'openai':
        return testOpenAI(apiKey)
      case 'google':
        return testGoogle(apiKey)
      default:
        return { success: false, error: `Unknown provider: ${provider}` }
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Connection test failed' }
  }
}

async function testAnthropic(apiKey: string): Promise<TestResult> {
  const response = await net.fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'Hi' }]
    })
  })

  if (response.ok) return { success: true }

  if (response.status === 401) {
    return {
      success: false,
      error: "This key doesn't seem to work — double-check that you copied it correctly"
    }
  }
  if (response.status === 403) {
    return {
      success: false,
      error: 'Your API key does not have permission. Check your Anthropic account.'
    }
  }

  return { success: false, error: `Anthropic API returned status ${response.status}` }
}

async function testOpenAI(apiKey: string): Promise<TestResult> {
  const response = await net.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'Hi' }]
    })
  })

  if (response.ok) return { success: true }

  if (response.status === 401) {
    return {
      success: false,
      error: "This key doesn't seem to work — double-check that you copied it correctly"
    }
  }

  return { success: false, error: `OpenAI API returned status ${response.status}` }
}

async function testGoogle(apiKey: string): Promise<TestResult> {
  const response = await net.fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Hi' }] }],
        generationConfig: { maxOutputTokens: 1 }
      })
    }
  )

  if (response.ok) return { success: true }

  if (response.status === 400 || response.status === 403) {
    return {
      success: false,
      error: "This key doesn't seem to work — double-check that you copied it correctly"
    }
  }

  return { success: false, error: `Google API returned status ${response.status}` }
}
