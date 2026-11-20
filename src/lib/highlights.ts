import type { CaseHighlights, HighlightEntry, ThemeName } from './types';

/** Alias for CaseHighlights used by the viewer */
export type HighlightConfig = CaseHighlights;

/** A single highlight item with role info for rendering */
export interface HighlightItem {
  text: string;
  role: string;
}

// ===== Field & Role Constants =====

export const HIGHLIGHT_FIELDS = ['plead', 'record', 'evidence'] as const;
export const HIGHLIGHT_ROLES = ['defender', 'prosecutor', 'judge'] as const;

export const ROLE_HIGHLIGHT_LABELS: Record<string, string> = {
  defender: '辩护人',
  prosecutor: '公诉人',
  judge: '审判长',
};

export const FIELD_LABELS: Record<string, string> = {
  plead: '诉讼文书',
  record: '询问笔录',
  evidence: '证据材料',
};

// Map section label (from CaseFileViewer) to field key
export function sectionLabelToField(sectionLabel: string): string {
  if (sectionLabel.includes('诉讼')) return 'plead';
  if (sectionLabel.includes('询问') || sectionLabel.includes('笔录')) return 'record';
  if (sectionLabel.includes('证据')) return 'evidence';
  return '';
}

// ===== Role-Based Color System =====
// All three roles use the same color family (--primary), but different shades.
// This ensures theme consistency: the highlight color automatically matches
// the current background theme.

/** CSS class for each role's highlight background */
export const ROLE_HIGHLIGHT_CLASS: Record<string, string> = {
  defender: 'hl-role-defender',
  prosecutor: 'hl-role-prosecutor',
  judge: 'hl-role-judge',
};

/** Opacity levels for each role (same family, different shades) */
export const ROLE_SHADE_OPACITY: Record<string, number> = {
  defender: 0.18,
  prosecutor: 0.32,
  judge: 0.48,
};

/** Get the CSS class for a role's highlight */
export function getRoleHighlightClass(role: string): string {
  return ROLE_HIGHLIGHT_CLASS[role] || ROLE_HIGHLIGHT_CLASS.defender;
}

// ===== Preset Keywords (used for sentence extraction) =====
// These keywords are NOT highlighted directly — instead, we find the full
// sentence containing each keyword and highlight the entire sentence.
// This ensures highlights are sentence-level, not keyword-level.

export interface PresetCategory {
  /** Display label for this category */
  label: string;
  /** Keywords to search for; the full sentence containing any match is extracted */
  keywords: string[];
}

export const HIGHLIGHT_PRESETS: Record<string, PresetCategory[]> = {
  defender: [
    {
      label: '法定从宽情节',
      keywords: ['初犯', '偶犯', '无前科', '无违法犯罪记录', '从轻处罚', '减轻处罚', '从轻', '减轻', '免除处罚'],
    },
    {
      label: '认罪态度',
      keywords: ['认罪认罚', '如实供述', '坦白', '自首', '立功', '真诚悔罪', '自愿认罪'],
    },
    {
      label: '犯罪形态',
      keywords: ['未遂', '中止', '犯罪未遂', '犯罪中止', '预备', '犯罪预备'],
    },
    {
      label: '赔偿与谅解',
      keywords: ['退赔', '退赃', '赔偿', '谅解', '积极赔偿', '达成谅解', '赔偿损失'],
    },
    {
      label: '特殊主体',
      keywords: ['未成年', '限制刑事责任能力', '精神障碍', '智力障碍', '怀孕', '哺乳'],
    },
    {
      label: '主观与社会危害',
      keywords: ['主观恶性较小', '社会危害性较小', '社会危害性低', '人身危险性小'],
    },
    {
      label: '财产保全',
      keywords: ['冻结', '查封', '扣押', '追缴', '没收'],
    },
  ],
  prosecutor: [
    {
      label: '证据链完整性',
      keywords: ['证据链', '证据确实、充分', '证据确实充分', '排他性', '证据相互印证', '形成完整证据链', '证据之间相互印证'],
    },
    {
      label: '认罪认罚自愿性',
      keywords: ['认罪认罚', '自愿性', '认罪认罚自愿性', '具结书', '值班律师', '知悉法律后果'],
    },
    {
      label: '量刑建议依据',
      keywords: ['量刑建议', '法定依据', '法定刑', '建议判处', '建议量刑', '从重处罚', '从轻处罚'],
    },
    {
      label: '犯罪构成要件',
      keywords: ['犯罪构成', '主体要件', '主观要件', '客体要件', '客观要件', '主观故意', '直接故意', '间接故意', '犯罪故意'],
    },
    {
      label: '危害结果与因果关系',
      keywords: ['危害结果', '危害公共安全', '因果关系', '致人死亡', '造成重伤', '造成损失'],
    },
    {
      label: '从重情节',
      keywords: ['情节严重', '情节恶劣', '后果严重', '数罪并罚', '累犯', '前科', '主观恶性深', '主观恶性大'],
    },
    {
      label: '非法占有目的',
      keywords: ['非法占有目的', '以非法占有为目的', '非法占有'],
    },
  ],
  judge: [
    {
      label: '程序合法性',
      keywords: ['程序合法', '程序违法', '违反法定程序', '合法传唤', '依法告知', '诉讼权利告知'],
    },
    {
      label: '争议焦点',
      keywords: ['争议焦点', '争议事实', '主要争议', '核心争议', '双方争议'],
    },
    {
      label: '庭审驾驭',
      keywords: ['庭审驾驭', '法庭指挥', '诉讼权利保障', '引导举证', '归纳争议', '引导辩论'],
    },
    {
      label: '证据合法性审查',
      keywords: ['非法证据', '非法证据排除', '证据合法性', '证据能力', '不得作为定案依据'],
    },
    {
      label: '管辖与回避',
      keywords: ['管辖权', '管辖', '回避', '回避申请', '法定代理人', '合适成年人'],
    },
    {
      label: '审判组织',
      keywords: ['合议庭', '审判组织', '独任审判', '审判委员会', '人民陪审员'],
    },
    {
      label: '举证质证与证明标准',
      keywords: ['举证质证', '举证责任', '证明标准', '事实清楚', '证据确实充分'],
    },
  ],
};

