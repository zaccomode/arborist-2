import './assets/main.css'

import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import App from './App'
import { GitGate } from './components/git-gate'
import { StoreStatusToasts } from './components/store-status'
import { Toaster } from '@/components/ui/sonner'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* Mirrors the theme onto a `.dark` class, following the OS until the
        settings screen sets it explicitly. */}
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <StoreStatusToasts />
      <GitGate>
        <App />
      </GitGate>
      <Toaster />
    </ThemeProvider>
  </React.StrictMode>
)
