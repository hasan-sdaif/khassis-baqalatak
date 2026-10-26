/** Bounded JSON reader for public and administrative API handlers.
 * Counts streamed bytes before decoding/parsing so chunked requests cannot bypass
 * the Content-Length check and oversized bodies do not reach JSON.parse.
 */
export type LimitedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413; error: 'invalid_json' | 'invalid_encoding' | 'request_too_large' | 'invalid_body' }

export async function readJsonLimited(request: Request, maxBytes: number): Promise<LimitedJsonResult> {
  const contentLength = request.headers.get('content-length')
  if (contentLength != null) {
    const parsedLength = Number(contentLength)
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      return { ok: false, status: 413, error: 'request_too_large' }
    }
  }

  const reader = request.body?.getReader()
  if (!reader) return { ok: false, status: 400, error: 'invalid_json' }
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined)
        return { ok: false, status: 413, error: 'request_too_large' }
      }
      chunks.push(value)
    }

    const bytes = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }

    let source: string
    try {
      source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      return { ok: false, status: 400, error: 'invalid_encoding' }
    }

    try {
      return { ok: true, value: JSON.parse(source) as unknown }
    } catch {
      return { ok: false, status: 400, error: 'invalid_json' }
    }
  } catch {
    return { ok: false, status: 400, error: 'invalid_body' }
  } finally {
    try { reader.releaseLock() } catch { /* already cancelled/released by runtime */ }
  }
}
