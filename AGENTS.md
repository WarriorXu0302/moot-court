# 项目上下文 — 模拟法庭教学系统

### 版本技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4
- **State**: Zustand
- **AI**: 豆包2.0 pro (doubao-seed-2-0-pro-260215)，流式SSE输出
- **TTS**: coze-coding-dev-sdk audio TTS
- **ASR**: coze-coding-dev-sdk ASRClient（整段文件识别，非流式）
- **Workflow**: Coze平台工作流（异步执行+轮询）
- **Database**: Supabase (PostgreSQL + Drizzle ORM)

## 目录结构

```
├── public/                 # 静态资源
├── scripts/                # 构建与启动脚本
├── src/
│   ├── app/                # 页面路由与布局
│   │   ├── page.tsx                    # 登录页（学生登录/注册/教师入口/游客）
│   │   ├── teacher/
│   │   │   ├── page.tsx                # 教师端主页（学情区+案例设计区同页）
│   │   │   ├── case-detail/page.tsx    # 案例详情查看页（三栏可编辑+发布，评分标准跳转按钮）
│   │   │   ├── scoring/page.tsx        # 评分标准大页面（响应式编辑器+保存+AI重新生成）
│   │   │   └── learning-detail/page.tsx # 训练学情查看页（三栏+AI分析）
│   │   ├── student/
│   │   │   ├── select/page.tsx         # 案例选择页
│   │   │   ├── case-detail/page.tsx    # 案例详情查看页（9个问题+AI助手）
│   │   │   ├── defense-writing/page.tsx # 辩护词撰写页（对话/编辑/评价）
│   │   │   ├── indictment-writing/page.tsx # 刑事起诉书撰写页（公诉人专属）
│   │   │   ├── prosecution-writing/page.tsx # 公诉意见书撰写页（公诉人专属）
│   │   │   ├── court-investigation/    # 法庭调查页（辩护人专属）
│   │   │   ├── court-debate/           # 法庭辩论页（辩护人专属）
│   │   │   ├── prosecutor-investigation/ # 法庭调查页（公诉人专属）
│   │   │   ├── prosecutor-debate/      # 法庭辩论页（公诉人专属）
│   │   │   ├── indictment-review/      # 起诉审查页（审判长专属，4列10问题）
│   │   │   ├── trial-outline-writing/  # 庭审提纲撰写页（审判长专属，4列编辑器）
│   │   │   ├── judge-opening/          # 开庭页（审判长专属，庭前输入+书记员流程+开庭多阶段）
│   │   │   ├── judge-investigation/    # 法庭调查页（审判长专属，13阶段主持）
│   │   │   ├── judge-debate/           # 法庭辩论页（审判长专属，8阶段主持）
│   │   │   ├── judge-final-statement/  # 被告人最后陈述+判决书生成（审判长专属）
│   │   │   ├── judge-deliberation/     # 评议讨论页（审判长专属，合议庭讨论+判决书输入）
│   │   │   ├── judge-verdict/          # 宣判与闭庭页（审判长专属）
│   │   │   └── final-statement/        # 最后陈述/宣判/闭庭页（辩护人/公诉人共享）
│   │   ├── law-search/page.tsx        # 法条检索整页（2026-08-15改版：任何情况不用弹窗，入口按钮 router.push 跳转本页；useLawSearch hook 发起工作流+轮询；结果=左法条卡片列表+右两层折叠目录，点法条跳详情视图，法条正文与解释展开区均直出渲染数据库优化好的原文；全宽版式无max-w、正文text-lg、页面无字号缩放控件；两层滚动=外层h-screen框架固定不滚+双栏结果区各自overflow-y-auto独立滚动，内容再多不拉长整页，窄屏单栏时结果区整块内滚）
│   │   ├── api/
│   │   │   ├── llm/stream/route.ts     # LLM流式输出API
│   │   │   ├── tts/route.ts            # 语音合成API
│   │   │   ├── asr/route.ts            # 语音识别API（整段文件识别）
│   │   │   ├── summary/route.ts        # 学习过程总结API
│   │   │   ├── workflow/run/route.ts   # Coze工作流执行API
│   │   │   ├── workflow/history/route.ts # 工作流历史查询API
│   │   │   ├── cases/route.ts          # 案例CRUD API
│   │   │   ├── cases/check-pending/route.ts # 工作流断点恢复API
│   │   │   ├── students/route.ts       # 学生注册/登录/信息修改 API
│   │   │   ├── learning-records/route.ts # 学习记录CRUD API
│   │   │   └── learning-sessions/route.ts # 学习场次API（每次学习一条：时长/进度/得分/评价/records环节快照/documents文书/lifecycle行为）
│   ├── components/
│   │   ├── ui/             # Shadcn UI 组件库
│   │   ├── title-bar.tsx   # 通用标题栏（角色/卷宗/法条检索/背景/字体/字号/跳过/继续/文书/学习记录/结束分析/首页）
│   │   ├── law-search.tsx  # 法条检索组件库（2026-08-15直出化）：LawSearchButton（router.push('/law-search')，TitleBar与学生/教师各页头部挂载，首页除外）+ useLawSearch hook（工作流7674184725792489498：input→law[]+explain[{point,content}]，异步+轮询）+ LawResultColumns（左法条紧凑卡列表无№序号→点击跳LawDetailView；右解释两层折叠目录：一级〔N〕Folder分组+二级分类FileText节点默认收起）+ LawContentView（**直出渲染，零LLM请求**：2026-08-15起撤销AI流式重排——数据库原文已人工优化好；本地符号解析fallback立即渲染+ReactMarkdown渲染含Markdown标记的原文，样式走.law-ai-md；无缓存无流式无状态，打开即完整显示）
│   │   ├── law-format.ts    # 法条检索符号解析库：parseLawItem（条款号+罪名+正文）/parseExplainEntry（〔N〕序号+【分类】白名单切分）/splitLegalBlocks（一、（二）1.★标记→h1/h2/star/text结构块）/splitLawBody（法条按句分款）/previewText
│   │   ├── theme-provider.tsx # 主题Provider（data-theme/data-font/data-fontsize应用到DOM；layout.tsx 另有THEME_INIT_SCRIPT预绘脚本：同步读localStorage在首帧前设置html属性，杜绝主题闪烁FOUC；next.config.ts已关闭devIndicators）
│   │   ├── flow-page.tsx       # 流程全屏页面（流式输出+markdown渲染+背景图）
│   │   ├── flow-modal.tsx       # 流程旁白弹窗（流式输出+markdown渲染+背景图）
│   │   ├── ai-chat-panel.tsx    # AI对话面板（流式输出+TTS+缓存+固定滚动）
│   │   ├── case-file-viewer.tsx # 卷宗查看器（一级/二级菜单）
│   │   ├── court-character-image.tsx # 法庭角色立绘（发言气泡+闪亮动效）
│   │   ├── continue-modal.tsx   # 继续按钮弹窗（学习过程+概括+评价+建议）
│   │   ├── sample-viewer-dialog.tsx # 学生端AI样例查看弹窗（解锁条件+得分差距提示）
│   │   └── stage-standards-viewer.tsx # 学生端本环节评分标准查看器（Popover，按stageKey匹配环节）
│   │   └── task-hint.tsx     # 右下角流程提示悬浮框（全局挂载，指针事件自由拖拽+20s自动关闭；拖拽期间直接写style零重渲染，松手才提交state——流式页面拖拽不卡顿）
│   ├── hooks/
│   │   ├── use-ai-stream.ts  # 流式输出Hook
│   │   └── use-press-talk.ts # 长按说话统一Hook（指针/触摸适配+双信号防竞态，10个语音页面共用）
│   ├── lib/
│   │   ├── types.ts         # 全局类型定义
│   │   ├── store.ts         # Zustand全局状态管理
│   │   ├── utils.ts         # 通用工具函数 (cn)
│   │   ├── audio.ts         # TTS语音播放与音色映射（全局单例音频）
│   │   ├── audio-wav.ts     # 录音转16kHz WAV（AudioContext解码+重采样，ASR只收WAV）
│   │   ├── knowledge.ts     # 法庭知识常量（开庭/调查/辩论/评议/宣判步骤+注意事项）
│   │   ├── scoring.ts       # 评分标准系统设置（总标准+13环节标准+AI样例解锁）
│   │   ├── lifecycle-utils.ts # LIFECYCLE标签解析/流式过滤（字符串感知括号计数）
│   │   └── end-training.ts  # 结束训练函数（保存学习记录+跳转）
│   ├── storage/database/
│   │   ├── supabase-client.ts   # Supabase客户端
│   │   └── shared/schema.ts     # Drizzle ORM Schema
│   └── server.ts           # 自定义服务端入口
├── next.config.ts
├── package.json
└── tsconfig.json
```

