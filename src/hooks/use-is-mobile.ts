'use client';

import { useState, useEffect } from 'react';

/**
 * Detects whether the viewport is below the lg breakpoint (1024px).
 * Used to switch ResizablePanelGroup direction between horizontal (desktop) and vertical (mobile).
 */
export function useIsMobile(breakpoint = 1024): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < breakpoint);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [breakpoint]);

  return isMobile;
}
