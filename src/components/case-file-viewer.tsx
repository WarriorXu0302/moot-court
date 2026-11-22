'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ChevronDown, ChevronRight, FileText, Folder, ChevronsDownUp, ChevronsUpDown, Minus, X, MessageSquareText, Highlighter } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from 'remark-cjk-friendly';
import { type HighlightConfig, type HighlightItem, HIGHLIGHT_ROLES, ROLE_HIGHLIGHT_LABELS, getHighlightsForRoles, sectionLabelToField, getRoleHighlightClass } from '@/lib/highlights';
import { useAppStore } from '@/lib/store';
import type { Annotation as StoreAnnotation } from '@/lib/types';

export interface CaseFileItem {
  title: string;
  book: string;
}

export interface CaseFileSection {
  label: string;
  items: CaseFileItem[];
}

export type Annotation = StoreAnnotation;

interface CaseFileViewerProps {
  sections: CaseFileSection[];
  title?: string;
  extraSection?: CaseFileSection | null;
  showWrongButton?: boolean;
  wrongContent?: string;
  onWrongClick?: () => void;
  onWrongContentChange?: (content: string) => void;
  highlightConfig?: HighlightConfig | null;
  currentRole?: string;
  /** When true, show role filter checkboxes (multi-select, inverse, select all) */
  showHighlightFilter?: boolean;
  /** When provided, shows a "高亮" button in the selection toolbar for adding sentence highlights */
  onAddHighlight?: (sectionLabel: string, selectedText: string, role: string) => void;
  /** 初始展开的条目，形如 `${分区下标}-${条目标题}`（如 "0-基本案情"）；默认全部收起 */
  defaultOpenKey?: string | null;
  /** 标题栏显示【标记文字】【取消标记】（类似法考答题界面）：选中文字后点击，黄色底色标出 */
  markTools?: boolean;
  /**
   * 批注作用域：批注存在全局 store、按条目下标定位。页面上同时有多个查看器时（案件基本资料 + 卷宗），
   * 必须给不同前缀，否则两边下标相同的条目会互相串批注。
   */
  annotationScope?: string;
}

const ANNOTATION_DEFAULT_COLOR = 'rgba(250, 204, 21, 0.2)';