- 项目文件（如 app 目录、pages 目录、components 等）默认初始化到 `src/` 目录下。

## 包管理规范

**仅允许使用 pnpm** 作为包管理器，**严禁使用 npm 或 yarn**。
**常用命令**：
- 安装依赖：`pnpm add <package>`
- 安装开发依赖：`pnpm add -D <package>`
- 安装所有依赖：`pnpm install`
- 移除依赖：`pnpm remove <package>`

## 开发规范

### 编码规范

- 默认按 TypeScript `strict` 心智写代码；优先复用当前作用域已声明的变量、函数、类型和导入，禁止引用未声明标识符或拼错变量名。
- 禁止隐式 `any` 和 `as any`；函数参数、返回值、解构项、事件对象、`catch` 错误在使用前应有明确类型或先完成类型收窄，并清理未使用的变量和导入。
- **useSearchParams 必须包在 `<Suspense>` 边界内**（页面组件拆内层组件 + Suspense 包裹导出），否则生产构建预渲染报 `missing-suspense-with-csr-bailout` 直接中断部署（2026-08-16 /law-search 与 /teacher/scoring 踩坑）。
- **禁止给 useStageDialogueLogger 传内联字面量数组**（如 `useStageDialogueLogger('最后陈述', [])`）：hook 的 useEffect 依赖 messages，内联数组每次渲染新引用 → upsertStageDialogue 写 store → 无 selector 的 `useAppStore()` 订阅组件重渲染 → 无限循环「Maximum update depth exceeded」整页白屏（2026-10 final-statement / judge-final-statement 两页白屏事故）。必须传模块级稳定常量；hook 内部已加引用防护（同一数组引用不重复 upsert）。
- **/api/summary 为 SSE 流式**（2026-10 由 invoke 非流式改造）：模型按「【概括】/【评价】/【建议】/【得分】」分隔标记协议输出（不用 JSON，流式无法增量解析）；前端统一走 `src/lib/summary-stream.ts` —— `streamSummary`（fetch+reader 逐 chunk 回调累积全文）+ `parseSummarySections`（增量解析，含段尾半截标记剥离）+ `fetchSummarySections`（组合：流式获取+解析返回结构化）+ 两个格式约定段：`SUMMARY_FORMAT_INSTRUCTION`（结束分析，不限字数）与 `STAGE_SUMMARY_FORMAT_INSTRUCTION`（环节总结精简版：概括≤60字/评价≤100字/建议≤60字）。ContinueModal 传 `streamText` 即启用流式视图（四区块固定渲染、内容框内增长，版面不跳动）。调用方：use-end-analysis.tsx（中途结束分析）+ final-statement/page.tsx（训练完成分析）+ **16 个业务页面的"继续"按钮环节总结**（2026-10 二轮改造：原先 fetch /api/llm/stream 请求虽流式但前端等全部读完解析 JSON 才显示，弹窗一直转圈；现统一改 fetchSummarySections + 标记协议 + 限字数，打开即见文字流入且生成时长大幅缩短；页面结构：state `continueStream` + handleContinue 内 fetchSummarySections(onChunk: setContinueStream) + ContinueModal streamText={continueStream} + finally 清理）。
- **法庭调查/辩论 6 页 AI 发言风格系统**（2026-10 二轮升级，依据真实庭审记录《法庭调查和法庭辩论.docx》逐角色逐环节标定，取代原"120/150-300字+不超50字"两级粗放分级）：`src/lib/court-style.ts` 导出 `INVESTIGATION_SPEECH_STYLE`（调查版）/ `DEBATE_SPEECH_STYLE`（辩论版），6 页（judge-investigation / court-investigation / prosecutor-investigation / judge-debate / court-debate / prosecutor-debate）systemPrompt 统一在末尾注入。核心档位（法律文书宣读不受限）：审判长程序短语5-25字/连续短问≤60字/归纳焦点50-150字/纠偏一句≤60字（顺势定焦点≤150字）；公诉人讯问一问一答5-20字/举证80-250字/质证回应单异议点50-120字、多异议点≤220字硬上限/辩论150-250字分点+"公诉人发表完毕"；辩护人发问5-25字/质证80-200字三性框架/辩论150-300字分点+"发表完毕"；被告人证人具体事实直答2-30字/陈述经过40-120字松散口语禁法律术语；全程禁英文混杂、禁括号描述动作。e2e 双案由 15 场景三连测 20/21 达标（被告人长陈述偶超 ~25% 属 temperature 0.7 正常方差，勿再硬压防陈述碎裂）。新增庭审页必须注入对应 SPEECH_STYLE，不要再写一刀切字数上限。

