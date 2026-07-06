const SENSITIVE_KEY = /^(auth_?key|api_?key|authorization|password|passwd|access_?token|refresh_?token|secret|private_?key)$/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [
    key,
    SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(child),
  ]));
}

/** JSON intended for external judges and reports; preserves data while removing credentials. */
export function serializePayloadForExternalUse(payload: unknown): string {
  return JSON.stringify(redact(payload));
}
