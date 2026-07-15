# gi-go-mcp

Gizmos Godot MCP is an MCP server that provides full Godot 4.x engine control for AI-driven game development.

> **Security Warning**: This server grants an AI full access to execute code and arbitrary GDScript operations within the allowed Godot project directories. Only run this server in a controlled, isolated environment or within repositories you trust.

## Requirements
- Node.js >= 20
- Godot 4.x (4.4 or later recommended)

## Installation from Source

Clone the repository and build from source:

```bash
git clone https://github.com/Defkil/gi-go-mcp.git
cd gi-go-mcp
npm ci
npm run build
```

## Configuration

To use this MCP server with Claude or another AI assistant, configure your MCP client with the local build path. Set the `GODOT_PATH` environment variable if Godot is not in your system path, and configure `GODOT_MCP_ALLOWED_DIRS` to restrict operations to specific directories.

```json
{
  "mcpServers": {
    "gi-go-mcp": {
      "command": "node",
      "args": ["/path/to/gi-go-mcp/build/index.js"],
      "env": {
        "GODOT_PATH": "/path/to/godot",
        "GODOT_MCP_ALLOWED_DIRS": "/path/to/my/godot/projects"
      }
    }
  }
}
```

## Capability Domains
- **Editor Control**: Launch Godot, fetch project structure, and manage scenes.
- **Node & Scene Management**: Add, move, delete, and inspect nodes and scenes.
- **Script Management**: Read, write, and execute GDScript.
- **Runtime Bridge**: Connect to a running Godot game instance via TCP.

**Note on Runtime Bridge**: When `run_project` is executed, the server injects an autoload script (`mcp_interaction_server.gd`) to enable live interaction.

## Architecture Summary
The server runs via Node.js, implementing the Model Context Protocol (MCP). It communicates with the Godot engine using headless command-line execution for static operations, and a TCP socket connection for dynamic runtime interactions when a game instance is running.

## Development and Testing

- `npm run build`: Compile TypeScript and copy required GDScript files.
- `npm test`: Run the Vitest test suite.
- `npm run watch`: Continuously compile on file changes.

## Attribution and License

Original godot-mcp implementation by Solomon Elias (https://github.com/Coding-Solo/godot-mcp) and Tugcan Topaloglu.
Maintained by Oliver Grüttner.

MIT License
