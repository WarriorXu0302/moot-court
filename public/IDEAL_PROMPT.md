# 模拟法庭教学系统 —— 理想初始提示词（一次性建成定稿状态）

> 本文档由已交付项目的**定稿状态**倒推生成：将初稿提示词与后续历次重大改版的核心需求合并、去重、定稿，形成一份“从零出发，一次建完”的总提示词。使用者无需再经过本项目经历过的多轮迭代，直接按本文档实施即可得到当前线上版本。
>
> 说明：文中标注了【初稿】【改版】的来源脉络，便于理解需求演进；实施者按全文一次执行即可。

---

# 第一部分：项目总述

## 1. 一句话需求

构建一个**模拟法庭教学系统**（Web 应用）：教师端设计并发布刑事案例（由 AI 工作流自动生成案卷材料），学生端选择**辩护人 / 公诉人 / 审判长**三种角色，在与 AI 角色扮演的模拟庭审流程中完成**案例研习、法律文书撰写、法庭调查、法庭辩论、最后陈述、宣判**等全环节实训，全程 AI 流式输出 + 语音合成播报 + 语音识别输入，并提供**法条检索**工具；教师端可查看全班训练学情与 AI 分析，并维护**评分标准**（13 环节 + 总维度），学生端按标准获得文书 AI 评价与达标后解锁的 AI 样例。系统使用**超星单点登录**实名认证，游客可免登体验。

## 2. 用户与角色

- **学生**：超星 OAuth 实名登录（学工号），或游客（免登录，不入会话）。学生按角色走三条不同的实训路线。
- **教师**：教师密码 + 超星 OAuth 双门槛登录，设计案例、查看学情、维护评分标准。
- **三种庭审角色（UserRole）**：`judge` 审判长、`prosecutor` 公诉人、`defender` 辩护人。

## 3. 技术栈（硬约定）

| 层 | 选型 |
|---|---|
| Framework | **Next.js 16（App Router）** + React 19 + TypeScript 5（strict 心智） |
| UI | **shadcn/ui**（Radix UI 预装于 `src/components/ui/`）+ **Tailwind CSS 4** |
| 状态 | **Zustand**（全局 store，persist 到 localStorage，key `court-sim-storage`） |
| 数据库 | **Supabase PostgreSQL** + **Drizzle ORM**（schema 在 `src/storage/database/shared/schema.ts`） |
| 认证 | 超星 OAuth 2.0 单点登录 + Supabase Auth（service role 管理，httpOnly Session Cookie） |
| LLM | 豆包 seed 2.0 pro，统一走后端 **`/api/llm/stream`（SSE 流式）**，可选 `caching` |
| TTS | coze-coding-dev-sdk audio TTS，走 **`/api/tts`**（返回 audioUri） |
| ASR | coze-coding-dev-sdk ASRClient（**整段文件识别，非流式**），走 **`/api/asr`**（只吃 16kHz 单声道 WAV base64） |
| 工作流 | Coze 平台工作流（**异步执行 + 轮询历史**），走 `/api/workflow/run` + `/api/workflow/history` |
| 包管理 | **只用 pnpm**（preinstall 强制 `only-allow pnpm`） |

## 4. 运行与端口约定

- 服务端口必须从环境变量 **`DEPLOY_RUN_PORT`** 读取（自定义 `src/server.ts` 或 next 启动脚本），**严禁硬编码端口**；禁止占用 9000 端口。
- 绝对 URL 构造（OAuth 回调、分享等）用环境变量 `COZE_PROJECT_DOMAIN_DEFAULT`，严禁硬编码域名/localhost。
- 项目必须有合法 `.coze` 配置（dev: pnpm install + pnpm run dev；deploy: pnpm run build + pnpm run start）。
- 预览/生产热更新由 dev server 承担，代码改动无需重启。

## 5. 工程红线（写代码时就遵守，避免返工）

