#!/usr/bin/env node
/**
 * Creates the AttaccaClaw analytics dashboard in Datadog.
 *
 * Usage:
 *   node scripts/create-datadog-dashboard.mjs
 *
 * Reads DD_CLIENT_KEY and DD_APP_KEY from .env automatically.
 */

import { config } from 'dotenv'
config()

const DD_API_KEY = process.env.DD_API_KEY || process.env.DD_CLIENT_KEY
const DD_APP_KEY = process.env.DD_APP_KEY
const DD_SITE = 'https://us5.datadoghq.com'

if (!DD_API_KEY || !DD_APP_KEY) {
  console.error('Missing keys. Set DD_CLIENT_KEY and DD_APP_KEY in .env')
  process.exit(1)
}

const SRC = 'source:attacca-claw'
const ev = (type) => `${SRC} @attributes.evt:${type}`

// Helpers to build widget definitions
function note(text) {
  return {
    definition: {
      type: 'note',
      content: `## ${text}`,
      background_color: 'transparent',
      font_size: '18',
      text_align: 'left',
      show_tick: false,
      tick_pos: 'left',
      tick_edge: 'left'
    }
  }
}

function queryValue(title, query, opts = {}) {
  const w = {
    definition: {
      title,
      type: 'query_value',
      requests: [
        {
          response_format: 'scalar',
          queries: [
            {
              data_source: 'logs',
              name: 'a',
              search: { query },
              indexes: ['*'],
              compute: { aggregation: opts.aggregation || 'count', ...(opts.metric ? { metric: opts.metric } : {}) }
            }
          ],
          formulas: [{ formula: opts.formula || 'a' }]
        }
      ],
      precision: opts.precision ?? 0
    }
  }
  if (opts.custom_unit) w.definition.custom_unit = opts.custom_unit
  // For multi-query (success rate)
  if (opts.queries) {
    w.definition.requests = [
      {
        response_format: 'scalar',
        queries: opts.queries,
        formulas: [{ formula: opts.formula }]
      }
    ]
  }
  return w
}

function timeseries(title, series, displayType = 'bars') {
  const queries = series.map((s) => ({
    data_source: 'logs',
    name: s.name,
    search: { query: s.query },
    indexes: ['*'],
    compute: { aggregation: 'count' },
    group_by: s.group_by || []
  }))
  const formulas = series.map((s) => ({
    formula: s.name,
    ...(s.alias ? { alias: s.alias } : {})
  }))
  return {
    definition: {
      title,
      type: 'timeseries',
      requests: [
        {
          response_format: 'timeseries',
          queries,
          formulas,
          display_type: displayType
        }
      ]
    }
  }
}

function toplist(title, query, facet, limit = 10) {
  return {
    definition: {
      title,
      type: 'toplist',
      requests: [
        {
          response_format: 'scalar',
          queries: [
            {
              data_source: 'logs',
              name: 'a',
              search: { query },
              indexes: ['*'],
              compute: { aggregation: 'count' },
              group_by: [
                {
                  facet,
                  limit,
                  sort: { aggregation: 'count', order: 'desc' }
                }
              ]
            }
          ],
          formulas: [{ formula: 'a' }]
        }
      ]
    }
  }
}

function pie(title, query, facet, limit = 10) {
  return {
    definition: {
      title,
      type: 'sunburst',
      requests: [
        {
          response_format: 'scalar',
          queries: [
            {
              data_source: 'logs',
              name: 'a',
              search: { query },
              indexes: ['*'],
              compute: { aggregation: 'count' },
              group_by: [
                {
                  facet,
                  limit,
                  sort: { aggregation: 'count', order: 'desc' }
                }
              ]
            }
          ],
          formulas: [{ formula: 'a' }]
        }
      ]
    }
  }
}

