import { NextRequest, NextResponse } from 'next/server';
import { TTSClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { requireLogin } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const auth = requireLogin(request);
  if (!auth.ok) return auth.response;
  try {
    const { text, speaker, uid } = await request.json();

    if (!text || !uid) {
      return NextResponse.json({ error: 'text and uid are required' }, { status: 400 });
    }

    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const config = new Config();
    const client = new TTSClient(config, customHeaders);

    const response = await client.synthesize({
      uid,
      text,
      speaker: speaker || 'zh_female_xiaohe_uranus_bigtts',
      audioFormat: 'mp3',
      sampleRate: 24000,
    });

    return NextResponse.json({
      audioUri: response.audioUri,
      audioSize: response.audioSize,
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : 'TTS error';
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
