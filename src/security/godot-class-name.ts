const GODOT_CLASS_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isSafeGodotClassName(value: unknown): value is string {
  return typeof value === 'string' && GODOT_CLASS_IDENTIFIER.test(value);
}
