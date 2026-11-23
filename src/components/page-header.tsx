'use client';

/**
 * 非训练页的统一页头：教师端各页、法条检索、学生学情详情、案例选择。
 *
 * 原先这些页面各写一套顶栏：有的带「背景 / 字体 / 字号」三个按钮，有的带标题前缀"案例详情:"，
 * 有的只有返回箭头，高度、内边距、按钮顺序都不一样。这里收成一个：
 *   左 = 返回 + 标题（+ 副标题），中间留白，右 = 页面自己的操作 + 法条检索 + 显示设置 + 账号。
 */

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, LogOut, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LawSearchButton } from '@/components/law-search';
import { AvatarImage } from '@/components/avatar-image';
import { useAppStore } from '@/lib/store';
import { logoutSession } from '@/lib/session-user';
import { THEMES, FONTS, FONT_SIZES } from '@/lib/display-prefs';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** 返回目标；传 'back' 走浏览器后退；不传则不显示返回 */
  back?: string | 'back';
  backLabel?: string;
  /** 页面自己的操作按钮（放在右侧最前） */
  actions?: ReactNode;
  /** 标题后的状态标记（如"编辑中"） */
  badge?: ReactNode;
  showLawSearch?: boolean;
  className?: string;
}

export function DisplayMenu() {
  const { theme, font, fontSize, setTheme, setFont, setFontSize } = useAppStore();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="显示设置" className="shrink-0 gap-1.5 text-muted-foreground hover:text-foreground">
          <SlidersHorizontal className="h-4 w-4" />
          <span className="hidden xl:inline">显示</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">配色</DropdownMenuLabel>
        {THEMES.map((t) => (
          <DropdownMenuItem key={t.value} onClick={() => setTheme(t.value)}>
            {/* 缩略预览：在小方块上套该主题的 data-theme，直接取它真实的底色、卡片色和主色，
                与选中后整页效果一致（原先只有一个主色圆点，五种都是深色点，难以区分） */}
            <span data-theme={t.value} className="mr-2.5 flex h-7 w-11 shrink-0 flex-col gap-0.5 overflow-hidden rounded-[3px] border border-border bg-background p-1 shadow-sm" aria-hidden>
              <span className="h-1.5 w-full rounded-[1px] bg-primary" />
              <span className="flex flex-1 gap-0.5">
                <span className="flex-1 rounded-[1px] border border-border bg-card" />
                <span className="w-2 rounded-[1px] bg-seal/80" />
              </span>
            </span>
            <span className={theme === t.value ? 'font-medium' : ''}>{t.label}</span>
            {theme === t.value && <Check className="ml-auto h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">字体</DropdownMenuLabel>
        {FONTS.map((f) => (
          <DropdownMenuItem key={f.value} onClick={() => setFont(f.value)}>
            <span className={font === f.value ? 'font-medium' : ''}>{f.label}</span>
            {font === f.value && <Check className="ml-auto h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">字号</DropdownMenuLabel>
        <div className="grid grid-cols-4 gap-1 px-1 pb-1">
          {FONT_SIZES.map((sz) => (
            <button
              key={sz.value}
              type="button"
              onClick={() => setFontSize(sz.value)}
              aria-pressed={fontSize === sz.value}
              className={cn(
                'rounded-sm border py-1 text-xs',
                fontSize === sz.value ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent',
              )}
            >
              {sz.label}
            </button>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AccountMenu() {
  const router = useRouter();
  const { user, logout } = useAppStore();
  if (!user) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="ml-1 shrink-0 rounded-full outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-ring" aria-label="账号">
          <AvatarImage src={user.avatar} name={user.nickname} color={user.avatarColor} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="truncate text-sm font-medium">
          {user.nickname}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {user.role === 'teacher' ? '教师' : user.isGuest ? '游客' : '学生'}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={async () => {
            await logoutSession();
            logout();
            router.push('/');
          }}
        >
          <LogOut className="mr-2 h-4 w-4" />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PageHeader({
  title, subtitle, back, backLabel = '返回', actions, badge, showLawSearch = true, className,
}: PageHeaderProps) {
  const router = useRouter();
  return (
    <header className={cn('sticky top-0 z-30 shrink-0 border-b bg-card', className)}>
      <div className="flex h-14 items-center gap-3 px-3 sm:px-5">
        {back && (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-1 shrink-0 gap-1 text-muted-foreground hover:text-foreground"
            onClick={() => (back === 'back' ? router.back() : router.push(back))}
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">{backLabel}</span>
          </Button>
        )}
        {back && <span className="h-5 w-px shrink-0 bg-border" aria-hidden />}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="min-w-0">
            <h1 className="truncate font-display text-[1.05rem] font-semibold leading-tight text-foreground" title={typeof title === 'string' ? title : undefined}>
              {title}
            </h1>
            {subtitle && <p className="truncate text-xs leading-tight text-muted-foreground">{subtitle}</p>}
          </div>
          {badge}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          {actions && <span className="mx-1 h-5 w-px bg-border" aria-hidden />}
          {showLawSearch && <LawSearchButton />}
          <DisplayMenu />
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
