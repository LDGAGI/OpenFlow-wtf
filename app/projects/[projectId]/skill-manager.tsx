"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Check, FolderUp, Sparkles, Trash2 } from "lucide-react"

import { deleteLocalSkill, listLocalSkills, saveLocalSkill } from "@/lib/local-files/skills"
import { packageFromFolder, type StoredSkill } from "@/lib/skills/types"
import { skillReferenceFileCount } from "@/lib/skills/resources"

import styles from "./skill-manager.module.css"

const FOLDER_INPUT_PROPS = { webkitdirectory: "", directory: "" }

export function SkillManager({ activeSkill, query, onClose, onActivate }: {
  activeSkill: StoredSkill | null
  query: string
  onClose: () => void
  onActivate: (skill: StoredSkill | null) => void
}) {
  const [skills, setSkills] = useState<StoredSkill[]>([])
  const [error, setError] = useState("")
  const [highlighted, setHighlighted] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { void listLocalSkills().then(setSkills) }, [])

  async function importFolder(files: FileList | null) {
    if (!files?.length) return
    try {
      const skill = await packageFromFolder(files)
      await saveLocalSkill(skill)
      setSkills(await listLocalSkills())
      setError("")
      onActivate(skill)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Skill 文件夹无法读取")
    }
  }

  async function remove(skill: StoredSkill) {
    if (!window.confirm(`删除本地 Skill「${skill.name}」？`)) return
    await deleteLocalSkill(skill.id)
    if (activeSkill?.id === skill.id) onActivate(null)
    setSkills(await listLocalSkills())
  }

  const normalizedQuery = query.trim().toLowerCase()
  const visibleSkills = useMemo(() => skills.filter((skill) =>
    !normalizedQuery || `${skill.name} ${skill.description}`.toLowerCase().includes(normalizedQuery)
  ), [normalizedQuery, skills])

  const activeIndex = visibleSkills.length ? Math.min(highlighted, visibleSkills.length - 1) : 0
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowDown" && visibleSkills.length) {
        event.preventDefault()
        setHighlighted((current) => (current + 1) % visibleSkills.length)
      }
      if (event.key === "ArrowUp" && visibleSkills.length) {
        event.preventDefault()
        setHighlighted((current) => (current - 1 + visibleSkills.length) % visibleSkills.length)
      }
      if (event.key === "Enter" && visibleSkills[activeIndex]) {
        event.preventDefault()
        const skill = visibleSkills[activeIndex]
        onActivate(activeSkill?.id === skill.id ? null : skill)
        onClose()
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [activeIndex, activeSkill?.id, onActivate, onClose, visibleSkills])

  return (
    <section className={styles.menu} role="menu" aria-label="选择 Skill">
      <div className={styles.heading}><span>Skill</span><small>{skills.length || ""}</small></div>
      <div className={styles.list}>
        {visibleSkills.length ? visibleSkills.map((skill, index) => {
          const active = activeSkill?.id === skill.id
          return (
            <div className={styles.item} data-active={active} data-highlighted={activeIndex === index} key={skill.id} onMouseEnter={() => setHighlighted(index)}>
              <button
                type="button"
                className={styles.select}
                role="menuitemradio"
                aria-checked={active}
                onClick={() => { onActivate(active ? null : skill); onClose() }}
              >
                <span className={styles.skillIcon}>{active ? <Check size={12} /> : <Sparkles size={12} />}</span>
                <span className={styles.copy}>
                  <strong>{skill.name}</strong>
                  <small>{skill.description} · {skillReferenceFileCount(skill)} 个参考文件</small>
                </span>
              </button>
              <button type="button" className={styles.remove} onClick={() => { void remove(skill) }} title={`删除 ${skill.name}`} aria-label={`删除 ${skill.name}`}><Trash2 size={12} /></button>
            </div>
          )
        }) : <div className={styles.empty}>{skills.length ? "没有匹配的 Skill" : "还没有导入 Skill"}</div>}
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
      <button type="button" className={styles.importButton} onClick={() => fileRef.current?.click()}><FolderUp size={13} /><span>导入 Skill 文件夹</span></button>
      <input ref={fileRef} className={styles.fileInput} type="file" {...FOLDER_INPUT_PROPS} onChange={(event) => { void importFolder(event.target.files); event.target.value = "" }} />
    </section>
  )
}
