export class SseReadTimeoutError extends Error {
  constructor() {
    super("等待供应商流式响应超时")
    this.name = "SseReadTimeoutError"
  }
}

function dataFromFrame(frame: string): string | null {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
  return data.length ? data.join("\n") : null
}

async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SseReadTimeoutError()), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 按 SSE 规范兼容 LF/CRLF、多行 data 和没有尾随空行的最后一帧。 */
export async function* sseDataLines(
  body: ReadableStream<Uint8Array>,
  options?: {
    rawSink?: { text: string }
    firstEventTimeoutMs?: number
    idleTimeoutMs?: number
  }
) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let firstRead = true
  try {
    while (true) {
      const timeoutMs = firstRead
        ? (options?.firstEventTimeoutMs ?? 300_000)
        : (options?.idleTimeoutMs ?? 180_000)
      const { value, done } = await readWithTimeout(reader, timeoutMs)
      if (done) break
      firstRead = false
      const chunk = decoder.decode(value, { stream: true })
      if (options?.rawSink && options.rawSink.text.length < 500) {
        options.rawSink.text += chunk.slice(0, 500 - options.rawSink.text.length)
      }
      buffer += chunk

      while (true) {
        const boundary = /\r?\n\r?\n/.exec(buffer)
        if (!boundary || boundary.index === undefined) break
        const frame = buffer.slice(0, boundary.index)
        buffer = buffer.slice(boundary.index + boundary[0].length)
        const data = dataFromFrame(frame)
        if (data !== null) yield data
      }
    }

    buffer += decoder.decode()
    if (buffer.trim()) {
      const data = dataFromFrame(buffer)
      if (data !== null) yield data
    }
  } catch (error) {
    if (error instanceof SseReadTimeoutError) await reader.cancel(error).catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }
}
