# gi-go-mcp

Gizmos Godot MCP is an MCP server that provides full Godot 4.x engine control for AI-driven game development.

> **Security warning:** This server can execute code and arbitrary GDScript. Run it only with trusted projects and clients. Configure `GODOT_MCP_ALLOWED_DIRS`; without it, project-root access remains permissive for compatibility.

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

Configure your MCP client with the local build path. Set `GODOT_PATH` if Godot is not on `PATH`. Set `GODOT_MCP_ALLOWED_DIRS` to a JSON array of trusted roots; delimited lists are also accepted (`;` or `,` on Windows, `:` or `,` on POSIX).

```json
{
  "mcpServers": {
    "gi-go-mcp": {
      "command": "node",
      "args": ["/path/to/gi-go-mcp/build/bin.js"],
      "env": {
        "GODOT_PATH": "/path/to/godot",
        "GODOT_MCP_ALLOWED_DIRS": "[\"/path/to/my/godot/projects\"]"
      }
    }
  }
}
```

Configured roots are enforced after native path canonicalization, including symlink and Windows-junction resolution, for project roots and project discovery. This is not yet a complete filesystem sandbox: inner resource parameters passed to Godot and path time-of-check/time-of-use races remain residual risks.

## Capability Domains
- **Editor Control**: Launch Godot, fetch project structure, and manage scenes.
- **Node & Scene Management**: Add, move, delete, and inspect nodes and scenes.
- **Script Management**: Read, write, and execute GDScript.
- **Runtime Bridge**: Connect to a running Godot game instance via TCP.

**Runtime bridge caveat:** `run_project` copies `mcp_interaction_server.gd` and updates `project.godot` to register an autoload. A clean stop removes changes created by the server; a crash can require manual cleanup. Child stdout and stderr are capped at 1 MiB per stream and the latest diagnostics remain available after exit.

Dynamic ports, multi-session ownership, process-tree kill escalation, and zero-pollution runtime injection are planned but not implemented.

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