### next.config 配置规范

- 配置的路径不要写死绝对路径，必须使用 path.resolve(__dirname, ...)、import.meta.dirname 或 process.cwd() 动态拼接。

### 滚动结构兼容性（2026-09-21）

- **禁止「外层禁滚动 + 内层无滚动区」组合**：页面主容器若在 `lg` 等断点用 `overflow-hidden` 锁死，则其内部每个内容栏必须自带 `overflow-y-auto`（双层滚动设计，如法条检索页、教师端三栏页）；任何一栏只有自然高度内容而无滚动容器时，必须保留页面级滚动（`overflow-y-auto` 全断点），否则桌面端（尤其 macOS 全屏）内容超高即被裁切且无法滚动（学生端案例选择页 2026-09-21 事故：右栏案例详情长文被裁）。
- 判断标准：锁页面滚动 = 承诺「所有内容都有归属的滚动区」；做不到就放开页面滚动，Windows 内容不超高时不出现滚动条，行为无损。

### Hydration 问题防范

1. 严禁在 JSX 渲染逻辑中直接使用 typeof window、Date.now()、Math.random() 等动态数据。**必须使用 'use client' 并配合 useEffect + useState 确保动态内容仅在客户端挂载后渲染**；同时严禁非法 HTML 嵌套（如 <p> 嵌套 <div>）。
2. **SSR 直出的 SVG 几何坐标（Math.sin/cos 等三角函数计算值）必须归一精度**（如 `Number(v.toFixed(4))`）：ECMAScript 不强制三角函数结果 bit-for-bit 一致，服务端与浏览器实现的浮点尾数可不同，导致 hydration mismatch（2026-10-08 login-screen.tsx 印章刻度环 60 根 line 坐标报警事故）。
3. **禁止使用 head 标签**，优先使用 metadata，详见文档：https://nextjs.org/docs/app/api-reference/functions/generate-metadata
   1. 三方 CSS、字体等资源可在 `globals.css` 中顶部通过 `@import` 引入或使用 next/font
   2. preload, preconnect, dns-prefetch 通过 ReactDOM 的 preload、preconnect、dns-prefetch 方法引入
   3. json-ld 可阅读 https://nextjs.org/docs/app/guides/json-ld

## UI 设计与组件规范 (UI & Styling Standards)

- 模板默认预装核心组件库 `shadcn/ui`，位于`src/components/ui/`目录下
- Next.js 项目**必须默认**采用 shadcn/ui 组件、风格和规范，**除非用户指定用其他的组件和规范。**

## 模拟法庭系统架构

