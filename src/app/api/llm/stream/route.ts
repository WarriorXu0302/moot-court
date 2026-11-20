import { NextRequest, NextResponse } from 'next/server';
import { HeaderUtils } from 'coze-coding-dev-sdk';
import { LLMClient, type ChatMessage } from '@/lib/llm-client';
import { requireLogin } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const auth = requireLogin(request);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const { messages, model, temperature, caching } = body as {
      messages?: ChatMessage[]; model?: string; temperature?: number; caching?: boolean;
    };

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'messages is required' }, { status: 400 });
    }

    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const client = new LLMClient(customHeaders);

    // model / caching 仅在回落到平台 SDK 时生效；走自定义接口时模型由 LLM_MODEL 决定
    const stream = client.stream(messages, {
      ...(model ? { model } : {}),
      temperature: temperature ?? 0.7,
      ...(caching ? { caching: 'enabled' } : {}),
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            if (chunk.content) {
              const text = chunk.content.toString();
              const sseData = `data: ${JSON.stringify({ content: text })}\n\n`;
              controller.enqueue(encoder.encode(sseData));
            }
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (error: unknown) {
          const errMsg = error instanceof Error ? error.message : 'Stream error';
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: errMsg })}\n\n`)
          );
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
    const errMsg = error instanceof Error ? error.message : 'Internal error';
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
