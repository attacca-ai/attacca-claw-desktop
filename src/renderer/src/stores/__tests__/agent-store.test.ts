import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useAgentStore } from '../agent-store'
import { installMockApi, cleanupMockApi } from '../../../../../tests/helpers'

describe('agent-store', () => {
  beforeEach(() => {
    installMockApi()
    useAgentStore.setState({
      currentTask: null,
      taskQueue: [],
      activityFeed: [],
      isProcessing: false,
      usageLimitReached: false,
      morningBriefing: null,
      briefingDate: null
    })
  })

  afterEach(() => {
    cleanupMockApi()
  })

  describe('addTask', () => {
    it('creates a task and auto-starts when no current task', () => {
      useAgentStore.getState().addTask('Test task')
      const state = useAgentStore.getState()

      expect(state.currentTask).not.toBeNull()
      expect(state.currentTask!.description).toBe('Test task')
      expect(state.currentTask!.status).toBe('in_progress')
      expect(state.currentTask!.startedAt).toBeDefined()
      expect(state.isProcessing).toBe(true)
    })

    it('queues task when another task is in progress', () => {
      useAgentStore.getState().addTask('First task')
      useAgentStore.getState().addTask('Second task')

      const state = useAgentStore.getState()
      expect(state.currentTask!.description).toBe('First task')
      expect(state.taskQueue).toHaveLength(1)
      expect(state.taskQueue[0].description).toBe('Second task')
      expect(state.taskQueue[0].status).toBe('pending')
    })

    it('generates unique task IDs', () => {
      useAgentStore.getState().addTask('Task 1')
      useAgentStore.getState().addTask('Task 2')

      const state = useAgentStore.getState()
      expect(state.currentTask!.id).not.toBe(state.taskQueue[0].id)
    })

    it('adds activity entry when task is added', () => {
      useAgentStore.getState().addTask('New task')
      const state = useAgentStore.getState()
      const taskActivity = state.activityFeed.find((a) =>
        a.description.includes('Task added: New task')
      )
      expect(taskActivity).toBeDefined()
    })

    it('queues multiple tasks in FIFO order', () => {
      useAgentStore.getState().addTask('First')
      useAgentStore.getState().addTask('Second')
      useAgentStore.getState().addTask('Third')

      const state = useAgentStore.getState()
      expect(state.taskQueue[0].description).toBe('Second')
      expect(state.taskQueue[1].description).toBe('Third')
    })
  })

  describe('completeTask', () => {
    it('marks current task as completed', () => {
      useAgentStore.getState().addTask('Task to complete')
      const taskId = useAgentStore.getState().currentTask!.id
      useAgentStore.getState().completeTask(taskId, 'Done!')

      const state = useAgentStore.getState()
      expect(state.currentTask).toBeNull()
      expect(state.isProcessing).toBe(false)
    })

    it('stores result in activity feed', () => {
      useAgentStore.getState().addTask('Task to complete')
      const taskId = useAgentStore.getState().currentTask!.id
      useAgentStore.getState().completeTask(taskId, 'Done!')

      const state = useAgentStore.getState()
      const completedActivity = state.activityFeed.find((a) =>
        a.description.includes('Task completed')
      )
      expect(completedActivity).toBeDefined()
      expect(completedActivity!.details).toBe('Done!')
    })

    it('auto-advances to next task in queue', () => {
      useAgentStore.getState().addTask('First')
      useAgentStore.getState().addTask('Second')

      const firstId = useAgentStore.getState().currentTask!.id
      useAgentStore.getState().completeTask(firstId)

      const state = useAgentStore.getState()
      expect(state.currentTask).not.toBeNull()
      expect(state.currentTask!.description).toBe('Second')
      expect(state.currentTask!.status).toBe('in_progress')
      expect(state.isProcessing).toBe(true)
      expect(state.taskQueue).toHaveLength(0)
    })

    it('does nothing if taskId does not match current task', () => {
      useAgentStore.getState().addTask('Current task')
      useAgentStore.getState().completeTask('nonexistent_id')

      expect(useAgentStore.getState().currentTask).not.toBeNull()
      expect(useAgentStore.getState().isProcessing).toBe(true)
    })
  })

  describe('failTask', () => {
    it('fails current task and adds error activity', () => {
      useAgentStore.getState().addTask('Task to fail')
      const taskId = useAgentStore.getState().currentTask!.id
      useAgentStore.getState().failTask(taskId, 'Something broke')

      const state = useAgentStore.getState()
      expect(state.currentTask).toBeNull()
      expect(state.isProcessing).toBe(false)
      const errorActivity = state.activityFeed.find(
        (a) => a.type === 'error' && a.description.includes('Task failed')
      )
      expect(errorActivity).toBeDefined()
      expect(errorActivity!.details).toBe('Something broke')
    })

    it('auto-advances queue after failure', () => {
      useAgentStore.getState().addTask('First')
      useAgentStore.getState().addTask('Second')

      const firstId = useAgentStore.getState().currentTask!.id
      useAgentStore.getState().failTask(firstId, 'Error')

      const state = useAgentStore.getState()
      expect(state.currentTask!.description).toBe('Second')
      expect(state.currentTask!.status).toBe('in_progress')
    })

    it('does nothing if taskId does not match', () => {
      useAgentStore.getState().addTask('Current')
      useAgentStore.getState().failTask('wrong_id', 'Error')

      expect(useAgentStore.getState().currentTask).not.toBeNull()
    })
  })

  describe('emergencyStop', () => {
    it('clears currentTask, taskQueue, and sets isProcessing to false', () => {
      useAgentStore.getState().addTask('First')
      useAgentStore.getState().addTask('Second')
      useAgentStore.getState().addTask('Third')

      useAgentStore.getState().emergencyStop()

      const state = useAgentStore.getState()
      expect(state.currentTask).toBeNull()
      expect(state.taskQueue).toHaveLength(0)
      expect(state.isProcessing).toBe(false)
    })

    it('adds emergency stop activity entry', () => {
      useAgentStore.getState().emergencyStop()
      const state = useAgentStore.getState()
      const stopActivity = state.activityFeed.find((a) => a.description.includes('Emergency stop'))
      expect(stopActivity).toBeDefined()
      expect(stopActivity!.type).toBe('error')
    })
  })

  describe('addActivity / clearActivity', () => {
    it('adds activity entries with auto-generated id and timestamp', () => {
      useAgentStore.getState().addActivity({ type: 'info', description: 'Hello' })
      const state = useAgentStore.getState()

      expect(state.activityFeed).toHaveLength(1)
      expect(state.activityFeed[0].id).toBeDefined()
      expect(state.activityFeed[0].timestamp).toBeGreaterThan(0)
      expect(state.activityFeed[0].type).toBe('info')
      expect(state.activityFeed[0].description).toBe('Hello')
    })

    it('appends activities in order', () => {
      useAgentStore.getState().addActivity({ type: 'info', description: 'First' })
      useAgentStore.getState().addActivity({ type: 'action', description: 'Second' })

      const feed = useAgentStore.getState().activityFeed
      expect(feed).toHaveLength(2)
      expect(feed[0].description).toBe('First')
      expect(feed[1].description).toBe('Second')
    })

    it('clearActivity empties the feed', () => {
      useAgentStore.getState().addActivity({ type: 'info', description: 'Test' })
      useAgentStore.getState().clearActivity()
      expect(useAgentStore.getState().activityFeed).toHaveLength(0)
    })
  })

  describe('setMorningBriefing', () => {
    it('sets content and briefingDate to today', () => {
      useAgentStore.getState().setMorningBriefing('Good morning!')
      const state = useAgentStore.getState()

      expect(state.morningBriefing).toBe('Good morning!')
      expect(state.briefingDate).toBe(new Date().toISOString().split('T')[0])
    })

    it('overwrites previous briefing', () => {
      useAgentStore.getState().setMorningBriefing('First briefing')
      useAgentStore.getState().setMorningBriefing('Second briefing')
      expect(useAgentStore.getState().morningBriefing).toBe('Second briefing')
    })
  })
})