### 核心数据流
1. 教师端设计案例 → 触发工作流7656623831193223210（异步，~10分钟）
2. 教师端发布案例 → 触发工作流7656793461539356723（异步，~4分钟）生成法律文书
3. 学生端同步14个字段 → 辩护人路线：案例详情→辩护词撰写→法庭调查→法庭辩论→最后陈述→宣判→闭庭
4. 学生端同步14个字段 → 公诉人路线：案例详情→刑事起诉书撰写→公诉意见书撰写→法庭调查→法庭辩论→最后陈述→宣判→闭庭
5. 学生端同步14个字段 → 审判长路线：案例详情→起诉审查→庭审提纲撰写→开庭→法庭调查→法庭辩论→被告人最后陈述→评议讨论→宣判与闭庭
6. 最后陈述页触发工作流7657514573812550生成判决书（辩护人/公诉人路线）
7. 审判长最后陈述页触发工作流7657514573813612550生成判决书（审判长路线）
8. 法条检索弹窗触发工作流7674184725792489498（input关键词 → law法条[] + explain解释/案例[{point,content}]），异步轮询，TitleBar与各页头部可用，首页除外

### API 规范
- **LLM流式**: POST `/api/llm/stream` - SSE格式 `data: {"content":"..."}`，支持caching参数
- **TTS**: POST `/api/tts` - 返回 `{audioUri, audioSize}`
- **ASR**: POST `/api/asr` - body `{uid, base64Data}` → 返回 `{text, duration}`
- **总结**: POST `/api/summary` - 返回 `{summary, evaluation, suggestion}`
- **工作流**: POST `/api/workflow/run` (isAsync=true) → GET `/api/workflow/history?executeId=xxx`
- **学生**: POST `/api/students`（仅 `guest` 游客建号；GET 与 update_profile 已移除，原先无需登录即可读全表含密码列）
- **认证**: POST `/api/auth/register` 学号注册 · POST `/api/auth/login` 学号登录 · POST `/api/auth/teacher/login` 教师密码登录 · GET `/api/auth/me` 当前用户 · POST `/api/auth/logout` 退出
- **案例**: GET/POST `/api/cases` (action: save/publish/offline/delete/update_documents) · POST/GET `/api/cases/check-pending` (恢复中断的工作流：检查 generating 状态案例 + 法律文书待生成案例)

### 评分标准系统
- 数据存储：`cases.judge` 列（jsonb 文本），结构 `{overall:{dimensions,grading}, stages:[...13环节], sampleUnlock:{scoreThreshold,evalCountThreshold}}`，解析用 `parseScoringStandards`（src/lib/scoring.ts）
- 生成链路：`buildScoringGenerationPrompt`（框架prompt，源自系统提示词+知识库考核要点）→ LLM 流式生成 → `parseScoringStandards` 校验落库；种子文件 `scripts/scoring-seed.json` 由 `scripts/generate-scoring-seed.ts` 离线生成
- 存量补加：`scripts/migrate-scoring.mjs`（幂等，已挂在 `scripts/start.sh`，judge 为空的案例按种子补加；生产环境同时删除过时案例「车超、李勇等强奸、故意杀人、伪证案」）

