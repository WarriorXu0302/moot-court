# AI + 法律：研究与产品进展综述（截至 2026 年 11 月）

> 编写日期：2026-11-18。数据来自公开报道、论文与行业调研，均附出处。融资、采用率等数字口径不一，部分来自厂商或营销性文章，已在文中标注可信度。

---

## 一、总体判断

1. **从"对话助手"进入"智能体（Agent）"阶段**。2026 年 3–8 月，Harvey、Legora、Thomson Reuters、LexisNexis、Microsoft 先后推出智能体产品，能力从问答、起草，扩展到多步骤的检索、起草、核查任务。
2. **资本高度集中在头部**。Harvey 年内估值从 80 亿美元升到约 155 亿美元，Legora 约 56 亿美元。2026 年一季度是法律科技融资史上第二活跃的季度。
3. **能力上限仍然清楚**。LegalBench 这类选择/分类基准已经接近饱和（头部模型约 86–89%），但端到端法律任务的"全部达标率"仍然只有个位数到十几个百分点。幻觉问题没有解决，法庭因 AI 编造引用作出的处理决定已超过 2,200 件。
4. **采用面广，用得不深**。中外调研中"用过 AI"的比例普遍在 90% 左右，但系统化、全员部署的比例低得多。国内报告的说法是"广度已开、深度未至"。
5. **监管思路一致：AI 辅助，人担责**。最高人民法院坚持"AI 不得代替法官裁判"。欧盟《AI 法》把司法类高风险义务推迟到 2027 年 12 月。美国法院处罚的是"提交未核实的 AI 内容"，而不是"使用 AI"本身。

---

## 二、商业产品格局

### 2.1 海外头部

| 厂商 | 2026 年关键进展 | 定位 |
|---|---|---|
| **Harvey** | 3 月 G 轮融资 2 亿美元，估值 110 亿美元（GIC、Sequoia 领投）；9 月再融 5.5 亿美元，估值约 155–156 亿美元，用于自研模型；2026 年 1 月 ARR 约 1.9 亿美元，有报道称已到约 4 亿美元；推出 Agent Builder；8 月预览自研法律智能体模型 Tenet | 大型律所、企业法务的综合平台 |
| **Legora**（原 Leya，瑞典） | 3 月 D 轮融资 5.5 亿美元，估值 55.5 亿美元（Accel 领投），4 月追加后共 6 亿美元，估值 56 亿美元；5 月发布智能体操作系统 aOS；有报道称 10 月 E 轮估值 88 亿美元，**未经多方证实** | Harvey 的主要竞争对手，正在扩张美国市场 |
| **Thomson Reuters CoCounsel** | CoCounsel Legal 重构为全智能体体验（基于 Claude Agent SDK） | 与 Westlaw 绑定 |
| **LexisNexis Protégé** | 5 月推出 Lexis+ with Protégé Work：先生成可见的任务计划，再执行智能体起草；用 Shepard's Verify 标记无法核实的引用 | 与 Lexis 数据库绑定 |
| **Clio + vLex** | 以 10 亿美元收购 vLex，整合 Vincent AI | 中小律所 |
| **Microsoft / Anthropic** | Word 内置 Legal Agent；Anthropic 开源 93 个法律智能体 | 通用平台向法律场景渗透 |

市场的基本分工：用 Westlaw 的律所倾向 CoCounsel，用 Lexis 的倾向 Protégé，要综合平台的选 Harvey 或 Legora，Clio 用户用 Clio 自带的 AI。

**部署实况（ILTA 2026，500 多家律所）**：94% 的律所在用或正在评估生成式 AI，但真正达到"过半律师每天使用"的只有 Microsoft Copilot 和 Westlaw Advantage 两款。各工具的使用率：Copilot 76%、CoCounsel 44%、Claude 44%、Harvey 43%（700 人以上的大所中为 84%）。

### 2.2 国内

- **法院系统**：最高法"法信法律基座大模型"是国家级法律 AI 基础设施。深圳法院联合迪博技术研发的审判垂直大模型和"智辅审判系统 5.0"，在 2026 年世界人工智能大会（WAIC）上并入"法象"智能体平台。厂商宣称 2025 年深圳法官人均结案 744 件，同比增加 249 件，上诉率下降 35.1%，**此为厂商口径**。法治日报 2026 年政法智能化案例中，有济南中院的执行平台、南通中院的庭审辅助、保定中院的"智慧庭审"等。
- **商业产品**：iCourt AlphaGPT（2 月）、面壁智能 CPM for Legal 和行政复议垂直大模型 2.0（9 月服贸会）、科大讯飞星火法律大模型（全国产算力训练）。
- **地方治理**：WAIC 2026 期间，上海发布全国首部法律服务领域大模型部署应用指引，并发起共建法律 AI 可信算力空间"模法境"。

