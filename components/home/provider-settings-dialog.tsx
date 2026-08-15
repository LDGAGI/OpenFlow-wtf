"use client"

import { Plus, X } from "lucide-react"
import { useState } from "react"

import { createClientId } from "@/lib/client-id"
import {
  clearProviderSettings,
  loadProviderSettings,
  saveProviderSettings,
  settingsFromConnections,
  type ProviderConnection,
  type ProviderKind,
  type ProviderSettings,
  type ReasoningEffort,
} from "@/lib/provider-settings"
import {
  compatibleModelProfiles,
  inferMediaBinding,
  mediaAdapterLabel,
  modelProfileLabel,
  type MediaAdapterId,
  type ModelProfileId,
} from "@/lib/provider-models"
import { SelectMenu } from "@/components/ui/select-menu"
import { ProviderModelGrid } from "./provider-model-grid"

import styles from "./provider-settings-dialog.module.css"

type ModelsResponse = { models?: string[]; error?: string }

async function readModelsResponse(response: Response): Promise<ModelsResponse> {
  const text = await response.text()
  try {
    return JSON.parse(text) as ModelsResponse
  } catch {
    if (text.trimStart().startsWith("<")) {
      return { error: "模型列表接口返回了网页，请检查 Base URL 或模型列表路径" }
    }
    return { error: "模型列表接口未返回有效 JSON" }
  }
}

const REASONING_OPTIONS: { value: ReasoningEffort | ""; label: string }[] = [
  { value: "", label: "默认（不传该参数）" },
  { value: "low", label: "低（low）" },
  { value: "medium", label: "中（medium）" },
  { value: "high", label: "高（high）" },
]

const KIND_META: Record<ProviderKind, { title: string; baseUrlPlaceholder: string }> = {
  chat: {
    title: "对话 API 配置",
    baseUrlPlaceholder: "https://api.example.com/v1",
  },
  image: {
    title: "图片 API 配置",
    baseUrlPlaceholder: "https://api.example.com/v1",
  },
  video: {
    title: "视频 API 配置",
    baseUrlPlaceholder: "https://api.example.com/v1",
  },
}

const MODELS_AUTH_OPTIONS = [
  { value: "bearer", label: "Bearer Token" },
  { value: "x-api-key", label: "x-api-key" },
  { value: "query", label: "URL 参数 key" },
  { value: "none", label: "无需鉴权" },
]

type MediaBindingDraft = {
  adapter: MediaAdapterId | ""
  capabilityProfile: ModelProfileId | ""
}

function suggestedBinding(kind: "image" | "video", model: string): MediaBindingDraft {
  const inferred = inferMediaBinding(kind, model)
  return inferred ?? {
    adapter: kind === "video" ? "async-video" : "",
    capabilityProfile: "",
  }
}

function bindingDrafts(connection?: ProviderConnection) {
  return Object.fromEntries(
    connection?.models.map((model) => [model.id, {
      adapter: model.adapter,
      capabilityProfile: model.capabilityProfile,
    }]) ?? []
  ) as Record<string, MediaBindingDraft>
}

function adapterOptions(kind: "image" | "video") {
  const adapters: MediaAdapterId[] = kind === "image"
    ? ["openai-image", "async-image"]
    : ["async-video"]
  return [
    { value: "", label: "选择接口方式" },
    ...adapters.map((adapter) => ({ value: adapter, label: mediaAdapterLabel(adapter) })),
  ]
}

function capabilityOptions(kind: "image" | "video", adapter: MediaAdapterId | "") {
  return [
    { value: "", label: "选择能力模板" },
    ...compatibleModelProfiles(kind, adapter || null).map((profile) => ({
      value: profile,
      label: modelProfileLabel(profile),
    })),
  ]
}