### 司法解释（law）质量保障
- 背景：案例 law 字段由工作流 LLM 异步生成，长输出存在"后半段疲劳"问题（曾出现生产案例 16 条全只有标题、或前 4 条有正文后 9 条只有标题，2026-09 已人工补全生产数据）
- 机制：`src/lib/law-quality.ts` —— `analyzeLawCompleteness`（解析 JSON 数组，无「：」或「：」后正文 <10 字判定缺正文）+ `ensureLawComplete`（缺正文条目并行调 LLM 按条目类型补全：法条→真实原文/规范文件→核心内容概要/指导案例→案情与要旨；清洗"原标题："字面前缀；任何失败 fallback 原文，绝不阻塞保存）
- 接入点：`/api/cases` 三个 law 落库处全部经过 ensureLawComplete —— POST action=save（工作流保存）、PATCH（含断点恢复/教师手工编辑）、POST action=publish（发布）
- 教师端：案例详情页「评分标准」按钮跳转独立大页面 `/teacher/scoring?caseId=xxx`（teacher/scoring/page.tsx，响应式左右分栏+整页滚动，支持编辑 dimensions/grading/stages/sampleUnlock、保存（POST /api/cases action=update_scoring）、AI按本案件资料重新生成；角色Tab按 common/defender/prosecutor/judge 过滤，Badge 用 ROLE_LABEL 中文化）
- 学生端：4个写作页评价提示词注入本环节标准（stageStandardsToPrompt）；评价计数持久化 localStorage（key: `court-eval-progress`），达到「单次≥80分 或 累计3次」解锁「AI样例」按钮（SampleViewerDialog 显示教师端生成/随流程推进的法律文书样例）
- 评分标准学生端可见入口：5个写作/评议页评价栏头部「本环节评分标准」Popover（stage-standards-viewer，stageKey 对应种子 stages[].key）+ 学生案例详情页卷宗「评分标准」分区 + 学生案例选择页「训练价值」下方只读分区（总维度+评级+13环节要点，max-h滚动）；生产/开发环境经 migrate-scoring.mjs（挂 start.sh）幂等补加后随部署自动同步
- **学习记录**: GET/POST `/api/learning-records`
- **学习场次（2026-09-17）**: 一次学习 = 选择案例进入训练（`store.trainingStartTime`，persist 跨刷新保留）→ 结束分析保存。`end-training.ts` 算时长、分析报告 summary 加【本次学习时长：X】前缀（防重复）、POST `/api/learning-sessions`（含 records 环节快照/documents 文书/lifecycle 行为轨迹/score）后清零。结束分析弹窗与 final-statement 页同步显示时长前缀。表 `learning_sessions`（student_id 外键→students，started/ended_at timestamptz，duration_seconds 服务端兜底重算，records/documents/lifecycle jsonb）；GET 列表不带大字段，`?id=&detail=1` 带全量详情，`?studentId=` 过滤
- **教师端主页布局（2026-09-17改版）**：两列网格 `lg:grid-cols-2 lg:grid-rows-[repeat(3,minmax(0,1fr))]`，五个 Card 用 `lg:col-start/row-start` 定位（DOM 顺序不变）：左列=案例设计（上，1行）+案例列表（下，row-span-2），右列=训练学情/学习场次统计/学生总览统计（各1行）；案例列表与学情表等宽；移动端单列按 DOM 序堆叠
- **教师端主页紧凑化（2026-09-17二改）**：五卡 Header 单行化（标题+描述 flex 同行 truncate，场次/总览卡右侧挂「查看详情」按钮开全量列表弹窗）；Card `gap-1 py-1.5`、Header `px-4 pb-0`、Content `px-4`、表格 th/td `py-0.5`、行内按钮 `h-6 text-xs`——保证右列三表在 1080p 特大字号档各展示≥5行；**教训：原生 table 的 auto 布局下长文本 td 会换行撑高行，必须内嵌 `<div className="max-w-[Npx] truncate">`（td 上加 max-w 无效）；学情表案例名 td 即此处理**
- **教师端宏观统计（teacher/page.tsx）**：「学习场次统计」（学生/案例/角色/时长/得分/结束时间/查看→SessionDetailDialog 展示当次环节快照+对话+文书）+「学生总览统计」（按 studentId 聚合总次数/总时长/最近学习）。**教训：弹窗/卡片内禁止用原生 `<details>/<summary>` 折叠元素（沙箱 Chromium 渲染即页面崩溃 Target crashed），一律用自定义 div+滚动区；Radix Dialog 内容中所有 state 引用必须空值保护（sessionDetail?.x），否则首渲染 client-side exception 白屏；**Radix DialogContent 默认带 `sm:max-w-lg`，覆盖宽度必须同时写 `sm:max-w-*` 变体（如 `max-w-[92vw] sm:max-w-[92vw]`），否则 ≥sm 断点宽度仍被压回 32rem**；教师端两个全量统计弹窗=92vw/85vw×85vh 大弹窗**
- **TTS门控（2026-08-15）**：AI 回复配音仅在语音模式下生成——10个对话页（judge×5、prosecutor/court×4、sentencing-negotiation）在 enqueueTts 前统一检查 `voiceModeRef.current`（useRef 镜像 voiceMode，防流式回调闭包过期）；文字模式静默输出、无「按住说话」按钮；ai-chat-panel 的手动朗读不受此门控限制
- **TTS分句流水线+预取管线（2026-10，修"文字流完干等配音"卡顿）**：三级优化叠加。①分句：audio.ts `createTtsSentenceFeeder(speaker, uid)`（push(fullText) 流式中按句末标点 。！？；!?;\n 切完整句即时 enqueueTts，safeLimit 截断 LIFECYCLE 标签及半截标签前缀不入队，flush 尾句且幂等）；10 庭审页统一接入——流式 try 内 fetch 前创建 feeder（voiceModeRef.current 门控）、循环内 setStreamingText 后 push、结束处 flush 替代整段 enqueueTts。②阶段推进：19 处 `waitForTtsQueue()`（等全排空）→ `waitForTtsQueueDrain(8)`（仅积压＞8 句≈30s 语音时限速；曾用阈值 2，实测语音模式下自动链每阶段都要等积压降到 2 句=20-40s 空白，用户感知"上一个人说完到下一个思考中隔很久"——8 是"正常节奏恒零等待、仅防极端视听脱节"的软限流）；waitForTtsQueue 保留导出但页面已无调用。③**预取管线（关键）**：TTS 队列合成与播放解耦——enqueueTts 立即按并发窗口（MAX_CONCURRENT_SYNTH=3，从队首扫描保证前序句优先 ready）发起 /api/tts 合成，播放循环 schedulePlayback 严格按序消费 ready 任务（error 任务跳过不阻塞，interruptTts abort 在途合成+全部 resolve）；消除旧串行"合成1.5s+播放3s×N句"的壁钟累加，播第 N 句时第 N+1~N+3 句已并行合成完毕。任务状态机 pending→synthesizing→ready/error，播放完才 shift。e2e 实测：首个 /api/tts 请求距流式起点 <1s、单次发言 7 个分句 TTS 请求、3 阶段连续推进无回归
- **庭审页 e2e 注意**：persist partialize 不含 selectedCase（内存态），localStorage 注入刷新不恢复，e2e 必须走真实路径 SPA 导航（select→角色→案例→进入训练）；dev 模式页面首次访问需编译，"跳过"链跳转 wait_for_url 需 40-60s 超时；court-investigation 页 FlowPage「全部跳过」直接触发 runAIStage(0) 自动发言（无需用户输入），是验证 TTS/流式的最短路径；**/tmp 会被系统定期清理，e2e 脚本放 /var/tmp**
- **AI发问阶段必须配 responder（2026-10-15，修"证人不说话卡住"）**：三个调查页 STAGES 中所有"AI角色向另一角色发问"的 ai 阶段必须带 `responder` 字段（共9处：court-investigation 审判长补充询问→被告人/公诉人询问证人→证人；prosecutor-investigation 辩护人询问被告人/被害人/交叉·直接询问证人4处；judge-investigation 公诉人·辩护人讯问被告人/询问被害人/询问证人4处）。**根因**：发言风格系统（court-style.ts）严格"只扮演一个角色"后，AI发问方只问不答，被问角色无发言阶段永远沉默；runAIStage 在 speaker 发言后检测 stage.responder，有则以 `AI_RESPOND:{提问者}` 前缀调 streamAIResponse 让被问者回答（各页 streamAIResponse 的 isAutoRespond 分支文案：只回答刚才的提问、不代替提问者发言、不自行继续提问）。**新增发问类阶段时必须同步配置 responder**。
- **userInteractedRef 假死（2026-10-15）**：8 页（3调查+3辩论+judge-opening+judge-verdict）handleSendMessage 设 `userInteractedRef.current=true` 打断自动链后，responder 回答完成、推进下一阶段前**必须复位为 false**——否则下一个 ai 阶段发言完会被 runAIStage 的 userInteractedRef 检查误判为"用户打断"而 return，阶段不再推进，界面停在"自动推进中"假死（用户刚发过一次言后必经此坑）。
- **TTS 挂起兜底（2026-10-15）**：fetchTtsUri 加 20s 合成超时（Promise.race，防 /api/tts 挂起致任务永停 synthesizing、并发窗口占满）；waitForTtsQueueDrain 加 90s 兜底（超时 interruptTts 清场放行，防音频元素 onended/onerror 均不触发的浏览器边缘情况致阶段推进永久阻塞）。
- **流式速度双瓶颈（2026-10，"文本模式一直卡"根因）**：①**/api/llm/stream 曾每 chunk 人为 `await setTimeout(30ms)`"打字机减速"**——豆包 chunk 粒度 1-3 字，300 字回复被拖慢 4.5s、3000 字长文拖慢 45s+（实测 stage0 宣读起诉书 100-150s）；已删除，豆包原生生成速度即最佳打字机节奏（实测同阶段 14.4s、0.1s 首字），**严禁再在 SSE 路由加人为 sleep**。②前端每 chunk setStreamingText → 整组件重渲染+ReactMarkdown 全量重解析（O(n²)）：`src/lib/streaming-throttle.ts` 的 `createThrottledStreamSetter(setter, 50ms)` 把 setState 节流到 20fps——10 庭审页 + flow-page/flow-modal/ai-chat-panel 流式循环统一 `streamThrottle.push(fullText)`（循环内勿再直接 setStreamingText）；ttsFeeder.push 不参与节流（入队无渲染成本）。
- **文本/语音双模式回复设置（2026-10）**：两模式彻底分离。①回复格式：`src/lib/response-style.ts` 导出 `replyFormatInstruction(voiceMode)`——文本模式 REPLY_FORMAT_TEXT（markdown 结构化：**加粗**/有序列表，阅读优化）；语音模式 REPLY_FORMAT_VOICE（口语短句、禁任何 markdown 符号防被 TTS 读出，播报优化）；10 庭审页发言流式统一 `content: systemPrompt + replyFormatInstruction(voiceModeRef.current)`（ref 实时读，切模式下轮即生效；评价/文书再生成等其他 LLM 调用不拼）。②TTS 参与：文本模式零 TTS——feeder 门控（voiceModeRef.current 才创建）+ 19 处阶段推进等待改 `if (voiceModeRef.current) await waitForTtsQueueDrain(2)`（文本模式连等待都跳过）；语音模式才走分句流水线+预取管线。模式切换按钮 onClick 带 interruptTts 防跨模式残留播放。e2e 实测：文本模式 stream 正常且零 /api/tts 请求、回复含 <strong>/<ol> 结构；语音模式按住说话+无输入框
- **等待态角色归属（2026-08-15）**：多角色庭审页等待气泡显示「{当前发言角色}正在思考…」（streamingSpeaker 在请求发起前即设置，故等待期正确归属公诉人/辩护人等而非卡在审判长）；10页统一用 `hasVisibleStream`（lifecycle-utils）判断流式文本剥离 LIFECYCLE 标签后是否非空——空则维持思考态，避免空气泡闪现
- **评议页三栏**：judge-deliberation 为 讨论(52%)｜判决书(26%)｜判决书评价(22%) 三栏并行，评价在提交判决书后流式生成于右栏，与左侧讨论互不阻塞
- **评议音色**：陪审员甲=zh_male_taocheng_uranus_bigtts（男声）、陪审员乙=zh_female_vv_uranus_bigtts（女声），审判长维持原音色