const dashboard = {
  title: 'AttaccaClaw — Agent Analytics',
  description:
    'How users interact with the AttaccaClaw agent: sessions, features, tool usage, errors, and onboarding.',
  layout_type: 'ordered',
  widgets: [
    // ── KEY METRICS ──
    note('Key Metrics'),

    queryValue('Total Sessions', ev('app.session_started')),

    queryValue('Unique Users', SRC, {
      aggregation: 'cardinality',
      metric: '@usr.id'
    }),

    queryValue('Agent Interactions', ev('agent.chat.sent')),

    {
      definition: {
        title: 'Tool Call Success Rate',
        type: 'query_value',
        requests: [
          {
            response_format: 'scalar',
            queries: [
              {
                data_source: 'logs',
                name: 'ok',
                search: { query: ev('agent.tool_call.succeeded') },
                indexes: ['*'],
                compute: { aggregation: 'count' }
              },
              {
                data_source: 'logs',
                name: 'fail',
                search: { query: ev('agent.tool_call.failed') },
                indexes: ['*'],
                compute: { aggregation: 'count' }
              }
            ],
            formulas: [{ formula: '(ok / (ok + fail)) * 100' }]
          }
        ],
        precision: 1,
        custom_unit: '%'
      }
    },

    queryValue('Captures Saved', ev('capture.saved')),

    queryValue('Gateway Errors', ev('gateway.error')),

    // ── SESSIONS & FEATURES ──
    note('Sessions & Feature Usage'),

    timeseries('Sessions Over Time', [
      { name: 'sessions', query: ev('app.session_started'), alias: 'Sessions' }
    ]),

    timeseries('Feature Usage Over Time', [
      {
        name: 'views',
        query: ev('feature.viewed'),
        alias: 'Views',
        group_by: [
          {
            facet: '@attributes.view',
            limit: 10,
            sort: { aggregation: 'count', order: 'desc' }
          }
        ]
      }
    ]),

    pie('Most Used Features', ev('feature.viewed'), '@attributes.view'),

    // ── AGENT TOOL CALLS ──
    note('Agent Tool Calls'),

    timeseries('Tool Calls: Success vs Failure', [
      { name: 'ok', query: ev('agent.tool_call.succeeded'), alias: 'Succeeded' },
      { name: 'fail', query: ev('agent.tool_call.failed'), alias: 'Failed' }
    ]),

    toplist('Most Used Toolkits', `${SRC} @attributes.evt:agent.tool_call.*`, '@attributes.toolkit'),

    toplist('Most Used Actions', ev('agent.tool_call.succeeded'), '@attributes.actionName', 15),

    toplist('Tool Call Errors by Category', ev('agent.tool_call.failed'), '@attributes.errorCategory'),

    // ── CAPTURES & WORKFLOWS ──
    note('Captures & Workflows'),

    timeseries('Capture Funnel', [
      { name: 'started', query: ev('capture.started'), alias: 'Started' },
      { name: 'saved', query: ev('capture.saved'), alias: 'Saved' },
      { name: 'discarded', query: ev('capture.discarded'), alias: 'Discarded' }
    ]),

    toplist('Captures by Source Type', ev('capture.started'), '@attributes.sourceType'),

    timeseries('Workflows: Created vs Run', [
      { name: 'created', query: ev('workflow.created'), alias: 'Created' },
      { name: 'run', query: ev('workflow.run'), alias: 'Run' }
    ]),

    // ── SYSTEM HEALTH ──
    note('System Health & Integrations'),

    timeseries(
      'Gateway Health',
      [
        { name: 'started', query: ev('gateway.started'), alias: 'Started' },
        { name: 'errors', query: ev('gateway.error'), alias: 'Errors' },
        { name: 'restarts', query: ev('gateway.restarted'), alias: 'Restarts' }
      ],
      'line'
    ),

    timeseries('Tool Connections / Disconnections', [
      { name: 'connected', query: ev('tool.connected'), alias: 'Connected' },
      { name: 'disconnected', query: ev('tool.disconnected'), alias: 'Disconnected' }
    ]),

    toplist('Most Connected Tools', ev('tool.connected'), '@attributes.toolId', 15),

    // ── PERMISSIONS & TRUST ──
    note('Permissions & Trust'),

    timeseries('Permission Decisions', [
      { name: 'presented', query: `${SRC} @attributes.evt:permission.*.presented`, alias: 'Presented' },
      { name: 'resolved', query: `${SRC} @attributes.evt:permission.*.resolved`, alias: 'Resolved' }
    ]),

    timeseries('Emergency Actions', [
      { name: 'kill', query: ev('trust.kill_switch.activated'), alias: 'Kill Switch' },
      { name: 'takeover', query: ev('trust.takeover.activated'), alias: 'Take Over' }
    ]),

    toplist('Trust Profile Changes', ev('trust.profile_changed'), '@attributes.to_profile', 5),

    // ── ONBOARDING ──
    note('Onboarding'),

    toplist('Onboarding Step Completion', ev('onboarding.step_completed'), '@attributes.stepName'),

    timeseries('Onboarding Completions', [
      { name: 'completed', query: ev('onboarding.completed'), alias: 'Completed' }
    ]),

    pie('LLM Provider Distribution', ev('onboarding.completed'), '@attributes.llmProvider', 5),

    // ── AGENT TASKS ──
    note('Agent Tasks'),

    timeseries('Task Outcomes', [
      { name: 'completed', query: ev('agent.task.completed'), alias: 'Completed' },
      { name: 'failed', query: ev('agent.task.failed'), alias: 'Failed' }
    ]),

    toplist('Task Failure Categories', ev('agent.task.failed'), '@attributes.errorCategory'),

    // ── RAW LOG ──
    note('Recent Events'),

    {
      definition: {
        title: 'Event Stream',
        type: 'log_stream',
        indexes: [],
        query: SRC,
        columns: ['@message', '@usr.id', '@attributes'],
        sort: { column: 'time', order: 'desc' },
        message_display: 'expanded-md'
      }
    }
  ],
  notify_list: [],
  reflow_type: 'auto'
}

async function createDashboard() {
  console.log('Creating AttaccaClaw dashboard on Datadog US5...')

  const response = await fetch(`${DD_SITE}/api/v1/dashboard`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'DD-API-KEY': DD_API_KEY,
      'DD-APPLICATION-KEY': DD_APP_KEY
    },
    body: JSON.stringify(dashboard)
  })

  if (!response.ok) {
    const body = await response.text()
    console.error(`Failed (${response.status}):`, body)
    process.exit(1)
  }

  const result = await response.json()
  console.log('\nDashboard created successfully!')
  console.log(`URL: ${DD_SITE}${result.url}`)
  console.log(`ID:  ${result.id}`)
}

createDashboard()
