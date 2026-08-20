import {
  Braces,
  Bug,
  Code,
  Container,
  Database,
  FileCode,
  Folder,
  FolderOpen,
  GitBranch,
  GitFork,
  Globe,
  Hammer,
  Kanban,
  Layers,
  Notebook,
  PlayCircle,
  Rocket,
  Settings,
  SquareArrowOutUpRight,
  SquareTerminal,
  Terminal,
  TestTube,
  Wrench,
  Zap,
  type LucideIcon
} from 'lucide-react'

/**
 * The icons a preset can carry, as a fixed set rather than the whole library.
 *
 * lucide's dynamic loader would fetch each icon as its own chunk, which puts
 * an empty square in the UI for a frame and, worse, in a screenshot.
 */
export const PRESET_ICONS: Record<string, LucideIcon> = {
  Braces,
  Bug,
  Code,
  Container,
  Database,
  FileCode,
  Folder,
  FolderOpen,
  GitBranch,
  GitFork,
  Globe,
  Hammer,
  Kanban,
  Layers,
  Notebook,
  PlayCircle,
  Rocket,
  Settings,
  SquareArrowOutUpRight,
  SquareTerminal,
  Terminal,
  TestTube,
  Wrench,
  Zap
}

export const PRESET_ICON_NAMES = Object.keys(PRESET_ICONS)

export function presetIcon(name: string): LucideIcon {
  return PRESET_ICONS[name] ?? SquareArrowOutUpRight
}
