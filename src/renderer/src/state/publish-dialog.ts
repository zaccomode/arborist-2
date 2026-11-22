import { create } from 'zustand'

/**
 * Whether the Publish to GitHub dialog is open (#150). A store rather than
 * App state, since three places open it — the project switcher, and the push
 * buttons in the detail header and the commit box when the project has no
 * remote to push to — and threading a callback down to each is noise.
 */
export const usePublishDialog = create<{
  open: boolean
  setOpen: (open: boolean) => void
}>((set) => ({
  open: false,
  setOpen: (open) => set({ open })
}))
