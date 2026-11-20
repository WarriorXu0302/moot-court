import { NextRequest, NextResponse } from 'next/server';
import { requireLogin, forbidden } from '@/lib/api-auth';
import { workflowAccess } from '@/lib/workflow-access';

export const runtime = 'nodejs';
export const maxDuration = 600;

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

// POST: Run a workflow (sync or async)
export async function POST(request: NextRequest) {
  try {
    const { workflowId, parameters, isAsync, async: asyncFlag } = await request.json();

    if (!workflowId) {
      return NextResponse.json({ error: 'workflowId is required' }, { status: 400 });
    }
    const auth = requireLogin(request);
    if (!auth.ok) return auth.response;
    const access = workflowAccess(String(workflowId));
    if (!access) return forbidden('该工作流未开放');
    if (access === 'teacher' && auth.session.role !== 'teacher') return forbidden('仅教师可运行该工作流');

    const headers = buildHeaders();
    const body: Record<string, unknown> = {
      workflow_id: workflowId,
      parameters: parameters || {},
    };
    if (isAsync || asyncFlag) {
      body.is_async = true;
    }

    const response = await fetch(`${cozeApiBase}/v1/workflow/run`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : 'Workflow run error';
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

// GET: Query async workflow result
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workflowId = searchParams.get('workflowId');
    const executeId = searchParams.get('executeId');

    if (!workflowId || !executeId) {
      return NextResponse.json({ error: 'workflowId and executeId are required' }, { status: 400 });
    }
    const auth = requireLogin(request);
    if (!auth.ok) return auth.response;
    const access = workflowAccess(String(workflowId));
    if (!access) return forbidden('该工作流未开放');
    if (access === 'teacher' && auth.session.role !== 'teacher') return forbidden('仅教师可运行该工作流');

    const headers = buildHeaders();
    const response = await fetch(
      `${cozeApiBase}/v1/workflows/${workflowId}/run_histories/${executeId}`,
      { headers }
    );

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : 'Workflow history error';
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
