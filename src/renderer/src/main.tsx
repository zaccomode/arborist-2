import './assets/main.css'

import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { GitGate } from './components/git-gate'
import { StoreStatusToasts } from './components/store-status'
import { ThemeSync } from './components/theme-sync'
import { UpdateToasts } from './components/update-notice'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Worktree state is re-read from git, so a refetch is cheap and a
      // stale view is the thing to avoid. #11 tunes this alongside the
      // refresh pipeline.
      staleTime: 15_000,
      refetchOnWindowFocus: true
    }
  }
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* Mirrors the theme onto a `.dark` class, following the OS until the
        settings screen sets it explicitly. */}
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <StoreStatusToasts />
          <UpdateToasts />
          <ThemeSync />
          <GitGate>
            <App />
          </GitGate>
        </TooltipProvider>
      </QueryClientProvider>
      <Toaster />
    </ThemeProvider>
  </React.StrictMode>
)
