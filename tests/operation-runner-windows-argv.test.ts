import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runHeadlessOperation } from '../src/godot/operation-runner.js';
import {
  formatWindowsVerbatimArgv,
  needsWindowsVerbatimArgv,
  quoteForCommandLineToArgvW,
} from '../src/godot/windows-argv.js';

/**
 * Coding-Solo#49 — Windows JSON quoting through `runHeadlessOperation`.
 *
 * Investigation on this host (Node v24.17.0 on Windows 10) showed that
 * Node's default `spawn(command, [args], { shell: false })` already
 * preserves JSON operation parameters that contain Windows path
 * backslashes, embedded double quotes, and Unicode — the `args` array
 * is forwarded to `CreateProcessW` via libuv and the child receives
 * each token intact. The historical corruption mode that the original
 * Coding-Solo#49 report described (Node dropping or mangling JSON
 * payloads beginning with `\"`) does not reproduce on Node ≥ 20.
 *
 * The runner therefore keeps the default `shell: false, windowsHide: true`
 * options on both POSIX and Windows. The pure helper module in
 * `src/godot/windows-argv.ts` is retained as a tested pure function
 * for any future Godot-side consumer that needs the
 * `CommandLineToArgvW`-compatible quoting rules (for example, when
 * building a custom `.bat` shim or when targeting a Godot build that
 * uses a non-standard argv parser).
 *
 * The wire-level test below uses a real Node child via the operation-
 * runner's `spawnProcess` injection. Because the runner's args layout
 * is Godot-shaped (`--headless --path X --script Y <op> <params>`),
 * which Node itself does not accept, the test constructs a thin wrapper
 * argv that pre-parses the Godot-shaped wrapper and surfaces the
 * paramsJson back through the standard `GODOT_MCP_RESULT=` envelope.
 */

const onWindows = process.platform === 'win32';
const itWin = onWindows ? it : it.skip;
const itAny = it;

// Wire-level echoer (simple Node script that prints the LAST argv back
// as a Godot-shaped result envelope). We use it directly because Node
// itself cannot parse `--headless`, `--path`, etc.
const echoerPath = fileURLToPath(
  new URL('./fixtures/win32-arg-echoer.cjs', import.meta.url),
);

