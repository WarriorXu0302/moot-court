import { NextRequest, NextResponse } from 'next/server';
import { setSessionCookie } from '@/lib/session';
import { clientIp, isThrottled, recordFailure } from '@/lib/login-throttle';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const runtime = 'nodejs';

const AVATAR_COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F'];

function randomAvatarColor(): string {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

/**
 * 游客建号限流：同一来源 10 分钟最多 200 个。
 * 游客入口不需要任何凭据，没有上限就能被脚本刷库；但教室/机房常见一个班几十人共用同一出口 IP，
 * 阈值不能像登录失败那样收得很紧，否则会误伤正常上课。
 */
const GUEST_MAX_PER_WINDOW = 200;

/**
 * 仅保留游客入口。
 *
 * 学号注册 / 登录走 /api/auth/register 与 /api/auth/login。
 * 原先这里的 GET（返回整张 students 表，含 password 列）与 update_profile（可改任意用户）
 * 都不需要登录且全站无调用方，已移除：留着等于把账号库和资料写权限对外敞开。
 *
 * 游客必须真的建一行：training_records.student_id 外键指向 students.id，
 * 只在前端造一个假 id 会让游客的实训记录全部写失败。
 * 同时签发 role=student 的会话 Cookie——业务接口现在都要求登录，游客也需要会话才能训练。
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (body?.action !== 'guest') {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

    const key = `guest:${clientIp(request)}`;
    if (isThrottled(key, GUEST_MAX_PER_WINDOW)) {
      return NextResponse.json({ error: '游客入口使用过于频繁，请稍后再试或注册账号' }, { status: 429 });
    }
    recordFailure(key); // 复用计数器作为"创建次数"，窗口内不清零

    const guestId = `guest_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const { data, error } = await getSupabaseClient()
      .from('students')
      .insert({
        student_id: guestId,
        // 游客不走密码登录；登录接口对 is_guest 行与 guest_ 前缀一律拒绝
        password: 'guest',
        nickname: '游客用户',
        avatar: null,
        avatar_color: randomAvatarColor(),
        is_guest: true,
      })
      // 只回传展示字段，不把 password 列带出去
      .select('id, student_id, nickname, avatar_color')
      .single();
    if (error) throw error;

    return setSessionCookie(NextResponse.json({ student: data }), data.id as string, 'student');
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : 'DB error';
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
