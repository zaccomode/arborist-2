import './assets/main.css'

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { GitGate } from './components/git-gate'

// Follow the OS theme until M1 wires nativeTheme + an explicit setting.
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
const applyTheme = (): void => {
  document.documentElement.classList.toggle('dark', darkQuery.matches)
}
applyTheme()
darkQuery.addEventListener('change', applyTheme)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GitGate>
      <App />
    </GitGate>
  </React.StrictMode>
)
