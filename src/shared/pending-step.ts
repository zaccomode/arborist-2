/**
 * A step that awaits something and then acts, which the person can call off
 * while it waits (#161). Delete asks git whether the worktree is dirty before
 * deciding what to do; if the dialog is dismissed in the meantime, the answer
 * must neither open the force-delete question nor delete anything.
 *
 * `begin()` returns a check to make after each `await`: it stays true until
 * `cancel()` is called or another step begins. Kept free of React so it is
 * tested directly.
 */
export interface PendingStep {
  begin(): () => boolean
  cancel(): void
}

export function createPendingStep(): PendingStep {
  let generation = 0
  return {
    begin() {
      const mine = ++generation
      return () => mine === generation
    },
    cancel() {
      generation++
    }
  }
}
