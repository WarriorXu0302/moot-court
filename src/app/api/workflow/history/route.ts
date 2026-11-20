import { NextRequest, NextResponse } from 'next/server';
import { requireLogin, forbidden } from '@/lib/api-auth';
import { workflowAccess } from '@/lib/workflow-access';

export const runtime = 'nodejs';
export const maxDuration = 60;

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

// GET: Query async workflow execution result
// Required: executeId, workflowId
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const executeId = searchParams.get('executeId');
    const workflowId = searchParams.get('workflowId');

    if (!executeId) {
      return NextResponse.json({ error: 'executeId is required' }, { status: 400 });
    }

    const auth = requireLogin(request);
    if (!auth.ok) return auth.response;
    if (workflowId) {
      const access = workflowAccess(workflowId);
      if (!access) return forbidden('该工作流未开放');
      if (access === 'teacher' && auth.session.role !== 'teacher') return forbidden('仅教师可查询该工作流');
    } else if (auth.session.role !== 'teacher') {
      // 不带 workflowId 时走旧的按 execute_id 直查端点，无法按白名单约束，仅教师可用
      return forbidden('缺少 workflowId');
    }

    const headers = buildHeaders();

    // Use the correct Coze API endpoint: /v1/workflows/{workflowId}/run_histories/{executeId}
    // This returns an array with execute_status field
    let apiUrl: string;
    if (workflowId) {
      apiUrl = `${cozeApiBase}/v1/workflows/${workflowId}/run_histories/${executeId}`;
    } else {
      // Fallback: try the old endpoint (may not work for all cases)
      apiUrl = `${cozeApiBase}/v1/workflow/run_history?execute_id=${executeId}`;
    }

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers,
    });

    const result = await response.json();

    if (result.code === 0 && result.data) {
      // The correct endpoint returns data as an array
      if (Array.isArray(result.data) && result.data.length > 0) {
        const item = result.data[0];
        const execStatus = item.execute_status || 'Running';

        if (execStatus === 'Success' || execStatus === 'Completed') {
          // Parse the output data - Coze returns 'Output' (capital O) as a JSON string
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
          // Handle double-nested Output: some workflows return { Output: "<json string>" }
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
          return NextResponse.json({
            status: 'completed',
            data: output,
            debug: item.debug_url,
          });
        } else if (execStatus === 'Failed' || execStatus === 'Error') {
          return NextResponse.json({
            status: 'failed',
            error: item.error_msg || 'Workflow execution failed',
          });
        }
      } else if (!Array.isArray(result.data)) {
        // Old endpoint format: data is an object with status field
        const status = result.data.status || 'Running';
        if (status === 'Completed' || status === 'Success') {
          let output: Record<string, unknown> = {};
          try {
            if (typeof result.data.output === 'string') {
              output = JSON.parse(result.data.output);
            } else if (result.data.output) {
              output = result.data.output;
            }
          } catch {
            output = { raw: result.data.output };
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
          return NextResponse.json({
            status: 'completed',
            data: output,
            debug: result.data.debug_url,
          });
        } else if (status === 'Failed' || status === 'Error') {
          return NextResponse.json({
            status: 'failed',
            error: result.data.error_msg || 'Workflow execution failed',
          });
        }
      }
    }

    // Still running
    return NextResponse.json({
      status: 'running',
      executeId,
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : 'Workflow history query error';
    return NextResponse.json({ error: errMsg, status: 'error' }, { status: 500 });
  }
}
