import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"
import nextTs from "eslint-config-next/typescript"

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "node_modules/**", "data/**"]),
  {
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='jsx']",
          message: "禁止使用 styled-jsx（<style jsx>）：scoped class 不会加到 Link 等外部组件上，样式会静默失效。请改用 CSS Modules（*.module.css + className={styles.x}）。",
        },
      ],
    },
  },
])
