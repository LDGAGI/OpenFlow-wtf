import type { Metadata } from "next"

import "./globals.css"

export const metadata: Metadata = {
  title: "OpenFlow",
  description: "本地优先的图片与视频生成工作台",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