1. **pnpm only**，严禁 npm/yarn。
2. 严禁隐式 `any` / `as any`；所有函数参数、事件对象、catch 错误必须有类型或完成收窄；清理未使用变量与导入。
3. **Hydration 防范**：JSX 中严禁直接用 `typeof window` / `Date.now()` / `Math.random()` 参与首渲染，一律 `'use client'` + `useEffect/useState` 客户端挂载后渲染；严禁非法嵌套（`<p>` 包 `<div>`）；禁止 `<head>`，用 metadata / ReactDOM.preconnect / json-ld。
4. **【血泪教训】任何使用 `useSearchParams()` 的页面，必须拆内层组件 + `<Suspense>` 包裹导出**，否则生产构建预渲染阶段报 `missing-suspense-with-csr-bailout` 直接中断部署（开发期不报错！）。本项目踩坑页：`/law-search`、`/teacher/scoring`。
5. **主题 FOUC 防范**：根布局内联同步脚本（读 localStorage → 首帧前设置 `data-theme/data-font/data-fontsize`），杜绝首屏主题闪烁；`next.config.ts` 关闭 devIndicators。
6. next.config 路径用 `path.resolve/__dirname` 动态拼接，不写绝对路径。
7. 语音输入**严禁浏览器 Web Speech API**（国内不可用），一律 `/api/asr`；录音 blob 必须经 `blobToWav16k` 转 16kHz 单声道 WAV 后 base64 上传。
8. React 19 不 `import React`（除非用到 `React.xxx`）；标点全半角；括号/模板串成对闭合。
9. 代码中**严禁硬编码密钥/Token**；所有集成配置走环境变量。

---

# 第二部分：信息架构（全部页面定稿清单）

> 路由全部置于 `src/` 目录下。★ 表示需 useSearchParams + Suspense 边界。

## 2.1 公共与认证

| 路由 | 说明 |
|---|---|
| `/` | **登录页**：学生登录（超星）、教师入口（密码+超星）、游客进入。左侧深色仪式面板（MOOT COURT 眉题、黄铜印章天平徽章、主标题、副标语），右侧登录卡。多机构时在按钮下提示“将跳转超星统一鉴权登录，支持：…”（动态列出白名单全部单位名，不硬编码）。 |
| `/auth/complete` | 超星回调落地页：同步 zustand store 后跳目标页（**业务守卫读 store，禁止回调直跳业务页**）。 |
| `/auth/error` | 登录错误页。 |
| `/law-search` ★ | **法条检索整页**（见 4.6）。 |

## 2.2 教师端（`/teacher/*`）

| 路由 | 说明 |
|---|---|
| `/teacher` ★ | 教师主页，**学情区 + 案例设计区同页**。案例设计：填写需求 → 触发工作流 A 异步生成案例（~10 分钟），可查看生成进度；案例列表：发布/下线/删除，断点恢复（check-pending）。学情区：全班训练记录列表 + AI 学情分析入口。 |
| `/teacher/case-detail` ★ | 案例详情查看页：三栏可编辑（案件资料分区）+ 发布按钮 + **跳转评分标准页**按钮。 |
| `/teacher/scoring` ★ | **评分标准大页面**（见 4.7）：响应式左右分栏编辑器，编辑总维度/评级档位/13 环节标准/样例解锁阈值，保存（update_scoring），或“AI 按本案资料重新生成”。 |
| `/teacher/learning-detail` ★ | 训练学情查看页：三栏（学生列表 / 训练过程记录 / AI 分析）。 |

## 2.3 学生端（`/student/*`）

