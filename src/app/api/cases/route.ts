import { NextRequest, NextResponse } from 'next/server';
import { HeaderUtils } from 'coze-coding-dev-sdk';
import { LLMClient } from '@/lib/llm-client';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { buildScoringGenerationPrompt } from '@/lib/scoring';
import { buildArbitrationScoringPrompt } from '@/lib/arbitration-scoring';
import { ensureLawComplete } from '@/lib/law-quality';
import { normalizeCaseType, parseArbitrationMeta, EMPTY_ARBITRATION_META, isAdversarial } from '@/lib/case-type';
import { rowToCaseData } from '@/lib/case-row';
import { requireLogin, requireTeacher } from '@/lib/api-auth';
import { buildArbitrationCasePrompt, parseArbitrationCaseOutput } from '@/lib/arbitration-case-prompt';

export const runtime = 'nodejs';
export const maxDuration = 300;

// GET: List all cases
export async function GET(request: NextRequest) {
  const auth = requireLogin(request);
  if (!auth.ok) return auth.response;
  // 学生（含游客）只能读已发布案例：草稿/下线案例含未审核的 AI 生成内容与答案文书
  const isTeacher = auth.session.role === 'teacher';
  try {
    const { searchParams } = new URL(request.url);
    const status = isTeacher ? searchParams.get('status') : 'published';
    const id = searchParams.get('id');
    const client = getSupabaseClient();

    // Single case by id
    if (id) {
      const { data, error } = await client.from('cases').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      // 学生访问未发布案例按"不存在"处理，不泄露该 id 存在
      if (!data || (!isTeacher && data.status !== 'published')) {
        return NextResponse.json({ error: '案例不存在' }, { status: 404 });
      }
      return NextResponse.json({ case: rowToCaseData(data, { forStudent: !isTeacher }) });
    }

    let query = client.from('cases').select('*').order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Map DB columns to CaseData format；类型筛选放内存做，case_type 列未迁移时也不报错
    const typeFilter = searchParams.get('caseType');
    let cases = (data || []).map((r) => rowToCaseData(r, { forStudent: !isTeacher }));
    if (typeFilter) cases = cases.filter((c) => c.caseType === normalizeCaseType(typeFilter));

    return NextResponse.json({ cases });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : 'DB error';
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

// POST: Create, publish, or offline a case
export async function POST(request: NextRequest) {
  // 所有 POST 动作（保存/发布/下线/文书回写/评分/AI 生成）都是教师操作
  const auth = requireTeacher(request);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const client = getSupabaseClient();

    // --- Publish or Offline ---
    if (body.action === 'publish' || body.action === 'offline') {
      const newStatus = body.action === 'publish' ? 'published' : 'offline';
      const caseId = body.caseId;

      // If publishing, update status and save case data
      if (body.action === 'publish' && body.caseData) {
        const cd = body.caseData;
        // 发布前确保司法解释条目带正文（工作流长输出可能只给标题）
        // 仲裁案例跳过：补全提示词写死刑事主题，会把仲裁条目补成刑事内容
        const pubHeaders = HeaderUtils.extractForwardHeaders(request.headers);
        const pubIsArb = await isArbitrationCase(client, caseId, cd.caseType ?? body.caseType);
        const completedLaw = cd.law && !pubIsArb ? await ensureLawComplete(cd.law, pubHeaders) : cd.law;
        const { error } = await client
          .from('cases')
          .update({
            name: cd.name,
            profile: cd.profile,
            teach: cd.teach,
            case_info: cd.case,
            plead: cd.plead,
            record: cd.record,
            evidence: cd.evidence,
            law: completedLaw,
            indictment: cd.indictment,
            prosecution: cd.prosecution,
            defense: cd.defense,
            victim: cd.victim,
            plan: cd.plan,
            person: cd.person,
            judge: cd.scoringStandards || cd.judge || null,
            wrong: cd.wrong,
            highlights: cd.highlights,
            status: newStatus,
            updated_at: new Date().toISOString(),
          })
          .eq('id', caseId);

        if (error) throw error;
      } else {
        const { error } = await client
          .from('cases')
          .update({
            status: newStatus,
            updated_at: new Date().toISOString(),
          })
          .eq('id', caseId);

        if (error) throw error;
      }

      return NextResponse.json({ success: true });
    }

    // --- Update documents (from workflow result) ---
    if (body.action === 'update_documents') {
      const docs = body.documents || {};
      const { error } = await client
        .from('cases')
        .update({
          indictment: docs.indictment || null,
          prosecution: docs.prosecution || null,
          defense: docs.defense || null,
          victim: docs.victim || null,
          plan: docs.plan || null,
          person: docs.person || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', body.caseId);

      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    // --- Manually update scoring standards (teacher edited) ---
    if (body.action === 'update_scoring' && body.caseId && body.scoringStandards) {
      const client = getSupabaseClient();
      let standardsJson: string;
      if (typeof body.scoringStandards === 'string') {
        standardsJson = body.scoringStandards;
      } else {
        const parsed = body.scoringStandards as {
          overall?: { dimensions?: unknown[]; grading?: unknown[] };
          stages?: unknown[];
        };
        if (!parsed.overall || !Array.isArray(parsed.overall.dimensions) || !Array.isArray(parsed.stages)) {
          return NextResponse.json({ error: '评分标准结构不完整' }, { status: 400 });
        }
        standardsJson = JSON.stringify(parsed);
      }
      const { error: updateErr } = await client
        .from('cases')
        .update({ judge: standardsJson, updated_at: new Date().toISOString() })
        .eq('id', body.caseId);
      if (updateErr) throw updateErr;
      return NextResponse.json({ success: true });
    }

    // --- Generate scoring standards via LLM (teacher) ---
    if (body.action === 'generate_scoring' && body.caseId) {
      const client = getSupabaseClient();
      const { data: caseRow, error: fetchErr } = await client
        .from('cases')
        .select('*')
        .eq('id', body.caseId)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!caseRow) return NextResponse.json({ error: '案例不存在' }, { status: 404 });

      // 仲裁案例用仲裁评分框架；刑事保持原提示词不变
      const scoringInput = {
        name: caseRow.name as string | null,
        profile: caseRow.profile as string | null,
        teach: caseRow.teach as string | null,
        case_info: caseRow.case_info as string | null,
      };
      const rowType = normalizeCaseType((caseRow as Record<string, unknown>).case_type);
      const prompt =
        isAdversarial(rowType)
          ? buildArbitrationScoringPrompt({ ...scoringInput, caseType: rowType, meta: parseArbitrationMeta((caseRow as Record<string, unknown>).meta) ?? null })
          : buildScoringGenerationPrompt(scoringInput);

      // 调用 LLM 生成评分标准（累积流式输出）
      const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
      const llm = new LLMClient(customHeaders);
      const stream = llm.stream([{ role: 'user', content: prompt }], { temperature: 0.3 });
      let fullText = '';
      for await (const chunk of stream) {
        if (chunk.content) fullText += chunk.content.toString();
      }

      // 提取 JSON（容错：剥掉可能的 markdown 代码块包裹与前后杂文字）
      const jsonStart = fullText.indexOf('{');
      const jsonEnd = fullText.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
        return NextResponse.json({ error: 'AI输出中未找到合法JSON' }, { status: 502 });
      }
      let standardsJson: string;
      try {
        const parsed = JSON.parse(fullText.slice(jsonStart, jsonEnd + 1)) as {
          overall?: { dimensions?: unknown[]; grading?: unknown[] };
          stages?: unknown[];
          sampleUnlock?: { scoreThreshold?: number; evalCountThreshold?: number };
        };
        if (!parsed.overall || !Array.isArray(parsed.overall.dimensions) || !Array.isArray(parsed.stages)) {
          throw new Error('结构不完整');
        }
        // 规范化：补齐解锁规则、时间戳
        parsed.sampleUnlock = {
          scoreThreshold: parsed.sampleUnlock?.scoreThreshold ?? 60,
          evalCountThreshold: parsed.sampleUnlock?.evalCountThreshold ?? 3,
        };
        const normalized = {
          version: 1,
          generatedAt: new Date().toISOString(),
          overall: parsed.overall,
          stages: parsed.stages,
          sampleUnlock: parsed.sampleUnlock,
        };
        standardsJson = JSON.stringify(normalized);
      } catch {
        return NextResponse.json({ error: '评分标准JSON解析失败，请重试' }, { status: 502 });
      }

      const { error: updateErr } = await client
        .from('cases')
        .update({ judge: standardsJson, updated_at: new Date().toISOString() })
        .eq('id', body.caseId);
      if (updateErr) throw updateErr;

      return NextResponse.json({ success: true, scoringStandards: standardsJson });
    }

    // --- Generate arbitration case via LLM (teacher; replaces the criminal Coze workflow for case_type=arbitration) ---
    // 前端先 save 一行 generating（带 caseType/meta），再带 caseId 调本动作；
    // 服务端同步生成并回写该行。工作流 ID 由 Coze 平台侧维护，仲裁版无对应工作流，故直接走 LLM。
    if (body.action === 'generate_arbitration' && body.caseId && typeof body.need === 'string') {
      const meta = parseArbitrationMeta(body.meta) ?? EMPTY_ARBITRATION_META;
      const genHeaders = HeaderUtils.extractForwardHeaders(request.headers);
      const llm = new LLMClient(genHeaders);
      let fullText = '';
      try {
        const stream = llm.stream(
          [{ role: 'user', content: buildArbitrationCasePrompt(body.need, meta) }],
          { temperature: 0.6 },
        );
        for await (const chunk of stream) {
          if (chunk.content) fullText += chunk.content.toString();
        }
      } catch (e: unknown) {
        await client.from('cases').update({ status: 'generated', name: '生成失败', updated_at: new Date().toISOString() }).eq('id', body.caseId);
        const msg = e instanceof Error ? e.message : 'LLM error';
        return NextResponse.json({ error: `仲裁案例生成失败：${msg}` }, { status: 502 });
      }

      const parsed = parseArbitrationCaseOutput(fullText);
      if (!parsed) {
        await client.from('cases').update({ status: 'generated', name: '生成失败', updated_at: new Date().toISOString() }).eq('id', body.caseId);
        return NextResponse.json({ error: 'AI 输出无法解析为案例，请重试' }, { status: 502 });
      }
      // 不调用 ensureLawComplete：其补全提示词写死刑事主题（故意伤害/正当防卫），
      // 用于仲裁会把缺正文条目补成刑事内容。仲裁法律依据由生成提示词约束（不确定处标【待核验】）+ 教师审核。
      const { data: updated, error: updErr } = await client
        .from('cases')
        .update({
          name: parsed.name,
          profile: parsed.profile || null,
          teach: parsed.teach || null,
          case_info: parsed.case || null,
          plead: parsed.plead || null,
          record: parsed.record || null,
          evidence: parsed.evidence || null,
          law: parsed.law || null,
          wrong: parsed.wrong || null,
          person: parsed.person || null,
          status: 'generated',
          updated_at: new Date().toISOString(),
        })
        .eq('id', body.caseId)
        .select()
        .single();
      if (updErr) throw updErr;
      return NextResponse.json({ data: rowToCaseData(updated) });
    }

    // --- Save case data from workflow ---
    if (body.action === 'save' && body.caseData) {
      const cd = body.caseData;
      // 落库前确保司法解释条目带正文（工作流长输出可能只给标题）
      const saveHeaders = HeaderUtils.extractForwardHeaders(request.headers);
      const saveIsArb = isAdversarial(normalizeCaseType(cd.caseType ?? body.caseType));
      const completedLaw = cd.law ? (saveIsArb ? cd.law : await ensureLawComplete(cd.law, saveHeaders)) : null;
      const { data, error } = await client
        .from('cases')
        .insert({
          name: cd.name || '未命名案例',
          profile: cd.profile || null,
          teach: cd.teach || null,
          case_info: cd.case || null,
          plead: cd.plead || null,
          record: cd.record || null,
          evidence: cd.evidence || null,
          law: completedLaw,
          wrong: cd.wrong || null,
          highlights: cd.highlights || null,
          creator_name: cd.creatorName || '李璎霖',
          status: cd.status || 'generated',
          workflow_execute_id: body.workflowExecutionId || cd.workflowExecutionId || null,
          ...caseTypeColumns(cd.caseType ?? body.caseType, cd.meta ?? body.meta),
        })
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json({ data: rowToCaseData(data) });
    }

    // --- Create a new case ---
    const { data, error } = await client
      .from('cases')
      .insert({
        name: body.name || '未命名案例',
        profile: body.profile || null,
        teach: body.teach || null,
        case_info: body.case || null,
        plead: body.plead || null,
        record: body.record || null,
        evidence: body.evidence || null,
        law: body.law || null,
        wrong: body.wrong || null,
        creator_name: body.creatorName || '李璎霖',
        status: body.status || 'generating',
        workflow_execute_id: body.workflowExecuteId || null,
        generate_execute_id: body.generateExecuteId || null,
        ...caseTypeColumns(body.caseType, body.meta),
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ data: rowToCaseData(data) });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : 'DB error';
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

// PATCH: Update a case
export async function PATCH(request: NextRequest) {
  const auth = requireTeacher(request);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const client = getSupabaseClient();

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    const fieldMap: Record<string, string> = {
      name: 'name',
      profile: 'profile',
      teach: 'teach',
      case: 'case_info',
      plead: 'plead',
      record: 'record',
      evidence: 'evidence',
      law: 'law',
      indictment: 'indictment',
      prosecution: 'prosecution',
      defense: 'defense',
      victim: 'victim',
      plan: 'plan',
      person: 'person',
      scoringStandards: 'judge',
      wrong: 'wrong',
      highlights: 'highlights',
      creatorName: 'creator_name',
      status: 'status',
      case_info: 'case_info',
      workflowExecuteId: 'workflow_execute_id',
      generateExecuteId: 'generate_execute_id',
    };

    for (const [key, dbField] of Object.entries(fieldMap)) {
      if (body[key] !== undefined) {
        updateData[dbField] = body[key];
      }
    }
    // 仅当请求显式带类型/元数据时才写，未执行迁移的库上刑事编辑不受影响
    if (body.caseType !== undefined || body.meta !== undefined) {
      Object.assign(updateData, caseTypeColumns(body.caseType, body.meta, true));
    }

    // 更新司法解释字段前确保条目带正文（工作流长输出可能只给标题）；仲裁案例跳过（原因同发布处）
    if (typeof updateData.law === 'string' && updateData.law) {
      const patchHeaders = HeaderUtils.extractForwardHeaders(request.headers);
      if (!(await isArbitrationCase(client, body.id, body.caseType))) {
        updateData.law = await ensureLawComplete(updateData.law, patchHeaders);
      }
    }

    const { data, error } = await client
      .from('cases')
      .update(updateData)
      .eq('id', body.id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ data: rowToCaseData(data) });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : 'DB error';
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

// DELETE: Delete a case
export async function DELETE(request: NextRequest) {
  const auth = requireTeacher(request);
  if (!auth.ok) return auth.response;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const client = getSupabaseClient();
    const { error } = await client.from('cases').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : 'DB error';
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

/**
 * 判断案例是否仲裁类型：请求显式声明优先，否则读库。
 * 读 select('*') 而非单列，避免 case_type 列未迁移时报错；列不存在即视为刑事。
 */
async function isArbitrationCase(
  client: ReturnType<typeof getSupabaseClient>,
  id: unknown,
  declared: unknown,
): Promise<boolean> {
  // 涉外民商事诉讼与仲裁同样跳过刑事专用的法条补全与文书工作流
  if (declared !== undefined && declared !== null) return isAdversarial(normalizeCaseType(declared));
  if (typeof id !== 'string' || !id) return false;
  const { data } = await client.from('cases').select('*').eq('id', id).maybeSingle();
  return isAdversarial(normalizeCaseType((data as Record<string, unknown> | null)?.case_type));
}

/**
 * 案件类型列。刑事（默认）返回空对象，保持原 SQL 不变，
 * 因此 case_type/meta 列尚未迁移时刑事案例的读写仍然正常；
 * 只有仲裁案例才写入这两列（此时必须已执行 scripts/migrations/001-case-type.sql）。
 * force=true（PATCH 显式修改类型）时刑事也写出 case_type，用于改回刑事。
 */
function caseTypeColumns(caseType: unknown, meta: unknown, force = false): Record<string, unknown> {
  const type = normalizeCaseType(caseType);
  if (type === 'criminal' && !force) return {};
  const cols: Record<string, unknown> = { case_type: type };
  if (isAdversarial(type)) {
    cols.meta = parseArbitrationMeta(meta) ?? EMPTY_ARBITRATION_META;
  } else if (force) {
    cols.meta = null;
  }
  return cols;
}