### 登录体系（学号 + 密码，2026-11 由超星单点登录改回站内登录）

超星 OAuth 已整体移除（`src/lib/chaoxing-*`、`/api/auth/callback/chaoxing`、`/auth/complete`、`/auth/error`、`src/proxy.ts`、Supabase Auth 会话全部删除，`@supabase/ssr` 依赖已卸）。现为三种入口：学号注册/登录、游客、教师密码。

```text
注册/登录 → 服务端校验 → 签发 HMAC 签名 httpOnly Cookie（court_session）→ 前端 fetchSessionUser 同步 zustand store → 目标页
```

关键约定：

- **会话**：`src/lib/session.ts`。Cookie 只存 `{sid: students.id, role, exp}`，HMAC-SHA256 签名，7 天有效；角色只信签名值，客户端改不了。签名密钥取 `AUTH_SECRET`，未配置时由 `COZE_SUPABASE_SERVICE_ROLE_KEY` 派生（更换该值会让所有人重新登录）。Secure 标志只看运行环境（NODE_ENV/COZE_PROJECT_ENV），**不要改成按请求域名推断**——在 http 环境误打 Secure 会被浏览器丢弃，表现为"登录后一刷新就退出"。
- **密码**：`src/lib/password.ts`，scrypt + 每密码独立随机盐，格式 `scrypt$salt$hash`。`students` 表里有 42 条遗留**明文密码**行（超星上线前的学号注册账号）：`verifyPassword` 兼容明文并在登录成功后自动升级为哈希（`needsUpgrade`），不需要批量迁移。
- **限流**：`src/lib/login-throttle.ts`，进程内存，同「来源+账号」与「账号」两个维度 10 分钟 8 次失败即拒绝；注册、教师登录同样限流。多实例部署只能降低爆破速度，不是强保证。
- **防枚举**：账号不存在与密码错误返回同一句「学号或密码错误」，并对不存在的账号也做一次等价 scrypt 开销。
- **学号规则**：`^[A-Za-z0-9_.-]{3,32}$`；`guest_`、`cx_`、`__` 前缀为保留命名空间（游客行、历史超星行），禁止注册，登录接口对 `is_guest` 行与 `guest_`/`__` 前缀一律拒绝密码登录。历史上的 3 条超星行密码是随机串，天然无法密码登录。
- **教师端**：`/api/auth/teacher/login` 只校验 `TEACHER_PASSWORD`，**无默认值**——未配置返回 503。原先默认 `123` 是因为后面还有超星登录这第二道门，现在它是教师端唯一门槛。教师会话的 `sid` 固定为 `'teacher'`（无 students 行，教师不产生实训记录）。
- **游客**：`POST /api/students` 的 `guest` action 建 `is_guest` 行并**签发 role=student 的会话**（业务 API 现在都要求登录，游客也必须有会话才能训练）。同一出口 IP 10 分钟最多建 200 个游客（教室共用出口，阈值不能太紧）。游客退出同样要吊销会话（title-bar 已统一调用 logoutSession）。
- **鉴权范围（2026-11 已覆盖全部业务 API）**：`src/lib/api-auth.ts` 提供 `requireLogin` / `requireTeacher` / `requireStudent`，所有路由开头调用。权限矩阵：
  - **仅教师**：`/api/cases` 的 POST/PATCH/DELETE（含 save/publish/offline/update_documents/update_scoring/generate_scoring/generate_arbitration）、`/api/cases/check-pending`、`PATCH /api/learning-records`、`DELETE /api/learning-sessions`。
  - **登录即可**：`/api/llm/stream`、`/api/tts`、`/api/asr`、`/api/summary`。
  - **登录即可，但按身份收敛数据**：`GET /api/cases`（学生/游客只能读 `published`，忽略 `status` 参数，按 id 取未发布案例返回 404）；`GET /api/learning-records`、`GET /api/learning-sessions`（学生只能读自己，传别人的 id 返回 403，不传则强制收敛到自己，`?id=` 单条详情额外校验归属）。
  - **写入身份只认会话**：`POST /api/learning-records`、`POST /api/learning-sessions` 忽略请求体里的 `studentId`，一律用会话里的 `sid`；教师（无 students 行）不能写。
  - **工作流白名单**：`src/lib/workflow-access.ts` 登记所有允许的 Coze 工作流 ID 及权限（案例设计/文书生成=教师，判决书/法条检索=登录即可）。`/api/workflow/run|history` 对未登记的 ID 一律 403，history 缺 workflowId 仅教师可用。**新增工作流必须在此登记，否则 403。**
  - 教师页面守卫仍是前端检查 `user.role`，但接口层已兜底，前端被绕过也拿不到数据。
