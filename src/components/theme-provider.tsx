'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';

/**
 * Applies theme, font, and font size data attributes to the document root.
 * This enables CSS variable-based theming via [data-theme], [data-font], [data-fontsize].
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useAppStore((s) => s.theme);
  const font = useAppStore((s) => s.font);
  const fontSize = useAppStore((s) => s.fontSize);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-font', font);
    root.setAttribute('data-fontsize', fontSize);
  }, [theme, font, fontSize]);

  return <>{children}</>;
}
