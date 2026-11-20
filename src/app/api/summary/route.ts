import { NextRequest, NextResponse } from 'next/server';
import { HeaderUtils } from 'coze-coding-dev-sdk';
import { LLMClient } from '@/lib/llm-client';
import { requireLogin } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * 学习过程总结 API —— SSE 流式输出。
 * 模型按「【概括】/【评价】/【建议】/【得分】」分隔标记协议输出，
 * 前端流式增量解析各区块，版面结构稳定。
 */
export async function POST(request: NextRequest) {
  const auth = requireLogin(request);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const { systemPrompt, userPrompt, temperature } = body;

    if (!systemPrompt || !userPrompt) {
      return NextResponse.json({ error: 'systemPrompt and userPrompt are required' }, { status: 400 });
    }

    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const client = new LLMClient(customHeaders);

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userPrompt },
    ];

    const stream = client.stream(messages, {
      caching: 'enabled',
      temperature: temperature ?? 0.5,
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            if (chunk.content) {
              const text = chunk.content.toString();
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: text })}\n\n`));
            }
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (error: unknown) {
          const errMsg = error instanceof Error ? error.message : 'Stream error';
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: errMsg })}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : 'Summary error';
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
