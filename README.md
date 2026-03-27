# Attacca Claw

Open-source AI productivity assistant for knowledge workers. Attacca Claw connects calendars, email, project management, and communication tools into a single dashboard where an AI agent works through tasks under human oversight. Built on the [OpenClaw](https://github.com/openclaw) agent runtime, it runs entirely on your machine with your own API keys — no account required.

## Features

- **Trust architecture** with 3-tier risk classification (low/medium/high) and enforced permission gate — high-risk actions always require human approval, medium-risk behavior adapts to trust profile (cautious/balanced/autonomous)
- **Tool integrations** via Composio (Gmail, Google Calendar, Outlook, Slack, Trello, ClickUp, Asana, Notion)
- **Local-first memory system** with semantic search (on-device embeddings, no API key needed)
- **Background intelligence**: daily/weekly memory synthesis, importance decay, identity trait evolution
- **Knowledge capture**: URL extraction, YouTube transcripts, meeting notes
- **Schedule analysis** with conflict detection
- **Workflow builder** with conversational UI
- **Take Over mode** for autonomous background operation
- **Bilingual setup wizard** (English/Spanish)

## Quick Start

```bash
git clone https://github.com/attacca/attacca-claw.git
cd attacca-claw
npm install
npm run dev
```

On first launch, the Setup Wizard guides you through:

1. Choose an LLM provider (Anthropic, OpenAI, or Google) and enter your API key
2. Optionally add a Composio API key for tool integrations
3. Optionally enable anonymous research telemetry

## Requirements

- Node.js 20+
- An LLM API key (Anthropic, OpenAI, or Google)
- Optional: Composio API key for tool integrations (free at [composio.dev](https://composio.dev))

## Architecture

Electron three-process model:

- **Main process** (`src/main/`): manages windows, spawns OpenClaw gateway, handles IPC, local Composio service, memory system, background scheduler
- **Preload** (`src/preload/`): bridges main↔renderer via typed `window.api`
- **Renderer** (`src/renderer/`): React 19 + TypeScript + Tailwind CSS v4 + Zustand + shadcn/ui

Local services:

- **Memory server** (port 3101): semantic search, embeddings, identity traits
- **Composio server** (port 3102): agent tool execution
- **OpenClaw gateway** (port 18789): AI agent runtime

All data stays local. API keys never leave your machine.

## Development

| Command              | Description                      |
| -------------------- | -------------------------------- |
| `npm run dev`        | Start in development mode        |
| `npm run build`      | Typecheck + build                |
| `npm run lint`       | ESLint                           |
| `npm run format`     | Prettier                         |
| `npm run typecheck`  | Run both node and web typechecks |
| `npm run test`       | Run all tests                    |
| `npm run test:watch` | Tests in watch mode              |

Platform builds:

```bash
npm run build:win    # Windows NSIS installer
npm run build:mac    # macOS DMG (x64 + arm64)
npm run build:linux  # Linux AppImage
```

## OpenClaw Compatibility

Tested with OpenClaw v2026.2.19-2 (pinned). Other versions may work but are not officially supported.

## Telemetry

Attacca Claw includes optional, opt-in anonymous telemetry sent to Datadog for research purposes.

- **Default**: OFF
- **What's collected**: trust tier usage patterns, task success/failure rates, feature engagement, tool call success/failure (action name and toolkit only)
- **What's NOT collected**: API keys, personal data, email content, file contents, conversations, tool call parameters
- **Transparency**: View exactly what would be sent in Settings → Telemetry → "View data"
- **Build config**: Set `DD_CLIENT_KEY` in `.env` — injected at build time via `electron.vite.config.ts`. Without it, events queue locally but never send

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
