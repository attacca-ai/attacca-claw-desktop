import { registerTask } from './index'

/**
 * Registers all background tasks at app startup.
 */
export function registerAllTasks(): void {
  registerTask({
    id: 'daily-synthesis',
    name: 'Daily Memory Synthesis',
    description: 'Analyzes recent captures to identify patterns and update identity traits',
    cronExpression: '0 2 * * *', // 2:00 AM daily
    enabled: true,
    requiresIdle: true,
    handler: async () => {
      const { runDailySynthesis } = await import('../memory/synthesizer')
      await runDailySynthesis()
    }
  })

  registerTask({
    id: 'weekly-synthesis',
    name: 'Weekly Deep Synthesis',
    description:
      'Deep analysis of the week — promotes patterns to identity traits, compacts old memories',
    cronExpression: '0 3 * * 0', // 3:00 AM Sunday
    enabled: true,
    requiresIdle: true,
    handler: async () => {
      const { runWeeklySynthesis } = await import('../memory/synthesizer')
      await runWeeklySynthesis()
    }
  })

  registerTask({
    id: 'importance-decay',
    name: 'Memory Importance Decay',
    description: 'Reduces importance of memories not accessed in 30+ days',
    cronExpression: '0 4 * * 0', // 4:00 AM Sunday (after weekly synthesis)
    enabled: true,
    requiresIdle: false,
    handler: async () => {
      const { runImportanceDecay } = await import('../memory/synthesizer')
      await runImportanceDecay()
    }
  })

  registerTask({
    id: 'embedding-backfill',
    name: 'Embedding Backfill',
    description: 'Generates embeddings for memories that were saved without them',
    cronExpression: '*/30 * * * *', // Every 30 minutes
    enabled: true,
    requiresIdle: true,
    handler: async () => {
      const { backfillEmbeddings } = await import('../memory/migrate-embeddings')
      await backfillEmbeddings()
    }
  })

  console.log('[scheduler] Registered 4 tasks')
}
