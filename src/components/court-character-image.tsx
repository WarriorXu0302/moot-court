'use client';

import Image from 'next/image';
import { cn } from '@/lib/utils';

interface CourtCharacterImageProps {
  src: string;
  name: string;
  isActive?: boolean;
  /** Unused — kept for API compatibility */
  bubble?: string;
}

/**
 * Court character portrait.
 * When isActive: full brightness + glowing border + name highlight (speaking indicator).
 * When inactive: dimmed, no border glow.
 * No speech bubble, no gray overlay box.
 */
export function CourtCharacterImage({ src, name, isActive }: CourtCharacterImageProps) {
  return (
    <div className="relative flex flex-col items-center transition-all duration-500">
      {/* Character image */}
      <div className={cn(
        'relative overflow-hidden rounded-lg transition-all duration-500',
        'w-20 h-24 lg:w-24 lg:h-28',
        isActive
          ? 'ring-2 ring-primary shadow-lg brightness-110 scale-105'
          : 'ring-1 ring-border/40 brightness-50 scale-100'
      )}>
        <Image src={src} alt={name} fill className="object-cover object-top" sizes="96px" />
      </div>

      {/* Name label — highlighted when speaking */}
      <span className={cn(
        'mt-1 text-xs font-medium transition-colors duration-300 px-2 py-0.5 rounded-full',
        isActive
          ? 'text-primary-foreground bg-primary shadow-sm'
          : 'text-muted-foreground/60 bg-transparent'
      )}>
        {name}
      </span>
    </div>
  );
}
