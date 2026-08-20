import { useEffect, useMemo, useState } from 'react'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Sidebar } from '@/components/sidebar'
import { NoProjects, ProjectDetail } from '@/components/detail-pane'
import { useAddProject, useProjects, useRemoveProject } from '@/api/queries'
import { invoke } from '@/api/client'
import { useSelection } from '@/state/selection'

function App(): React.JSX.Element {
  const projects = useProjects()
  const addProject = useAddProject()
  const removeProject = useRemoveProject()
  const [addError, setAddError] = useState<string | null>(null)

  const { projectId, selectProject } = useSelection()
  const list = useMemo(() => projects.data ?? [], [projects.data])
  const selected = list.find((project) => project.id === projectId) ?? null

  useEffect(() => {
    // Land on something as soon as there is something to land on, including
    // after the selected project is removed.
    if (!selected && list.length > 0) selectProject(list[0].id)
    if (list.length === 0 && projectId) selectProject(null)
  }, [list, selected, projectId, selectProject])

  const handleAddProject = async (): Promise<void> => {
    setAddError(null)
    const path = await invoke('system:pickFolder')
    if (!path) return
    try {
      const added = await addProject.mutateAsync(path)
      selectProject(added.id)
    } catch (error) {
      setAddError((error as Error).message)
    }
  }

  return (
    <div className="h-screen bg-background p-2">
      <ResizablePanelGroup orientation="horizontal">
        {/* Numeric sizes are pixels: the concept's sidebar is about 260 wide. */}
        <ResizablePanel defaultSize={260} minSize={200} maxSize={420}>
          <Sidebar
            projects={list}
            selectedId={selected?.id ?? null}
            onSelect={selectProject}
            onAddProject={() => void handleAddProject()}
            addError={addError}
          />
        </ResizablePanel>
        <ResizableHandle className="mx-1 bg-transparent" />
        <ResizablePanel>
          <main className="h-full rounded-lg border bg-card">
            {selected ? (
              <ProjectDetail
                project={selected}
                onRemove={() => removeProject.mutate(selected.id)}
              />
            ) : (
              <NoProjects onAddProject={() => void handleAddProject()} />
            )}
          </main>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}

export default App
