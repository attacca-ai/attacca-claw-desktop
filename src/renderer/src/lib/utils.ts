import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * Extract the first text block from an Anthropic message content array.
 * With interleaved-thinking enabled, content[0] may be a thinking block;
 * this safely finds the actual text block.
 */
export function extractMessageText(
  message: { content?: Array<{ type?: string; text?: string }> } | null | undefined
): string {
  if (!message?.content) return ''
  const block = message.content.find((b) => b.type === 'text' || (!b.type && b.text))
  return block?.text ?? ''
}
