/**
 * 应用入口。官方设置面板用 --dsw-alias-* / --dsw-shadow-*，
 * 这些变量在 ui-theme 的 token 表里；0.1.1 起官方 ui-theme 客户端插件
 * 激活时自行注入全部五张全局样式表（含 shiki），无需这里静态引入。
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Root } from './routes'
import { bootOfficialClient } from './officialClient'
import { initTheme } from './theme'
import './officialMenu.css'
import './styles.css'

initTheme()
void bootOfficialClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename="/camind">
      <Root />
    </BrowserRouter>
  </StrictMode>,
)
