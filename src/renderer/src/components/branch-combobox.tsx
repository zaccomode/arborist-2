import { useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
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
 * A searchable picker for `worktrees:create`'s `baseRef`: HEAD, local
 * branches, and remote branches, in that order. A real repository has dozens
 * of branches, which is what the search is for — cmdk filters the list
 * against whatever is typed. The switch-branch palette (#96) has its own
 * list and matching, in `src/shared/branch-picker.ts`.
 */
export function BranchCombobox({
  value,
  onChange,
  options,
  loading
}: {
  value: string
  onChange: (value: string) => void
  options: BaseRefOption[]
  loading: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const selected = options.find((option) => option.value === value)

  const groups: { key: BaseRefOption['group']; heading: string }[] = [
    { key: 'head', heading: 'Start point' },
    { key: 'local', heading: 'Local branches' },
    { key: 'remote', heading: 'Remote branches' }
  ]

  const triggerLabel = selected?.label ?? (value || 'HEAD')

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
          <CommandInput placeholder="Search branches…" value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>{loading ? 'Loading…' : 'No matching branch.'}</CommandEmpty>
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
