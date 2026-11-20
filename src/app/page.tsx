import { cookies } from 'next/headers';
import { readSessionFromCookieStore } from '@/lib/session';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import LoginScreen, { type ActiveSession } from '@/components/login-screen';

// 每次进首页都要按真实 Cookie 判断登录态，不能被静态化。
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const session = readSessionFromCookieStore(await cookies());
  let active: ActiveSession | null = null;

  if (session?.role === 'teacher') {
    active = { nickname: '教师', studentId: 'teacher', role: 'teacher' };
  } else if (session) {
    try {
      const { data } = await getSupabaseClient()
        .from('students')
        .select('student_id, nickname')
        .eq('id', session.sid)
        .maybeSingle();
      if (data) active = { nickname: data.nickname || data.student_id, studentId: data.student_id, role: 'student' };
    } catch {
      // 读库失败按未登录展示，用户重新登录即可
    }
  }

  return <LoginScreen session={active} />;
}
