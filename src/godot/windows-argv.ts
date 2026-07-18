/**
 * Windows verbatim-arguments helper for `runHeadlessOperation`.
 *
 * Node's default `spawn(command, [args], { shell: false })` reconstructs
 * the Windows `lpCommandLine` using `child_process`'s argument-quoting
 * rules, which on Windows treats `\` followed by `"` as an escape and
 * silently strips it. A JSON-serialized payload such as
 *
 *   {"path":"C:\\Users\\mail\\project\\sub\\scene.tscn",
 *    "name":"Scene \"Main\" Level"}
 *
 * therefore arrives at Godot with the backslashes and quotes corrupted,
 * and any payload that begins with `\"` is dropped entirely from argv.
 *
 * The standard fix is to switch to `spawn(cmdline, {
 * shell: false, windowsVerbatimArguments: true })` and pre-format the
 * entire command line using the documented Microsoft rules
 * (`CommandLineToArgvW` parsing). The helper below applies those rules
 * to every individual argv token and joins them with single spaces.
 *
 * Why a helper rather than relying on `child_process`'s own escaping:
 * the helper output is the literal bytes that `CreateProcessW` will
 * receive; the child's `OS::get_cmdline_args()` (which Godot uses) is
 * `CommandLineToArgvW`-compatible, so the round-trip is byte-stable
 * for arbitrary UTF-8, embedded double quotes, and Windows paths
 * containing backslashes.
 *
 * Reference: Microsoft docs, "Parsing C++ Command-Line Arguments"
 * (https://learn.microsoft.com/en-us/cpp/cpp/main-function-command-line-args)
 */

/**
 * Quote a single argv token for the `CommandLineToArgvW` parser.
 *
 * Rules (Microsoft, "Parsing C++ Command-Line Arguments"):
 *   - A token is wrapped in double quotes.
 *   - A literal `"` inside the token is escaped as `\"`.
 *   - A run of backslashes is preserved literally UNLESS it immediately
 *     precedes a `"` that is meant to be escaped: 2n backslashes before a
 *     `"` produce n literal backslashes followed by an escaped `"`; 2n+1
 *     backslashes before a `"` produce n literal backslashes followed
 *     by a literal `"`.
 */
export function quoteForCommandLineToArgvW(token: string): string {
  let out = '';
  let trailingBackslashes = 0;
  for (let i = 0; i < token.length; i++) {
    const ch = token.charCodeAt(i);
    if (ch === 0x5c /* \ */) {
      trailingBackslashes++;
      continue;
    }
    if (ch === 0x22 /* " */) {
      // Double every preceding backslash so a closing `"` is escaped,
      // then add the escaped quote.
      out += '\\'.repeat(trailingBackslashes * 2 + 1) + '"';
      trailingBackslashes = 0;
      continue;
    }
    if (trailingBackslashes > 0) {
      out += '\\'.repeat(trailingBackslashes);
      trailingBackslashes = 0;
    }
    out += token[i];
  }
  // Trailing backslashes are doubled so the closing `"` of the wrapper
  // is not treated as escaped.
  if (trailingBackslashes > 0) {
    out += '\\'.repeat(trailingBackslashes * 2);
  }
  return `"${out}"`;
}

/**
 * Build a single command-line string suitable for
 * `spawn(cmdline, { shell: false, windowsVerbatimArguments: true })`.
 *
 * The command itself is quoted by the same `CommandLineToArgvW` rules.
 */
export function formatWindowsVerbatimArgv(
  command: string,
  args: readonly string[],
): string {
  const parts: string[] = [quoteForCommandLineToArgvW(command)];
  for (const arg of args) {
    parts.push(quoteForCommandLineToArgvW(arg));
  }
  return parts.join(' ');
}

/**
 * Whether the current host requires the verbatim-arguments path.
 *
 * Only true on win32; on POSIX the default argv-array spawn is correct
 * and the verbatim path is not implemented by Node's child_process
 * (the option is silently ignored outside Windows).
 */
export function needsWindowsVerbatimArgv(): boolean {
  return process.platform === 'win32';
}