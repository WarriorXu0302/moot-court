import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { requireLogin, requireTeacher, forbidden } from '@/lib/api-auth';

export const runtime = 'nodejs';

/**
 * 将历史 fid 映射为机构名称，找不到时返回空串。
 * 超星登录下线后新账号不再有 fid；这里只为历史记录（students.fid 已写入过的行）继续显示机构名。
 */
function fidToOrgName(fid: string): string {
  if (!fid) return '';
  const known: Record<string, string> = { '114795': '北京师范大学', '1385': '超星集团' };
  return known[fid] || '';
}

// GET: List training records for a case or student
export async function GET(request: NextRequest) {
  const auth = requireLogin(request);
  if (!auth.ok) return auth.response;
  const isTeacher = auth.session.role === 'teacher';
  try {
    const { searchParams } = new URL(request.url);
    const caseId = searchParams.get('case_id');
    let studentId = searchParams.get('student_id');
    // 学生只能看自己的记录：显式传了别人的 id 直接拒绝；没传则强制收敛到自己，
    // 否则 `GET /api/learning-records` 会把全班的训练记录（含对话与评价）返回给任何学生
    if (!isTeacher) {
      if (studentId && studentId !== auth.session.sid) return forbidden();
      studentId = auth.session.sid;
    }
    const client = getSupabaseClient();

    let query = client.from('training_records').select('*');
    if (caseId) query = query.eq('case_id', caseId);
    if (studentId) query = query.eq('student_id', studentId);

    query = query.order('updated_at', { ascending: false });

    const { data, error } = await query;
    if (error) throw error;

    // Fetch student names separately for display
    const studentIds = [...new Set((data || []).map((r: Record<string, unknown>) => r.student_id as string).filter(Boolean))];
    const studentMap: Record<string, { nickname?: string; student_id?: string; fid?: string }> = {};
    if (studentIds.length > 0) {
      const { data: students } = await client
        .from('students')
        .select('id, nickname, student_id, fid')
        .in('id', studentIds);
      for (const s of (students || [])) {
        studentMap[s.id] = { nickname: s.nickname, student_id: s.student_id, fid: s.fid };
      }
    }

    const records = (data || []).map((row: Record<string, unknown>) => {
      const stu = studentMap[row.student_id as string];
      return { ...row, _studentInfo: stu };
    });

    return NextResponse.json({ records: records.map(rowToLearningStats) });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : (typeof error === 'object' && error !== null && 'message' in error ? String((error as Record<string, unknown>).message) : 'DB error');
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

// POST: Create training record (when student ends training)
export async function POST(request: NextRequest) {
  const auth = requireLogin(request);
  if (!auth.ok) return auth.response;
  // 教师没有 students 行（training_records.student_id 外键指向 students.id），不能写训练记录
  if (auth.session.role !== 'student') return forbidden('仅学生可保存训练记录');
  try {
    const body = await request.json();
    // 身份只认会话：忽略客户端传来的 studentId，防止替别人写/覆盖成绩
    body.studentId = auth.session.sid;
    const client = getSupabaseClient();

    // Handle 'save' action from student end
    if (body.action === 'save') {
      // Build overall summary from records (each stage is kept separate in learning_records)
      const records = body.records || [];
      const summaryParts = records.map((r: Record<string, unknown>) => r.summary || '').filter(Boolean);
      const evalParts = records.map((r: Record<string, unknown>) => r.evaluation || '').filter(Boolean);
      const sugParts = records.map((r: Record<string, unknown>) => r.suggestion || '').filter(Boolean);
      const overallSummary = summaryParts.join('；') || '训练完成';
      const overallEvaluation = evalParts.join('；') || '';
      const overallSuggestion = sugParts.join('；') || '';
      const lastRecord = records[records.length - 1];
      const stage = body.stage || (lastRecord?.pageName as string) || '';
      const progress = body.progress || 0;

      // Calculate overall score from records that have scores
      const scoredRecords = records.filter((r: Record<string, unknown>) => typeof r.score === 'number' && r.score >= 0 && r.score <= 100);
      const overallScore = scoredRecords.length > 0
        ? Math.round(scoredRecords.reduce((sum: number, r: Record<string, unknown>) => sum + (r.score as number), 0) / scoredRecords.length)
        : (typeof body.overallScore === 'number' ? body.overallScore : 0);

      // Check if a record already exists for this student+case
      const { data: existing } = await client
        .from('training_records')
        .select('id')
        .eq('student_id', body.studentId)
        .eq('case_id', body.caseId)
        .maybeSingle();

      if (existing) {
        // Update existing record
        const { data, error } = await client
          .from('training_records')
          .update({
            case_name: body.caseName,
            role: body.role || 'defender',
            overall_score: overallScore,
            summary: overallSummary,
            evaluation: overallEvaluation,
            suggestion: overallSuggestion,
            last_stage: stage,
            progress: progress,
            learning_records: JSON.stringify(records),
            lifecycle: body.lifecycle ? JSON.stringify(body.lifecycle) : undefined,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
          .select()
          .single();

        if (error) throw error;
        return NextResponse.json({ data });
      }

      const { data, error } = await client
        .from('training_records')
        .insert({
          student_id: body.studentId,
          case_id: body.caseId,
          case_name: body.caseName,
          role: body.role || 'defender',
          overall_score: overallScore,
          summary: overallSummary,
          evaluation: overallEvaluation,
          suggestion: overallSuggestion,
          last_stage: stage,
          progress: progress,
          learning_records: JSON.stringify(records),
          lifecycle: body.lifecycle ? JSON.stringify(body.lifecycle) : undefined,
        })
        .select()
        .single();

      if (error) throw error;

      return NextResponse.json({ data });
    }

    // Default: create training record
    const { data, error } = await client
      .from('training_records')
      .insert({
        student_id: body.studentId,
        case_id: body.caseId,
        case_name: body.caseName,
        role: body.role,
        overall_score: body.overallScore || 0,
        summary: body.summary || '',
        evaluation: body.evaluation || '',
        suggestion: body.suggestion || '',
        last_stage: body.lastStage || '',
        progress: body.progress || 0,
        learning_records: body.learningRecords ? JSON.stringify(body.learningRecords) : null,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ data });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : 'DB error';
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

// Helper: Map DB row to LearningStatsItem
function rowToLearningStats(row: Record<string, unknown>) {
  let stageRecords: Array<{
    pageName: string;
    summary: string;
    evaluation: string;
    suggestion: string;
    score?: number;
    conversations: Array<{ role: string; content: string }>;
    createdAt: number;
  }> = [];
  try {
    if (row.learning_records) {
      stageRecords = typeof row.learning_records === 'string'
        ? JSON.parse(row.learning_records)
        : row.learning_records;
    }
  } catch { /* ignore */ }

  return {
    id: row.id as string,
    caseName: (row.case_name as string) || '',
    studentName: (row._studentInfo as Record<string, string> | undefined)?.nickname || (row._studentInfo as Record<string, string> | undefined)?.student_id || (row.student_id as string) || '',
    fid: (row._studentInfo as Record<string, string> | undefined)?.fid || '',
    orgName: fidToOrgName((row._studentInfo as Record<string, string> | undefined)?.fid || ''),
    role: (row.role as string) || 'defender',
    score: (row.overall_score as number) || 0,
    summary: (row.summary as string) || '',
    evaluation: (row.evaluation as string) || '',
    suggestion: (row.suggestion as string) || '',
    lastTrainTime: row.updated_at ? new Date(row.updated_at as string).getTime() : Date.now(),
    lastStage: (row.last_stage as string) || '',
    progress: (row.progress as number) || 0,
    stageRecords,
    lifecycle: (() => { try { return row.lifecycle ? (typeof row.lifecycle === 'string' ? JSON.parse(row.lifecycle) : row.lifecycle) : null; } catch { return null; } })(),
  };
}

// PATCH: Update training record
export async function PATCH(request: NextRequest) {
  const auth = requireTeacher(request);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const client = getSupabaseClient();

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (body.overallScore !== undefined) updateData.overall_score = body.overallScore;
    if (body.summary !== undefined) updateData.summary = body.summary;
    if (body.evaluation !== undefined) updateData.evaluation = body.evaluation;
    if (body.suggestion !== undefined) updateData.suggestion = body.suggestion;
    if (body.lastStage !== undefined) updateData.last_stage = body.lastStage;
    if (body.progress !== undefined) updateData.progress = body.progress;
    if (body.learningRecords !== undefined) updateData.learning_records = body.learningRecords;

    const { data, error } = await client
      .from('training_records')
      .update(updateData)
      .eq('id', body.id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ data });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : 'DB error';
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