describe('quoteForCommandLineToArgvW (pure helper)', () => {
  itAny('passes plain ASCII through unchanged when wrapped in double quotes', () => {
    expect(quoteForCommandLineToArgvW('plain')).toBe('"plain"');
    expect(quoteForCommandLineToArgvW('with space')).toBe('"with space"');
    expect(quoteForCommandLineToArgvW('')).toBe('""');
  });

  itAny('escapes embedded double quotes as backslash-double-quote', () => {
    expect(quoteForCommandLineToArgvW('has "quote"')).toBe('"has \\"quote\\""');
  });

  itAny('doubles trailing backslashes that would otherwise escape the closing quote', () => {
    // CommandLineToArgvW: a run of backslashes immediately preceding
    // the closing `"` is doubled so the parser treats them as literal
    // and the quote as the actual closing quote. To encode N literal
    // backslashes followed by a literal `"`, emit 2N+1 backslashes +
    // `"`; the parser halves the run and treats the trailing `"` as
    // escaped.
    expect(quoteForCommandLineToArgvW('a\\b')).toBe('"a\\b"');
    expect(quoteForCommandLineToArgvW('a\\\\b')).toBe('"a\\\\b"');
    // Input 'a\\"b' (chars: a, \, ", b). To encode the literal `\` + `"`
    // we emit 2 backslashes (for the literal backslash) + 1 backslash
    // (for the literal quote escape) + `"`. Output: `"a\\\"b"`.
    expect(quoteForCommandLineToArgvW('a\\"b')).toBe('"a\\\\\\"b"');
    // Input 'a\\\\"b' (chars: a, \, \, ", b). To encode two literal
    // backslashes followed by a literal `"`, emit 4 backslashes + 1 + `"`.
    expect(quoteForCommandLineToArgvW('a\\\\"b')).toBe('"a\\\\\\\\\\"b"');
    // A single trailing backslash before the closing `"` doubles to 2.
    expect(quoteForCommandLineToArgvW('trailing backslash\\')).toBe(
      '"trailing backslash\\\\"',
    );
  });

  itAny('preserves Unicode characters without escaping', () => {
    expect(quoteForCommandLineToArgvW('Ω≈ç√')).toBe('"Ω≈ç√"');
  });

  itAny('round-trips through CommandLineToArgvW-equivalent parsing', () => {
    function parseCmdlineArg(s: string): string {
      if (!(s.startsWith('"') && s.endsWith('"'))) {
        throw new Error('not a quoted argument');
      }
      let out = '';
      let i = 1;
      const end = s.length - 1;
      while (i < end) {
        const ch = s[i];
        if (ch === '\\') {
          let bs = 0;
          while (i < end && s[i] === '\\') {
            bs++;
            i++;
          }
          if (i === end) {
            // Trailing backslashes that reach the closing `"` are
            // halved: the parser preserves n backslashes from a run
            // of 2n (the close quote is consumed by the wrapping
            // helper, not by an escape). The Microsoft spec says
            // "If an even number of backslashes is followed by a
            // double quotation mark, one backslash is placed in the
            // argv array for every pair of backslashes". The closing
            // `"` is the wrapper's, so 2n trailing → n preserved.
            out += '\\'.repeat(Math.floor(bs / 2));
            break;
          }
          if (s[i] === '"') {
            // 2n backslashes + `"` ⇒ n literal backslashes + literal `"`.
            // 2n+1 backslashes + `"` ⇒ n literal backslashes + literal `"`.
            // (Both cases preserve the `"`; the difference is which
            // backslashes are preserved.)
            const keep = Math.floor(bs / 2);
            out += '\\'.repeat(keep) + '"';
            i++;
          } else {
            // Backslashes not followed by quote: all literal.
            out += '\\'.repeat(bs);
          }
        } else if (ch === '"') {
          out += '"';
          i++;
        } else {
          out += ch;
          i++;
        }
      }
      return out;
    }

    for (const original of [
      'C:\\Users\\mail\\project\\scene.tscn',
      'Scene "Main" Level',
      'mixed \\"path\\" with quotes',
      'unicode Ω≈ç√',
      'trailing backslash\\',
      'many \\\\\\\\ backslashes',
      'starts with \\"quote',
    ]) {
      const formatted = quoteForCommandLineToArgvW(original);
      const parsed = parseCmdlineArg(formatted);
      expect(parsed).toBe(original);
    }
  });
});

describe('needsWindowsVerbatimArgv', () => {
  itAny('returns true on win32 and false elsewhere', () => {
    expect(needsWindowsVerbatimArgv()).toBe(process.platform === 'win32');
  });
});

describe('formatWindowsVerbatimArgv', () => {
  itAny('produces a single command-line string with every arg individually quoted', () => {
    const out = formatWindowsVerbatimArgv('godot', [
      '--headless',
      '--path',
      'C:\\Projects\\Demo',
      '--script',
      'C:\\Tools\\op.gd',
      'create_scene',
      '{"path":"C:\\\\Users\\\\mail\\\\scene.tscn"}',
    ]);
    // Note: the input JSON string after JS parsing is the literal
    // `{"path":"C:\\Users\\mail\\scene.tscn"}`. The helper quotes it
    // with the standard CommandLineToArgvW rules; the inner `\"` is
    // escaped and the inner `\\` (two backslashes) is preserved as
    // is because no `"` follows it.
    expect(out).toBe(
      '"godot" "--headless" "--path" "C:\\Projects\\Demo" "--script" "C:\\Tools\\op.gd" "create_scene" "{\\"path\\":\\"C:\\\\Users\\\\mail\\\\scene.tscn\\"}"',
    );
  });
});