// ===== Sentence Extraction =====

/** Sentence boundary characters in Chinese legal text */
const SENTENCE_BOUNDARIES = /([。！？；\n])/;

/**
 * Extract the full sentence containing a given keyword from text.
 * Searches for the keyword, then expands to the nearest sentence boundaries.
 * Returns the trimmed sentence including the boundary punctuation.
 */
export function extractSentence(fullText: string, keyword: string): string | null {
  const idx = fullText.indexOf(keyword);
  if (idx === -1) return null;

  // Find sentence start: search backward from keyword position for a boundary
  let start = 0;
  for (let i = idx - 1; i >= 0; i--) {
    if (SENTENCE_BOUNDARIES.test(fullText[i])) {
      start = i + 1;
      break;
    }
  }

  // Find sentence end: search forward from keyword position for a boundary
  let end = fullText.length;
  for (let i = idx + keyword.length; i < fullText.length; i++) {
    if (SENTENCE_BOUNDARIES.test(fullText[i])) {
      end = i + 1; // Include the boundary punctuation
      break;
    }
  }

  const sentence = fullText.slice(start, end).trim();
  // Reject if the sentence is too short (just the keyword) or too long (> 300 chars)
  if (sentence.length < keyword.length + 2) return null;
  if (sentence.length > 300) {
    // Truncate at a reasonable boundary but still try to include context
    const kwStartInSentence = idx - start;
    const contextStart = Math.max(0, kwStartInSentence - 50);
    const contextEnd = Math.min(sentence.length, kwStartInSentence + keyword.length + 150);
    return sentence.slice(contextStart, contextEnd).trim();
  }
  return sentence;
}

/**
 * Extract all unique sentences containing any of the given keywords.
 * Each keyword may match multiple occurrences in the text.
 */
export function extractSentencesForKeywords(fullText: string, keywords: string[]): string[] {
  const sentences = new Set<string>();
  for (const kw of keywords) {
    // Find all occurrences of the keyword
    let searchFrom = 0;
    let safety = 0;
    while (safety++ < 50) {
      const idx = fullText.indexOf(kw, searchFrom);
      if (idx === -1) break;
      const sentence = extractSentenceAt(fullText, kw, idx);
      if (sentence && sentence.length >= 4) {
        sentences.add(sentence);
      }
      searchFrom = idx + kw.length;
    }
  }
  return Array.from(sentences);
}

