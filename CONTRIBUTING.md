# Contributing to `@illicomedia/skills-mcp-server`

Thank you for your interest in improving Fredo QA Skills MCP Server.

## Development Workflow

### Prerequisites
- Node.js >= 18.0.0
- pnpm >= 9.0.0

### Setup
```bash
git clone git@github.com:illicomedia/skills-mcp-server.git
cd skills-mcp-server
pnpm install
```

### Quality Gates
Before submitting a pull request, all gates must pass locally:

1. **Linting & Code Formatting (Biome)**:
   ```bash
   pnpm run lint
   ```
   Zero errors, zero warnings.

2. **TypeScript Compilation**:
   ```bash
   pnpm run build
   ```

3. **Test Suite & 100% Coverage**:
   ```bash
   pnpm run test:coverage
   ```
   All tests must pass with 100% lines, 100% branches, and 100% function coverage.

4. **Package Smoke Test**:
   ```bash
   pnpm run release:smoke
   ```

---

## Commit Guidelines

We use conventional commit messages:
- `feat(scope): ...`
- `fix(scope): ...`
- `docs(scope): ...`
- `chore(scope): ...`

Every commit must be focused, truthful, and verified.
