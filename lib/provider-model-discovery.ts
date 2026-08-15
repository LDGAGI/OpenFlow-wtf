export function extractProviderModelIds(payload: unknown) {
  const ids: string[] = []
  const visit = (value: unknown, depth: number) => {
    if (depth > 3 || value === null || value === undefined) return
    if (typeof value === "string") {
      if (value.trim()) ids.push(value.trim())
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") visit(item, depth + 1)
        else if (item && typeof item === "object") {
          const record = item as Record<string, unknown>
          const id = record.id ?? record.name ?? record.model ?? record.model_id
          if (typeof id === "string") visit(id, depth + 1)
        }
      }
      return
    }
    if (typeof value !== "object") return
    const record = value as Record<string, unknown>
    for (const key of ["data", "models", "items", "results", "result"]) {
      if (key in record) visit(record[key], depth + 1)
    }
  }
  visit(payload, 0)
  return [...new Set(ids)]
}