/** Extract sentence at a specific keyword occurrence position */
function extractSentenceAt(fullText: string, keyword: string, kwIdx: number): string | null {
  // Find sentence start
  let start = 0;
  for (let i = kwIdx - 1; i >= 0; i--) {
    if (SENTENCE_BOUNDARIES.test(fullText[i])) {
      start = i + 1;
      break;
    }
  }

  // Find sentence end
  let end = fullText.length;
  for (let i = kwIdx + keyword.length; i < fullText.length; i++) {
    if (SENTENCE_BOUNDARIES.test(fullText[i])) {
      end = i + 1;
      break;
    }
  }

  const sentence = fullText.slice(start, end).trim();
  if (sentence.length < 4) return null;
  if (sentence.length > 300) {
    const kwStartInSentence = kwIdx - start;
    const contextStart = Math.max(0, kwStartInSentence - 50);
    const contextEnd = Math.min(sentence.length, kwStartInSentence + keyword.length + 150);
    return sentence.slice(contextStart, contextEnd).trim();
  }
  return sentence;
}

// ===== Utility Functions =====

export function parseHighlights(jsonStr: string | undefined): CaseHighlights {
  if (!jsonStr) return {};
  try {
    const parsed = JSON.parse(jsonStr);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function getRoleHighlights(highlights: CaseHighlights, role: string): Record<string, HighlightEntry[]> {
  return highlights[role] || {};
}

export function getFieldHighlights(highlights: CaseHighlights, role: string, field: string): HighlightEntry[] {
  return highlights[role]?.[field] || [];
}

/**
 * Get all highlight items for a given field, aggregated across multiple roles.
 * Returns items with role info so the renderer can apply role-based colors.
 */
export function getHighlightsForRoles(
  config: CaseHighlights,
  roles: string[],
  field: string,
): HighlightItem[] {
  const items: HighlightItem[] = [];
  for (const role of roles) {
    const entries = config[role]?.[field];
    if (entries) {
      for (const entry of entries) {
        if (entry.text) {
          items.push({ text: entry.text, role });
        }
      }
    }
  }
  return items;
}

/**
 * Toggle a highlight entry for a role+field.
 * Color is now role-based, so the `color` field stores the role name.
 */
export function toggleHighlight(
  highlights: CaseHighlights,
  role: string,
  field: string,
  text: string,
  color?: string,
): CaseHighlights {
  const next = { ...highlights };
  if (!next[role]) next[role] = {};
  if (!next[role][field]) next[role][field] = [];
  const existing = next[role][field];
  const idx = existing.findIndex((h) => h.text === text);
  if (idx >= 0) {
    next[role][field] = existing.filter((h) => h.text !== text);
  } else {
    next[role][field] = [...existing, { text, color: color || role }];
  }
  return next;
}

export function removeHighlight(
  highlights: CaseHighlights,
  role: string,
  field: string,
  text: string,
): CaseHighlights {
  const next = { ...highlights };
  if (!next[role]?.[field]) return next;
  next[role] = { ...next[role] };
  next[role][field] = next[role][field].filter((h) => h.text !== text);
  return next;
}

/** Flatten JSON-array text fields (plead/record/evidence) into a plain string for searching */
function flattenField(data: string | undefined): string {
  if (!data) return '';
  try {
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed)) {
      return parsed.map((item: { book?: string; title?: string }) => `${item.title || ''} ${item.book || ''}`).join('\n');
    }
  } catch {
    // Not JSON, use as-is
  }
  return data;
}

/**
 * Auto-generate highlights for a case by scanning text fields for preset keywords,
 * then extracting the full sentence containing each match.
 * Returns a CaseHighlights object with sentence-level entries.
 */
export function autoGenerateHighlights(
  caseData: { plead?: string; record?: string; evidence?: string },
): CaseHighlights {
  const result: CaseHighlights = {};
  const fields: Array<{ key: string; data: string | undefined }> = [
    { key: 'plead', data: caseData.plead },
    { key: 'record', data: caseData.record },
    { key: 'evidence', data: caseData.evidence },
  ];

  for (const { key, data } of fields) {
    if (!data) continue;
    const fullText = flattenField(data);
    if (!fullText) continue;

    for (const role of HIGHLIGHT_ROLES) {
      const categories = HIGHLIGHT_PRESETS[role] || [];
      const allKeywords = categories.flatMap(c => c.keywords);
      const sentences = extractSentencesForKeywords(fullText, allKeywords);

      if (sentences.length > 0) {
        if (!result[role]) result[role] = {};
        result[role][key] = sentences.map(s => ({ text: s, color: role }));
      }
    }
  }

  return result;
}

/**
 * Extract sentences from a field for a specific role based on that role's preset keywords.
 * Used by the teacher edit panel when clicking a preset category.
 */
export function extractPresetSentences(
  fullText: string,
  role: string,
): { category: string; sentences: string[] }[] {
  const categories = HIGHLIGHT_PRESETS[role] || [];
  return categories.map(cat => ({
    category: cat.label,
    sentences: extractSentencesForKeywords(fullText, cat.keywords),
  }));
}