---

## 三、学术研究前沿

### 3.1 评测：从"选择题"走向"端到端交付"

| 基准 | 要点 |
|---|---|
| **LegalBench**（Vals.ai 榜单，2026-10） | 第一名约 88.6%，前 15 名都在 86–89% 之间，已接近饱和、区分度下降 |
| **Harvey LAB**（2026-05 开源） | 1,200 多项任务，覆盖 24 个执业领域，评分细则共 7.5 万条；要求全部细则都满足才算通过。首批结果最高仅 7.1%（Claude Opus 4.7）。这是 Harvey 自建的基准，可视为信号，但不是独立验证 |
| **Harvey LAB-AA**（Artificial Analysis 独立版，120 项私有任务） | 最高通过率 14.2%（Claude Fable 5） |
| **Legal Research Bench**（arXiv 2610.00609） | 测量长链路法律检索智能体在端到端任务上的可靠性 |
| **BenGER**（arXiv 2605.28183） | 德国法涵摄推理；同期有 LEXam（ICLR 2026） |

**共识**：模型的分项能力已经很强（按单条细则计，经后训练的模型通过率可超过 0.9），但一个完整任务要求所有环节都不出错，这一点仍然很难做到。研究者把这种现象称为"锯齿状智能"（jagged intelligence）。有实验发现，智能体跳过自查步骤会直接拉低成功率。

### 3.2 幻觉：从"有没有"到"能否追溯"

- 经典结论：Magesh 等（*JELS* 2025）发现，即使用了检索增强（RAG），主流法律检索工具仍有 17–33% 的幻觉率。Dahl 等的 "Large Legal Fictions"（2024）是同主题的奠基性论文。
- 2026 年的新方向：
  - **断言级检测**：*When Citations Mislead?*（arXiv 2610.10971）主张逐条断言对照所引来源检查，而不是只看整体准确率。
  - **智能体幻觉的分层画像**：LexAgentHallu（arXiv 2609.09754）。
  - **立场论文**：主张把幻觉理解为"法律依据（warrant）的失败"（arXiv 2609.17546）。
- 中文侧：LegalHalBench 收录 1,988 题，覆盖 800 多条法条。

### 3.3 模型路线：专用后训练回归

Harvey 与 Applied Compute 合作后训练 GLM-5.1，Tenet 则基于 Kimi K3 后训练。头部厂商在通用前沿模型之外，开始自建法律专用模型，以降低成本、提高稳定性。

### 3.4 法学教育（与本项目直接相关）

- **AI 模拟法庭**：Princeton/Stanford 的论文 *AI-Assisted Moot Courts*（CSLAW '26，arXiv 2603.04718）测试了 5 个模型、3 种提示策略和 3 个智能体模拟器，用 20 项指标评价 AI 生成的"法官提问"。结论：AI 提问的**逼真度较高，但问题多样性低，而且有谄媚倾向**；在提示词中要求模型"专门挑逻辑漏洞"，所有模型都稳定提升。
- **整学期诉讼模拟**：*West Virginia Law Review* 2026 年的文章介绍了一门课：用文字和语音聊天机器人扮演当事人、证人、对方律师，覆盖从接案、调查、诉状、动议、和解估值到 ADR 的全过程。
- **对抗式庭审训练流程**：*JAITD* 2026(3) 提出以"对抗式诉讼模拟"为核心的分步教学流程。
- **竞赛**：AI.Moot Court 2026，为期 11 周的英文赛事，面向法学、政治学、国际关系专业学生。

---

## 四、司法实践中的风险：AI 编造引用

- **数量**：Damien Charlotin 的公开数据库到 2026 年 10 月 19 日共收录 **2,202 件**法院决定，其中涉及律师 872 件、当事人自行诉讼 1,267 件。2026 年 1 月为 719 件，增长很快。
- **典型处罚**：
  - 第六巡回法院 Whiting 案：每名律师罚 1.5 万美元，并承担双倍费用。
  - 内布拉斯加州最高法院：63 处引用中 57 处有问题，律师被临时停职。
  - 密西西比州北区联邦法院 Withers 案：两名律师在该区禁止执业两年。
  - 第九巡回法院：两名律师停止执业 6 个月。
  - 新加坡 [2026] SGHC 49：每名律师个人承担 5,000 新元费用。
- **规则**：法院处罚的不是使用 AI，而是提交未经核实的 AI 产出。ABA Formal Opinion 512 规定，律师可以对使用工具和审核产出的时间收费，但不得对实际没有工作的时间收费。

---

## 五、监管与政策

