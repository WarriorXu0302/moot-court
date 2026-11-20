/**
 * 显示偏好（背景 / 字体 / 字号）的唯一定义。
 * 原先 title-bar、教师主页、教师案例详情、教师学情页各抄一份，改一处漏三处。
 */
import type { ThemeName, FontName, FontSize } from './types';

export const THEMES: { value: ThemeName; label: string; swatch: string }[] = [
  { value: 'light-gray', label: '卷宗白', swatch: '#22455A' },
  { value: 'warm', label: '暖米', swatch: '#3B4A55' },
  { value: 'forest', label: '青绿', swatch: '#24503F' },
  { value: 'navy', label: '藏蓝', swatch: '#1F3361' },
  { value: 'rice', label: '宣纸', swatch: '#2E2A24' },
];

export const FONTS: { value: FontName; label: string }[] = [
  { value: 'yahei', label: '苹方 / 雅黑' },
  { value: 'heiti', label: '黑体' },
  { value: 'songti', label: '宋体' },
];

export const FONT_SIZES: { value: FontSize; label: string }[] = [
  { value: 'small', label: '小' },
  { value: 'medium', label: '标准' },
  { value: 'large', label: '大' },
  { value: 'xlarge', label: '特大' },
];