function MediaModelBindings({
  kind,
  models,
  bindings,
  onChange,
}: {
  kind: "image" | "video"
  models: string[]
  bindings: Record<string, MediaBindingDraft>
  onChange: (model: string, binding: MediaBindingDraft) => void
}) {
  if (!models.length) return null
  return (
    <div className={styles.bindingList}>
      {models.map((model) => {
        const binding = bindings[model] ?? suggestedBinding(kind, model)
        return (
          <div key={model} className={styles.bindingItem}>
            <strong title={model}>{model}</strong>
            <SelectMenu
              ariaLabel={`${model} 接口方式`}
              value={binding.adapter}
              options={adapterOptions(kind)}
              onChange={(value) => {
                const adapter = value as MediaAdapterId | ""
                const compatible = binding.capabilityProfile && adapter
                  ? compatibleModelProfiles(kind, adapter).includes(binding.capabilityProfile)
                  : false
                onChange(model, {
                  adapter,
                  capabilityProfile: compatible ? binding.capabilityProfile : "",
                })
              }}
            />
            <SelectMenu
              ariaLabel={`${model} 能力模板`}
              value={binding.capabilityProfile}
              options={capabilityOptions(kind, binding.adapter)}
              onChange={(value) => onChange(model, {
                ...binding,
                capabilityProfile: value as ModelProfileId | "",
              })}
              disabled={!binding.adapter}
            />
          </div>
        )
      })}
    </div>
  )
}

type DialogProps = {
  kind: ProviderKind
  onSaved: (settings: ProviderSettings | null) => void
  onCancel: () => void
}

export function ProviderSettingsDialog(props: DialogProps) {
  return props.kind === "chat"
    ? <SingleProviderSettingsDialog {...props} />
    : props.kind === "image"
      ? <ImageProviderSettingsDialog {...props} />
    : <MediaProviderSettingsDialog {...props} kind={props.kind} />
}

