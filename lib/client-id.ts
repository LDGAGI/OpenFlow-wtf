const UUID_TEMPLATE = "10000000-1000-4000-8000-100000000000"

/** Generate an opaque browser-local key without requiring an HTTPS secure context. */
export function createClientId() {
  const webCrypto = globalThis.crypto
  if (typeof webCrypto?.randomUUID === "function") return webCrypto.randomUUID()

  if (typeof webCrypto?.getRandomValues === "function") {
    return UUID_TEMPLATE.replace(/[018]/g, (character) => {
      const value = Number(character)
      const random = webCrypto.getRandomValues(new Uint8Array(1))[0]!
      return (value ^ (random & (15 >> (value / 4)))).toString(16)
    })
  }

  const randomPart = Math.random().toString(36).slice(2)
  return `local-${Date.now().toString(36)}-${randomPart}`
}
