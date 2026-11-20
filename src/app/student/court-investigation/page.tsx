'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { usePressTalk } from '@/hooks/use-press-talk';
import { useRouter } from 'next/navigation';
import { TitleBar } from '@/components/title-bar';
import { FloatingAssistant } from '@/components/floating-assistant';
import { ContinueModal } from '@/components/continue-modal';
import { fetchSummarySections, STAGE_SUMMARY_FORMAT_INSTRUCTION } from '@/lib/summary-stream';
import { FlowPage } from '@/components/flow-page';
import { CaseFileViewer, type CaseFileSection } from '@/components/case-file-viewer';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAppStore } from '@/lib/store';
import { parseHighlights } from '@/lib/highlights';
import type { ChatMessage, LearningRecordEntry } from '@/lib/types';
import { Send, Loader2, SkipForward, Mic, Square, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from 'remark-cjk-friendly';
import { COURT_EVIDENCE_KNOWLEDGE, COURT_CROSS_EXAMINATION_KNOWLEDGE, DIRECT_EXAMINATION_KNOWLEDGE, CROSS_EXAMINATION_KNOWLEDGE, COURT_LANGUAGE_KNOWLEDGE } from '@/lib/knowledge';
import { createTtsSentenceFeeder, interruptTts, setTtsSpeakerCallback, waitForTtsQueueDrain } from '@/lib/audio';
import { replyFormatInstruction } from '@/lib/response-style';
import { INVESTIGATION_SPEECH_STYLE } from '@/lib/court-style';
import { createThrottledStreamSetter } from '@/lib/streaming-throttle';
import { LifecycleBar } from '@/components/lifecycle-bar';

import { parseLifecycleFromAIResponse, advanceLifecycleForPage, stripLifecycleForStreaming, hasVisibleStream } from '@/lib/lifecycle-utils';
import { useEndAnalysis } from '@/hooks/use-end-analysis';
import { useStageDialogueLogger } from '@/hooks/use-stage-logger';
import { getFlow } from '@/lib/flows';

// Court investigation stages
const STAGES = getFlow('criminal', 'defender', 'investigation');

function parseJsonArray(jsonStr: string | undefined): { title: string; book: string }[] {
  if (!jsonStr) return [];
  try { const arr = JSON.parse(jsonStr); return Array.isArray(arr) ? arr : []; } catch { return []; }
}

export default function CourtInvestigationPage() {
  const router = useRouter();
  const { modal: endAnalysisModal, handleEndAnalysis } = useEndAnalysis({ currentPageName: '法庭调查' });

  const { selectedCase, addLearningRecord, user, hydrated, learningRecords, selectedRole } = useAppStore();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // 本环节对话实时计入学习记录（供学习记录展示与结束分析遍历全部环节）
  useStageDialogueLogger('法庭调查', messages);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [streamingSpeaker, setStreamingSpeaker] = useState('');
  const [voiceMode, setVoiceMode] = useState(false);
  const voiceModeRef = useRef(voiceMode);
  useEffect(() => {
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);
  const recRef = useRef<{ stop: () => void } | null>(null);
  const [currentStageIdx, setCurrentStageIdx] = useState(0);
  const [showPretrialModal, setShowPretrialModal] = useState(true);
  const [showOpeningModal, setShowOpeningModal] = useState(false);
  const [showContinueModal, setShowContinueModal] = useState(false);
  const [continueLoading, setContinueLoading] = useState(false);
  const [continueStream, setContinueStream] = useState('');
  const [continueRecord, setContinueRecord] = useState<LearningRecordEntry | undefined>(undefined);
  const [autoRunning, setAutoRunning] = useState(false);
  const [ttsSpeaker, setTtsSpeaker] = useState<string | null>(null);
  const [aiBubble, setAiBubble] = useState<{ speaker: string; text: string } | null>(null);
  const userInteractedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    // 登录态尚未从 localStorage 恢复：此刻 user 恒为 null，不能据此判断未登录
    if (!hydrated) return;
    if (!user) { router.push('/'); return; }
    if (!selectedCase) { router.push('/student/select'); return; }
  }, [selectedCase, user, hydrated, router]);

  useEffect(() => {
    setTtsSpeakerCallback(setTtsSpeaker);
    return () => { setTtsSpeakerCallback(null); interruptTts(); abortRef.current?.abort(); };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingText]);

  const caseFileSections: CaseFileSection[] = [
    { label: '诉讼文书卷', items: parseJsonArray(selectedCase?.plead) },
    { label: '询问笔录', items: parseJsonArray(selectedCase?.record) },
    { label: '证据材料', items: parseJsonArray(selectedCase?.evidence) },
  ];
  const highlightConfig = parseHighlights(selectedCase?.highlights);

  const contextData = `案件基本资料:\n${selectedCase?.case || ''}\n\n诉讼文书卷:\n${selectedCase?.plead || ''}\n\n询问笔录:\n${selectedCase?.record || ''}\n\n证据材料:\n${selectedCase?.evidence || ''}\n\n相关法条和司法解释:\n${selectedCase?.law || ''}\n\n辩护词:\n${selectedCase?.defense || ''}\n\n刑事起诉书:\n${selectedCase?.indictment || ''}\n\n公诉意见书:\n${selectedCase?.prosecution || ''}\n\n角色资料:\n${selectedCase?.person || ''}`;

  const isUserSpeaker = (speaker: string) => speaker.includes('辩护人');

  const streamAIResponse = useCallback(async (prompt: string, speaker: string, playTts = true) => {
    setIsStreaming(true);
    setStreamingText('');
    setStreamingSpeaker(speaker);

    const isAutoRespond = prompt.startsWith('AI_RESPOND:');
    const isResponder = prompt.startsWith('辩护人提问:') || isAutoRespond;
    const userQuestion = isResponder && !isAutoRespond ? prompt.replace('辩护人提问: ', '') : '';
    const autoQuestioner = isAutoRespond ? prompt.replace('AI_RESPOND:', '') : '';

    const systemPrompt = `你正在模拟一场法庭调查。你当前扮演的角色是"${speaker}"。

${isAutoRespond ? `刚才${autoQuestioner}就案件事实向你提问（见上方对话记录的最后一条），请你以${speaker}的身份如实回答。注意：你是被询问的对象，只回答刚才的提问，不要代替${autoQuestioner}或其他任何角色发言，更不要自行继续提问。` : isResponder ? `辩护人（用户）向你提问："${userQuestion}"，请你以${speaker}的身份回答。注意：你是被询问的对象，辩护人是提问者，不要代替辩护人发言。` : '请根据法庭调查的流程推演法庭进展，你代表当前阶段的角色发言。'}

请根据法庭调查的操作步骤和注意事项来推演法庭进展。

${speaker === '审判长' ? '你能获取到案件基本资料和庭审提纲。' : ''}
${speaker === '公诉人' ? '你能获取到案件基本资料、刑事起诉书和公诉意见书。' : ''}
${speaker === '被告人' ? '你能获取到辩护词。' : ''}
${speaker === '被害人' ? '你能获取到刑事代理词。' : ''}
${speaker === '证人' ? '你能获取到询问笔录。' : ''}

请注意：
- 如果受害人已去世或无法出庭，则被害人不发言
- 你的回复要符合角色身份，使用口语化表达，像真实说话一样自然
- 各角色发言的语言风格与字数必须严格符合下方【发言语言风格要求】（宣读法律文书原文时按其完整篇幅，不受此限）
- 不要重复之前已经说过的话
- 不要使用括号描述神情、表情、动作等，这些会被语音合成读出来
- 严禁代替其他角色发言，只扮演"${speaker}"这一个角色

以下是法庭调查的相关知识，请参考：

${COURT_EVIDENCE_KNOWLEDGE}

${COURT_CROSS_EXAMINATION_KNOWLEDGE}

${DIRECT_EXAMINATION_KNOWLEDGE}

${CROSS_EXAMINATION_KNOWLEDGE}

案件生命周期：系统已在案例详情页自动生成了初始的生命周期时间轴（从立案开始的各关键节点）。在后续对话中，你需要智能判断是否需要更新生命周期：
- 当对话涉及新的诉讼阶段或法律程序节点时，在回复末尾输出已完成的阶段节点（用<LIFECYCLE>标签包裹JSON）
- 当对话只是讨论已有阶段内的细节（如证据分析、法条解释）时，不需要重复输出生命周期
- 输出格式：<LIFECYCLE>{"nodes":[{"stage":"阶段名","legalActions":"详细描述该阶段的具体法律行为，包括主体、程序步骤和关键环节（不少于30字）","documents":"列出形成的法律文书并说明其内容和作用（不少于20字）","legalBasis":"写明法律条文全称及条文要旨"},...]}</LIFECYCLE>
- 生命周期只覆盖从立案到一审判决生效，不包含二审、死刑复核、执行等后续阶段
- 只输出已完成的阶段节点（学生已经经历过的阶段），不要输出未来未到达的阶段
- 输出时应包含之前所有已完成节点加上当前新完成的节点，不要包含未来阶段
- 【重要】每个字段必须详细、具体，起到教学提示作用，禁止使用过于简短的概括性描述
可行性评估与风险提示：如果用户提出明显偏离案件事实或法律规定的假设，你不必直接顺着用户的思路给答案，而应指出该假设与案件事实或法律规定之间的差异，提示相关风险，并引导用户回到合法合理的分析路径上。
${COURT_LANGUAGE_KNOWLEDGE}

${INVESTIGATION_SPEECH_STYLE}`;

    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), 90000); // 90s timeout

    try {
      const ttsFeeder = voiceModeRef.current && playTts ? createTtsSentenceFeeder(speaker, 'court-investigation-user') : null;
      const streamThrottle = createThrottledStreamSetter(setStreamingText);
      const response = await fetch('/api/llm/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemPrompt + replyFormatInstruction(voiceModeRef.current) },
            { role: 'user', content: contextData + '\n\n已有对话:\n' + messages.map(m => `${m.speaker}: ${m.content}`).join('\n') + '\n\n当前阶段: ' + prompt },
          ],
          temperature: 0.7,
          caching: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader!.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') break;
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                fullText += parsed.content;
                streamThrottle.push(fullText);
                if (ttsFeeder) ttsFeeder.push(fullText);
              }
            } catch { /* skip */ }
          }
        }
      }

      const msg: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: parseLifecycleFromAIResponse(fullText),
        timestamp: Date.now(),
        speaker,
      };
      setMessages((prev) => [...prev, msg]);
      setStreamingText('');

      // TTS only in voice mode — text mode stays silent
      if (ttsFeeder) ttsFeeder.flush(fullText);
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setMessages((prev) => [...prev, {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: `错误: ${err.message}`,
          timestamp: Date.now(),
          speaker,
        }]);
      }
    } finally {
      clearTimeout(timeoutId);
      setIsStreaming(false);
      setStreamingText('');
      setStreamingSpeaker('');
      abortRef.current = null;
    }
  }, [contextData, messages]);

  const runAIStage = useCallback(async (stageIdx: number) => {
    const stage = STAGES[stageIdx];
    if (!stage) return;
    await streamAIResponse(stage.label, stage.speaker, true);
    // Wait for TTS to finish before moving to next stage
    if (voiceModeRef.current) await waitForTtsQueueDrain(8);
    // 发问类AI阶段：被问角色需回答刚才的提问
    const stageResponder = (stage as { responder?: string }).responder;
    if (stageResponder) {
      await streamAIResponse(`AI_RESPOND:${stage.speaker}`, stageResponder, true);
      if (voiceModeRef.current) await waitForTtsQueueDrain(8);
    }
    // If user interacted during TTS, stop auto-run
    if (userInteractedRef.current) {
      userInteractedRef.current = false;
      return;
    }
    // Move to next stage
    if (stageIdx + 1 < STAGES.length) {
      const nextStage = STAGES[stageIdx + 1];
      setCurrentStageIdx(stageIdx + 1);
      if (nextStage.type === 'ai') {
        setTimeout(() => runAIStage(stageIdx + 1), 300);
      }
    }
  }, [streamAIResponse]);


  // 长按说话（统一 hook：指针/触摸适配 + 竞态安全）
  const { isRecording, asrLoading, pressHandlers } = usePressTalk({
    uid: user?.id || 'guest',
    onText: (text) => {
      setInput(text);
      setTimeout(() => handleSendMessage(), 0);
    },
  });

  const handleSendMessage = async () => {
    if (!input.trim() || isStreaming) return;
    // Signal that user took over — stops auto-run progression
    userInteractedRef.current = true;
    // Interrupt any ongoing AI TTS
    interruptTts();
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
      speaker: '辩护人',
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    // AI responds as the character being examined (responder), or 审判长 if not specified
    const responder = (currentStage as { responder?: string })?.responder || '审判长';
    await streamAIResponse(`辩护人提问: ${input.trim()}`, responder, true);
    // Wait for AI response TTS to finish
    if (voiceModeRef.current) await waitForTtsQueueDrain(8);
    // 用户发言已被responder回应，打断语义消费完毕——复位以让后续AI阶段正常自动推进（否则下个AI阶段发言后会误判为用户打断而假死）
    userInteractedRef.current = false;
    // Auto-advance to next AI stages
    if (currentStageIdx + 1 < STAGES.length) {
      const nextStage = STAGES[currentStageIdx + 1];
      setCurrentStageIdx(currentStageIdx + 1);
      if (nextStage.type === 'ai') {
        setTimeout(() => runAIStage(currentStageIdx + 1), 300);
      }
    }
  };

  const handleNextStage = () => {
    if (isStreaming) {
      abortRef.current?.abort();
      setIsStreaming(false);
      setStreamingText('');
    }
    // In voice mode, show the last AI message as a floating bubble
    if (voiceMode) {
      const lastAi = [...messages].reverse().find(m => m.role === 'assistant');
      if (lastAi) {
        setAiBubble({ speaker: lastAi.speaker || 'AI', text: lastAi.content });
      }
    }
    interruptTts();
    if (currentStageIdx + 1 < STAGES.length) {
      const nextIdx = currentStageIdx + 1;
      setCurrentStageIdx(nextIdx);
      const nextStage = STAGES[nextIdx];
      if (nextStage.type === 'ai') {
        setTimeout(() => runAIStage(nextIdx), 400);
      }
    }
  };

  const handleContinue = async () => {
    setShowContinueModal(true);
    setContinueLoading(true);

    const allRecords = learningRecords.map(r => `${r.pageName}: ${r.summary}`).join('\n');
    const summaryPrompt = `请根据以下法庭调查的学习过程，进行概括、评价和训练建议。

案件资料:\n${contextData}

## 法庭调查的操作步骤
- 1. 公诉人宣读起诉书。在审判长宣布法庭调查开始后，首先由公诉人宣读起诉书；有附带民事诉讼的，再由附带民事诉讼原告人或者其诉讼代理人宣读附带民事起诉状。
- 2. 被告人陈述。在审判长主持下，被告人可以就起诉书指控的犯罪事实进行陈述。被告人如果承认起诉书指控的犯罪，应让其陈述犯罪事实；如果他否认起诉书指控的犯罪，应允许他陈述辩解意见。
- 3. 被害人陈述。在被告人陈述之后，如果有被害人，则应在审判长的主持下，由被害人对起诉书指控的犯罪事实及自己的受害经过进行陈述。
- 4. 控辩双方讯问或询问被告人。在审判长的主持下，公诉人，被害人及其法定代理人、诉讼代理人，被告人的法定代理人及辩护人可以讯问或询问被告人。其次序是：（1）公诉人可以就起诉书指控的犯罪事实讯问被告人；（2）经审判长许可，被害人及其法定代理人、诉讼代理人可以就公诉人讯问的情况对被告进行补充性发问；（3）经审判长准许，被告人的辩护人及其法定代理人可以就案件事实向被告人发问。
- 5. 控辩双方询问被害人。在审判长的主持下，控辩双方可以询问被害人。
- 6. 审判人员讯问或询问。审判人员认为有必要时，可以向被告人、被害人发问。
- 7. 询问证人、鉴定人。基于直接和言词原则的精神，只有在法庭上经过控、辩双方询问、质证，证言和鉴定意见才能作为定案的根据。询问证人、鉴定人的顺序是：首先，由审判人员告知他要如实地提供证言和有意作伪证或者掩匿罪证要负的法律责任。其次，先由证据的内容对本诉讼主张有利的一方对证人、鉴定人进行询问。再次，经审判长许可，由对方对证人、鉴定人进行反询问。最后，在控辩双方询问完毕后，合议庭认为有必要时，可以询问证人、鉴定人。在询问的过程中，向证人、鉴定人发问的内容与本案无关或者发问的方式不当的，审判长应当制止；控辩双方认为对方发问的内容与本案无关或者发问的方式不当并提出异议的，审判长应当根据情况予以支持或者驳回。
- 8. 出示实物证据、宣读鉴定意见和有关笔录。公诉人、辩护人应当向法庭出示实物证据，让当事人辨认。当庭出示的实物证据，应当先由出示证据的一方就所出示的证据来源、特征等作必要的说明，然后由另一方进行辨认并发表意见，控辩双方可以互相质问、辩论。对未到庭的证人、鉴定人，其证言笔录及鉴定意见应当当庭宣读。当庭出示的实物证据、宣读的证人证言、鉴定意见和勘验、检查笔录，在出示、宣读后应将原件移交法庭。
- 9. 调取新的证据。法庭审理过程中，当事人和辩护人、诉讼代理人有权申请通知新的证人到庭，调取新的物证，申请重新鉴定或者勘验。当事人和辩护人、诉讼代理人申请通知新的证人到庭，调取新的物证，申请重新鉴定或者勘验的，应当提供证人的姓名、证据的存放地点，说明所要证明的案件事实、要求重新鉴定或者勘验的理由。审判人员对于上述申请，应当作出是否同意的决定。在法庭审理过程中，辩护律师在提供被告人无罪或者罪轻的证据时，认为在侦查、审查起诉过程中侦查机关、人民检察院收集的证明被告人无罪或者罪轻的证据材料需要在法庭上出示的，可以申请人民法院向人民检察院调取该证据材料，并可以到人民法院查阅、摘抄、复制该证据材料。
- 10. 法庭调查核实证据。在法庭调查过程中，合议庭对证据有疑问的，可以宣布休庭，对证据进行调查核实。人民法院调查核实证据的方法有勘验、检查、扣押、鉴定和查询、冻结。必要时，人民法院在调查核实证据时，可以通知检察人员、辩护人到场。
- 11. 以上部分是刑事诉讼部分的法庭调查。附带民事诉讼部分的法庭调查，一般在刑事诉讼部分调查结束以后，根据民事诉讼法的有关规定进行。
## 法庭调查的注意事项：
- 1. 公诉人宣读起诉书时，应该宣读起诉书的全部内容，包括起诉书的落款单位等，但该起诉书的附注部分不必宣读。
- 2. 法庭调查阶段，先由公诉人举证，并接受诉讼各方的质证。在公诉人举证完毕后，被害人及其代理人、被告人及其辩护人可以向法庭提交证据。未经法庭调查并接受对方质证的证据，法院不得作为裁判的根据。
- 3. 在向法庭举证时，可以一次举出一份证据，也可以一次举出一组证据。每举出一份或一组证据，都需要简洁明了地向法庭说明证据的种类、名称、来源、内容及证明目的。
- 4. 讯问、询问需要遵守的规则是：（1） 起诉书指控被告人的犯罪事实为两起以上的，法庭调查时，一般应当就每一起犯罪事实分别进行讯问；（2） 对于共同犯罪案件中的被告人，应当分别进行讯问，合议庭认为必要时，可以传唤共同被告人同时到庭对质；（3） 控辩双方讯问或询问与本案无关的问题的，审判长应当制止；（4） 控辩双方认为对方讯问或者询问的内容与本案无关，或者讯问、询问的方式不当并提出异议的，审判长应当根据情况予以支持或者驳回。
- 5. 被告人当庭翻供的处理。实践中被告人有时会当庭推翻侦查阶段的有罪供述。在被告人翻供后，就公诉人而言，应当沉着冷静，通过宣读侦查阶段犯罪嫌疑人的口供笔录及提出其他证据予以证明。对此，《人民检察院刑事诉讼规则》第403条第2款规定：“被告人在庭审中的陈述与在侦查、审查起诉中的供述不一致，足以影响定罪量刑的，可以宣读被告人供述笔录，并针对笔录中被告人的供述内容对被告人进行讯问，或者提出其他证据进行证明。”就法官而言，则应当通过讯问被告人了解翻供的真实原因；审查翻供的前后说法，查明前后供述的差别之处；变换角度反复讯问，审查翻供的内容与其他证据是否一致。
- 6. 询问证人需要遵守的规则是：（1） 询问的内容应当与案件事实有关；（2） 不得以诱导方式提问；（3） 不得威胁证人；（4） 不得损害证人的人格尊严。这些规则也适用于对被告人、被害人、附带民事诉讼原告人和被告人、鉴定人的讯问或者询问。
- 7. 控辩双方针对对方违法讯问、询问提出异议的程序一般是：（1） 举手示意；（2） 向审判长提出抗议，简洁地说明理由，如对方的询问是诱导性询问等；（3） 合议庭当庭表态异议能否成立。
- 8. 合议庭对被告人、被害人及证人、鉴定人等的发问，只能在控辩双方讯问、询问完毕后才能进行。而且，这种发问是一种补充性发问。当然，为了查明事实真相，审判长、审判员、陪审员也应积极思考，在案件关键事实不清时，应当积极主动发问。
- 9. 所有在法庭上提交的实物证据及复制品，均需由法警当庭传递给对方查看、质证，然后再传给审判人员。实物证据原则上应当移交原物、原件。

对话记录:
${messages.map((m) => `${m.speaker || m.role}: ${m.content}`).join('\n')}

之前的学习记录:
${allRecords}

${STAGE_SUMMARY_FORMAT_INSTRUCTION}`;

    try {
      const data = await fetchSummarySections({
        systemPrompt: '你是一位法学教授，负责对模拟法庭训练的学习过程进行总结评价。' + '\n\n' + STAGE_SUMMARY_FORMAT_INSTRUCTION,
        userPrompt: summaryPrompt,
        temperature: 0.5,
        onChunk: (t) => setContinueStream(t),
      });
      let summary = data.summary || '', evaluation = data.evaluation, suggestion = data.suggestion, score: number | undefined = data.score;
      if (score === undefined && evaluation) { try { const { extractScore } = await import('@/lib/writing-outline'); score = extractScore(evaluation); } catch { /* skip */ } }

      const record: LearningRecordEntry = {
        pageName: '法庭调查',
        conversations: messages,
        summary,
        evaluation,
        suggestion,
        score,
        createdAt: Date.now(),
      };
      setContinueRecord(record);
      addLearningRecord(record);
    } catch {
      setContinueRecord({
        pageName: '法庭调查',
        conversations: messages,
        summary: '生成总结时出错',
        evaluation: '无法生成评价',
        suggestion: '请重试',
        createdAt: Date.now(),
      });
    } finally {
      setContinueStream('');
      setContinueLoading(false);
    }
  };

  if (!selectedCase) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const currentStage = STAGES[currentStageIdx];

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <TitleBar
        pageName="法庭调查"
        onSkip={() => { if (abortRef.current) abortRef.current.abort(); interruptTts(); advanceLifecycleForPage('/student/court-debate'); router.push('/student/court-debate'); }}
        onContinue={handleContinue}
        canContinue={messages.length > 0}
        continueTooltip="请先参与法庭调查"
        onEndAnalysis={handleEndAnalysis}
        showHome
        onHome={() => router.push('/')}
        isStudent
      />
      {endAnalysisModal}
      <LifecycleBar />

      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup orientation={isMobile ? 'vertical' : 'horizontal'} className="h-full">
          <ResizablePanel defaultSize={66} minSize={30}>
            <div className="flex flex-col overflow-hidden h-full border-r">
          {voiceMode ? (
            <>
              {/* Voice mode: background image with speaker indicator, user messages visible, AI messages via TTS only */}
              <div
                className="relative flex-1 overflow-hidden bg-cover bg-center"
                style={{ backgroundImage: 'url(/characters/defender.png)' }}
              >
                {/* Speaker indicator badge at top */}
                {(isStreaming || ttsSpeaker) && (
                  <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20">
                    <div className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-primary text-primary-foreground shadow-lg">
                      <span className="w-2.5 h-2.5 rounded-full bg-primary-foreground animate-pulse" />
                      <span className="text-base font-semibold">
                        {streamingSpeaker || ttsSpeaker || currentStage?.speaker} 正在发言
                      </span>
                    </div>
                  </div>
                )}
                {/* Speaker name watermark on image when idle */}
                {!isStreaming && !ttsSpeaker && currentStage?.speaker && (
                  <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20">
                    <div className="px-4 py-1.5 rounded-full bg-card/70 backdrop-blur shadow text-sm text-muted-foreground">
                      {currentStage.speaker}
                    </div>
                  </div>
                )}
                {/* Interactive prompt in voice mode */}
                {currentStage?.type === 'interactive' && !isStreaming && (
                  <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20">
                    <div className="px-5 py-2.5 rounded-full bg-primary/90 backdrop-blur shadow-lg text-sm font-medium text-center text-primary-foreground">
                      请作为辩护人发言
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Text mode: pure text chat, no background image */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto scroll-thin p-3 space-y-2 min-h-0">
                {messages.length === 0 && !isStreaming && (
                  <div className="text-center text-muted-foreground py-8 text-sm">
                    法庭调查即将开始...
                  </div>
                )}
                {messages.map((msg) => (
                  <div key={msg.id}>
                    {msg.role === 'user' ? (
                      <div className="flex justify-end">
                        <div className="max-w-[85%] rounded-lg px-3 py-2 text-sm bg-primary text-primary-foreground">
                          <div className="font-semibold mb-1">{msg.speaker}</div>
                          <div>{msg.content}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex justify-start">
                        <div className="max-w-[85%]">
                          <div className="text-xs font-semibold mb-0.5 text-primary">{msg.speaker}</div>
                          <div className="rounded-lg px-3 py-2 text-sm bg-muted markdown-content">
                            <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{msg.content}</ReactMarkdown>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {isStreaming && (
                  <div className="flex justify-start">
                    <div className="max-w-[85%]">
                      <div className="text-xs font-semibold mb-0.5 text-primary">
                        {streamingSpeaker || currentStage?.speaker}
                      </div>
                      <div className="rounded-lg px-3 py-2 text-sm bg-muted">
                        {hasVisibleStream(streamingText) ? (
                          <div className="markdown-content">
                            <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{stripLifecycleForStreaming(streamingText)}</ReactMarkdown>
                            <span className="typewriter-cursor" />
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <span className="w-2 h-2 rounded-full bg-primary ai-thinking-dot" />
                            <span className="w-2 h-2 rounded-full bg-primary ai-thinking-dot" />
                            <span className="w-2 h-2 rounded-full bg-primary ai-thinking-dot" />
                            <span>{(streamingSpeaker || currentStage?.speaker || 'AI').trim()}正在思考…</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Mode switch + controls */}
          <div className="border-t p-3 space-y-2 shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate">当前环节: {currentStage?.label}</span>
              <Button
                variant={voiceMode ? 'default' : 'outline'}
                size="sm"
                onClick={() => { setVoiceMode(!voiceMode); interruptTts(); }}
                className="text-xs h-7"
              >
                {voiceMode ? '切换文字模式' : '切换语音模式'}
              </Button>
              <Button variant="outline" size="sm" onClick={handleNextStage} disabled={isStreaming}>
                <SkipForward className="h-3.5 w-3.5 mr-1" />
                下一环节
              </Button>
            </div>

            {currentStage?.type === 'interactive' && !voiceMode && (
              <div className="flex gap-2">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="作为辩护人发言..."
                  className="resize-none text-sm min-h-[50px] max-h-[80px]"
                  disabled={isStreaming}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                />
                <Button onClick={handleSendMessage} disabled={!input.trim() || isStreaming} size="icon" className="shrink-0" aria-label="发送" title="发送（Enter）">
                  {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            )}

            {currentStage?.type === 'interactive' && voiceMode && (
              <div className="flex items-center justify-center gap-3 py-2">
                <Button
                  variant={isRecording ? 'destructive' : 'default'}
                  size="lg"
                  disabled={isStreaming || asrLoading}
                  aria-label="按住说话"
                  {...pressHandlers}
                  className="rounded-full h-14 w-14 p-0 select-none touch-none"
                >
                  {isRecording ? <Square className="h-5 w-5" /> : asrLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mic className="h-6 w-6" />}
                </Button>
                <span className="text-sm text-muted-foreground">
                  {asrLoading ? '识别中...' : isRecording ? '正在聆听…' : '长按说话'}
                </span>
              </div>
            )}

            {currentStage?.type === 'ai' && !isStreaming && (
              <div className="text-xs text-muted-foreground text-center py-1">
                {currentStage.label} · 自动推进中
              </div>
            )}
          </div>
        </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={34} minSize={20}>
            <div className="overflow-hidden h-full">
              <CaseFileViewer sections={caseFileSections} title="卷宗" highlightConfig={highlightConfig} currentRole={selectedRole || undefined} />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* AI text floating bubble (voice mode only, when user clicks "next stage") */}
      {aiBubble && voiceMode && (
        <div className="fixed bottom-24 right-[36%] z-50 max-w-md">
          <div className="relative bg-card/95 backdrop-blur border border-border rounded-lg shadow-lg p-4">
            <button
              onClick={() => setAiBubble(null)}
              className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="font-semibold text-sm mb-2 text-primary">{aiBubble.speaker}</div>
            <div className="text-sm max-h-48 overflow-y-auto markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{aiBubble.text}</ReactMarkdown></div>
          </div>
        </div>
      )}

      {/* Pre-trial flow — 4 rounds, auto-refresh */}
      <FlowPage
        open={showPretrialModal}
        onClose={() => {
          setShowPretrialModal(false);
          setShowOpeningModal(true);
        }}
        onSkipAll={() => {
          setShowPretrialModal(false);
          setShowOpeningModal(false);
          setAutoRunning(true);
          runAIStage(0);
        }}
        title="开庭前流程"
        rounds={[
          {
            systemPrompt: `以旁白形式沉浸式描写开庭前第一幕：文书送达。法院书记员将起诉书副本送达被告人，被告人签收。用场景叙事呈现，不要使用任何小标题或序号，不要提及第几幕，用纯叙事段落呈现，约500字。

案件基本资料:
${selectedCase?.case || ''}`,
            contextData: selectedCase?.case || '',
          },
          {
            systemPrompt: `以旁白形式沉浸式描写开庭前第二幕：庭前通知。法院向公诉人、辩护人、被告人发出开庭通知书，告知开庭时间、地点。用场景叙事呈现，不要使用任何小标题或序号，不要提及第几幕，用纯叙事段落呈现，约500字。

案件基本资料:
${selectedCase?.case || ''}`,
            contextData: selectedCase?.case || '',
          },
          {
            systemPrompt: `以旁白形式沉浸式描写开庭前第三幕：公告发布。法院在公告栏发布开庭公告，写明案由、开庭时间、地点，允许公民旁听。用场景叙事呈现，不要使用任何小标题或序号，不要提及第几幕，用纯叙事段落呈现，约500字。

案件基本资料:
${selectedCase?.case || ''}`,
            contextData: selectedCase?.case || '',
          },
          {
            systemPrompt: `以旁白形式沉浸式描写开庭前第四幕：法庭布置。法庭工作人员布置审判席、公诉人席、辩护人席、被告人席，摆放法槌、卷宗，检查录音设备。晨光洒入法庭。用场景叙事呈现，不要使用任何小标题或序号，不要提及第几幕，用纯叙事段落呈现，约500字。

案件基本资料:
${selectedCase?.case || ''}`,
            contextData: selectedCase?.case || '',
          },
        ]}
        backgroundImage="/bg-pretrial.jpeg"
      />

      {/* Opening flow — 3 rounds, auto-refresh */}
      <FlowPage
        open={showOpeningModal}
        onClose={() => {
          setShowOpeningModal(false);
          setAutoRunning(true);
          runAIStage(0);
        }}
        onSkipAll={() => {
          setShowOpeningModal(false);
          setAutoRunning(true);
          runAIStage(0);
        }}
        title="开庭流程"
        rounds={[
          {
            systemPrompt: `以旁白形式沉浸式描写开庭第一幕：庭前准备。书记员入庭，查点到庭人员，宣读法庭纪律。被告人被法警带入法庭。用场景叙事呈现，不要使用任何小标题或序号，不要提及第几幕，用纯叙事段落呈现，约500字。

案件基本资料:
${selectedCase?.case || ''}`,
            contextData: selectedCase?.case || '',
          },
          {
            systemPrompt: `以旁白形式沉浸式描写开庭第二幕：审判人员入庭。审判长、审判员入庭，全体起立。审判长敲响法槌，宣布开庭。用场景叙事呈现，不要使用任何小标题或序号，不要提及第几幕，用纯叙事段落呈现，约500字。

案件基本资料:
${selectedCase?.case || ''}`,
            contextData: selectedCase?.case || '',
          },
          {
            systemPrompt: `以旁白形式沉浸式描写开庭第三幕：身份与权利告知。审判长查明被告人身份，宣布案由，告知被告人享有申请回避、自行辩护、最后陈述等诉讼权利。各方均不申请回避。用场景叙事呈现，不要使用任何小标题或序号，不要提及第几幕，用纯叙事段落呈现，约500字。

案件基本资料:
${selectedCase?.case || ''}`,
            contextData: selectedCase?.case || '',
          },
        ]}
        backgroundImage="/bg-opening.jpeg"
      />

      <ContinueModal
        open={showContinueModal}
        onClose={() => {
          setShowContinueModal(false);
          if (continueRecord) router.push('/student/court-debate');
        }}
        loading={continueLoading}
        streamText={continueStream}
        record={continueRecord}
        conversations={messages}
      />

      <FloatingAssistant pageContext="法庭调查阶段，进行举证质证" />
    </div>
  );
}

