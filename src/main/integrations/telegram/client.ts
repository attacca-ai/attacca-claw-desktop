import { getConfig, telegramApi } from './connector'

/**
 * Send a text message to the connected user
 */
export async function sendMessage(
  chatId?: number,
  text?: string,
  parseMode: 'Markdown' | 'MarkdownV2' | 'HTML' = 'HTML'
): Promise<unknown> {
  const config = getConfig()
  const targetChatId = chatId || config?.chatId
  if (!targetChatId) throw new Error('Telegram not connected — no chat ID')
  if (!text) throw new Error('Message text is required')

  return telegramApi('sendMessage', {
    chat_id: targetChatId,
    text,
    parse_mode: parseMode,
    disable_web_page_preview: true
  })
}

/**
 * Send end-of-day summary
 */
export async function sendDailySummary(summary: {
  tasksCompleted: Array<{ title: string; status: string }>
  tasksInProgress: Array<{ title: string; progress: string }>
  tasksBlocked: Array<{ title: string; reason: string }>
  tomorrowPriorities: string[]
}): Promise<unknown> {
  let text = '<b>End of Day Summary</b>\n\n'

  if (summary.tasksCompleted.length > 0) {
    text += '<b>Completed:</b>\n'
    for (const t of summary.tasksCompleted) {
      text += `  - ${t.title}\n`
    }
    text += '\n'
  }

  if (summary.tasksInProgress.length > 0) {
    text += '<b>In Progress:</b>\n'
    for (const t of summary.tasksInProgress) {
      text += `  - ${t.title} — ${t.progress}\n`
    }
    text += '\n'
  }

  if (summary.tasksBlocked.length > 0) {
    text += '<b>Blocked:</b>\n'
    for (const t of summary.tasksBlocked) {
      text += `  - ${t.title} — ${t.reason}\n`
    }
    text += '\n'
  }

  if (summary.tomorrowPriorities.length > 0) {
    text += "<b>Tomorrow's Priorities:</b>\n"
    for (const p of summary.tomorrowPriorities) {
      text += `  - ${p}\n`
    }
  }

  return sendMessage(undefined, text, 'HTML')
}

/**
 * Send Take Over mode status update
 */
export async function sendTakeOverUpdate(update: {
  completedSinceLastUpdate: string[]
  newItemsDetected: string[]
  pendingApprovals: string[]
  nextActions: string[]
}): Promise<unknown> {
  let text = '<b>Take Over Mode Update</b>\n\n'

  if (update.completedSinceLastUpdate.length > 0) {
    text += '<b>Done:</b>\n'
    for (const item of update.completedSinceLastUpdate) {
      text += `  - ${item}\n`
    }
    text += '\n'
  }

  if (update.newItemsDetected.length > 0) {
    text += '<b>New items detected:</b>\n'
    for (const item of update.newItemsDetected) {
      text += `  - ${item}\n`
    }
    text += '\n'
  }

  if (update.pendingApprovals.length > 0) {
    text += '<b>Needs your approval (open Attacca):</b>\n'
    for (const item of update.pendingApprovals) {
      text += `  - ${item}\n`
    }
    text += '\n'
  }

  if (update.nextActions.length > 0) {
    text += '<b>Next:</b>\n'
    for (const item of update.nextActions) {
      text += `  - ${item}\n`
    }
  }

  return sendMessage(undefined, text, 'HTML')
}

/**
 * Send an urgent notification
 */
export async function sendUrgentNotification(title: string, body: string): Promise<unknown> {
  const text = `<b>${title}</b>\n\n${body}`
  return sendMessage(undefined, text, 'HTML')
}

/**
 * Check if Telegram is connected and bot can reach the user
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const config = getConfig()
    if (!config) return false
    await telegramApi('getChat', { chat_id: config.chatId })
    return true
  } catch {
    return false
  }
}
