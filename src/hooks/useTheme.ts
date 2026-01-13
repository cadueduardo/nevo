'use client'

import { useTheme as useThemeContext } from '@/components/providers/ThemeProvider'

export function useTheme() {
  return useThemeContext()
}
