"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { FolderKanban, Menu } from "lucide-react"

import styles from "./home-shell.module.css"

const nav = [{ href: "/projects", label: "项目", icon: FolderKanban }]

export function HomeShell({ children }: { children: React.ReactNode; guest?: boolean }) {
  const pathname = usePathname()
  const [navOpen, setNavOpen] = useState(false)
  const navRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!navOpen) return
    function onPointerDown(event: PointerEvent) {
      if (!navRef.current?.contains(event.target as Node)) setNavOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setNavOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [navOpen])

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)

  return (
    <main className={styles.homeShell}>
      <header className={styles.homeHeader}>
        <div className={styles.headerLeft}>
          <div className={styles.navMenu} ref={navRef}>
            <button className={styles.iconTrigger} aria-label="菜单" title="菜单" aria-expanded={navOpen} onClick={() => setNavOpen((open) => !open)}>
              <Menu size={17} />
            </button>
            {navOpen ? (
              <div className={`${styles.dropdown} ${styles.navDropdown}`} role="menu">
                {nav.map((item) => {
                  const Icon = item.icon
                  return <Link key={item.href} href={item.href} role="menuitem" className={isActive(item.href) ? styles.active : ""} onClick={() => setNavOpen(false)}><Icon size={14} />{item.label}</Link>
                })}
              </div>
            ) : null}
          </div>
          <Link href="/projects" className="home-brand"><span>ON</span><strong>OpenFlow</strong></Link>
        </div>
        <nav className={styles.mainNav} aria-label="主导航">
          {nav.map((item) => <Link key={item.href} href={item.href} className={isActive(item.href) ? styles.active : ""}>{item.label}</Link>)}
        </nav>
      </header>
      <div className={styles.homeBody}>{children}</div>
    </main>
  )
}
