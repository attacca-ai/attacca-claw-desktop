import { net } from 'electron'
import { getConfig, type ActiveCollabConfig } from './connector'

async function getValidConfig(): Promise<ActiveCollabConfig> {
  const config = getConfig()
  if (!config) throw new Error('ActiveCollab not connected')
  return config
}

async function apiRequest(
  endpoint: string,
  options: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<unknown> {
  const config = await getValidConfig()
  const url = `${config.instanceUrl}/api/v1${endpoint}`

  const response = await net.fetch(url, {
    method: options.method || 'GET',
    headers: {
      'X-Angie-AuthApiToken': config.token,
      'Content-Type': 'application/json',
      ...options.headers
    },
    body: options.body
  })

  if (response.status === 401) {
    throw new Error('ActiveCollab token invalid or expired. Please reconnect.')
  }

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`ActiveCollab API error (${response.status}): ${text}`)
  }

  if (response.status === 204) return null
  return response.json()
}

// === READ (Low Risk) ===

export async function getProjects(): Promise<unknown[]> {
  return apiRequest('/projects') as Promise<unknown[]>
}

export async function getProject(projectId: number): Promise<unknown> {
  return apiRequest(`/projects/${projectId}`)
}

export async function getTaskLists(projectId: number): Promise<unknown[]> {
  return apiRequest(`/projects/${projectId}/task-lists`) as Promise<unknown[]>
}

export async function getTasks(projectId: number): Promise<unknown[]> {
  return apiRequest(`/projects/${projectId}/tasks`) as Promise<unknown[]>
}

export async function getTask(projectId: number, taskId: number): Promise<unknown> {
  return apiRequest(`/projects/${projectId}/tasks/${taskId}`)
}

export async function getMyTasks(): Promise<unknown[]> {
  const config = await getValidConfig()
  return apiRequest(`/users/${config.userId}/tasks`) as Promise<unknown[]>
}

export async function getTimeRecords(projectId: number, taskId: number): Promise<unknown[]> {
  return apiRequest(`/projects/${projectId}/tasks/${taskId}/time-records`) as Promise<unknown[]>
}

export async function getComments(_projectId: number, taskId: number): Promise<unknown[]> {
  return apiRequest(`/comments/task/${taskId}`) as Promise<unknown[]>
}

export async function getActivity(): Promise<unknown[]> {
  return apiRequest('/activity-log') as Promise<unknown[]>
}

// === WRITE (Mid Risk) ===

export async function createTask(
  projectId: number,
  taskListId: number,
  task: {
    name: string
    body?: string
    assignee_id?: number
    due_on?: string // YYYY-MM-DD
    priority?: number // 0=normal, 1=high, 2=highest
    label_ids?: number[]
  }
): Promise<unknown> {
  return apiRequest(`/projects/${projectId}/task-lists/${taskListId}/tasks`, {
    method: 'POST',
    body: JSON.stringify(task)
  })
}

export async function updateTask(
  projectId: number,
  taskId: number,
  updates: {
    name?: string
    body?: string
    assignee_id?: number
    due_on?: string
    priority?: number
    is_completed?: boolean
  }
): Promise<unknown> {
  return apiRequest(`/projects/${projectId}/tasks/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify(updates)
  })
}

export async function completeTask(_projectId: number, taskId: number): Promise<unknown> {
  return apiRequest(`/complete/task/${taskId}`, { method: 'PUT' })
}

export async function reopenTask(_projectId: number, taskId: number): Promise<unknown> {
  return apiRequest(`/open/task/${taskId}`, { method: 'PUT' })
}

export async function addComment(taskType: string, taskId: number, body: string): Promise<unknown> {
  return apiRequest(`/comments/${taskType}/${taskId}`, {
    method: 'POST',
    body: JSON.stringify({ body })
  })
}

export async function logTime(
  projectId: number,
  taskId: number,
  value: number,
  summary?: string
): Promise<unknown> {
  const config = await getValidConfig()
  return apiRequest(`/projects/${projectId}/tasks/${taskId}/time-records`, {
    method: 'POST',
    body: JSON.stringify({
      value,
      user_id: config.userId,
      summary: summary || '',
      record_date: new Date().toISOString().split('T')[0]
    })
  })
}

// === DELETE (High Risk) ===

export async function deleteTask(projectId: number, taskId: number): Promise<void> {
  await apiRequest(`/projects/${projectId}/tasks/${taskId}`, { method: 'DELETE' })
}

export async function moveToTrash(projectId: number, taskId: number): Promise<unknown> {
  return apiRequest(`/projects/${projectId}/tasks/${taskId}/move-to-trash`, {
    method: 'PUT'
  })
}

// === CONVENIENCE ===

export async function getMyOpenTasks(): Promise<unknown[]> {
  const tasks = await getMyTasks()
  return tasks.filter((t) => !(t as { is_completed: boolean }).is_completed)
}

export async function getProjectOverview(
  projectId: number
): Promise<{ project: unknown; taskLists: unknown[]; tasks: unknown[] }> {
  const [project, taskLists, tasks] = await Promise.all([
    getProject(projectId),
    getTaskLists(projectId),
    getTasks(projectId)
  ])
  return { project, taskLists, tasks }
}