- 业务页的登录守卫读 zustand store，所以登录成功后必须先 `login(user)` 写 store 再跳转；首页对已有会话会用 `fetchSessionUser` 补齐 store。
- **页面登录守卫必须等 `hydrated`（2026-11 修复"刷新业务页被弹回首页"）**：zustand `persist` 从 localStorage 恢复前，hook 读到的 `user` 恒为初始值 `null`，守卫 effect 恰好在这一帧触发就会把已登录用户当成未登录、`router.push('/')`。用调试日志确认过：同一次刷新里 effect 先后读到 `user=有 → 有 → null → 有`，中间那一帧是 null。现统一为：`store.hydrated`（不持久化，恢复完成后置位）+ 守卫写成 `if (!hydrated) return;` 在前，且 **`hydrated` 必须加进该 effect 的依赖数组**，否则恢复完成后守卫不会重跑。26 个页面已改。**新增需要登录的页面必须照此写**，不要再复制 `if (!user) { router.push('/'); return; }` 的旧写法。`hydrated` 的置位写在 `store.ts` 末尾而不是 `onRehydrateStorage` 回调里（localStorage 同步恢复，回调触发时 `useAppStore` 还在暂时性死区，引用会抛错且被吞掉）；存档损坏时 zustand 只走 catch 分支、不触发完成事件，所以用 0ms 定时器兜底，否则守卫永远等不到 ready 会卡死。
- **登录态对账**：`src/components/auth-sync.tsx` 挂在根布局，页面加载时若 store 有 user 就请求 `/api/auth/me`，401 则清本地登录态。用于处理「前端以为已登录、接口全 401」（会话过期、Cookie 被清、改造前的游客没有服务端会话）。网络错误不当作未登录。
- `students.fid` 字段与教师端「单位」列保留（显示历史超星账号的机构名），新账号该字段为空。

