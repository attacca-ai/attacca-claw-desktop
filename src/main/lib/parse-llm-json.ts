/**
 * Extract and parse JSON from an LLM response that may contain markdown code fences.
 * Finds the first { and last } to extract the JSON object.
 */
export function parseLlmJson<T>(raw: string): T {
  // Strip markdown code fences if present
  let cleaned = raw
    .replace(/```json?\n?/g, '')
    .replace(/```/g, '')
    .trim()

  // Extract JSON object between first { and last }
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1)
  }

  return JSON.parse(cleaned) as T
}
