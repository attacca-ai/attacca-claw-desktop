# Contributing to Attacca Claw

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

1. **Prerequisites**: Node.js 20+, npm 10+
2. **Clone and install**:
   ```bash
   git clone https://github.com/attacca/attacca-claw.git
   cd attacca-claw
   npm install
   ```
3. **Run in development**:
   ```bash
   npm run dev
   ```
4. **Run the Setup Wizard** on first launch to configure your API keys.

## Commands

| Command              | Description                            |
| -------------------- | -------------------------------------- |
| `npm run dev`        | Start Electron app in development mode |
| `npm run build`      | Typecheck + build                      |
| `npm run lint`       | ESLint                                 |
| `npm run format`     | Prettier                               |
| `npm run typecheck`  | Run both node and web typechecks       |
| `npm run test`       | Run all tests                          |
| `npm run test:watch` | Run tests in watch mode                |

## Pull Request Process

1. Fork the repo and create a branch from `main`.
2. Make your changes. Follow existing code patterns and style.
3. Ensure `npm run typecheck` and `npm run test` pass.
4. Submit a PR with a clear description of what changed and why.

## Code Style

- TypeScript throughout (strict mode)
- React 19 with functional components
- Zustand for state management
- Tailwind CSS v4 for styling
- Follow existing naming and file organization patterns

## Architecture

See `CLAUDE.md` for detailed architecture documentation.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
