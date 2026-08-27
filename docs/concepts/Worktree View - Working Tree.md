# Worktree View - Working Tree

This concept displays a working tree view containing local changes to the current branch, and the user has selected a file change to bring up a third panel on the right to diff changes within that file.

## On The Right-Hand Panel

The panel to the right is a standard UI pattern that may be re-used by other flows (e.g. the commit graph view). It should disappear if it's "parent" context disappears from view (in this case, the file the user is viewing is unmounted because they changed tabs, worktrees or projects). It should not have an empty state.
No matter how many panels are visible, the right-hand-most panel should be the one that scales relatively to the window's width. This means that if two panels are open, the second panel scales to the window's width, where the left one maintains an absolute width when the window is resized. Likewise, if three panels are open, the two left panels maintain an absolute width while the third scales with the width of the window. Note that this should only affect panels that go from relatively-sized to absolutely-sized: in this example, the left sidebar's width is not changed whether two or three panels are open, because it is always absolutely-widthed.
In cases where a panel goes from being relatively-scaled to absolutely-sized (such as the second panel when a third is opened), it should remember it's absolute width such that it snaps to that width when a third panel opens again. This should be remembered across app sessions.
