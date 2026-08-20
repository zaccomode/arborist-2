import { createElement } from 'react'
import { presetIcon } from '@/lib/preset-icons'

/**
 * A preset's icon, by name.
 *
 * `createElement` rather than assigning the looked-up component to a
 * capitalised variable and rendering it: the latter creates a component
 * during render, which remounts its subtree on every pass.
 */
export function PresetIcon({
  name,
  className
}: {
  name: string
  className?: string
}): React.JSX.Element {
  return createElement(presetIcon(name), { className })
}
