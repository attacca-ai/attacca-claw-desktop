import { ipcMain } from 'electron'

export function registerActiveCollabHandlers(): void {
  ipcMain.handle('activecollab:connect-cloud', async (_event, email: string, password: string) => {
    try {
      const { connectCloud } = await import('../integrations/activecollab/connector')
      const config = await connectCloud(email, password)
      return {
        success: true,
        config: { companyName: config.companyName, email: config.email }
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Connection failed'
      }
    }
  })

  ipcMain.handle(
    'activecollab:connect-selfhosted',
    async (_event, url: string, email: string, password: string) => {
      try {
        const { connectSelfHosted } = await import('../integrations/activecollab/connector')
        const config = await connectSelfHosted(url, email, password)
        return {
          success: true,
          config: { instanceUrl: config.instanceUrl, email: config.email }
        }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Connection failed'
        }
      }
    }
  )

  ipcMain.handle('activecollab:status', async () => {
    try {
      const { isConnected, getConfig } = await import('../integrations/activecollab/connector')
      const connected = isConnected()
      const config = getConfig()
      return {
        connected,
        config: config
          ? {
              companyName: config.companyName,
              email: config.email,
              isCloud: config.isCloud
            }
          : null
      }
    } catch {
      return { connected: false, config: null }
    }
  })

  ipcMain.handle('activecollab:disconnect', async () => {
    try {
      const { disconnect } = await import('../integrations/activecollab/connector')
      disconnect()
      return { success: true }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Disconnect failed'
      }
    }
  })
}
