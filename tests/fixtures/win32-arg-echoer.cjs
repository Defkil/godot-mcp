// Windows-argv echoer fixture used by tests/operation-runner-windows-argv.test.ts.
// Reads its own argv (process.argv.slice(2)) and emits it as a Godot-style
// GODOT_MCP_RESULT marker so the operation-runner can parse it back as a
// typed result. No filesystem or network access; the file lives in the
// shared tests/fixtures directory and is committed.
//
// The test harness invokes this echoer DIRECTLY (no Godot-shaped wrapper)
// by overriding the spawn call so the runner's args become the echoer's
// argv. The echoer therefore reads the paramsJson as the FIRST argument
// and reports all of argv.
'use strict';
const args = process.argv.slice(2);
const paramsJson = args.length > 0 ? args[args.length - 1] : '{}';
const payload = {
  argvLen: args.length,
  args: args,
  paramsJson: paramsJson,
};
process.stdout.write('GODOT_MCP_RESULT=' + JSON.stringify(payload) + '\n');