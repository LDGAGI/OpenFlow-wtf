import { useDeferredValue, useState } from "react"

import styles from "./provider-model-grid.module.css"

type Props = {
  models: readonly string[]
  selected: ReadonlySet<string>
  onToggle: (model: string) => void
}

export function ProviderModelGrid({ models, selected, onToggle }: Props) {
  const [query, setQuery] = useState("")
  const deferredQuery = useDeferredValue(query.trim().toLowerCase())
  const visibleModels = deferredQuery
    ? models.filter((model) => model.toLowerCase().includes(deferredQuery))
    : models

  if (!models.length) return null

  return (
    <div className={styles.picker}>
      <input
        className={styles.search}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="搜索模型"
        aria-label="搜索模型"
        autoComplete="off"
        spellCheck={false}
      />
      <div className={styles.grid}>
        {visibleModels.map((model) => {
          const active = selected.has(model)
          return (
            <button
              key={model}
              type="button"
              className={`${styles.model} ${active ? styles.active : ""}`}
              aria-pressed={active}
              title={model}
              onClick={() => onToggle(model)}
            >
              <span>{model}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
