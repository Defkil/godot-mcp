# Contributing to gi-go-mcp

Thank you for your interest in contributing to gi-go-mcp!

## Getting Started
1. Ensure Node.js 20+ is installed.
2. Clone the repository and install dependencies with `npm ci`.
3. Run `npm run build` to build the TypeScript and Godot scripts.
4. Run `npm test` to verify your environment.

## Conventional Commits
We use Conventional Commits. Please format your commit messages accordingly (e.g., `feat: add new capability`, `fix: path validation error`, `docs: update readme`).

## Pull Request Process
1. Use Test-Driven Development (TDD) for any new features or bug fixes.
2. Add focused failing tests first, then implement the behavior.
3. Ensure all tests pass (`npm test`) and the project builds successfully (`npm run build`).
4. Ensure no new security vulnerabilities are introduced (`npm audit --omit=dev`).
5. Open a Pull Request targeting the `main` branch.