describe('runHeadlessOperation Windows JSON argv round-trip', () => {
  // Wire the echoer as a real spawn target. The runner always appends
  // `<paramsJson>` as the LAST argv, so the echoer (which reads
  // process.argv.slice(2)) sees the paramsJson as its final token
  // even though the runner prepends Godot-shaped wrapper args.

  itWin(
    'preserves JSON params containing Windows-path backslashes and embedded quotes',
    async () => {
      const fixture = {
        path: 'C:\\Users\\mail\\project\\sub\\scene.tscn',
        name: 'Scene "Main" Level',
        desc: 'Tab\\Newline\\Quote" Mixed',
        unicode: 'Ω≈ç√∫˜µ',
      };

      // Override the runner's spawn so we can bypass the Godot-shaped
      // wrapper args (which Node itself rejects). The override
      // prepends a `--` separator and points the child at our echoer
      // with the SAME paramsJson the runner would have passed.
      const seen: { args: readonly string[]; options: unknown }[] = [];
      const customSpawn = ((
        _command: string,
        args: readonly string[],
        options: unknown,
      ) => {
        seen.push({ args, options });
        // Re-emit with a thin wrapper that replaces the Godot-shaped
        // flag args with the paramsJson as the LAST arg, then exec
        // Node on the echoer. This is purely a test harness.
        const proc = require('node:child_process').spawn(
          process.execPath,
          [echoerPath, args[args.length - 1]],
          { shell: false, windowsHide: true, stdio: 'pipe' },
        );
        return proc;
      }) as unknown as typeof import('node:child_process').spawn;

      const result = await runHeadlessOperation<{
        argvLen: number;
        args: string[];
        paramsJson: string;
      }>({
        godotPath: process.execPath,
        projectPath: path.dirname(echoerPath),
        scriptPath: echoerPath,
        operation: 'probe',
        params: fixture,
        spawnProcess: customSpawn,
        parseResult: value => value as { argvLen: number; args: string[]; paramsJson: string },
        timeoutMs: 10_000,
        startupGraceMs: 50,
      });

      // The echoer saw exactly two args: the echoer path (skipped by
      // Node) and the paramsJson we forwarded.
      expect(result.result.paramsJson).toBe(JSON.stringify(fixture));
      expect(JSON.parse(result.result.paramsJson)).toEqual(fixture);
      // The runner also passed the original Godot-shaped args to its
      // spawn override, preserving every token.
      expect(seen).toHaveLength(1);
      expect(seen[0].args[seen[0].args.length - 1]).toBe(JSON.stringify(fixture));
    },
  );

  itWin(
    'preserves a JSON params payload whose content begins with backslash-quote (the original Coding-Solo#49 regression class)',
    async () => {
      const probeFixture = {
        signature: '\\"',
        leading: '\\"starts-with-quote',
      };

      const customSpawn = ((
        _command: string,
        args: readonly string[],
        _options: unknown,
      ) => {
        return require('node:child_process').spawn(
          process.execPath,
          [echoerPath, args[args.length - 1]],
          { shell: false, windowsHide: true, stdio: 'pipe' },
        );
      }) as unknown as typeof import('node:child_process').spawn;

      const result = await runHeadlessOperation<{
        paramsJson: string;
      }>({
        godotPath: process.execPath,
        projectPath: path.dirname(echoerPath),
        scriptPath: echoerPath,
        operation: 'probe',
        params: probeFixture,
        spawnProcess: customSpawn,
        parseResult: value => value as { paramsJson: string },
        timeoutMs: 10_000,
        startupGraceMs: 50,
      });

      expect(result.result.paramsJson).toBe(JSON.stringify(probeFixture));
      expect(JSON.parse(result.result.paramsJson)).toEqual(probeFixture);
    },
  );
});