| 地区 | 进展 |
|---|---|
| **中国** | 最高法 2022 年发布《关于规范和加强人工智能司法应用的意见》，确立"AI 不得代替法官裁判"、AI 结果只作参考、责任由法官承担，仍是该领域的主要文件。2026 年 9 月发布的法发〔2026〕10 号针对的是**涉 AI 纠纷的审理**，不是 AI 在法院的应用。2026 年 11 月第二十三次全国法院工作会议提出"以数智化驱动审判工作生产力变革""稳慎开展人工智能辅助审判"。上海发布法律服务大模型部署应用指引 |
| **欧盟** | Digital Omnibus（条例 (EU) 2026/1744，2026-07-27 生效）把附件 III 高风险系统（含第 8 点"司法与民主程序"）的义务从 2026-08-02 推迟到 **2027-12-02**；公共机构已在用的高风险系统仍是 2030-08-02；第 50 条透明度义务、通用 AI 模型（GPAI）义务按原计划于 2026-08 适用 |
| **美国** | 没有统一立法，主要靠法院的个案处罚、各地法院的常设命令和律协伦理意见 |

---

## 六、行业影响：计费模式

- Everlaw/Wakefield 2026 年 10 月的调研（300 名企业法务）：86% 使用生成式 AI；54% 已减少外包给律所的工作量；81% 预计 5 年内按结果计费会超过按小时计费。
- 律所自己的感受要慢得多：只有 25% 认为 AI 减少了某些任务的计费工时（去年为 19%），最常用的 9 种替代计费方式中有 8 种仍以小时计费为基础。
- Wolters Kluwer 2026：超过 90% 的律师每天至少使用一种 AI 工具。
- **结论**：客户期待降价和按结果计费，律所端变化缓慢，双方存在明显落差。

### 国内采用率
- LexisNexis《2026 中国内地法律 AI 调研》（411 人）：99% 使用 AI，其中专业法律 AI 的使用率为 54%；65% 担心保密和数据安全；77% 表示有引导式工作流程会更愿意使用。
- 《2026 中国律师行业 AI 应用报告》：大多数律所仍停留在查法条、写草稿、润色文书阶段，流程再造的很少。

---

## 七、对本项目（国际法模拟法庭教学系统）的启示

1. **防谄媚、提多样性**：Princeton 研究指出 AI 模拟法官提问"逼真但单一、爱附和"。可以在仲裁庭和审判长提问的系统提示中加入"专门挑论证逻辑漏洞"的指令（该研究中对所有模型都有效），并在多轮提问之间加入"提问角度去重"。
2. **引用可追溯**：幻觉研究正转向断言级核查。学生和 AI 引用的公约、条文、判例，可以对照案例 `law` 字段或检索结果标记"已核实 / 无法核实"，与 Lexis 的 Shepard's Verify 思路一致。这本身也是很好的职业伦理训练素材（可参考 Charlotin 数据库中的真实处罚案例）。
3. **评价按细则全部达标**：可借鉴 LAB 细则评分 + "全部达标"的双指标，与现有 13 环节评分标准结合，同时给学生"细则通过率"和"整体是否可交付"两个结果。
4. **从对话走向智能体**：行业主线是"可见计划 → 分步执行 → 自查"。写作页可以考虑显示 AI 的审阅计划，并加入一步自查。
5. **合规表述**：教学产品中的 AI 裁判、评议内容，应保持"AI 仅供参考，裁判由人负责"的定位，与最高法 2022 年意见一致。

---

## 参考来源

