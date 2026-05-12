/**
 * Build a plain object from @fastify/multipart request.body (attachFieldsToBody: true).
 * Each field is { value, fieldname, ... }; we take .value and exclude file fields.
 */
export function multipartBodyToObject(
  body: Record<string, unknown> | undefined,
  excludeKeys: string[] = ['images', 'image', 'medias'],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!body || typeof body !== 'object') return out;
  for (const [key, v] of Object.entries(body)) {
    if (excludeKeys.includes(key)) continue;
    if (v != null && typeof v === 'object' && 'value' in v) {
      const entry = v as { value: unknown; file?: unknown };
      if (!('file' in entry) || !entry.file) {
        out[key] = entry.value;
      }
    }
  }
  return out;
}
