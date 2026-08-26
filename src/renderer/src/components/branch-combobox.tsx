import { useRef, useState } from 'react'
import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export interface BaseRefOption {
  /** What `worktrees:create` receives as `baseRef`; empty means HEAD. */
  value: string
  label: string
  group: 'head' | 'local' | 'remote'
}

/**
 * A searchable picker for `worktrees:create`'s `baseRef`, and for the
 * switch-branch picker: HEAD, local branches, and remote branches, in that
 * order. A real repository has dozens of branches, which is what the search
 * is for — cmdk filters the list against whatever is typed.
 *
 * `allowCreate` adds a "Create branch “x”" row whenever the typed search
 * doesn't exactly match an existing option — the switch-branch dialog's
 * create-a-new-branch flow (#69 review). When there's nothing typed yet and
 * nothing to pick from, the empty state itself calls that out with a button
 * rather than relying on the user already knowing typing a name works (#69
 * review, round two). The base-ref picker on create-worktree leaves it
 * unset: every base there has to already exist.
 */
export function BranchCombobox({
  value,
  onChange,
  options,
  loading,
  allowCreate
}: {
  value: string
  onChange: (value: string) => void
  options: BaseRefOption[]
  loading: boolean
  allowCreate?: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const selected = options.find((option) => option.value === value)

  const trimmedSearch = search.trim()
  const showCreate =
    allowCreate &&
    trimmedSearch.length > 0 &&
    !options.some((option) => option.value === trimmedSearch)

  const groups: { key: BaseRefOption['group']; heading: string }[] = [
    { key: 'head', heading: 'Start point' },
    { key: 'local', heading: 'Local branches' },
    { key: 'remote', heading: 'Remote branches' }
  ]

  const triggerLabel = selected?.label ?? (value || (allowCreate ? 'Select a branch' : 'HEAD'))

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // Fresh search next time it opens, rather than showing whatever was
        // typed (and possibly since abandoned) the last time.
        if (!next) setSearch('')
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronsUpDown className="shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) p-0"
        // A base ref rarely matters once the dialog has focus elsewhere;
        // stealing it back from the branch field the moment this opens
        // would undo whatever the user was about to type there.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <Command>
          <CommandInput
            ref={inputRef}
            placeholder="Search branches…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              {loading ? (
                'Loading…'
              ) : allowCreate && trimmedSearch.length === 0 ? (
                // Nothing typed yet and nothing to pick from — the bare "No
                // matching branch." left the create flow undiscoverable
                // (#69 review): a button gives it a visible affordance
                // rather than relying on the user to already know that
                // typing a name works.
                <div className="flex flex-col items-center gap-2">
                  <span>No matching branch. Type a name to create one.</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => inputRef.current?.focus()}
                  >
                    <Plus />
                    Create a new branch
                  </Button>
                </div>
              ) : (
                'No matching branch.'
              )}
            </CommandEmpty>
            {showCreate && (
              <CommandGroup heading="Create">
                <CommandItem
                  value={`create ${trimmedSearch}`}
                  onSelect={() => {
                    onChange(trimmedSearch)
                    setOpen(false)
                  }}
                >
                  <Plus />
                  <span className="truncate">Create branch “{trimmedSearch}”</span>
                </CommandItem>
              </CommandGroup>
            )}
            {groups.map(({ key, heading }) => {
              const entries = options.filter((option) => option.group === key)
              if (entries.length === 0) return null
              return (
                <CommandGroup key={key} heading={heading}>
                  {entries.map((option) => (
                    <CommandItem
                      key={`${key}:${option.value}`}
                      value={`${option.label} ${option.value}`}
                      onSelect={() => {
                        onChange(option.value)
                        setOpen(false)
                      }}
                    >
                      <Check className={cn(option.value !== value && 'invisible')} />
                      <span className="truncate">{option.label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
