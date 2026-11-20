import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookie, readSession } from '@/lib/session';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const session = readSession(request);
  if (!session) {
    return NextResponse.json({ error: '未登录或会话已过期' }, { status: 401 });
  }

  let response: NextResponse;

  if (session.role === 'teacher') {
    response = NextResponse.json({
      user: { id: 'teacher', studentId: 'teacher', nickname: '教师', avatar: '', role: 'teacher' },
    });
  } else {
    try {
      const { data: student, error } = await getSupabaseClient()
        .from('students')
        .select('id, student_id, nickname, avatar, avatar_color, is_guest')
        .eq('id', session.sid)
        .maybeSingle();
      if (error) throw error;
      if (!student) {
        // 账号已被删除：会话作废
        return clearSessionCookie(NextResponse.json({ error: '账号不存在' }, { status: 401 }));
      }
      response = NextResponse.json({
        user: {
          id: student.id,
          studentId: student.student_id,
          nickname: student.nickname || student.student_id,
          avatar: student.avatar || '',
          avatarColor: student.avatar_color || '',
          role: 'student',
          isGuest: !!student.is_guest,
        },
      });
    } catch (error) {
      console.error('读取登录用户失败:', error);
      return NextResponse.json({ error: '账号资料读取失败' }, { status: 500 });
    }
  }

  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
