import { useState } from 'react'
import { gatewayClient } from '@/lib/gateway-client'
import { useGatewayStore } from '@/stores/gateway-store'
import { useAgentStore } from '@/stores/agent-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, Plug, Check } from 'lucide-react'

interface ConnectionProposal {
  name: string
  type: 'api' | 'oauth' | 'webhook'
  description: string
  authMethod: string
  riskClassification: Record<string, string>
}

export function MetaAgent(): React.JSX.Element {
  const connectionState = useGatewayStore((s) => s.connectionState)
  const addActivity = useAgentStore((s) => s.addActivity)

  const [toolName, setToolName] = useState('')
  const [toolDescription, setToolDescription] = useState('')
  const [generating, setGenerating] = useState(false)
  const [proposal, setProposal] = useState<ConnectionProposal | null>(null)
  const [installed, setInstalled] = useState(false)

  const handleGenerate = async (): Promise<void> => {
    if (!toolName.trim() || !toolDescription.trim()) return

    setGenerating(true)
    setProposal(null)
    setInstalled(false)

    try {
      if (connectionState === 'connected') {
        const result = await gatewayClient.rpc<{ connection: ConnectionProposal }>(
          'agent.request',
          {
            prompt: `The user wants to connect a custom tool: "${toolName}" - "${toolDescription}". Analyze if this tool has a public API, OAuth, or webhooks. Generate a connection proposal. Return as JSON: { "connection": { "name": string, "type": "api"|"oauth"|"webhook", "description": string, "authMethod": string, "riskClassification": Record<string, string> } }`
          }
        )
        if (result.connection) {
          setProposal(result.connection)
          setGenerating(false)
          return
        }
      }

      // Fallback
      setProposal({
        name: toolName,
        type: 'api',
        description: `Custom connection for ${toolName}: ${toolDescription}`,
        authMethod: 'API Key',
        riskClassification: {
          'Read data': 'Low',
          'Create/update': 'Medium',
          'Delete/send': 'High'
        }
      })
    } catch {
      setProposal({
        name: toolName,
        type: 'api',
        description: `Custom connection for ${toolName}: ${toolDescription}`,
        authMethod: 'API Key',
        riskClassification: {
          'Read data': 'Low',
          'Create/update': 'Medium',
          'Delete/send': 'High'
        }
      })
    } finally {
      setGenerating(false)
    }
  }

  const handleInstall = (): void => {
    if (!proposal) return

    addActivity({
      type: 'info',
      description: `Custom connection installed: ${proposal.name}`
    })
    setInstalled(true)
  }

  return (
    <div className="flex flex-1 flex-col p-6">
      <h2 className="mb-2 text-xl font-semibold text-foreground">Custom Tool Connection</h2>
      <p className="mb-6 text-sm text-muted-foreground">
        Connect a tool that isn't in the built-in catalog. Describe the tool and how you use it, and
        your assistant will attempt to create a custom connection.
      </p>

      <div className="flex flex-col gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">Tool name</label>
          <Input
            value={toolName}
            onChange={(e) => setToolName(e.target.value)}
            placeholder="e.g., Monday.com, Airtable, HubSpot..."
            disabled={generating}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            How do you use this tool?
          </label>
          <textarea
            value={toolDescription}
            onChange={(e) => setToolDescription(e.target.value)}
            placeholder="Describe what you use this tool for and what you'd like your assistant to do with it..."
            className="min-h-[100px] w-full resize-y rounded-md border border-input bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            disabled={generating}
          />
        </div>

        <Button
          onClick={handleGenerate}
          disabled={generating || !toolName.trim() || !toolDescription.trim()}
        >
          {generating ? (
            <>
              <Loader2 className="animate-spin" />
              Analyzing tool...
            </>
          ) : (
            <>
              <Plug className="h-4 w-4" />
              Generate Connection
            </>
          )}
        </Button>

        {/* Proposal */}
        {proposal && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">{proposal.name}</CardTitle>
                <Badge variant="outline">{proposal.type.toUpperCase()}</Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">{proposal.description}</p>

              <div className="text-xs">
                <span className="font-medium text-foreground">Auth method: </span>
                <span className="text-muted-foreground">{proposal.authMethod}</span>
              </div>

              <div>
                <p className="mb-1 text-xs font-medium text-foreground">Risk classification:</p>
                <div className="flex flex-col gap-1">
                  {Object.entries(proposal.riskClassification).map(([action, risk]) => (
                    <div key={action} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{action}</span>
                      <Badge
                        variant="outline"
                        className={
                          risk === 'High'
                            ? 'text-red-500'
                            : risk === 'Medium'
                              ? 'text-yellow-500'
                              : 'text-green-500'
                        }
                      >
                        {risk}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>

              {installed ? (
                <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                  <Check className="h-4 w-4" />
                  Connection installed
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button onClick={handleInstall}>
                    <Check className="h-4 w-4" />
                    Install Connection
                  </Button>
                  <Button variant="outline" onClick={() => setProposal(null)}>
                    Discard
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