**产品与融资**
- [CNBC：Harvey 110 亿美元估值（2026-03）](https://www.cnbc.com/2026/03/25/legal-ai-startup-harvey-raises-200-million-at-11-billion-valuation.html)
- [Bloomberg：Harvey 156 亿美元估值（2026-09）](https://www.bloomberg.com/news/articles/2026-09-09/legal-ai-startup-harvey-hits-15-6-billion-value-with-550-million-round)
- [Legora 官方：D 轮 5.5 亿美元](https://legora.com/newsroom/legora-raises-550-million-series-d-to-fuel-us-growth)
- [Legal IT Insider：Legora 55.5 亿美元估值](https://legaltechnology.com/legora-raises-550m-series-d-at-5-55bn-valuation-interview-with-founder-max-junestrand/)
- [Contrary Research：Legora](https://research.contrary.com/company/legora)
- [Tech-insider：Legora E 轮（未证实）](https://tech-insider.org/legora-550-million-series-d-5-5-billion-valuation-harvey-ai-2026/)
- [Spellbook：2026 法律 AI 智能体](https://spellbook.com/learn/best-legal-ai-agent)
- [GC AI：法律 AI 工具对比](https://gc.ai/blog/legal-ai-tools)
- [Legal AI 定价对比](https://thelegalprompts.com/blog/ai-legal-tools-pricing-comparison)
- [智能体研究院：法律智能体落地报告（引 ILTA 2026）](https://clawpk.net/research/R-INDUSTRY-17-legal-agent-adoption-2026)

**研究与评测**
- [Vals.ai LegalBench 榜单](https://www.vals.ai/benchmarks/legal_bench)
- [Harvey LAB 结果汇总](https://aiinsiders.net/article/harveys-legal-agent-benchmark-shows-frontier-models-far)
- [Harvey LAB-AA](https://cryptobriefing.com/harvey-lab-aa-legal-ai-benchmark/)
- [Applied Compute × Harvey](https://www.appliedcompute.com/case-studies/harvey)
- [When Citations Mislead?（arXiv 2610.10971）](https://arxiv.org/pdf/2610.10971)
- [LexAgentHallu（arXiv 2609.09754）](https://arxiv.org/pdf/2609.09754)
- [Legal Hallucination as Failure of Legal Warrant（arXiv 2609.17546）](https://arxiv.org/pdf/2609.17546)
- [Legal Research Bench（arXiv 2610.00609）](https://arxiv.org/pdf/2610.00609)
- [BenGER（arXiv 2605.28183）](https://arxiv.org/pdf/2605.28183)
- [Hallucination-Free?（Magesh 等）](https://www.researchgate.net/publication/391086271_Hallucination-Free_Assessing_the_Reliability_of_Leading_AI_Legal_Research_Tools)
- [LegalHalBench（arXiv 2501.06521）](https://arxiv.org/pdf/2501.06521)

**法学教育**
- [AI-Assisted Moot Courts（arXiv 2603.04718）](https://arxiv.org/pdf/2603.04718)
- [项目页](https://princeton-polaris-lab.github.io/oral-args-webpage/)
- [Training New Lawyers With and For GenAI（WVLR）](https://researchrepository.wvu.edu/cgi/viewcontent.cgi?article=6502&context=wvlr)
- [JAITD 2026(3)](https://jaitd.com/index.php/journal/article/download/50/62/114)
- [AI.Moot Court 2026](https://vdaaimootcourt.com/)

**幻觉处罚**
- [Haqq：2,202 件追踪](https://www.haqq.ai/blog/ai-legal-hallucination-audit)
- [GC AI：处罚追踪](https://gc.ai/blog/ai-hallucination-legal-cases)
- [LegalDesire：2026 年已核实案例](https://legaldesire.com/ai-hallucination-sanctions-2026-table/)

**国内**
- [法治日报：2026 政法智能化案例名单](http://www.legaldaily.com.cn/index/content/2026-06/23/content_9410730.html)
- [光明网：法象大模型](https://difang.gmw.cn/sz/2026-07/20/content_38896236.htm)
- [北京日报：面壁智能服贸会](https://xinwen.bjd.com.cn/content/s6aa74dc4e4b039a8e2f109a1.html)
- [人民政协网：iCourt AlphaGPT](https://www.rmzxw.com.cn/c/2026-02-04/3865621.shtml?n2m=1)
- [新浪：上海法律服务大模型部署应用指引](https://finance.sina.cn/stock/jdts/2026-07-20/detail-iniikxus8138396.d.html?vt=4)
- [清华大学：法信法律基座大模型](https://www.tsinghua.edu.cn/info/1182/115304.htm)
- [最高法：关于规范和加强人工智能司法应用的意见](https://www.court.gov.cn/zixun/xiangqing/382461.html)
- [最高法知产庭：关于依法审理涉人工智能纠纷案件的意见](https://ipc.court.gov.cn/zh-cn/news/view-6033.html)
- [新浪：全国法院工作会议](https://k.sina.cn/article_1726918143_66eeadff02001xbeq.html)
- [LexisNexis：2026 中国内地法律 AI 调研](https://www.lexisnexis.com/blogs/cn/b/legal-ai-insights/posts/china-ai-sentiment-survey-report-2026)
- [上邦：2026 中国律师行业 AI 应用报告](https://aiwork.shangbon.com/news/260906uq4r.html)

**监管与行业**
- [Cooley：Digital AI Omnibus](https://cdp.cooley.com/digital-ai-omnibus-delays-key-deadlines-introduces-new-rules/)
- [AIActo：Omnibus 通过](https://www.aiacto.eu/en/blog/digital-omnibus-ai-act-report-2027)
- [CSA Research Note](https://labs.cloudsecurityalliance.org/research/csa-research-note-eu-ai-act-omnibus-vii-deadline-delay-20260/)
- [Everlaw 调研（2026-10）](https://finance.yahoo.com/technology/ai/articles/everlaw-survey-house-legal-teams-123500779.html)
- [Best Law Firms：替代计费调研](https://www.bestlawfirms.com/articles/law-firm-alternative-fee-arrangements-survey/8611)