| 路由 | 说明 |
|---|---|
| `/student/select` | 案例选择页：选角色（辩护人/公诉人/审判长）+ 选案例，展示案件介绍、训练价值、**只读评分标准区**（总维度+评级+13环节要点）。 |
| `/student/case-detail` | 案例详情：**9 个研习问题**（角色视角）+ AI 助手对话 + 卷宗查看器。 |
| `/student/defense-writing` | 【辩护人】辩护词撰写页：对话 / 编辑 / 评价 三段式。 |
| `/student/indictment-writing` | 【公诉人】刑事起诉书撰写页。 |
| `/student/prosecution-writing` | 【公诉人】公诉意见书撰写页。 |
| `/student/sentencing-negotiation` | 量刑协商页（对话式庭审，等待态归属对方角色）。 |
| `/student/court-investigation` | 【辩护人】法庭调查页（多角色语音庭审）。 |
| `/student/court-debate` | 【辩护人】法庭辩论页。 |
| `/student/prosecutor-investigation` | 【公诉人】法庭调查页。 |
| `/student/prosecutor-debate` | 【公诉人】法庭辩论页。 |
| `/student/indictment-review` | 【审判长】起诉审查页（4 列 10 问题）。 |
| `/student/trial-outline-writing` | 【审判长】庭审提纲撰写页（4 列编辑器）。 |
| `/student/judge-opening` | 【审判长】开庭页（庭前输入 + 书记员流程 + 开庭多阶段主持）。 |
| `/student/judge-investigation` | 【审判长】法庭调查页（13 阶段主持）。 |
| `/student/judge-debate` | 【审判长】法庭辩论页（8 阶段主持）。 |
| `/student/judge-final-statement` | 【审判长】被告人最后陈述 + 判决书生成。 |
| `/student/judge-deliberation` | 【审判长】评议讨论页：**讨论(52%)｜判决书(26%)｜判决书评价(22%) 三栏并行**，提交判决书后右栏流式生成评价，互不阻塞。陪审员甲=男声、陪审员乙=女声、审判长维持原音色。 |
| `/student/judge-verdict` | 【审判长】宣判与闭庭页。 |
| `/student/final-statement` | 【辩护人/公诉人共享】最后陈述 → 宣判 → 闭庭页。 |
| `/student/learning-detail` ★ | 学习记录详情页。 |

## 2.4 三条角色实训路线（核心数据流）

- **辩护人**：案例详情 → 辩护词撰写 → 法庭调查 → 法庭辩论 → 最后陈述 → 宣判 → 闭庭
- **公诉人**：案例详情 → 刑事起诉书 → 公诉意见书 → 法庭调查 → 法庭辩论 → 最后陈述 → 宣判 → 闭庭
- **审判长**：案例详情 → 起诉审查 → 庭审提纲 → 开庭 → 法庭调查 → 法庭辩论 → 被告人最后陈述 → 评议讨论 → 宣判与闭庭
- 每条路线结束时调用“结束训练”：保存学习记录 + 生成总结评价建议 + 跳转。

---

# 第三部分：数据模型与后端 API

## 3.1 数据库 Schema（Drizzle / Supabase）

- **students**：id(uuid PK)、student_id(学工号，unique)、password(超星账号为随机串，密码登录永不成立)、nickname、avatar、avatar_color、fid(机构)、is_guest、created_at/updated_at。
- **cases**：id(uuid PK)、name、profile、teach、case_info、plead、record、evidence、law、indictment、prosecution、defense、victim、plan、person、**judge(存评分标准 JSON)**、wrong、highlights(jsonb)、creator_name、status(generating/generated/published/offline)、workflow_execute_id、generate_execute_id、timestamps。
- **training_records**：id、student_id(FK)、case_id(FK cascade)、case_name、role、overall_score、summary、evaluation、suggestion、last_stage、progress、learning_records(jsonb)、lifecycle(jsonb)、timestamps。
- **case_design_requests**：id、need、workflow_id、execute_id、status、timestamps。

