import { useEffect, useRef } from 'react'
import { ArrowDownUp, Search, X } from 'lucide-react'
import { LIST_SORT_LABELS, type ListSort } from '@shared/list-view'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import type { ListSearch } from '@/state/list-search'

/**
 * Everything one sidebar list needs to be sorted and searched: the persisted
 * order plus its setter, the session-only search box state, and — for the
 * Worktrees list only — the pin toggle. Grouped rather than passed as six
 * loose props, since the two lists take the same shape and the `Sidebar` that
 * renders both would otherwise carry twelve.
 */
export interface ListViewControls {
  sort: ListSort
  onSortChange: (sort: ListSort) => void
  /** Omit both to leave the pin toggle out — the Remote Branches list has nothing to pin. */
  mainFirst?: boolean
  onMainFirstChange?: (mainFirst: boolean) => void
  search: ListSearch
}

/**
 * The two icon buttons every sidebar list header carries (#77), sitting
 * beside whatever action that list already had — "New worktree" on
 * Worktrees, "Fetch remotes" on Remote Branches. Icon-only until clicked, so
 * a header that was one word and one button stays that shape: search opens a
 * field below the header, sort opens a menu.
 *
 * `mainFirst` is the Worktrees list's own pin toggle and is absent from the
 * Remote Branches menu, which has no main branch to pin. It is a checkbox
 * item under a separator rather than a third radio option, because it is
 * orthogonal to the order: pinning partitions the list and the sort still
 * orders within each half.
 */
export function ListControls({
  label,
  view,
  disabled
}: {
  /** The list this controls, for the buttons' accessible names. */
  label: string
  view: ListViewControls
  disabled?: boolean
}): React.JSX.Element {
  const { search, sort, onSortChange, mainFirst, onMainFirstChange } = view

  return (
    <>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={search.open ? `Hide ${label} search` : `Search ${label}`}
        aria-pressed={search.open}
        disabled={disabled}
        onClick={() => search.setOpen(!search.open)}
      >
        {search.open ? <X /> : <Search />}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label={`Sort ${label}`} disabled={disabled}>
            <ArrowDownUp />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup
            value={sort}
            onValueChange={(value) => onSortChange(value as ListSort)}
          >
            <DropdownMenuRadioItem value="alphabetical">
              {LIST_SORT_LABELS.alphabetical}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="recently-updated">
              {LIST_SORT_LABELS['recently-updated']}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          {onMainFirstChange && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={mainFirst}
                onCheckedChange={(checked) => onMainFirstChange(checked === true)}
              >
                Keep main at the top
              </DropdownMenuCheckboxItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}

/**
 * The field the search button reveals. Focused on open, so the button is one
 * click rather than a click and then an aim, and Escape closes it — which
 * also clears the query, since `setOpen(false)` is what does the clearing.
 *
 * Rendered by the list rather than by `ListControls` because it belongs
 * under the header, not inside the row of icon buttons.
 */
export function ListSearchField({
  label,
  search
}: {
  label: string
  search: ListSearch
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <Input
      ref={inputRef}
      type="search"
      data-testid={`${label.toLowerCase().replace(/\s+/g, '-')}-search`}
      className="mb-1 h-7 text-sm"
      placeholder={`Filter ${label.toLowerCase()}…`}
      aria-label={`Filter ${label.toLowerCase()}`}
      value={search.query}
      onChange={(event) => search.setQuery(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') search.setOpen(false)
      }}
    />
  )
}

/**
 * What a list says when a filter is on and nothing matches — distinct from
 * its own empty state, which would otherwise claim the repository has no
 * worktrees when it has plenty and the filter is simply too narrow.
 */
export function NoListMatches({ query }: { query: string }): React.JSX.Element {
  return (
    <p className="px-2 py-1 text-sm text-muted-foreground">
      Nothing matches &ldquo;{query.trim()}&rdquo;.
    </p>
  )
}
