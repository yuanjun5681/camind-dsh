/**
 * 应用入口。官方设置面板用 --dsw-alias-* / --dsw-shadow-*，
 * 这些变量在 ui-theme 的 token 表里，官方壳会引入；这里同样引入，否则对话框背景是透明的。
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Root } from './routes'
import { bootOfficialClient } from './officialClient'
import { initTheme } from './theme'
import '@deepseek-ai/dsh-client-ui-theme/styles/base.css'
import '@deepseek-ai/dsh-client-ui-theme/styles/design-platform.css'
import '@deepseek-ai/dsh-client-ui-theme/styles/gradient-shadow-text.css'
import '@deepseek-ai/dsh-client-ui-theme/styles/scrollbar.css'
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
