import { NextRequest, NextResponse } from 'next/server';
import { ASRClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { requireLogin } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * 语音识别 API
 *
 * body: { uid: string; base64Data?: string; url?: string }
 *   - base64Data 与 url 二选一
 *   - base64Data 为不含 `data:audio/wav;base64,` 前缀的纯 base64
 *   - 音频要求：WAV / MP3 / M4A / OGG OPUS，时长 ≤ 2h，大小 ≤ 100MB
 *     （注意：MediaRecorder 默认产出的 webm 不在支持列表内，
 *       前端 use-speech-input 已统一转成 16kHz 单声道 WAV）
 *
 * 返回: { text: string; duration?: number }
 */
export async function POST(request: NextRequest) {
  const auth = requireLogin(request);
  if (!auth.ok) return auth.response;
  try {
    const { uid, base64Data, url } = await request.json();

    if (!uid) {
      return NextResponse.json({ error: 'uid is required' }, { status: 400 });
    }
    if (!base64Data && !url) {
      return NextResponse.json(
        { error: 'base64Data or url is required' },
        { status: 400 },
      );
    }

    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const config = new Config();
    const client = new ASRClient(config, customHeaders);

    const response = await client.recognize({ uid, base64Data, url });

    return NextResponse.json({
      text: response.text ?? '',
      duration: response.duration,
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : 'ASR error';
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
