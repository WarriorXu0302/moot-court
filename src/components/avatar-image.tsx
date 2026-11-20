'use client';

import { useState, useEffect } from 'react';

interface AvatarImageProps {
  src?: string;
  name?: string;
  color?: string;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * 头像组件：超星头像URL可能因防盗链(CORS/referrer)而裂图，
 * 加载失败时自动回退到带首字母的彩色圆形。
 * 使用 referrerPolicy="no-referrer" 绕过超星图片防盗链。
 */
export function AvatarImage({ src, name, color, size = 'sm' }: AvatarImageProps) {
  const [errored, setErrored] = useState(false);

  // src 变化时重置错误状态
  useEffect(() => {
    setErrored(false);
  }, [src]);

  const sizeClass = size === 'sm' ? 'h-7 w-7 text-xs' : size === 'lg' ? 'h-10 w-10 text-sm' : 'h-8 w-8 text-xs';

  if (!src || errored) {
    return (
      <div
        className={`${sizeClass} rounded-full flex items-center justify-center font-semibold text-white border border-border shrink-0`}
        style={{ backgroundColor: color || '#94a3b8' }}
      >
        {name?.charAt(0) || '?'}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={name || '用户'}
      referrerPolicy="no-referrer"
      onError={() => setErrored(true)}
      className={`${sizeClass} rounded-full object-cover border border-border shrink-0`}
    />
  );
}
