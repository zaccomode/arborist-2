import { useEffect } from 'react'
import { useTheme } from 'next-themes'
import { useSettings } from '@/api/queries'

/**
 * Applies the stored theme. The setting is the source of truth, because it
 * travels with the rest of the data file; next-themes only does the applying.
 */
export function ThemeSync(): null {
  const { setTheme } = useTheme()
  const theme = useSettings().data?.theme

  useEffect(() => {
    if (theme) setTheme(theme)
  }, [theme, setTheme])

  return null
}