/** 只在事件处理里调用；放在组件外，避免 React 编译器把组件内的 Date.now / Math.random 判为渲染期副作用 */
function nowMs(): number { return Date.now(); }
function newAnnotationId(): string { return `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

export function CaseFileViewer({
  sections,
  title = '卷宗',
  extraSection = null,
  showWrongButton = false,
  wrongContent,
  onWrongClick,
  onWrongContentChange,
  highlightConfig = null,
  currentRole,
  showHighlightFilter = false,
  onAddHighlight,
  defaultOpenKey = null,
  markTools = false,
  annotationScope = '',
}: CaseFileViewerProps) {
  const [openItemKey, setOpenItemKey] = useState<string | null>(defaultOpenKey);
  const [collapsedSections, setCollapsedSections] = useState<Set<number>>(new Set());
  const [allCollapsed, setAllCollapsed] = useState(false);
  const annotations = useAppStore((s) => s.caseAnnotations);
  const addCaseAnnotation = useAppStore((s) => s.addCaseAnnotation);
  const removeCaseAnnotationById = useAppStore((s) => s.removeCaseAnnotation);
  const [floatToolbar, setFloatToolbar] = useState<{ x: number; y: number; text: string; itemKey: string; sectionLabel: string } | null>(null);
  const [annotateMode, setAnnotateMode] = useState(false);
  const [noteInput, setNoteInput] = useState('');
  const [wrongModalOpen, setWrongModalOpen] = useState(false);
  const [wrongDraft, setWrongDraft] = useState(wrongContent || '');
  const containerRef = useRef<HTMLDivElement>(null);

  const [markHint, setMarkHint] = useState<string | null>(null);
  const flashHint = (t: string) => { setMarkHint(t); setTimeout(() => setMarkHint(null), 2500); };

  /** 当前选区所在条目的内容容器 */
  const selectionContext = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const anchor = sel.getRangeAt(0).startContainer;
    const el = (anchor.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor.parentElement)?.closest<HTMLElement>('[data-item-key]');
    if (!el || !containerRef.current?.contains(el)) return null;
    return { sel, el, itemKey: el.dataset.itemKey ?? '' };
  };

  const markSelection = () => {
    const ctx = selectionContext();
    if (!ctx) { flashHint('请先在案件资料中选中要标记的文字'); return; }
    const range = ctx.sel.getRangeAt(0);
    const text = ctx.sel.toString().trim();
    if (text.length < 1) return;
    // 算出选中的是该词在本条目里的第几次出现，避免"盈发公司"出现多次时总是标到第一处
    let occurrence = 0;
    for (let n = 0; n < 500; n++) {
      const r = findTextRange(ctx.el, text, { occurrence: n, includeMarked: true });
      if (!r) break;
      if (r.comparePoint(range.startContainer, range.startOffset) === 0) { occurrence = n; break; }
    }
    addCaseAnnotation({
      id: newAnnotationId(),
      itemKey: ctx.itemKey, selectedText: text, note: '', type: 'mark', occurrence, createdAt: nowMs(),
    });
    ctx.sel.removeAllRanges();
    setFloatToolbar(null);
  };

  const unmarkSelection = () => {
    const ctx = selectionContext();
    if (!ctx) { flashHint('请先选中要取消标记的文字'); return; }
    // 与选区有交集的黄色标记全部取消
    const hit = new Set<string>();
    ctx.el.querySelectorAll<HTMLElement>('[data-ann-id][data-manual-mark="mark"]').forEach((span) => {
      if (ctx.sel.containsNode(span, true) && span.dataset.annId) hit.add(span.dataset.annId);
    });
    if (hit.size === 0) { flashHint('选中的文字里没有标记'); return; }
    hit.forEach((id) => removeCaseAnnotationById(id));
    ctx.sel.removeAllRanges();
    setFloatToolbar(null);
  };

  // Highlight role filter: which roles' highlights are visible
  // Default: if currentRole is set, only show that role; otherwise show all
  const [highlightRoles, setHighlightRoles] = useState<Set<string>>(
    () => new Set(currentRole ? [currentRole] : HIGHLIGHT_ROLES as readonly string[])
  );

  // Update role filter when currentRole changes
  useEffect(() => {
    if (currentRole && !showHighlightFilter) {
      setHighlightRoles(new Set([currentRole]));
    } else if (!currentRole && showHighlightFilter) {
      setHighlightRoles(new Set(HIGHLIGHT_ROLES as readonly string[]));
    }
  }, [currentRole, showHighlightFilter]);

  const toggleRole = (role: string) => {
    setHighlightRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  };

  const selectAllRoles = () => setHighlightRoles(new Set(HIGHLIGHT_ROLES as readonly string[]));
  const inverseRoles = () => {
    setHighlightRoles((prev) => {
      const next = new Set<string>();
      for (const r of HIGHLIGHT_ROLES) {
        if (!prev.has(r)) next.add(r);
      }
      return next;
    });
  };
  const clearRoles = () => setHighlightRoles(new Set());

  // Check if highlightConfig has any data
  const hasHighlights = useMemo(() => {
    if (!highlightConfig) return false;
    return Object.keys(highlightConfig).length > 0;
  }, [highlightConfig]);

  // Sync wrongDraft when wrongContent prop changes externally
  useEffect(() => {
    setWrongDraft(wrongContent || '');
  }, [wrongContent]);

  const toggleItem = (key: string) => {
    setOpenItemKey((prev) => (prev === key ? null : key));
  };

  const toggleSection = (sIdx: number) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sIdx)) next.delete(sIdx);
      else next.add(sIdx);
      return next;
    });
  };

  const collapseAll = () => {
    setAllCollapsed(true);
    setOpenItemKey(null);
    setCollapsedSections(new Set(sections.map((_, i) => i)));
  };

  const expandAll = () => {
    setAllCollapsed(false);
    setCollapsedSections(new Set());
  };

  // Handle text selection — show floating toolbar at selection position
  const handleMouseUp = useCallback((itemKey: string, sectionLabel: string) => {
    // Small delay to let the browser finalize the selection
    setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        setFloatToolbar(null);
        setAnnotateMode(false);
        return;
      }
      const text = selection.toString().trim();
      if (text.length < 2) {
        setFloatToolbar(null);
        setAnnotateMode(false);
        return;
      }
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) return;
      // Position toolbar above the selection, relative to container
      const x = rect.left - containerRect.left + rect.width / 2;
      // If selection is near the top, show toolbar below instead of above
      const y = rect.top - containerRect.top < 50
        ? rect.bottom - containerRect.top + 8
        : rect.top - containerRect.top - 8;
      setFloatToolbar({ x, y, text, itemKey, sectionLabel });
      setAnnotateMode(false);
      setNoteInput('');
    }, 10);
  }, []);

  const doStrikethrough = () => {
    if (!floatToolbar) return;
    const newAnn: Annotation = {
      id: newAnnotationId(),
      itemKey: floatToolbar.itemKey,
      selectedText: floatToolbar.text,
      note: '',
      type: 'underline',
      createdAt: nowMs(),
    };
    // Commit to global store — persists across page navigation
    addCaseAnnotation(newAnn);
    // Clear selection and toolbar
    window.getSelection()?.removeAllRanges();
    setFloatToolbar(null);
  };

  const startAnnotate = () => {
    setAnnotateMode(true);
    setNoteInput('');
  };

  const confirmAnnotate = () => {
    if (!floatToolbar) return;
    const newAnn: Annotation = {
      id: newAnnotationId(),
      itemKey: floatToolbar.itemKey,
      selectedText: floatToolbar.text,
      note: noteInput.trim(),
      type: 'note',
      createdAt: nowMs(),
    };
    // Commit to global store — persists across page navigation
    addCaseAnnotation(newAnn);
    setAnnotateMode(false);
    setNoteInput('');
    // Clear selection and close toolbar
    window.getSelection()?.removeAllRanges();
    setFloatToolbar(null);
  };

  const cancelToolbar = useCallback(() => {
    setFloatToolbar(null);
    setAnnotateMode(false);
    setNoteInput('');
  }, []);

  const removeAnnotation = (id: string) => {
    removeCaseAnnotationById(id);
  };

  // Render content with annotations and role-based highlights
  const renderContent = (itemKey: string, content: string, sectionLabel: string) => {
    const itemAnnotations = annotations.filter((a) => a.itemKey === itemKey);
    const field = sectionLabelToField(sectionLabel);
    let highlights: HighlightItem[] = [];
    if (highlightConfig && field) {
      highlights = getHighlightsForRoles(highlightConfig, Array.from(highlightRoles), field);
    }
    return (
      <AnnotationRenderer
        key={itemKey}
        content={content}
        annotations={itemAnnotations}
        highlights={highlights}
      />
    );
  };

  return (
    <div ref={containerRef} className="flex flex-col h-full min-h-0 overflow-hidden relative">
      <div className="panel-head px-3 py-2 shrink-0 flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold text-sm shrink-0">{title}</h3>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={allCollapsed ? expandAll : collapseAll}
            title={allCollapsed ? '展开全部' : '折叠全部'}
          >
            {allCollapsed ? <ChevronsUpDown className="h-3 w-3" /> : <ChevronsDownUp className="h-3 w-3" />}
            <span className="ml-1 text-xs hidden lg:inline">{allCollapsed ? '展开' : '折叠'}</span>
          </Button>
          {markTools && (
            <>
              {/* onMouseDown 阻止默认行为：否则按下按钮的瞬间选区就被清掉了 */}
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onMouseDown={(e) => e.preventDefault()} onClick={markSelection} title="选中文字后点击，用黄色标出">
                <Highlighter className="h-3 w-3" />标记文字
              </Button>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onMouseDown={(e) => e.preventDefault()} onClick={unmarkSelection} title="选中已标记的文字后点击，取消标记">
                取消标记
              </Button>
            </>
          )}
          {showWrongButton && (
            <button
              className="text-xs px-2 py-1 rounded bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
              onClick={() => {
                setWrongDraft(wrongContent || '');
                setWrongModalOpen(true);
                onWrongClick?.();
              }}
            >
              程序瑕疵
            </button>
          )}
        </div>
      </div>

      {/* Highlight role filter bar */}
      {showHighlightFilter && hasHighlights && (
        <div className="px-3 py-1.5 border-b bg-muted/20 shrink-0 flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
            <Highlighter className="h-3 w-3" />
            <span>高亮筛选</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {HIGHLIGHT_ROLES.map((role) => (
              <label key={role} className="flex items-center gap-1 cursor-pointer text-xs">
                <Checkbox
                  checked={highlightRoles.has(role)}
                  onCheckedChange={() => toggleRole(role)}
                  className="h-3.5 w-3.5"
                />
                <span className="flex items-center gap-1">
                  <span className={`inline-block w-2.5 h-2.5 rounded-sm ${getRoleHighlightClass(role)}`} />
                  {ROLE_HIGHLIGHT_LABELS[role]}
                </span>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-1 ml-auto shrink-0">
            <button onClick={selectAllRoles} className="text-[10px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted/70 transition-colors">全选</button>
            <button onClick={inverseRoles} className="text-[10px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted/70 transition-colors">反选</button>
            <button onClick={clearRoles} className="text-[10px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted/70 transition-colors">清除</button>
          </div>
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-2 space-y-1">
            {sections.map((section, sIdx) => {
              const isCollapsed = collapsedSections.has(sIdx);
              return (
                <div key={sIdx}>
                  <div className="flex items-center w-full px-2 py-1.5 text-sm rounded text-left">
                    <button
                      className="flex items-center flex-1"
                      onClick={() => toggleSection(sIdx)}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-4 w-4 mr-1 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 mr-1 shrink-0 text-muted-foreground" />
                      )}
                      <Folder className="h-4 w-4 mr-1.5 shrink-0 text-primary" />
                      <span className="font-medium">{section.label}</span>
                    </button>
                    <span className="ml-auto text-xs text-muted-foreground">{section.items.length}</span>
                  </div>

                  {!isCollapsed && (
                    <div className="ml-6 space-y-0.5">
                      {section.items.map((item, iIdx) => {
                        const key = `${sIdx}-${item.title}`;
                        const isOpen = openItemKey === key;
                        const itemKey = `${annotationScope}${sIdx}-${iIdx}`;
                        return (
                          <div key={iIdx}>
                            <button
                              className="flex items-center w-full px-2 py-1 text-sm rounded text-left hover:bg-accent"
                              onClick={() => toggleItem(key)}
                            >
                              {isOpen ? (
                                <ChevronDown className="h-3 w-3 mr-1 shrink-0" />
                              ) : (
                                <ChevronRight className="h-3 w-3 mr-1 shrink-0" />
                              )}
                              <FileText className="h-3 w-3 mr-1.5 shrink-0 text-muted-foreground" />
                              <span className="truncate">{item.title}</span>
                            </button>

                            {isOpen && (
                              <div
                                className="ml-4 mt-1 mb-2 max-h-[50vh] overflow-y-auto scroll-thin rounded-sm border-l-2 border-primary/30 bg-card px-4 py-3 markdown-content docket-text"
                                data-item-key={itemKey}
                                onMouseUp={(e) => { e.stopPropagation(); handleMouseUp(itemKey, section.label); }}
                              >
                                {renderContent(itemKey, item.book, section.label)}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {extraSection && extraSection.items.length > 0 && (
              <div className="border-t pt-2 mt-2">
                <div className="flex items-center w-full px-2 py-1.5 text-sm rounded text-left">
                  <ChevronRight className="h-4 w-4 mr-1 shrink-0 text-muted-foreground" />
                  <FileText className="h-4 w-4 mr-1.5 shrink-0 text-destructive" />
                  <span className="font-medium text-destructive">{extraSection.label}</span>
                </div>
                <div className="ml-6 space-y-0.5">
                  {extraSection.items.map((item, iIdx) => {
                    const key = `extra-${iIdx}-${item.title}`;
                    const isOpen = openItemKey === key;
                    return (
                      <div key={iIdx}>
                        <button
                          className="flex items-center w-full px-2 py-1 text-sm rounded text-left hover:bg-accent"
                          onClick={() => toggleItem(key)}
                        >
                          {isOpen ? <ChevronDown className="h-3 w-3 mr-1 shrink-0" /> : <ChevronRight className="h-3 w-3 mr-1 shrink-0" />}
                          <FileText className="h-3 w-3 mr-1.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{item.title}</span>
                        </button>
                        {isOpen && (
                          <div className="ml-4 mt-1 mb-2 p-3 bg-destructive/5 rounded text-sm max-h-48 overflow-y-auto scroll-thin border-l-2 border-destructive/30 markdown-content">
                            <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{item.book}</ReactMarkdown>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Right sidebar: annotations list — only note-type, full text, no underline entries */}
        {(() => {
          const noteAnnotations = annotations.filter((a) => a.type === 'note');
          if (noteAnnotations.length === 0) return null;
          return (
          <div className="w-full sm:w-64 lg:w-72 xl:w-80 border-l bg-card/50 shrink-0 overflow-y-auto scroll-thin max-h-full">
            <div className="px-2 py-2 border-b sticky top-0 bg-card/95 backdrop-blur-sm z-10">
              <span className="text-xs font-semibold">批注列表 ({noteAnnotations.length})</span>
            </div>
            <div className="p-2 space-y-2">
              {noteAnnotations.map((ann, idx) => (
                <div key={ann.id} className="text-xs rounded-lg p-2.5 bg-card/60 border border-border/50 hover:border-primary/30 transition-colors" style={{ borderLeft: '3px solid var(--primary)' }}>
                  <div className="flex items-start justify-between gap-1">
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold bg-primary/15 text-primary">
                        {idx + 1}
                      </span>
                    </div>
                    <button
                      className="text-muted-foreground/40 hover:text-destructive shrink-0 transition-colors"
                      onClick={() => removeAnnotation(ann.id)}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <p className="mt-1 text-muted-foreground leading-relaxed break-words whitespace-pre-wrap">
                    {ann.selectedText}
                  </p>
                  {ann.note && (
                    <p className="mt-1.5 pt-1.5 border-t border-border/30 text-primary/80 italic break-words whitespace-pre-wrap">{ann.note}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
          );
        })()}
      </div>

      {markHint && (
        <div role="status" className="absolute left-1/2 top-12 z-50 -translate-x-1/2 rounded-md bg-foreground px-3 py-1.5 text-xs text-background shadow">{markHint}</div>
      )}

      {/* Floating toolbar — appears at selection position */}
      {floatToolbar && (
        <div
          data-float-toolbar
          className="absolute z-50 flex flex-col gap-1"
          style={{
            left: `${floatToolbar.x}px`,
            top: `${floatToolbar.y}px`,
            transform: 'translate(-50%, -100%)',
          }}
          // Prevent mousedown from clearing the text selection
          onMouseDown={(e) => e.preventDefault()}
        >
          {!annotateMode ? (
            <div
              className="flex items-center gap-1.5 rounded-full bg-card/95 shadow-lg border border-border px-1.5 py-1"
              style={{ backdropFilter: 'blur(8px)', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.2)' }}
            >
              <button
                className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-all hover:scale-105 cursor-pointer"
                style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                onClick={doStrikethrough}
                title="划线标记"
              >
                <Minus className="h-3.5 w-3.5" />
                划线
              </button>
              <button
                className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-all hover:scale-105 cursor-pointer"
                style={{ background: 'color-mix(in srgb, var(--primary) 15%, transparent)', color: 'var(--primary)' }}
                onClick={startAnnotate}
                title="添加批注"
              >
                <MessageSquareText className="h-3.5 w-3.5" />
                标注
              </button>
              {onAddHighlight && floatToolbar && (
                <div className="relative group">
                  <button
                    className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-all hover:scale-105 cursor-pointer"
                    style={{ background: 'color-mix(in srgb, var(--primary) 25%, transparent)', color: 'var(--primary)' }}
                    title="添加高亮句子"
                  >
                    <Highlighter className="h-3.5 w-3.5" />
                    高亮
                  </button>
                  <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 hidden group-hover:flex flex-col gap-0.5 bg-card border border-border rounded-lg shadow-lg p-1 z-50 min-w-[100px]">
                    {HIGHLIGHT_ROLES.map((role) => (
                      <button
                        key={role}
                        className="flex items-center gap-1.5 px-2 py-1 rounded text-xs hover:bg-muted transition-colors whitespace-nowrap"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          if (floatToolbar) {
                            onAddHighlight(floatToolbar.sectionLabel, floatToolbar.text, role);
                            window.getSelection()?.removeAllRanges();
                            setFloatToolbar(null);
                          }
                        }}
                      >
                        <span className={`inline-block w-2.5 h-2.5 rounded-sm ${getRoleHighlightClass(role)}`} />
                        {ROLE_HIGHLIGHT_LABELS[role]}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <button
                className="p-1.5 rounded-full hover:bg-muted text-muted-foreground/60 transition-colors cursor-pointer"
                onClick={cancelToolbar}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <div
              className="flex items-center gap-1 rounded-full bg-card/95 shadow-lg border border-border p-1"
              style={{ backdropFilter: 'blur(8px)', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.2)' }}
            >
              <input
                type="text"
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); confirmAnnotate(); }
                  if (e.key === 'Escape') { e.preventDefault(); setAnnotateMode(false); }
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                placeholder="输入批注内容..."
                className="text-xs px-2.5 py-1 bg-transparent border-none outline-none flex-1 min-w-[120px] focus:ring-0"
                autoFocus
              />
              <button
                className="px-3 py-1 rounded-full text-xs font-semibold transition-all hover:scale-105 cursor-pointer"
                style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                onClick={confirmAnnotate}
              >
                确认
              </button>
              <button
                className="p-1 rounded-full hover:bg-muted text-muted-foreground transition-colors cursor-pointer"
                onClick={() => setAnnotateMode(false)}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      )}

      {showWrongButton && wrongModalOpen && (
        <WrongModal
          content={wrongDraft}
          onClose={() => setWrongModalOpen(false)}
          onContentChange={(c) => {
            setWrongDraft(c);
            onWrongContentChange?.(c);
          }}
        />
      )}
    </div>
  );
}

/**
 * Find a Range in the container that matches the given search text.
 * Walks all text nodes, builds a full-text index, and maps the match back to DOM positions.
 * Handles whitespace differences between selection.toString() and DOM text content
 * by normalizing all whitespace to single spaces in both the search text and the index.
 */
function findTextRange(
  container: HTMLElement,
  rawSearchText: string,
  opts: { occurrence?: number; includeMarked?: boolean } = {},
): Range | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      // Skip text nodes inside our manual mark spans（标记文字按出现次序定位，需要把已标记的文字也计入，否则次序会错位）
      const parent = node.parentElement;
      if (!opts.includeMarked && parent && parent.dataset.manualMark) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    textNodes.push(node as Text);
  }

  if (textNodes.length === 0) return null;

  // Normalize whitespace: collapse all whitespace (spaces, newlines, tabs) to single space
  const normalizeWs = (s: string) => s.replace(/\s+/g, ' ').trim();
  const searchNormalized = normalizeWs(rawSearchText);

  // Build full text with per-node offset tracking, using a separator between block elements
  // to simulate how selection.toString() joins text across paragraphs.
  const nodeInfos: { textNode: Text; originalText: string; normalizedText: string; startOffset: number }[] = [];
  let fullText = '';

  for (const textNode of textNodes) {
    const originalText = textNode.textContent || '';
    const normalizedText = normalizeWs(originalText);
    if (normalizedText.length === 0) continue;

    // If this node is in a different block element than the previous, add a separator
    const prevInfo = nodeInfos[nodeInfos.length - 1];
    if (prevInfo) {
      const prevBlock = getBlockParent(prevInfo.textNode);
      const currBlock = getBlockParent(textNode);
      if (prevBlock !== currBlock) {
        fullText += ' ';
      }
    }

    nodeInfos.push({
      textNode,
      originalText,
      normalizedText,
      startOffset: fullText.length,
    });
    fullText += normalizedText;
  }

  let matchIdx = fullText.indexOf(searchNormalized);
  for (let n = 0; n < (opts.occurrence ?? 0) && matchIdx !== -1; n++) {
    matchIdx = fullText.indexOf(searchNormalized, matchIdx + searchNormalized.length);
  }
  if (matchIdx === -1 && (opts.occurrence ?? 0) > 0) return null;
  let matchLen = searchNormalized.length;
  if (matchIdx === -1) {
    // Fallback: try matching with all whitespace stripped
    const fullNoWs = fullText.replace(/\s/g, '');
    const searchNoWs = searchNormalized.replace(/\s/g, '');
    const noWsIdx = fullNoWs.indexOf(searchNoWs);
    if (noWsIdx === -1) return null;

    // Map noWs index back to fullText index and find the actual match length
    let count = 0;
    matchIdx = -1;
    let matchEndIdx = -1;
    for (let i = 0; i < fullText.length; i++) {
      if (count === noWsIdx && matchIdx === -1) {
        matchIdx = i;
      }
      if (count === noWsIdx + searchNoWs.length && matchEndIdx === -1) {
        matchEndIdx = i;
        break;
      }
      if (!/\s/.test(fullText[i])) count++;
    }
    if (matchIdx === -1) return null;
    matchLen = (matchEndIdx === -1 ? fullText.length : matchEndIdx) - matchIdx;
  }

  const matchEnd = matchIdx + matchLen;

  // Map full-text offsets back to individual text nodes
  const range = document.createRange();
  let startSet = false;

  for (const info of nodeInfos) {
    const nodeStart = info.startOffset;
    const nodeEnd = nodeStart + info.normalizedText.length;

    if (!startSet && nodeEnd > matchIdx) {
      // Start of match falls within this node
      const localStart = matchIdx - nodeStart;
      // Map normalized offset back to original offset
      const origStart = mapNormalizedToOriginal(info.originalText, info.normalizedText, localStart);
      range.setStart(info.textNode, origStart);
      startSet = true;
    }

    if (startSet && nodeEnd >= matchEnd) {
      // End of match falls within this node
      const localEnd = matchEnd - nodeStart;
      const origEnd = mapNormalizedToOriginal(info.originalText, info.normalizedText, localEnd);
      range.setEnd(info.textNode, origEnd);
      return range;
    }
  }

  return null;
}

/**
 * Get the nearest block-level ancestor of a text node.
 * Used to determine if two text nodes are in different paragraphs.
 */
function getBlockParent(textNode: Text): Element | null {
  let el: Element | null = textNode.parentElement;
  while (el) {
    const display = window.getComputedStyle(el).display;
    if (display === 'block' || display === 'list-item' || display === 'table-cell' || display === 'table-row') {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

/**
 * Map a character offset in the normalized text back to the original text.
 * Normalized text has all whitespace collapsed to single spaces and trimmed.
 */
function mapNormalizedToOriginal(original: string, normalized: string, normalizedOffset: number): number {
  // Walk through both strings simultaneously
  let origIdx = 0;
  let normIdx = 0;
  let inWhitespace = false;

  while (origIdx < original.length && normIdx < normalized.length) {
    const origChar = original[origIdx];
    const isWhitespace = /\s/.test(origChar);

    if (isWhitespace) {
      if (!inWhitespace) {
        // First whitespace char maps to the space in normalized text
        if (normIdx === normalizedOffset) return origIdx;
        normIdx++;
        inWhitespace = true;
      }
      origIdx++;
    } else {
      // Non-whitespace char
      if (normIdx === normalizedOffset) return origIdx;
      normIdx++;
      origIdx++;
      inWhitespace = false;
    }
  }

  // If we've consumed all normalized text, return the end of original
  if (normIdx === normalizedOffset) return origIdx;

  // Fallback: return original length
  return original.length;
}

/**
 * Wrap a Range with a styled span. Uses surroundContents, with fallback for multi-element ranges.
 */
function wrapRangeWithSpan(range: Range, styles: Partial<CSSStyleDeclaration>, markType: string, className?: string, annId?: string): void {
  const span = document.createElement('span');
  Object.assign(span.style, styles);
  if (className) span.className = className;
  span.dataset.manualMark = markType;
  if (annId) span.dataset.annId = annId;
  try {
    range.surroundContents(span);
  } catch {
    const contents = range.extractContents();
    span.appendChild(contents);
    range.insertNode(span);
  }
}

/** Render content with inline annotations and highlights applied via useEffect (DOM manipulation) */
function AnnotationRenderer({
  content,
  annotations,
  highlights,
}: {
  content: string;
  annotations: Annotation[];
  highlights: HighlightItem[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Apply annotations + highlights to the DOM after React renders
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 1. Remove previous manual marks (unwrap them)
    container.querySelectorAll('[data-manual-mark]').forEach(el => {
      const parent = el.parentNode;
      if (parent) {
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
        parent.normalize();
      }
    });

    // 2. Apply system highlights (from highlightConfig) with role-based colors
    for (const item of highlights) {
      if (!item.text) continue;
      const range = findTextRange(container, item.text);
      if (range) {
        wrapRangeWithSpan(range, {
          borderRadius: '2px',
          padding: '0 1px',
        }, 'highlight', getRoleHighlightClass(item.role));
      }
    }

    // 3. Apply user annotations (underline + note)
    for (const ann of annotations) {
      if (!ann.selectedText) continue;
      if (ann.type === 'mark') {
        const markRange = findTextRange(container, ann.selectedText, { occurrence: ann.occurrence ?? 0, includeMarked: true });
        if (markRange) wrapRangeWithSpan(markRange, { backgroundColor: 'rgba(250, 204, 21, 0.55)', borderRadius: '2px' }, 'mark', undefined, ann.id);
        continue;
      }
      const range = findTextRange(container, ann.selectedText);
      if (!range) continue;

      if (ann.type === 'underline') {
        wrapRangeWithSpan(range, {
          textDecoration: 'underline',
          textDecorationColor: 'var(--primary)',
          textDecorationThickness: '2px',
          textUnderlineOffset: '2px',
        }, 'underline');
      } else if (ann.type === 'note') {
        wrapRangeWithSpan(range, {
          backgroundColor: ANNOTATION_DEFAULT_COLOR,
          borderRadius: '3px',
          padding: '0 2px',
        }, 'note');
      }
    }
  }, [annotations, highlights, content]);

  return (
    <div ref={containerRef} className="annotation-content">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

function WrongModal({ content, onClose, onContentChange }: { content: string; onClose: () => void; onContentChange?: (content: string) => void }) {
  const [open, setOpen] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState(content);
  if (!open) return null;

  const canEdit = !!onContentChange;

  const handleSave = () => {
    onContentChange?.(editContent);
    setEditMode(false);
  };

  const handleClose = () => {
    setOpen(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={handleClose}>
      <div className="bg-card rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold text-base text-destructive">程序瑕疵说明</h3>
          <div className="flex items-center gap-2">
            {canEdit && !editMode && (
              <button
                className="text-xs px-2 py-1 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                onClick={() => { setEditContent(content); setEditMode(true); }}
              >
                修改
              </button>
            )}
            {canEdit && editMode && (
              <button
                className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                onClick={handleSave}
              >
                保存
              </button>
            )}
            <button
              className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
              onClick={handleClose}
            >
              关闭
            </button>
          </div>
        </div>
        <div className="flex-1 px-6 py-5 overflow-y-auto markdown-content docket-text">
          {editMode ? (
            <textarea
              className="w-full h-full min-h-[300px] text-sm bg-transparent border border-border rounded p-2 outline-none focus:ring-1 focus:ring-primary resize-none"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              placeholder="请输入程序瑕疵说明（可为空）..."
            />
          ) : content ? (
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{content}</ReactMarkdown>
          ) : (
            <p className="text-muted-foreground italic">暂无程序瑕疵说明。点击"修改"按钮可添加内容。</p>
          )}
        </div>
      </div>
    </div>
  );
}
