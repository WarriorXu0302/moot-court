'use client';

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight, FileText, Scale, Gavel, Shield, Search, GitBranch, Loader2 } from 'lucide-react';

export interface LifecycleNode {
  stage: string;
  legalActions: string;
  documents: string;
  legalBasis: string;
  completed?: boolean;
}

export interface CaseLifecycle {
  nodes: LifecycleNode[];
}

const STAGE_ICONS: Record<string, React.ReactNode> = {
  '立案': <Scale className="h-3.5 w-3.5" />,
  '侦查': <Search className="h-3.5 w-3.5" />,
  '移送': <FileText className="h-3.5 w-3.5" />,
  '审查起诉': <FileText className="h-3.5 w-3.5" />,
  '提起公诉': <Shield className="h-3.5 w-3.5" />,
  '审判准备': <FileText className="h-3.5 w-3.5" />,
  '开庭': <Gavel className="h-3.5 w-3.5" />,
  '法庭调查': <Search className="h-3.5 w-3.5" />,
  '法庭辩论': <GitBranch className="h-3.5 w-3.5" />,
  '最后陈述': <FileText className="h-3.5 w-3.5" />,
  '评议': <Scale className="h-3.5 w-3.5" />,
  '宣判': <Gavel className="h-3.5 w-3.5" />,
  '一审': <Gavel className="h-3.5 w-3.5" />,
  '案件查阅': <Search className="h-3.5 w-3.5" />,
};

export function getStageIcon(stage: string): React.ReactNode {
  for (const key of Object.keys(STAGE_ICONS)) {
    if (stage.includes(key)) return STAGE_ICONS[key];
  }
  return <FileText className="h-3.5 w-3.5" />;
}

// 防护：字段可能被 AI 输出为数组/对象，直接渲染会暴露对象代码，统一转为安全文本
function safeField(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string').join('；');
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.content === 'string') return obj.content;
    return '';
  }
  return String(value);
}

export function CaseLifecycleTimeline({ lifecycle, loading = false }: { lifecycle: CaseLifecycle | null; loading?: boolean }) {
  const [expandedNode, setExpandedNode] = useState<number | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const bubbleRefs = useRef<(HTMLDivElement | null)[]>([]);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Close popover when clicking outside
  useEffect(() => {
    if (expandedNode === null) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const isInsideBubble = bubbleRefs.current.some(ref => ref?.contains(target));
      const isInsidePopover = popoverRef.current?.contains(target);
      if (!isInsideBubble && !isInsidePopover) {
        setExpandedNode(null);
        setPopoverPos(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [expandedNode]);

  // Close popover on scroll/resize — but NOT when scrolling inside the popover itself
  useEffect(() => {
    if (expandedNode === null) return;
    const handler = (e: Event) => {
      // If the scroll event originated inside the popover, let it scroll normally
      if (popoverRef.current && e.target instanceof Node && popoverRef.current.contains(e.target)) {
        return;
      }
      setExpandedNode(null);
      setPopoverPos(null);
    };
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [expandedNode]);

  if (!lifecycle || !lifecycle.nodes || lifecycle.nodes.length === 0) {
    if (loading) {
      return (
        <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>正在生成案件生命周期...</span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground">
        <GitBranch className="h-3.5 w-3.5" />
        <span>案件生命周期（对话中生成）</span>
      </div>
    );
  }

  // Only show completed nodes — uncompleted (future) stages are hidden
  const visibleNodes = lifecycle.nodes.filter(n => n.completed !== false);

  if (visibleNodes.length === 0) {
    if (loading) {
      return (
        <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>正在生成案件生命周期...</span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground">
        <GitBranch className="h-3.5 w-3.5" />
        <span>案件生命周期（对话中生成）</span>
      </div>
    );
  }

  const handleNodeClick = (idx: number) => {
    if (expandedNode === idx) {
      setExpandedNode(null);
      setPopoverPos(null);
      return;
    }
    const bubble = bubbleRefs.current[idx];
    if (bubble) {
      const bubbleRect = bubble.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const popoverWidth = 400;
      // Use viewport-relative coordinates for fixed positioning
      setPopoverPos({
        top: bubbleRect.bottom + 8,
        left: Math.max(8, Math.min(bubbleRect.left - 120, viewportWidth - popoverWidth - 8)),
        width: popoverWidth,
      });
    }
    setExpandedNode(idx);
  };

  const popoverContent = expandedNode !== null && popoverPos ? (
    <div
      ref={popoverRef}
      data-lifecycle-popover
      className="fixed z-[9999] rounded-lg border bg-popover shadow-xl p-4 space-y-3 max-h-[70vh] overflow-y-auto scroll-thin"
      style={{ top: popoverPos.top, left: popoverPos.left, width: popoverPos.width }}
    >
      {(() => {
        const node = visibleNodes[expandedNode];
        return (
          <>
            <div className="flex items-center gap-2 pb-2 border-b">
              {getStageIcon(node.stage)}
              <span className="text-sm font-bold text-foreground">{node.stage}</span>
              <button
                className="ml-auto text-muted-foreground hover:text-foreground"
                onClick={() => { setExpandedNode(null); setPopoverPos(null); }}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
            <div>
              <Badge variant="secondary" className="mb-1.5 text-[10px]">法律行为</Badge>
              <p className="text-xs text-muted-foreground leading-relaxed break-words">{safeField(node.legalActions)}</p>
            </div>
            <div>
              <Badge variant="secondary" className="mb-1.5 text-[10px]">形成文书</Badge>
              <p className="text-xs text-muted-foreground leading-relaxed break-words">{safeField(node.documents)}</p>
            </div>
            <div>
              <Badge variant="secondary" className="mb-1.5 text-[10px]">法律依据</Badge>
              <p className="text-xs text-muted-foreground leading-relaxed break-words">{safeField(node.legalBasis)}</p>
            </div>
          </>
        );
      })()}
    </div>
  ) : null;

  return (
    <div ref={containerRef} className="relative border-b bg-card/40 px-4 py-1.5">
      <div className="flex items-center gap-0 overflow-x-auto scroll-thin">
        {visibleNodes.map((node, idx) => (
          <React.Fragment key={idx}>
            {/* Connector line between nodes */}
            {idx > 0 && (
              <div className="flex-shrink-0 flex items-center">
                <div className="h-px w-4 bg-border" />
                <ChevronRight className="h-3 w-3 text-muted-foreground -ml-1" />
              </div>
            )}
            {/* Bubble node */}
            <div
              ref={el => { bubbleRefs.current[idx] = el; }}
              className="flex-shrink-0 cursor-pointer"
              onClick={() => handleNodeClick(idx)}
            >
              <div className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors ${
                expandedNode === idx ? 'border-primary bg-primary/10' : 'border-border bg-card hover:border-muted-foreground/40'
              }`}>
                {getStageIcon(node.stage)}
                <span className="text-xs font-medium text-foreground whitespace-nowrap">{node.stage}</span>
              </div>
            </div>
          </React.Fragment>
        ))}
      </div>

      {/* Popover rendered via portal to escape parent overflow */}
      {mounted && popoverContent && createPortal(popoverContent, document.body)}
    </div>
  );
}
