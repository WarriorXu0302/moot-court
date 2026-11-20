import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { requireTeacher } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const maxDuration = 60;

const WORKFLOW_CASE_DESIGN_ID = '7656623831193223210';
const WORKFLOW_DOCUMENTS_ID = '7656793461539356723';

const cozeApiToken = process.env.COZE_WORKLOAD_API_TOKEN!;
const cozeApiBase = process.env.COZE_API_BASE_URL || 'https://api.coze.cn';

function buildHeaders() {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cozeApiToken}`,
    'Content-Type': 'application/json',
  };
  for (const pair of (process.env.COZE_EXTRA_HEADERS || '').split(';')) {
    const idx = pair.indexOf('=');
    if (idx > 0) headers[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return headers;
}

async function queryWorkflowHistory(
  workflowId: string,
  executeId: string
): Promise<{ status: 'completed' | 'failed' | 'running'; data?: Record<string, unknown> }> {
  const headers = buildHeaders();
  const url = `${cozeApiBase}/v1/workflows/${workflowId}/run_histories/${executeId}`;
  const response = await fetch(url, { method: 'GET', headers });
  const result = await response.json();

  if (result.code === 0 && Array.isArray(result.data) && result.data.length > 0) {
    const item = result.data[0];
    const execStatus = item.execute_status || 'Running';

    if (execStatus === 'Success' || execStatus === 'Completed') {
      const rawOutput = item.Output ?? item.output;
      let output: Record<string, unknown> = {};
      try {
        if (typeof rawOutput === 'string') {
          output = JSON.parse(rawOutput);
        } else if (rawOutput && typeof rawOutput === 'object') {
          output = rawOutput as Record<string, unknown>;
        }
      } catch {
        output = { raw: rawOutput };
      }
      // Handle double-nested Output
      const innerOutput = output.Output ?? output.output;
      if (typeof innerOutput === 'string') {
        try {
          const parsed = JSON.parse(innerOutput);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            output = parsed as Record<string, unknown>;
          }
        } catch {
          // innerOutput is not JSON, keep original output
        }
      }
      return { status: 'completed', data: output };
    } else if (execStatus === 'Failed' || execStatus === 'Error') {
      return { status: 'failed' };
    }
  }
  return { status: 'running' };
}

// POST: Check all pending workflows and save results if completed
export async function POST(request: NextRequest) {
  const auth = requireTeacher(request);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json().catch(() => ({}));
    const client = getSupabaseClient();
    const recovered: Array<{ caseId: string; caseName: string; type: string }> = [];
    const stillRunning: Array<{ caseId: string; caseName: string; type: string }> = [];
    const failed: Array<{ caseId: string; caseName: string; type: string }> = [];

    // 1. Check cases in 'generating' status (case design workflow)
    const { data: generatingCases } = await client
      .from('cases')
      .select('id, name, workflow_execute_id')
      .eq('status', 'generating')
      .not('workflow_execute_id', 'is', null);

    for (const c of generatingCases || []) {
      const execId = c.workflow_execute_id as string;
      if (!execId) continue;
      try {
        const result = await queryWorkflowHistory(WORKFLOW_CASE_DESIGN_ID, execId);
        if (result.status === 'completed' && result.data) {
          const output = result.data;
          await client
            .from('cases')
            .update({
              name: (output.name as string) || '未命名案例',
              profile: (output.profile as string) || null,
              teach: (output.teach as string) || null,
              case_info: (output.case as string) || null,
              plead: (output.plead as string) || null,
              record: (output.record as string) || null,
              evidence: (output.evidence as string) || null,
              law: (output.law as string) || null,
              wrong: (output.wrong as string) || null,
              status: 'generated',
              updated_at: new Date().toISOString(),
            })
            .eq('id', c.id);
          recovered.push({ caseId: c.id, caseName: (output.name as string) || c.name || '', type: 'case_design' });
        } else if (result.status === 'failed') {
          await client
            .from('cases')
            .update({ status: 'generated', name: '生成失败', updated_at: new Date().toISOString() })
            .eq('id', c.id);
          failed.push({ caseId: c.id, caseName: c.name || '', type: 'case_design' });
        } else {
          stillRunning.push({ caseId: c.id, caseName: c.name || '', type: 'case_design' });
        }
      } catch {
        stillRunning.push({ caseId: c.id, caseName: c.name || '', type: 'case_design' });
      }
    }

    // 2. Check published cases with pending legal documents workflow
    // A case needs legal docs recovery if: generate_execute_id is set AND indictment is empty/null
    const { data: pendingDocsCases } = await client
      .from('cases')
      .select('id, name, generate_execute_id, indictment')
      .eq('status', 'published')
      .not('generate_execute_id', 'is', null)
      .or('indictment.is.null,indictment.eq,');

    for (const c of pendingDocsCases || []) {
      const execId = c.generate_execute_id as string;
      if (!execId) continue;
      try {
        const result = await queryWorkflowHistory(WORKFLOW_DOCUMENTS_ID, execId);
        if (result.status === 'completed' && result.data) {
          const docs = result.data;
          await client
            .from('cases')
            .update({
              indictment: (docs.indictment as string) || null,
              prosecution: (docs.prosecution as string) || null,
              defense: (docs.defense as string) || null,
              victim: (docs.victim as string) || null,
              plan: (docs.plan as string) || null,
              person: (docs.person as string) || null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', c.id);
          recovered.push({ caseId: c.id, caseName: c.name || '', type: 'legal_docs' });
        } else if (result.status === 'failed') {
          failed.push({ caseId: c.id, caseName: c.name || '', type: 'legal_docs' });
        } else {
          stillRunning.push({ caseId: c.id, caseName: c.name || '', type: 'legal_docs' });
        }
      } catch {
        stillRunning.push({ caseId: c.id, caseName: c.name || '', type: 'legal_docs' });
      }
    }

    return NextResponse.json({
      success: true,
      recovered,
      stillRunning,
      failed,
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : 'DB error';
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

// GET: Same as POST but triggered on page load
export async function GET(request: NextRequest) {
  return POST(request);
}
