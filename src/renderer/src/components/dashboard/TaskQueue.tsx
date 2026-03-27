import { useState } from 'react'
import { useAgentStore } from '@/stores/agent-store'
import { gatewayClient } from '@/lib/gateway-client'
import { useGatewayStore } from '@/stores/gateway-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ListTodo, Plus, Loader2, Clock } from 'lucide-react'

export function TaskQueue(): React.JSX.Element {
  const { currentTask, taskQueue, addTask, isProcessing } = useAgentStore()
  const connectionState = useGatewayStore((s) => s.connectionState)
  const [newTaskInput, setNewTaskInput] = useState('')
  const [adding, setAdding] = useState(false)
  const [showInput, setShowInput] = useState(false)

  const handleAddTask = async (): Promise<void> => {
    if (!newTaskInput.trim()) return

    const prompt = newTaskInput.trim()
    setAdding(true)
    addTask(prompt)

    // If connected, send to gateway
    if (connectionState === 'connected') {
      console.log('[task] Sending chat.send to gateway:', prompt)
      try {
        await gatewayClient.rpc('chat.send', {
          sessionKey: 'agent:main:main',
          message: prompt,
          idempotencyKey: crypto.randomUUID()
        })
        console.log('[task] chat.send sent successfully')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[task] chat.send failed:', msg)
        useAgentStore.getState().addActivity({
          type: 'error',
          description: `Failed to send task to agent: ${msg}`
        })
      }
    } else {
      console.warn(
        '[task] Gateway not connected (state:',
        connectionState,
        ') — task queued locally'
      )
      useAgentStore.getState().addActivity({
        type: 'error',
        description: `Agent not connected — task queued but not sent (gateway state: ${connectionState})`
      })
    }

    setNewTaskInput('')
    setShowInput(false)
    setAdding(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') handleAddTask()
    if (e.key === 'Escape') {
      setShowInput(false)
      setNewTaskInput('')
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ListTodo className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Task Queue</h3>
          <span className="text-xs text-muted-foreground">
            ({(currentTask ? 1 : 0) + taskQueue.length})
          </span>
        </div>
        <Button variant="ghost" size="icon-xs" onClick={() => setShowInput(true)} title="Add task">
          <Plus className="h-3 w-3" />
        </Button>
      </div>

      {/* Add task input */}
      {showInput && (
        <div className="mb-3 flex gap-2">
          <Input
            value={newTaskInput}
            onChange={(e) => setNewTaskInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe what you need done..."
            className="text-sm"
            autoFocus
          />
          <Button size="sm" onClick={handleAddTask} disabled={adding || !newTaskInput.trim()}>
            {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Add'}
          </Button>
        </div>
      )}

      {/* Task list */}
      <div className="flex flex-1 flex-col gap-1 overflow-auto">
        {/* Current task */}
        {currentTask && (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-2">
            <div className="flex items-center gap-2">
              {isProcessing ? (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
              ) : (
                <Clock className="h-3 w-3 shrink-0 text-primary" />
              )}
              <span className="flex-1 text-xs font-medium text-foreground">
                {currentTask.description}
              </span>
              <Badge variant="default" className="text-[10px]">
                Active
              </Badge>
            </div>
          </div>
        )}

        {/* Pending tasks */}
        {taskQueue.map((task, i) => (
          <div key={task.id} className="rounded-md border border-border p-2">
            <div className="flex items-center gap-2">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] text-muted-foreground">
                {i + 1}
              </span>
              <span className="flex-1 text-xs text-muted-foreground">{task.description}</span>
              <Badge variant="outline" className="text-[10px]">
                Pending
              </Badge>
            </div>
          </div>
        ))}

        {/* Empty state */}
        {!currentTask && taskQueue.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm text-muted-foreground">No tasks in queue.</p>
            <Button variant="outline" size="sm" onClick={() => setShowInput(true)}>
              <Plus className="h-3 w-3" />
              Add a task
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
