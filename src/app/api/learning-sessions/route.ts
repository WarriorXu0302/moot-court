import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { requireLogin, requireTeacher, forbidden } from '@/lib/api-auth';

export const maxDuration = 60;

// 单次学习场次：从选择案例进入训练到结束分析为一次学习
// POST：学生端结束分析时写入一条（含时长、过程、评价、当次全部学习记录）
// GET：教师端查询全部（宏观统计），或 ?studentId= 查个人
export async function POST(request: NextRequest) {
  const auth = requireLogin(request);
  if (!auth.ok) return auth.response;
  if (auth.session.role !== 'student') return forbidden('仅学生可保存学习场次');
  try {
    const body = await request.json();
    const {
      studentName, fid, orgName,
      caseId, caseName, role,
      startedAt, endedAt, durationSeconds,
      progress, lastStage, score, summary, evaluation, suggestion,
      records, documents, lifecycle,
    } = body;

    // 身份只认会话，忽略客户端传来的 studentId
    const studentId = auth.session.sid;

    const startedMs = typeof startedAt === 'number' && startedAt > 0 ? startedAt : null;
    const endedMs = typeof endedAt === 'number' && endedAt > 0 ? endedAt : Date.now();
    // 服务端兜底计算时长，不信任客户端单方面的值
    const duration = typeof durationSeconds === 'number' && durationSeconds >= 0
      ? Math.round(durationSeconds)
      : (startedMs ? Math.max(0, Math.round((endedMs - startedMs) / 1000)) : 0);

    const client = getSupabaseClient();
    const { data, error } = await client
      .from('learning_sessions')
      .insert({
        student_id: studentId,
        student_name: studentName || '',
        fid: fid || '',
        org_name: orgName || '',
        case_id: caseId || '',
        case_name: caseName || '',
        role: role || '',
        started_at: startedMs ? new Date(startedMs).toISOString() : null,
        ended_at: new Date(endedMs).toISOString(),
        duration_seconds: duration,
        progress: typeof progress === 'number' ? progress : 0,
        stage: lastStage || '',
        overall_score: typeof score === 'number' ? score : null,
        summary: summary || '',
        evaluation: evaluation || '',
        suggestion: suggestion || '',
        records: records ? JSON.stringify(records) : null,
        documents: documents ? JSON.stringify(documents) : null,
        lifecycle: lifecycle ? JSON.stringify(lifecycle) : null,
      })
      .select()
      .single();

    if (error) {
      console.error('保存学习场次失败:', error);
      return NextResponse.json({ error: '保存失败' }, { status: 500 });
    }
    return NextResponse.json({ success: true, id: data.id });
  } catch (e) {
    console.error('学习场次接口异常:', e);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

interface SessionRow {
  id: string;
  student_id: string;
  student_name: string;
  fid: string | null;
  org_name: string | null;
  case_id: string | null;
  case_name: string | null;
  role: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  progress: number | null;
  stage: string | null;
  overall_score: number | null;
  summary: string | null;
  evaluation: string | null;
  suggestion: string | null;
  records: unknown;
  documents: unknown;
  created_at: string;
}

export async function GET(request: NextRequest) {
  const auth = requireLogin(request);
  if (!auth.ok) return auth.response;
  const isTeacher = auth.session.role === 'teacher';
  try {
    const { searchParams } = new URL(request.url);
    let studentId = searchParams.get('studentId');
    if (!isTeacher) {
      if (studentId && studentId !== auth.session.sid) return forbidden();
      studentId = auth.session.sid;
    }
    // 列表查询默认不返回 records/documents 大字段，详情用 ?id= 单查
    const sessionId = searchParams.get('id');
    const withDetail = searchParams.get('detail') === '1' || !!sessionId;

    const client = getSupabaseClient();
    let query = client
      .from('learning_sessions')
      .select(withDetail ? '*' : 'id,student_id,student_name,fid,org_name,case_id,case_name,role,started_at,ended_at,duration_seconds,progress,stage,overall_score,summary,evaluation,created_at')
      .order('ended_at', { ascending: false })
      .limit(500);

    if (sessionId) query = query.eq('id', sessionId);
    else if (studentId) query = query.eq('student_id', studentId);

    // 学生按 ?id= 取单条详情时，上面的 studentId 过滤分支不生效（sessionId 优先），
    // 必须在这里补上归属约束，否则任何学生可凭 id 读取他人的完整对话与文书
    if (!isTeacher && sessionId) query = query.eq('student_id', auth.session.sid);

    const { data, error } = await query;
    if (error) {
      console.error('查询学习场次失败:', error);
      return NextResponse.json({ error: '查询失败' }, { status: 500 });
    }

    const sessions = ((data || []) as unknown as SessionRow[]).map((row) => ({
      id: row.id,
      studentId: row.student_id,
      studentName: row.student_name,
      fid: row.fid || '',
      orgName: row.org_name || '',
      caseId: row.case_id || '',
      caseName: row.case_name || '',
      role: row.role || '',
      startedAt: row.started_at ? new Date(row.started_at).getTime() : 0,
      endedAt: row.ended_at ? new Date(row.ended_at).getTime() : 0,
      durationSeconds: row.duration_seconds || 0,
      progress: row.progress || 0,
      lastStage: row.stage || '',
      score: row.overall_score,
      summary: row.summary || '',
      evaluation: row.evaluation || '',
      records: withDetail
        ? (typeof row.records === 'string' ? JSON.parse(row.records) : row.records || [])
        : undefined,
      documents: withDetail
        ? (typeof row.documents === 'string' ? JSON.parse(row.documents) : row.documents || {})
        : undefined,
      createdAt: row.created_at,
    }));

    return NextResponse.json({ sessions });
  } catch (e) {
    console.error('学习场次查询异常:', e);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

// 删除单条学习场次（?id=xxx）
export async function DELETE(request: NextRequest) {
  const auth = requireTeacher(request);
  if (!auth.ok) return auth.response;
  try {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    const client = getSupabaseClient();
    const { error } = await client.from('learning_sessions').delete().eq('id', id);
    if (error) {
      console.error('删除学习场次失败:', error);
      return NextResponse.json({ error: '删除失败' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('学习场次删除异常:', e);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
