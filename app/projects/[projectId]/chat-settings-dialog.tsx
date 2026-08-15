"use client"

import { KeyRound, LoaderCircle, X } from "lucide-react"
import { useState } from "react"

import { ProviderModelGrid } from "@/components/home/provider-model-grid"
import {
  CHAT_PROVIDER_PRESETS,
  clearChatSettings,
  loadChatSettings,
  saveChatSettings,
  type ChatProvider,
  type ChatProviderType,
  type ChatSettings,
} from "@/lib/chat-settings"

import styles from "./chat-settings-dialog.module.css"

type ProviderDraft = {
  baseUrl: string
  apiKey: string
  models: string[]
  selected: Set<string>
}

type ModelsResponse = { models?: string[]; error?: string }

function initialDraft(id: ChatProviderType, provider?: ChatProvider): ProviderDraft {
  const storedModels = provider?.models ?? []
  return {
    baseUrl: provider?.baseUrl ?? CHAT_PROVIDER_PRESETS[id].baseUrl,
    apiKey: provider?.apiKey ?? "",
    models: storedModels,
    selected: new Set(storedModels),
  }
}

export function ChatSettingsDialog({
  onSaved,
  onCancel,
}: {
  onSaved: (settings: ChatSettings | null) => void
  onCancel: () => void
}) {
  const [initial] = useState(() => loadChatSettings())
  const [providerId] = useState<ChatProviderType>("openai-compatible")
  const [drafts, setDrafts] = useState<Record<ChatProviderType, ProviderDraft>>(() => ({
    "openai-compatible": initialDraft("openai-compatible", initial?.providers.find((item) => item.id === "openai-compatible")),
  }))
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState("")
  const [manualModel, setManualModel] = useState("")
  const draft = drafts[providerId]

  function updateDraft(update: Partial<ProviderDraft>) {
    setDrafts((current) => ({
      ...current,
      [providerId]: { ...current[providerId], ...update },
    }))
  }

  function updateConnection(update: Partial<ProviderDraft>) {
    updateDraft({ ...update, models: [], selected: new Set() })
    setError("")
  }

  async function fetchModels() {
    if (fetching || !draft.baseUrl.trim() || !draft.apiKey.trim()) return
    setFetching(true)
    setError("")
    try {
      const response = await fetch("/api/chat/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: draft.baseUrl.trim(),
          apiKey: draft.apiKey.trim(),
        }),
      })
      const data = await response.json().catch(() => null) as ModelsResponse | null
      if (!response.ok) throw new Error(data?.error ?? "无法获取模型")
      const models = [...new Set((data?.models ?? []).map((model) => model.trim()).filter(Boolean))]
      if (!models.length) throw new Error("上游没有返回模型，请手动添加模型 ID")
      updateDraft({
        models,
        selected: new Set(models.filter((model) => draft.selected.has(model))),
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法获取模型，请稍后重试")
    } finally {
      setFetching(false)
    }
  }

  function toggleModel(model: string) {
    const selected = new Set(draft.selected)
    if (selected.has(model)) selected.delete(model)
    else selected.add(model)
    updateDraft({ selected })
  }

  function addManualModel() {
    const model = manualModel.trim()
    if (!model) return
    const models = draft.models.includes(model) ? draft.models : [...draft.models, model]
    updateDraft({ models, selected: new Set(draft.selected).add(model) })
    setManualModel("")
    setError("")
  }

  function save() {
    const providers = (Object.entries(drafts) as [ChatProviderType, ProviderDraft][]).flatMap(([id, item]) => {
      const models = item.models.filter((model) => item.selected.has(model))
      if (!item.baseUrl.trim() || !item.apiKey.trim() || !models.length) return []
      return [{
        id,
        name: CHAT_PROVIDER_PRESETS[id].name,
        baseUrl: item.baseUrl.trim(),
        apiKey: item.apiKey.trim(),
        models,
      } satisfies ChatProvider]
    })
    const active = providers.find((item) => item.id === providerId)
    if (!active) return
    const previousModel = initial?.activeProviderId === providerId ? initial.activeModel : null
    const settings: ChatSettings = {
      version: 1,
      providers,
      activeProviderId: active.id,
      activeModel: previousModel && active.models.includes(previousModel) ? previousModel : active.models[0]!,
    }
    saveChatSettings(settings)
    onSaved(settings)
  }

  function clear() {
    clearChatSettings()
    onSaved(null)
  }

  const selectedCount = draft.models.filter((model) => draft.selected.has(model)).length
  const ready = Boolean(draft.baseUrl.trim() && draft.apiKey.trim() && selectedCount)

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="chat-models-title">
        <header className={styles.header}>
          <h2 id="chat-models-title">对话模型</h2>
          <button type="button" className={styles.iconButton} onClick={onCancel} title="关闭" aria-label="关闭">
            <X size={16} />
          </button>
        </header>

        <div className={styles.form}>
          <label className={styles.field}>
            <span>API 地址</span>
            <input value={draft.baseUrl} onChange={(event) => updateConnection({ baseUrl: event.target.value })} placeholder="https://api.example.com/v1" autoComplete="off" spellCheck={false} />
          </label>

          <label className={styles.field}>
            <span>API Key</span>
            <div className={styles.secretInput}>
              <KeyRound size={15} aria-hidden="true" />
              <input
                type="password"
                value={draft.apiKey}
                onChange={(event) => updateConnection({ apiKey: event.target.value })}
                placeholder="粘贴 API Key"
                autoComplete="new-password"
                aria-label="API Key"
              />
            </div>
          </label>

          <button
            type="button"
            className={styles.fetchButton}
            disabled={fetching || !draft.baseUrl.trim() || !draft.apiKey.trim()}
            onClick={() => void fetchModels()}
          >
            {fetching ? <><LoaderCircle className={styles.spinner} size={15} />正在获取模型</> : "获取模型"}
          </button>

          <div className={styles.manualRow}>
            <input value={manualModel} onChange={(event) => setManualModel(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addManualModel() } }} placeholder="手动填写模型 ID" autoComplete="off" spellCheck={false} />
            <button type="button" onClick={addManualModel}>添加</button>
          </div>

          {error ? <p className={styles.error}>{error}</p> : null}
        </div>

        {fetching || draft.models.length ? <div className={styles.modelsSection}>
          {fetching ? (
            <div className={styles.skeletonList} aria-label="正在加载模型">
              <span /><span /><span />
            </div>
          ) : (
            <ProviderModelGrid models={draft.models} selected={draft.selected} onToggle={toggleModel} />
          )}
        </div> : null}

        <footer className={styles.actions}>
          {initial ? <button type="button" className={styles.clearButton} onClick={clear}>清除全部</button> : null}
          <span />
          <button type="button" className={styles.cancelButton} onClick={onCancel}>取消</button>
          <button type="button" className={styles.saveButton} disabled={!ready} onClick={save}>保存</button>
        </footer>
      </section>
    </div>
  )
}