function ImageProviderSettingsDialog({ onSaved, onCancel }: DialogProps) {
  const [initial] = useState(() => loadProviderSettings("image"))
  const initialConnections = initial?.connections ?? []
  const [connections, setConnections] = useState<ProviderConnection[]>(initialConnections)
  const [selectedId, setSelectedId] = useState(initial?.activeConnectionId ?? initialConnections[0]?.id ?? "new")
  const selected = connections.find((connection) => connection.id === selectedId)
  const [name, setName] = useState(selected?.name ?? "")
  const [baseUrl, setBaseUrl] = useState(selected?.baseUrl ?? "")
  const [apiKey, setApiKey] = useState(selected?.apiKey ?? "")
  const [modelOptions, setModelOptions] = useState<string[]>(selected?.models.map((model) => model.id) ?? [])
  const [checked, setChecked] = useState<Set<string>>(() => new Set(selected?.models.map((model) => model.id) ?? []))
  const [bindings, setBindings] = useState<Record<string, MediaBindingDraft>>(() => bindingDrafts(selected))
  const [manualModel, setManualModel] = useState("")
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState("")
  const [advanced, setAdvanced] = useState(false)
  const [modelsPath, setModelsPath] = useState(selected?.paths?.models ?? "")
  const [modelsAuth, setModelsAuth] = useState<"bearer" | "x-api-key" | "query" | "none">(selected?.modelDiscoveryAuth ?? "bearer")
  const [generatePath, setGeneratePath] = useState(selected?.paths?.imageGenerate ?? "")
  const [statusPath, setStatusPath] = useState(selected?.paths?.imageGenerateStatus ?? "")
  const [editPath, setEditPath] = useState(selected?.paths?.imageEdit ?? "")
  const [editStatusPath, setEditStatusPath] = useState(selected?.paths?.imageEditStatus ?? "")
  const [verifiedConnection, setVerifiedConnection] = useState(
    selected ? `${selected.baseUrl.trim()}\n${selected.apiKey.trim()}` : ""
  )

  const connectionFingerprint = `${baseUrl.trim()}\n${apiKey.trim()}`
  const connectionVerified = Boolean(connectionFingerprint && connectionFingerprint === verifiedConnection)
  const selectedCount = modelOptions.filter((id) => checked.has(id)).length

  function loadDraft(connection?: ProviderConnection) {
    setName(connection?.name ?? "")
    setBaseUrl(connection?.baseUrl ?? "")
    setApiKey(connection?.apiKey ?? "")
    const models = connection?.models.map((model) => model.id) ?? []
    setModelOptions(models)
    setChecked(new Set(models))
    setBindings(bindingDrafts(connection))
    setModelsPath(connection?.paths?.models ?? "")
    setModelsAuth(connection?.modelDiscoveryAuth ?? "bearer")
    setGeneratePath(connection?.paths?.imageGenerate ?? "")
    setStatusPath(connection?.paths?.imageGenerateStatus ?? "")
    setEditPath(connection?.paths?.imageEdit ?? "")
    setEditStatusPath(connection?.paths?.imageEditStatus ?? "")
    setVerifiedConnection(connection ? `${connection.baseUrl.trim()}\n${connection.apiKey.trim()}` : "")
    setError("")
  }

  function selectConnection(id: string) {
    setSelectedId(id)
    loadDraft(connections.find((connection) => connection.id === id))
  }

  function addConnection() {
    setSelectedId("new")
    loadDraft()
  }

  function toggleModel(id: string) {
    setChecked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function addManualModel() {
    const id = manualModel.trim()
    if (!id) return
    setModelOptions((current) => current.includes(id) ? current : [...current, id])
    setBindings((current) => current[id] ? current : { ...current, [id]: suggestedBinding("image", id) })
    setChecked((current) => new Set(current).add(id))
    setManualModel("")
    setError("")
  }

  async function fetchModels() {
    if (fetching) return
    if (!name.trim() || !baseUrl.trim() || !apiKey.trim()) {
      setError("请填写渠道名称、API 地址和 API Key")
      return
    }
    setFetching(true)
    setError("")
    try {
      const response = await fetch("/api/chat/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim(),
          ...(modelsPath.trim() ? { path: modelsPath.trim() } : {}),
          auth: modelsAuth,
        }),
      })
      const data = await readModelsResponse(response)
      if (!response.ok) throw new Error(data.error ?? "获取模型失败")
      const models = [...new Set((data.models ?? []).map((model) => model.trim()).filter(Boolean))]
      setModelOptions(models)
      setBindings((current) => Object.fromEntries(models.map((id) => [id, current[id] ?? suggestedBinding("image", id)])))
      setChecked((current) => new Set(models.filter((id) => current.has(id))))
      setVerifiedConnection(connectionFingerprint)
      if (!models.length) setError("上游没有返回模型，请手动添加模型 ID")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "获取模型失败")
    } finally {
      setFetching(false)
    }
  }

  function save() {
    const models = modelOptions.filter((id) => checked.has(id)).flatMap((id) => {
      const binding = bindings[id]
      return binding?.adapter && binding.capabilityProfile
        ? [{ id, adapter: binding.adapter, capabilityProfile: binding.capabilityProfile }]
        : []
    })
    if (!name.trim() || !baseUrl.trim() || !apiKey.trim() || !models.length || models.length !== selectedCount) {
      setError("请填写连接信息，并为每个已选模型选择接口方式和能力模板")
      return
    }
    const id = selected?.id ?? createClientId()
    const paths = {
      ...(modelsPath.trim() ? { models: modelsPath.trim() } : {}),
      ...(generatePath.trim() ? { imageGenerate: generatePath.trim() } : {}),
      ...(statusPath.trim() ? { imageGenerateStatus: statusPath.trim() } : {}),
      ...(editPath.trim() ? { imageEdit: editPath.trim() } : {}),
      ...(editStatusPath.trim() ? { imageEditStatus: editStatusPath.trim() } : {}),
    }
    const connection: ProviderConnection = {
      version: 3,
      id,
      kind: "image",
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      ...(Object.keys(paths).length ? { paths } : {}),
      modelDiscoveryAuth: modelsAuth,
      models,
      activeModelId: models.some((model) => model.id === selected?.activeModelId) ? selected!.activeModelId : models[0]!.id,
      confirmed: true,
    }
    const next = selected ? connections.map((item) => item.id === id ? connection : item) : [...connections, connection]
    const settings = settingsFromConnections(next, id)
    if (!settings) return
    saveProviderSettings("image", settings)
    onSaved(settings)
  }

  function removeCurrent() {
    if (!selected) return
    const next = connections.filter((connection) => connection.id !== selected.id)
    if (!next.length) {
      clearProviderSettings("image")
      onSaved(null)
      return
    }
    const settings = settingsFromConnections(next, next[0]!.id)
    if (!settings) return
    saveProviderSettings("image", settings)
    setConnections(next)
    setSelectedId(next[0]!.id)
    loadDraft(next[0])
  }

  return (
    <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onCancel() }}>
      <section className={`${styles.settingsDialog} ${styles.mediaDialog} ${styles.imageDialog}`} role="dialog" aria-modal="true" aria-labelledby="image-provider-title">
        <div className={styles.dialogHeading}>
          <div>
            <h2 id="image-provider-title">图片 API</h2>
          </div>
          <button type="button" className={styles.dialogClose} onClick={onCancel} aria-label="关闭"><X size={16} /></button>
        </div>
        <div className={styles.connectionTabs} aria-label="图片 API 渠道">
          {connections.map((connection) => <button key={connection.id} type="button" className={connection.id === selectedId ? styles.connectionActive : ""} onClick={() => selectConnection(connection.id)}>{connection.name}</button>)}
          <button type="button" className={styles.addConnection} onClick={addConnection} aria-label="添加渠道" title="添加渠道"><Plus size={16} /></button>
        </div>
        <label className={styles.fieldGroup}><span>渠道名称</span><input className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder="自己填写一个名称" autoComplete="off" /></label>
        <label className={styles.fieldGroup}><span>API 地址</span><input className="field" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" autoComplete="off" spellCheck={false} /></label>
        <label className={styles.fieldGroup}><span>API Key</span><input className="field" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="粘贴你的 API Key" autoComplete="off" /></label>
        <button className="button" type="button" disabled={fetching || !name.trim() || !baseUrl.trim() || !apiKey.trim()} onClick={() => void fetchModels()}>{fetching ? "获取中…" : "获取模型"}</button>
        <div className={styles.modelRow}>
          <input className="field" value={manualModel} onChange={(event) => setManualModel(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addManualModel() } }} placeholder="手动填写模型 ID" />
          <button className="button" type="button" onClick={addManualModel}>添加</button>
        </div>
        {!connectionVerified && modelOptions.length ? <p className={styles.verifyNotice}>连接信息已修改，请重新获取模型</p> : null}
        <ProviderModelGrid models={modelOptions} selected={checked} onToggle={toggleModel} />
        <MediaModelBindings
          kind="image"
          models={modelOptions.filter((id) => checked.has(id))}
          bindings={bindings}
          onChange={(model, binding) => setBindings((current) => ({ ...current, [model]: binding }))}
        />
        <button className="button" type="button" onClick={() => setAdvanced((value) => !value)}>{advanced ? "收起高级设置" : "高级设置"}</button>
        {advanced ? <div className={styles.advancedGrid}>
          <label className={styles.fieldGroup}><span>模型列表路径</span><input className="field" value={modelsPath} onChange={(event) => setModelsPath(event.target.value)} placeholder="/models" /></label>
          <div className={styles.fieldGroup}><span>模型列表鉴权</span><SelectMenu ariaLabel="模型列表鉴权" value={modelsAuth} options={MODELS_AUTH_OPTIONS} onChange={(value) => setModelsAuth(value as typeof modelsAuth)} /></div>
          <label className={styles.fieldGroup}><span>生成路径</span><input className="field" value={generatePath} onChange={(event) => setGeneratePath(event.target.value)} placeholder="/images/generations" /></label>
          <label className={styles.fieldGroup}><span>生成状态路径</span><input className="field" value={statusPath} onChange={(event) => setStatusPath(event.target.value)} placeholder="/images/generations/{taskId}" /></label>
          <label className={styles.fieldGroup}><span>图片编辑路径</span><input className="field" value={editPath} onChange={(event) => setEditPath(event.target.value)} placeholder="/images/edits" /></label>
          <label className={styles.fieldGroup}><span>编辑状态路径</span><input className="field" value={editStatusPath} onChange={(event) => setEditStatusPath(event.target.value)} placeholder="/images/edits/{taskId}" /></label>
        </div> : null}
        {error ? <p className="error">{error}</p> : null}
        <div className={styles.dialogActions}><button className={`button ${styles.clearButton}`} type="button" onClick={removeCurrent} disabled={!selected}>删除渠道</button><span className={styles.actionsSpacer} /><button className="button" type="button" onClick={onCancel}>取消</button><button className="button button-primary" type="button" disabled={!name.trim() || !baseUrl.trim() || !apiKey.trim() || selectedCount === 0} onClick={save}>保存</button></div>
      </section>
    </div>
  )
}

