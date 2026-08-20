import { useState } from 'react'
import { TreePine, FolderGit2, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { invoke } from '@/api/client'

function App(): React.JSX.Element {
  const [pingResult, setPingResult] = useState<string | null>(null)

  const handlePing = async (): Promise<void> => {
    try {
      const value = await invoke('system:ping')
      setPingResult(value)
    } catch (error) {
      setPingResult(`error: ${(error as Error).message}`)
    }
  }

  return (
    <div className="flex h-screen gap-2 bg-background p-2">
      <div className="flex w-[260px] shrink-0 flex-col gap-2">
        <button
          type="button"
          className="flex items-center gap-2 rounded-lg border bg-sidebar px-3 py-2 text-sm font-medium hover:bg-accent"
        >
          <FolderGit2 className="size-4 text-muted-foreground" />
          <span className="flex-1 text-left">No project</span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </button>
        <aside className="flex flex-1 flex-col rounded-lg border bg-sidebar p-3">
          <p className="px-1 text-xs font-medium text-muted-foreground">Worktrees</p>
          <p className="mt-2 px-1 text-sm text-muted-foreground">Coming in M1.</p>
        </aside>
      </div>

      <main className="flex flex-1 flex-col items-center justify-center rounded-lg border bg-card">
        <TreePine className="size-10 text-muted-foreground" />
        <h1 className="mt-4 text-2xl font-semibold">Arborist</h1>
        <p className="mt-1 text-sm text-muted-foreground">M0 scaffold — shell placeholder</p>
        <Button className="mt-6" onClick={handlePing}>
          Ping main process
        </Button>
        {pingResult !== null && (
          <p data-testid="ping-result" className="mt-3 font-mono text-sm text-muted-foreground">
            {pingResult}
          </p>
        )}
      </main>
    </div>
  )
}

export default App