## 3.2 API 路由定稿清单（全部在 `src/app/api/`）

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/llm/stream` | POST | LLM 流式输出，SSE `data: {"content":"..."}`，支持 `caching`、`previousResponseId`。 |
| `/api/tts` | POST | 语音合成 → `{audioUri, audioSize}`。 |
| `/api/asr` | POST | 语音识别，body `{uid, base64Data}`(16kHz WAV) → `{text, duration}`。 |
| `/api/summary` | POST | 学习过程总结 → `{summary, evaluation, suggestion}`。 |
| `/api/workflow/run` | POST | 工作流执行，`{workflowId, isAsync:true, parameters}` → `{executeId}`。 |
| `/api/workflow/history` | GET | `?executeId=xxx` 轮询执行结果（SUCCESS/FAILURE）。 |
| `/api/cases` | GET/POST | 案例 CRUD；POST action: `save` / `publish` / `offline` / `delete` / `update_documents` / `update_scoring`（保存评分标准，空结构 400 拒绝）/ `generate_scoring`（AI 按本案资料重新生成评分标准）。 |
| `/api/cases/check-pending` | POST/GET | 工作流断点恢复（generating 案例 + 文书待生成案例）。 |
| `/api/students` | POST | `action: guest` 建游客记录；`update_profile` 修改资料。实名建号由超星回调完成。 |
| `/api/learning-records` | GET/POST | 学习记录 CRUD。 |
| `/api/auth/chaoxing` | GET | 发起超星登录（state 携带机构 fid，取白名单首项兜底）。 |
| `/api/auth/callback/chaoxing` | GET | 超星回调：换 token → 取身份 → 落 students → 建/同步 Supabase auth.users → 消费一次性 Magic Link → 写 Session Cookie → 跳 `/auth/complete`。 |
| `/api/auth/me` | GET | 当前用户（按 `app_metadata.court.role` 返回 teacher/student）。 |
| `/api/auth/logout` | POST | 退出。 |
| `/api/auth/teacher/unlock` | POST | 教师密码校验（`TEACHER_PASSWORD`，默认 123），写 HMAC 签名登录上下文后返回超星授权 URL；绕过密码直接拼 `next=/teacher` 拿不到签名标记，只能以学生身份被教师端守卫弹回。 |

## 3.3 工作流（Coze，异步 + 轮询）

| 工作流 | 用途 | 触发点 |
|---|---|---|
| `7656623831193223210` | 案例生成（14 字段案卷材料） | 教师设计案例 |
| `7656793461539356723` | 法律文书生成（起诉书/公诉意见书/辩护词等样例） | 教师发布案例 |
| `7657514573812550` | 判决书生成（辩护人/公诉人路线） | 学生最后陈述页 |
| `7657514573813612550` | 判决书生成（审判长路线） | 审判长最后陈述页 |
| `7674184725792489498` | 法条检索（input → law[] + explain[{point,content}]） | 法条检索页 |

---

# 第四部分：核心子系统定稿规格

## 4.1 登录体系（超星单点登录）【初稿即有 → 后改：下线学号密码、动态白名单】

- 学生实名登录**只走超星 OAuth**；游客保留（`POST /api/students action=guest` 建一行 is_guest 记录，无服务端会话）。
- 教师**双门槛**：先过教师密码（`TEACHER_PASSWORD` 环境变量，默认 `123`），服务端把教师意图写入 HMAC 签名登录上下文；再走超星 OAuth，回调建会话时凭上下文标记把账号在 `app_metadata.court.role` 持久提升为 `teacher`。
- 流程：`超星授权 → 服务端换 access_token → getUserByTokenFormMooc 取身份 → 落 students 表 → 建/同步 Supabase auth.users → 消费一次性 Magic Link → 写 Session Cookie → /auth/complete 同步 store → 目标页`。
- 关键约定：
  - 超星 OAuth 的 `state` 当作机构 FID 用（非随机串）；FID 白名单在环境变量 `CHAOXING_FIDS`，格式 `fid:名称`，逗号分隔；登录页**无单位下拉**，直接带首项 fid 跳转；多机构时按钮下动态列出全部单位名。
  - `chaoxing.name` 是**学工号**，`chaoxing.displayName` 才是姓名。
  - 可信身份只读 `app_metadata.chaoxing`（service role 可写）；`user_metadata` 用户能改，只用于展示。
  - `app_metadata.court.userId = students.id`，实训记录与教师统计按它关联。
  - Session Cookie 为 httpOnly，浏览器不直连 Supabase，数据全走服务端 API。

## 4.2 全局状态（Zustand store，persist）

- 持久化 key：`court-sim-storage`，字段：user、selectedRole、selectedCase、voiceMode（默认 true 语音模式）、documents、learningRecords、docProgress、主题三件套（theme/font/fontsize）。
- logout 清空业务字段；setCase 切换案例时重置相关状态。

## 4.3 语音交互系统【重大改版：TTS 门控 + ASR 统一 Hook + 等待态归属】

### TTS
- 全局单例音频 + **TTS 队列**：`enqueueTts`（AI 连续播报排队播）与 `interruptTts`（用户触发打断：停当前、清队列、立即播）双模式共存；`setTtsSpeakerCallback` 供 UI 追踪当前播报角色。
- 角色音色映射：审判长、公诉人、辩护人、陪审员甲(男声 `zh_male_taocheng_uranus_bigtts`)、陪审员乙(女声 `zh_female_vv_uranus_bigtts`) 等。
- **TTS 门控（定稿）**：AI 回复配音**仅在语音模式下生成**——10 个对话页在 enqueueTts 前统一检查 `voiceModeRef.current`（useRef 镜像 voiceMode，防流式回调闭包过期）；文字模式静默输出、不显示“按住说话”按钮；AI 对话面板的手动朗读不受门控。

### ASR
- 统一 `use-press-talk` Hook（`src/hooks/use-press-talk.ts`）：解构 `{isRecording, asrLoading, pressHandlers}` 展开到按钮（`touch-none select-none`），`onText` 回调收识别文本；内部指针+触摸双适配、getUserMedia pending 期快速松手防竞态。10 个语音页面共用，**禁止再手写 MediaRecorder 逻辑**。
- 交互形态：**按住说话 / 松开发送**；录音 blob → `blobToWav16k` → base64 → `/api/asr`。

### 等待态角色归属（定稿）
- 多角色庭审页等待气泡显示 **“{当前发言角色}正在思考…”**——`streamingSpeaker` 在请求发起前即设置，避免等待期卡在“审判长/AI”；评议页用 ttsSpeaker。
- 10 页统一用 `hasVisibleStream`（lifecycle-utils，剥离 LIFECYCLE 标签后非空）判断是否显示流式文本，空则维持思考态，防空气泡闪现。

## 4.4 庭审流程展示与 UI 组件

- **流程展示**（开庭前/开庭/最后陈述/宣判/闭庭）用**全屏页面**（flow-page）不用弹窗；评议等可用弹窗（flow-modal）。均流式输出 + markdown 渲染 + 低透明背景图。
- **court-character-image**：法庭角色立绘（发言气泡 + 闪亮动效）。
- **case-file-viewer**：卷宗查看器（一级/二级菜单）。
- **ai-chat-panel**：AI 对话面板（流式 + TTS + 缓存 + 固定高度滚动，不撑开页面）。
- **title-bar**：通用标题栏（角色/卷宗/法条检索/背景/字体/字号/跳过/继续/文书/学习记录/结束分析/首页）。
- **task-hint**：右下角流程提示悬浮框（全局挂载，指针拖拽自由移动 + 20s 自动关闭；**拖拽期间直接写 DOM style 零重渲染，松手才提交 state**——流式页面拖拽不卡顿）。
- **case-lifecycle-timeline / lifecycle-bar**：生命周期时间轴（LIFECYCLE 标签解析 + 流式过滤，字符串感知括号计数）。
- **continue-modal**：继续按钮弹窗（学习过程+概括+评价+建议）。
- **sample-viewer-dialog**：学生端 AI 样例查看弹窗（解锁条件 + 得分差距提示）。
- **stage-standards-viewer**：本环节评分标准查看器（Popover，按 stageKey 匹配）。
- **writing-outline-dialog / question-generator / highlights**：写作大纲、研习问题生成、卷宗高亮标注（Annotation）。

## 4.5 法律文书撰写页统一定稿规格

- 三段式：**对话（AI 引导）/ 编辑（撰写）/ 评价（AI 评分+建议）**。
- 4 个写作页（辩护词/刑事起诉书/公诉意见书/庭审提纲）**评价提示词注入本环节评分标准**（`stageStandardsToPrompt`）。
- 评价计数持久化 localStorage（key `court-eval-progress:学生:案例`），达到 **“单次 ≥60 分 或 累计 3 次”** 解锁“AI 样例”按钮（展示教师端发布案例时由工作流生成的文书样例）。
- 评价栏头部有“本环节评分标准”Popover。

## 4.6 法条检索整页（`/law-search`）【经历多轮改版，最终定稿】

**最终定稿（以此为准，覆盖了历史上“弹窗/AI流式重排/留白/字号/滚动”全部演进）：**

- **整页路由**，任何情况不用弹窗；入口按钮（天平图标）挂在 TitleBar 与学生/教师各页头部（首页除外），点击 `router.push('/law-search')`；页内“返回”回到来源页。
- 页面结构：标题区（天平图标+标题+副描述）→ 搜索栏（放大镜内嵌输入框 + 确定按钮 + 快捷关键词）→ 双栏结果区。
- **数据**：`useLawSearch` Hook 发工作流 `7674184725792489498`（input 关键词），异步执行 + 轮询，得 `law[]` + `explain[{point,content}]`。
- **全宽大字版式**：容器无 max-w 限制（`w-full + px-4 sm:px-6 lg:px-10`），正文 `text-lg` 基准，**页面自身不提供任何放大/缩小控件**（字号走全局档位）。
- **两层滚动**：外层页面框架（标题区+搜索栏）`h-screen overflow-hidden` 固定一屏不滚；内层左（法条列表）右（解释目录）两栏各自 `overflow-y-auto` 独立滚动——目录/法条再多也**不拉长整页**；窄屏单栏时结果区整块内滚。
- **左栏 = 紧凑法条卡列表**（无 № 序号）：条款号 + primary/10 罪名徽章 + 两行灰预览 + 右箭头；点击整卡进**法条详情视图**（顶部“← 返回检索结果”）。
- **右栏 = 两层折叠目录**（与卷宗同理）：一级 `〔N〕` 关联法条分组（Folder 图标+等宽序号+项数 Badge，可折叠），二级分类节点（FileText 图标+分类名+预览，默认收起）。
- **正文直出渲染（定稿，撤销历史上的“AI 流式重排”整条链路）**：数据库原文已人工优化好，打开即完整显示，**零 LLM 请求、无缓存、无流式**——`law-format.ts` 本地符号解析立即渲染；原文含 Markdown 标记则由 ReactMarkdown + `.law-ai-md` 样式渲染。
- **符号处理（law-format.ts）**：`一、`→加粗独立行；`（二）`/`1.`→左侧 2px 主色竖线缩进行；`★`→星形图标+浅底突出行；普通段落 justify；解析先按【分类】白名单切分、〔N〕提序号；数字标记用负向后顾断言避免误切年份/小数。
- 关键词快捷入口、检索计时提示、空态/错误态/重试齐备。

## 4.7 评分标准系统【重大改版新增，定稿】

- **存储**：`cases.judge` 列（jsonb 文本），结构 `{version, overall:{dimensions, grading}, stages:[13环节], sampleUnlock:{scoreThreshold,evalCountThreshold}}`；解析用 `parseScoringStandards`（`src/lib/scoring.ts`）。
- **生成链路**：`buildScoringGenerationPrompt`（框架 prompt，源自系统提示词 + 知识库考核要点）→ LLM 流式生成 → 校验落库；种子 `scripts/scoring-seed.json` 由 `scripts/generate-scoring-seed.ts` 离线生成。
- **存量补加**：`scripts/migrate-scoring.mjs`（幂等，挂 `scripts/start.sh`，judge 为空的案例按种子补加）。
- **教师端**：`/teacher/scoring?caseId=xxx` 独立大页面编辑器（响应式左右分栏 + 整页滚动），编辑 dimensions/grading/stages/sampleUnlock、保存（`update_scoring`）、AI 按本案资料重新生成；角色 Tab 按 common/defender/prosecutor/judge 过滤，Badge 中文（辩护人/公诉人/审判长/通用）。
- **学生端**：写作页评价提示词注入本环节标准；评价计数 localStorage；达 **单次≥60 或 累计 3 次** 解锁 AI 样例；评分标准只读入口 = 写作页“本环节评分标准”Popover + 案例详情“评分标准”分区 + 案例选择页“训练价值”下方只读区。

## 4.8 设计系统（DESIGN.md 定稿）

- **气质意象**：庄重法庭，高窗阳光，木质审判席、深色皮椅、整齐卷宗——法律的严肃权威 + 教学温度。
- **5 种背景主题**（`data-theme` 切 CSS 变量，均非纯黑）：清雅白(默认)/暖阳米/森林绿/藏蓝韵/古韵宣。
- **字体**：雅黑(默认)/黑体/宋体（`data-font`）；**4 档字号** 17/19/21/24px（`data-fontsize`，特大默认），全局生效。
- **流程背景图**（即梦生成，低透明不挡字）：bg-pretrial/opening/investigation/debate/final-statement/verdict/closing/deliberation，另有 bg-meeting-room / bg-negotiation 供写作页使用。
- **角色立绘**：/characters/defender|prosecutor|judge.png。
- **登录页**：左侧深墨色仪式面板（黄铜印章环天平徽章、MOOT COURT 眉题、四角 2px 黄铜角饰、细金线夹注标题）。
- **设计禁忌**：禁纯黑背景、禁蓝紫渐变、禁硬编码圆角像素、对话记录区固定高度滚动不撑开页面、动画庄重沉稳禁轻佻、流程展示用全屏页不用弹窗、文书只显示已完成。

---

# 第五部分：实施顺序建议（从零一次建完）

1. **脚手架**：`coze init` 初始化 nextjs 模板（src 目录），装齐依赖（React 19、Next 16、zustand、@supabase/ssr+supabase-js、drizzle-orm+kit、coze-coding-dev-sdk、react-markdown、lucide-react、tailwindcss4、tw-animate-css 等），配好 `.coze`。
2. **基础设施**：DB schema + supabase-client、Zustand store、主题 provider + 预绘脚本、server.ts 读 DEPLOY_RUN_PORT、全局 CSS（5 主题变量 + 字号变量 + law-ai-md）。
3. **登录体系**：超星 OAuth 全套 API + lib（chaoxing-client/login-context/court-student/supabase-*）+ 登录页 + auth/complete/error。
4. **核心 API**：llm/stream、tts、asr、summary、workflow run/history、cases、students、learning-records、check-pending、auth/*。
5. **基础组件**：title-bar、flow-page/modal、ai-chat-panel、case-file-viewer、court-character-image、continue-modal、task-hint、law-search 全套、scoring 相关组件。
6. **语音**：audio.ts（TTS 队列 + 门控）、audio-wav.ts、use-press-talk、use-ai-stream。
7. **教师端** 4 页；**学生端** 按三条路线建全部页面；**公共页**（法条检索、learning-detail）。
8. **评分标准系统**：scoring.ts + 生成/迁移脚本 + 教师端编辑器 + 学生端注入/解锁。
9. **收尾自检**：全量 `pnpm build`（重点验证所有 useSearchParams 页面均有 Suspense 边界）+ lint + ts-check + 接口冒烟。

---

# 附：需求演进脉络（初稿 → 历次重大改版，供理解）

> 理想提示词已将下列内容全部合并定稿，实施时**无需**再按此脉络迭代。

- **【初稿】** 搭建模拟法庭教学系统：三角色庭审流程训练 + AI 角色扮演对话（流式）+ 语音播报/识别 + 教师端案例设计（工作流生成案卷）+ 学情查看 + 超星单点登录 + 5 主题/字体/字号 + 法律文书写作与 AI 评价。
- **【改版 1 · 登录与安全】** 下线学号密码注册登录，实名只走超星 OAuth；教师双门槛（密码+超星+HMAC 上下文）；可信身份只读 app_metadata；登录页去单位下拉、动态列白名单单位。
- **【改版 2 · 评分标准系统】** 新增 13 环节 + 总维度评分标准（judge 列），教师端独立编辑器大页面，学生端评价注入标准 + 计数解锁 AI 样例 + 多处只读展示。
- **【改版 3 · 语音体验】** ASR 整段 WAV 统一 + use-press-talk 共用 Hook；TTS 门控（仅语音模式配音）；等待态角色归属“{角色}正在思考”+ hasVisibleStream 防空气泡；悬浮提示框拖拽零重渲染。
- **【改版 4 · 法条检索】** 弹窗 → 整页路由；AI 流式重排 → 数据库原文直出；№序号移除、两层折叠目录、符号代码化处理（一、（二）★ 换行）；全宽大字版式；两层滚动（页面固定、双栏内滚）。
- **【改版 5 · 工程稳定性】** useSearchParams 全部补 Suspense 边界（修生产构建中断）；主题 FOUC 预绘脚本；devIndicators 关闭；pnpm 强制。

---

*文档生成：基于项目定稿状态倒推（2026-08-16）。*