function SingleProviderSettingsDialog({
  kind,
  onSaved,
  onCancel,
}: DialogProps) {
  const meta = KIND_META[kind]
  const isChat = kind === "chat"
  const [initial] = useState(() => loadProviderSettings(kind))
  const [protocol, setProtocol] = useState<NonNullable<ProviderSettings["protocol"]>>(
    initial?.protocol ?? "chat-completions"
  )
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "")
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? "")
  const [modelOptions, setModelOptions] = useState<string[]>(
    () => initial?.models ?? []
  )
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(initial?.models ?? [])
  )
  const [manualModel, setManualModel] = useState("")
  const [reasoning, setReasoning] = useState<ReasoningEffort | "">(
    initial?.reasoningEffort ?? ""
  )
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState("")

  function toggleModel(item: string) {
    setChecked((current) => {
      const next = new Set(current)
      if (next.has(item)) next.delete(item)
      else next.add(item)
      return next
    })
  }

  function addManualModel() {
    const id = manualModel.trim()
    if (!id) return
    setModelOptions((current) => current.includes(id) ? current : [...current, id])
    setChecked((current) => new Set(current).add(id))
    setManualModel("")
    setError("")
  }

  async function fetchModels() {
    if (fetching) return
    if (!baseUrl.trim() || !apiKey.trim()) {
      setError("请先填写 Base URL 和 API Key")
      return
    }
    setFetching(true)
    setError("")
    try {
      const response = await fetch("/api/chat/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim() }),
      })
      const data = await readModelsResponse(response)
      if (!response.ok) {
        setError(data.error ?? "拉取模型失败")
        return
      }
      const list = [...new Set((data.models ?? []).map((model) => model.trim()).filter(Boolean))]
      if (!list.length) {
        setError("上游没有返回模型，请手动添加模型 ID")
        return
      }
      setModelOptions(list)
      setChecked((current) => new Set(list.filter((item) => current.has(item))))
    } catch {
      setError("网络异常，请稍后重试")
    } finally {
      setFetching(false)
    }
  }

  function save() {
    const models = modelOptions.filter((item) => checked.has(item))
    if (!baseUrl.trim() || !apiKey.trim() || !models.length) return
    const activeModel =
      initial?.activeModel && models.includes(initial.activeModel)
        ? initial.activeModel
        : models[0]
    const settings: ProviderSettings = {
      protocol: isChat ? protocol : undefined,
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      models,
      activeModel,
      reasoningEffort: isChat ? reasoning || undefined : undefined,
    }
    saveProviderSettings(kind, settings)
    onSaved(settings)
  }

  function clear() {
    clearProviderSettings(kind)
    onSaved(null)
  }

  const checkedCount = modelOptions.filter((item) => checked.has(item)).length

  return (
    <div
      className={styles.dialogBackdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onCancel()
      }}
    >
      <section
        className={styles.settingsDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-settings-title"
      >
        <h2 id="provider-settings-title">{meta.title}</h2>

        {isChat ? (
          <div className={styles.protocolGroup} role="radiogroup" aria-label="协议类型">
            <label className={`${styles.protocolCard} ${protocol === "chat-completions" ? styles.protocolActive : ""}`}>
              <input
                type="radio"
                name="chat-protocol"
                checked={protocol === "chat-completions"}
                onChange={() => setProtocol("chat-completions")}
              />
              <strong>Chat Completions</strong>
              <small>/chat/completions</small>
            </label>
            <label className={`${styles.protocolCard} ${protocol === "responses" ? styles.protocolActive : ""}`}>
              <input
                type="radio"
                name="chat-protocol"
                checked={protocol === "responses"}
                onChange={() => setProtocol("responses")}
              />
              <strong>Responses API</strong>
              <small>/responses</small>
            </label>
          </div>
        ) : null}

        <label className={styles.fieldGroup}>
          <span>Base URL</span>
          <input
            className="field"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder={meta.baseUrlPlaceholder}
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <label className={styles.fieldGroup}>
          <span>API Key</span>
          <input
            className="field"
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="sk-..."
            autoComplete="off"
          />
        </label>

        <button
          className="button"
          type="button"
          disabled={fetching || !baseUrl.trim() || !apiKey.trim()}
          onClick={() => void fetchModels()}
        >
          {fetching ? "拉取中…" : "拉取模型"}
        </button>
        <div className={styles.modelRow}>
          <input className="field" value={manualModel} onChange={(event) => setManualModel(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addManualModel() } }} placeholder="手动填写模型 ID" />
          <button className="button" type="button" onClick={addManualModel}>添加</button>
        </div>
        <ProviderModelGrid models={modelOptions} selected={checked} onToggle={toggleModel} />

        {isChat ? (
          <label className={styles.fieldGroup}>
            <span>思考级别（仅支持推理的模型生效）</span>
            <select
              className="field"
              value={reasoning}
              onChange={(event) => setReasoning(event.target.value as ReasoningEffort | "")}
            >
              {REASONING_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {error ? <p className="error">{error}</p> : null}

        <div className={styles.dialogActions}>
          {initial ? (
            <button className={`button ${styles.clearButton}`} type="button" onClick={clear}>
              清除配置
            </button>
          ) : null}
          <span className={styles.actionsSpacer} />
          <button className="button" type="button" onClick={onCancel}>
            取消
          </button>
          <button
            className="button button-primary"
            type="button"
            disabled={!baseUrl.trim() || !apiKey.trim() || checkedCount === 0}
            onClick={save}
          >
            保存
          </button>
        </div>
      </section>
    </div>
  )
}

function MediaProviderSettingsDialog({
  kind,
  onSaved,
  onCancel,
}: DialogProps & { kind: "image" | "video" }) {
  const [initial] = useState(() => loadProviderSettings(kind))
  const initialConnections = initial?.connections ?? []
  const [connections, setConnections] = useState<ProviderConnection[]>(initialConnections)
  const [selectedId, setSelectedId] = useState(initial?.activeConnectionId ?? initialConnections[0]?.id ?? "new")
  const selected = connections.find((connection) => connection.id === selectedId)
  const [name, setName] = useState(selected?.name ?? "")
  const [baseUrl, setBaseUrl] = useState(selected?.baseUrl ?? "")
  const [apiKey, setApiKey] = useState(selected?.apiKey ?? "")
  const [modelOptions, setModelOptions] = useState<string[]>(selected?.models.map((model) => model.id) ?? [])
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(selected?.models.map((model) => model.id) ?? [])
  )
  const [bindings, setBindings] = useState<Record<string, MediaBindingDraft>>(() => bindingDrafts(selected))
  const [manualModel, setManualModel] = useState("")
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState("")
  const [advanced, setAdvanced] = useState(false)
  const [modelsPath, setModelsPath] = useState(selected?.paths?.models ?? "")
  const [modelsAuth, setModelsAuth] = useState<"bearer" | "x-api-key" | "query" | "none">(selected?.modelDiscoveryAuth ?? "bearer")
  const [generatePath, setGeneratePath] = useState(selected?.paths?.imageGenerate ?? selected?.paths?.videoCreate ?? "")
  const [statusPath, setStatusPath] = useState(selected?.paths?.imageGenerateStatus ?? selected?.paths?.videoStatus ?? "")
  const [editPath, setEditPath] = useState(selected?.paths?.imageEdit ?? "")
  const [editStatusPath, setEditStatusPath] = useState(selected?.paths?.imageEditStatus ?? "")

  function loadDraft(connection?: ProviderConnection) {
    setName(connection?.name ?? "")
    setBaseUrl(connection?.baseUrl ?? "")
    setApiKey(connection?.apiKey ?? "")
    const models = connection?.models.map((model) => model.id) ?? []
    setModelOptions(models)
    setChecked(new Set(models))
    setBindings(bindingDrafts(connection))
    setModelsPath(connection?.paths?.models ?? "")
    setModelsAuth(connection?.modelDiscoveryAuth ?? "bearer")
    setGeneratePath(connection?.paths?.imageGenerate ?? connection?.paths?.videoCreate ?? "")
    setStatusPath(connection?.paths?.imageGenerateStatus ?? connection?.paths?.videoStatus ?? "")
    setEditPath(connection?.paths?.imageEdit ?? "")
    setEditStatusPath(connection?.paths?.imageEditStatus ?? "")
    setError("")
  }

  function selectConnection(id: string) {
    setSelectedId(id)
    loadDraft(connections.find((connection) => connection.id === id))
  }

  function addManualModel() {
    const id = manualModel.trim()
    if (!id) return
    setModelOptions((current) => current.includes(id) ? current : [...current, id])
    setBindings((current) => current[id] ? current : { ...current, [id]: suggestedBinding(kind, id) })
    setChecked((current) => new Set(current).add(id))
    setManualModel("")
    setError("")
  }

  function toggleModel(id: string) {
    setChecked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function fetchModels() {
    if (!baseUrl.trim() || !apiKey.trim() || fetching) return
    setFetching(true)
    setError("")
    try {
      const response = await fetch("/api/chat/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim(),
          ...(modelsPath.trim() ? { path: modelsPath.trim() } : {}),
          auth: modelsAuth,
        }),
      })
      const data = await readModelsResponse(response)
      if (!response.ok) throw new Error(data.error ?? "拉取模型失败")
      const ids = [...new Set((data.models ?? []).map((model) => model.trim()).filter(Boolean))]
      setModelOptions(ids)
      setBindings((current) => Object.fromEntries(ids.map((id) => [id, current[id] ?? suggestedBinding(kind, id)])))
      setChecked((current) => new Set(ids.filter((id) => current.has(id))))
      if (!ids.length) setError("上游没有返回模型，请手动添加模型 ID")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "拉取模型失败")
    } finally {
      setFetching(false)
    }
  }

  function save() {
    const models = modelOptions.filter((id) => checked.has(id)).flatMap((id) => {
      const binding = bindings[id]
      return binding?.adapter && binding.capabilityProfile
        ? [{ id, adapter: binding.adapter, capabilityProfile: binding.capabilityProfile }]
        : []
    })
    if (!baseUrl.trim() || !apiKey.trim() || !models.length || models.length !== checked.size) {
      setError("请填写连接信息，并为每个已选模型选择接口方式和能力模板")
      return
    }
    const id = selected?.id ?? createClientId()
    const paths = {
      ...(modelsPath.trim() ? { models: modelsPath.trim() } : {}),
      ...(generatePath.trim() ? kind === "image" ? { imageGenerate: generatePath.trim() } : { videoCreate: generatePath.trim() } : {}),
      ...(statusPath.trim() ? kind === "image" ? { imageGenerateStatus: statusPath.trim() } : { videoStatus: statusPath.trim() } : {}),
      ...(kind === "image" && editPath.trim() ? { imageEdit: editPath.trim() } : {}),
      ...(kind === "image" && editStatusPath.trim() ? { imageEditStatus: editStatusPath.trim() } : {}),
    }
    const connection: ProviderConnection = {
      version: 3,
      id,
      kind,
      name: name.trim() || `自有${kind === "image" ? "图片" : "视频"} API`,
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      ...(Object.keys(paths).length ? { paths } : {}),
      modelDiscoveryAuth: modelsAuth,
      models,
      activeModelId: models.some((model) => model.id === selected?.activeModelId) ? selected!.activeModelId : models[0]!.id,
      confirmed: true,
    }
    const next = selected
      ? connections.map((item) => item.id === id ? connection : item)
      : [...connections, connection]
    const settings = settingsFromConnections(next, id)
    if (!settings) return
    saveProviderSettings(kind, settings)
    onSaved(settings)
  }

  function removeCurrent() {
    if (!selected) return
    const next = connections.filter((connection) => connection.id !== selected.id)
    if (!next.length) {
      clearProviderSettings(kind)
      onSaved(null)
      return
    }
    const settings = settingsFromConnections(next, next[0]!.id)
    if (!settings) return
    saveProviderSettings(kind, settings)
    setConnections(next)
    setSelectedId(next[0]!.id)
    loadDraft(next[0])
  }

  return (
    <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onCancel() }}>
      <section className={`${styles.settingsDialog} ${styles.mediaDialog}`} role="dialog" aria-modal="true" aria-labelledby="provider-settings-title">
        <h2 id="provider-settings-title">{kind === "image" ? "图片" : "视频"} API</h2>

        <div className={styles.connectionTabs}>
          {connections.map((connection) => (
            <button key={connection.id} type="button" className={connection.id === selectedId ? styles.connectionActive : ""} onClick={() => selectConnection(connection.id)}>
              {connection.name}{connection.confirmed ? "" : " · 待确认"}
            </button>
          ))}
          <button type="button" onClick={() => { setSelectedId("new"); loadDraft() }}>新增渠道</button>
        </div>

        <label className={styles.fieldGroup}><span>渠道名称</span><input className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：我的图片 API" /></label>
        <label className={styles.fieldGroup}><span>Base URL</span><input className="field" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" autoComplete="off" spellCheck={false} /></label>
        <label className={styles.fieldGroup}><span>API Key</span><input className="field" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-..." autoComplete="off" /></label>

        <button className="button" type="button" disabled={fetching || !baseUrl.trim() || !apiKey.trim()} onClick={() => void fetchModels()}>{fetching ? "拉取中…" : "拉取模型"}</button>
        <ProviderModelGrid models={modelOptions} selected={checked} onToggle={toggleModel} />
        <MediaModelBindings
          kind={kind}
          models={modelOptions.filter((id) => checked.has(id))}
          bindings={bindings}
          onChange={(model, binding) => setBindings((current) => ({ ...current, [model]: binding }))}
        />

        <button className="button" type="button" onClick={() => setAdvanced((value) => !value)}>{advanced ? "收起高级设置" : "高级设置"}</button>
        {advanced ? <div className={styles.advancedGrid}>
          <div className={`${styles.fieldGroup} ${styles.advancedManual}`}>
            <span>手动添加模型</span>
            <div className={styles.modelRow}>
              <input className="field" value={manualModel} onChange={(event) => setManualModel(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addManualModel() } }} placeholder="上游模型 ID" />
              <button className="button" type="button" onClick={addManualModel}>添加</button>
            </div>
          </div>
          <label className={styles.fieldGroup}><span>模型列表路径</span><input className="field" value={modelsPath} onChange={(event) => setModelsPath(event.target.value)} placeholder="/models" /></label>
          <div className={styles.fieldGroup}><span>模型列表鉴权</span><SelectMenu ariaLabel="模型列表鉴权" value={modelsAuth} options={MODELS_AUTH_OPTIONS} onChange={(value) => setModelsAuth(value as typeof modelsAuth)} /></div>
          <label className={styles.fieldGroup}><span>{kind === "image" ? "生成路径" : "创建任务路径"}</span><input className="field" value={generatePath} onChange={(event) => setGeneratePath(event.target.value)} placeholder={kind === "image" ? "/images/generations" : "/videos"} /></label>
          <label className={styles.fieldGroup}><span>状态路径（使用 {"{taskId}"}）</span><input className="field" value={statusPath} onChange={(event) => setStatusPath(event.target.value)} placeholder={kind === "image" ? "/images/generations/{taskId}" : "/videos/{taskId}"} /></label>
          {kind === "image" ? <label className={styles.fieldGroup}><span>文件图生图路径</span><input className="field" value={editPath} onChange={(event) => setEditPath(event.target.value)} placeholder="/images/edits" /></label> : null}
          {kind === "image" ? <label className={styles.fieldGroup}><span>文件图生图状态路径</span><input className="field" value={editStatusPath} onChange={(event) => setEditStatusPath(event.target.value)} placeholder="/images/edits/{taskId}" /></label> : null}
        </div> : null}

        {error ? <p className="error">{error}</p> : null}
        <div className={styles.dialogActions}>
          {selected ? <button className={`button ${styles.clearButton}`} type="button" onClick={removeCurrent}>删除渠道</button> : null}
          <span className={styles.actionsSpacer} />
          <button className="button" type="button" onClick={onCancel}>取消</button>
          <button className="button button-primary" type="button" disabled={!baseUrl.trim() || !apiKey.trim() || checked.size === 0} onClick={save}>保存</button>
        </div>
      </section>
    </div>
  )
}
