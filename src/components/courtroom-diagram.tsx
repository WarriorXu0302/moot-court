'use client';

/**
 * 庭室示意图：仲裁庭 / 涉外民商事法庭的座位布局，当前发言人的座位高亮。
 *
 * 替代原先语音模式下的背景图——那张图是刑事法庭（桌牌写着公诉人、辩护人），
 * 放在仲裁或民商事庭审里会误导学生。座位名取自 forum-profile.courtroom，与流程里的 speaker 一致。
 */
import { cn } from '@/lib/utils';
import type { ForumProfile } from '@/lib/forum-profile';

interface Props {
  layout: ForumProfile['courtroom'];
  /** 正在发言（或轮到发言）的角色 */
  active?: string;
  /** 用户本人扮演的角色 */
  self?: string;
  /** 庭室名称，如"仲裁庭""法庭" */
  title: string;
}

function Seat({ name, caption, active, self, size = 'md' }: { name: string; caption?: string; active: boolean; self: boolean; size?: 'md' | 'lg' }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className={cn(
          'flex items-center justify-center rounded-sm border bg-card text-center font-display font-semibold leading-tight shadow-sm transition-all duration-300',
          size === 'lg' ? 'min-w-[7.5rem] px-4 py-3 text-base' : 'min-w-[6.5rem] px-3 py-2.5 text-sm',
          active ? 'scale-105 border-primary bg-primary text-primary-foreground shadow-md' : 'border-border text-foreground',
          self && !active && 'border-primary/60 border-dashed',
        )}
      >
        {name}
      </div>
      <span className={cn('text-xs', active ? 'font-medium text-primary' : 'text-muted-foreground')}>
        {self ? '你' : caption ?? ''}
        {active ? (self ? ' · 请发言' : ' · 发言中') : ''}
      </span>
    </div>
  );
}

export function CourtroomDiagram({ layout, active, self, title }: Props) {
  const is = (seat: string) => !!active && active === seat;
  const isSelf = (seat: string) => !!self && self === seat;
  // 审判席两侧成员同名时（如两位"审判员"）只在名称完全匹配时高亮，不会误亮
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-8 bg-muted/40 px-6 py-8" role="img" aria-label={`${title}座位示意，${active ? `${active}正在发言` : '等待开始'}`}>
      <p className="text-xs tracking-[0.3em] text-muted-foreground">{title}</p>

      {/* 审判席 / 仲裁庭席 */}
      <div className="flex flex-col items-center gap-3">
        <div className="flex items-end gap-3">
          <Seat name={layout.bench[0]} active={is(layout.bench[0]) && layout.bench[0] !== layout.bench[2]} self={false} />
          <Seat name={layout.bench[1]} active={is(layout.bench[1])} self={isSelf(layout.bench[1])} size="lg" />
          <Seat name={layout.bench[2]} active={is(layout.bench[2]) && layout.bench[0] !== layout.bench[2]} self={false} />
        </div>
        <div className="h-px w-[min(28rem,80%)] bg-border" />
        <Seat name={layout.clerk} active={is(layout.clerk)} self={false} />
      </div>

      {/* 当事人席 */}
      <div className="flex w-full max-w-xl items-start justify-between gap-6">
        <Seat name={layout.left.seat} caption={layout.left.caption} active={is(layout.left.seat)} self={isSelf(layout.left.seat)} />
        <Seat name={layout.right.seat} caption={layout.right.caption} active={is(layout.right.seat)} self={isSelf(layout.right.seat)} />
      </div>

      {/* 证人席 */}
      <div className="flex items-start gap-4 border-t border-dashed pt-5">
        {layout.witnesses.map((w) => (
          <Seat key={w} name={w} caption="出庭作证" active={is(w)} self={false} />
        ))}
      </div>
    </div>
  );
}