### 语音输入规范
- **严禁使用浏览器 Web Speech API**（SpeechRecognition / webkitSpeechRecognition），Chrome 依赖 Google 语音服务，国内不可用。语音识别一律走 `/api/asr`。
- `/api/asr` 只接受 16kHz 单声道 WAV（不支持 webm/opus），录音 blob 必须经 `blobToWav16k`（`src/lib/audio-wav.ts`）转换后 base64 上传。
- 长按说话交互统一用 `src/hooks/use-press-talk.ts`：解构 `{isRecording, asrLoading, pressHandlers}` 展开到按钮（`touch-none select-none`），`onText` 回调收识别文本；内部指针+触摸双适配、getUserMedia pending 期快速松手防竞态。新增语音页面禁止再手写 MediaRecorder 逻辑。
- 交互形态：「按住说话 / 松开发送」， courtroom 各环节页与写作页语音模式共用同一 hook。

### 5种背景主题
清雅白(默认) / 暖阳米 / 森林绿 / 藏蓝韵 / 古韵宣 — 通过 `data-theme` 属性切换CSS变量

### 字体系统
雅黑(默认) / 黑体 / 宋体 — 通过 `data-font` 属性切换
4档字号: 小(14px) / 中(16px) / 大(18px) / 特大(20px) — 通过 `data-fontsize` 属性切换

### 自定义 LLM 与教材案例（2026-11）

- **LLM 接口**：`src/lib/llm-client.ts` 统一封装服务端调用。`.env` 里 `LLM_API_KEY` + `LLM_BASE_URL` + `LLM_MODEL` 三项齐全就走 OpenAI 兼容接口，缺任一项回落平台 SDK（豆包）。五处服务端调用（`/api/llm/stream`、`/api/summary`、案例设计、评分标准生成、法条补全）都经过它。**走自定义接口时一律用 `LLM_MODEL`，忽略前端传来的 model 字段**（前端旧代码会传豆包模型名，原样转发会 403）。`caching` / `previousResponseId` 仅 SDK 回落时生效。模型名必须与 `GET /v1/models` 一致。已用本地假接口验证请求确实打到自定义地址、模型名为 `LLM_MODEL`。
- **平台定位**：面向国际法方向学生。10 个刑事案例已**下线**（`status=offline`，未删除），清单与恢复方法见 `docs/data/criminal-cases-offlined.json`；刑事页面代码保留，只是没有案例可选。
- **教材案例导入**：`scripts/import-book-cases.ts <序号|all> [--dry]`，从《中国国际私法经典案例评析》（解析结果在 `/var/tmp/step0/book/cases.json`，由 `/var/tmp/step0/book/parse.py` 生成，**不在仓库内**）挑 6 个导入：恒基案、轻纺案、Hemofarm 案、天卓案、SPAR 案、BY.O 案。**书里有的用原文**（案情 `case_info` 逐字一致、争议焦点），**书里没有的由 LLM 拟制**（`profile/teach/plead/record/evidence/law/wrong/person`），并在 `meta.reference.aiDrafted` 登记，导入后状态为 `generated`，**必须教师审核后再发布**。幂等（同名跳过）。
- **标准答案隔离**：裁判要旨、法理分析、拓展案例存在 `meta.reference`（`CaseReference`），**学生接口在服务端剪掉**（`rowToCaseData(row, { forStudent })`）。曾发现的坑：最初把裁判要旨直接写进了学生可见的 `law` 字段，等于把答案发给学生；现 `law` 只放规则本身，提示词里明令禁止出现"本案/最高人民法院认为"等裁判过程。新增导入或生成逻辑时，学生可见字段都要做"答案泄露"检查（核对措辞 + 与标准答案连续 18 字重合）。
- **训练进度（2026-11）**：标题栏（`isStudent`）显示「第 N / M 步」，路线表在 `src/lib/training-steps.ts`（按案件类型 × 角色，路径可带 `?phase=`/`?doc=` 查询参数）。**新增或调整学生端环节跳转时必须同步改这张表**，否则该页不显示进度。
- **教师端案例审核（2026-11）**：案例详情页顶部 `CaseReviewPanel` 显示出处、AI 拟制栏目（`meta.reference.aiDrafted`）与标准答案（折叠，仅教师）；发布前有确认弹窗，保存/发布失败会提示。教师主页设计表单默认收起，已下线案例折叠在列表末尾。
- **仲裁庭审阶段表的两条硬规则（2026-11 学生端全流程实测）**：①AI 阶段的 `responder` **不能是用户本人的角色**——否则 AI 会以学生身份代答（实测"仲裁庭向申请人代理人提问"后 AI 替申请人回答了）；需要学生回答 AI 提问时拆成"AI 提问（ai，无 responder）"+"学生回答（interactive）"两个阶段。②AI 阶段发言的 system prompt 会注明当前环节与下一环节（`stageInstruction`），回应学生发言时以陈述收尾、不追问——学生在该环节没有第二次发言机会，追问会悬空。`scripts/check-arbitration-flows.ts` 已加对应检查。
- **同页换阶段要重挂载**：仲裁庭审页调查→辩论只改 `?phase=`，Next 会复用组件实例（消息、环节下标全部沿用，实测显示"环节 15/8"且不自动开始）。已用 `key={phase}` 包一层；其他靠查询参数切换阶段的页面同理。
- **Markdown 渲染统一 `remarkPlugins={[remarkGfm, remarkCjkFriendly]}`**：CommonMark 规则下 `**…，**` 这类紧贴中文标点的加粗不生效、原样显示星号（AI 评价里很常见）。新增 ReactMarkdown 时一并加 `remark-cjk-friendly`。
- **仲裁案例的共享组件**：顶栏角色名 / 文书菜单、悬浮 AI 助手的角色名与案件上下文都按 `selectedCase.caseType` 区分，不要再写死"辩护人 / 公诉人 / 审判长"。

