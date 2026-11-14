# Network Mapping Web 文档

新增[威胁情报管理与自动标记](THREAT_INTELLIGENCE.md)：来源、周期、AI 开关与固定人工审核。
模型选择、供应商与全局设置、在线调试见 [LLM 配置](LLM.md)；近期改动见[更新日志](CHANGELOG.md)。

[项目首页](../README.md) · [前端维护与扩展](maintenance-guide.md)

Web 控制台提供扫描管理、资产搜索、分析报告及运维界面。页面行为与前端开发在此维护，服务端配置和协议由配套服务端文档说明。

## 本次版本

控制台 **0.1.24**；配套服务端 **0.1.30**、扫描器 **0.1.21**、控制台 **0.1.24**。变更见[更新日志](CHANGELOG.md)，迁移、IPC 3 与发布次序见[配套发布指南](https://github.com/wshijiang/network-mapping/blob/main/docs/RELEASING.md)。2026-10-27 修复后重新发布；2026-10-26 同版本制品已撤回，请核对当前 tag 提交与校验和。

## 版本更新

[更新日志](CHANGELOG.md)按阶段记录已实现变更与明确标注的规划；[服务探测分批计划](https://github.com/wshijiang/network-mapping/blob/main/docs/SERVICE_DETECTION_ROADMAP.md)区分当前交付与后续批次。

[服务协议识别与部署](https://github.com/wshijiang/network-mapping/blob/main/docs/SERVICE_PROTOCOLS.md)列出当前已实现协议、证据及边界。创建页默认自动识别全部已实现 TCP 服务，UDP 任务自动识别其支持的协议，无需逐项选择；非标准端口覆盖仍受扫描器策略和预算限制。TLS、DoH 与工业参数集中在 daisyUI 折叠高级设置，沿用明暗主题和现有布局。

[DNS 扩展计划](https://github.com/wshijiang/network-mapping/blob/main/docs/DNS_DOH_DOT_VNC_PLAN.md)与[工业协议计划](https://github.com/wshijiang/network-mapping/blob/main/docs/INDUSTRIAL_SERVICE_DETECTION_PLAN.md)保留设计记录；实际交付范围以当前支持矩阵为准。

## 从这里开始

| 当前任务 | 建议阅读顺序 |
| --- | --- |
| 使用控制台 | [功能指南](FEATURES.md) → [外观主题](theme-guide.md) → 按需使用[开放平台](OPEN_PLATFORM.md) |
| 部署前端 | [项目首页的构建与部署](../README.md#构建与部署) → [Docker 集成](DOCKER.md) → 服务端部署与托管验收 |
| 配置登录验证 | [登录人机验证](HUMAN_VERIFICATION.md) → 服务端同名专题 |
| 排查扫描器错误 | [错误与日志面板](scanner-diagnostics.md) → 服务端日志采集说明 → 扫描器本地诊断 |
| 开发页面与组件 | [维护与扩展指南](maintenance-guide.md) → 对应功能专题 → 相关工具测试和生产构建 |

## 功能使用

| 文档 | 内容 |
| --- | --- |
| [控制台功能指南](FEATURES.md) | 搜索、扫描、资产、分析与管理页面的行为 |
| [LLM 配置与在线调试](LLM.md) | 供应商、模型、全局覆盖和调试会话 |
| [Web 技术栈展示](WEB_DETECTION.md) | 框架组件、版本冲突、证据、搜索与 CSV |
| [Web 技术标签图标](WEB_TECHNOLOGY_ICONS.md) | SVG 来源、许可、品牌与通用符号及扩展方法 |
| [外观主题](theme-guide.md) | 主题设置、样式约定与组件适配 |
| [开放平台](OPEN_PLATFORM.md) | 应用申请、审批、凭据、调试及 Web 开发约定 |
| [统一通知渠道](NOTIFICATIONS.md) | 邮件、飞书、Telegram 的事件订阅、分渠道模板、在线预览、并行启用与投递记录 |

## 部署与诊断

| 文档 | 内容 |
| --- | --- |
| [Docker 集成](DOCKER.md) | 固定前端提交、前后端版本关系和 CI 构建 |
| [登录人机验证](HUMAN_VERIFICATION.md) | 验证组件、配套部署、错误恢复和开发验证 |
| [扫描器错误与日志面板](scanner-diagnostics.md) | 诊断面板、异常状态和交互验证 |

## 开发参考

| 文档 | 内容 |
| --- | --- |
| [前端维护与扩展](maintenance-guide.md) | 开发入口、路由、组件、HTTP、会话和验证命令 |

## 配套组件

| 组件 | 文档职责 | 入口 |
| --- | --- | --- |
| 服务端 | 系统部署、扫描协议、存储、运维及外部 API | [服务端文档中心](https://github.com/wshijiang/network-mapping/blob/main/docs/README.md) |
| 扫描器 | 节点部署、引擎配置、执行恢复及本地诊断 | [扫描器文档中心](https://github.com/wshijiang/Network-Mapping-Scanner/blob/main/docs/README.md) |
| Web 控制台 | 页面操作、前端集成、组件及交互验证 | [Web 文档中心](https://github.com/wshijiang/network-mapping-vue/blob/main/docs/README.md) |

## 文档维护约定

- 项目 README 提供定位和快速开始，本页提供完整索引；页面行为、部署、开发约定分别放在对应专题。
- 新增专题时同步本页，接口、配置和行为变化时同步服务端或扫描器说明。
- 站内使用相对 Markdown 链接，跨仓库使用完整 URL；命令注明运行位置，示例使用脱敏值。
- 当前实现、设计方案和验证记录分别说明，历史记录注明日期与适用版本。
- 本仓库尚无独立 MkDocs 配置；服务端和扫描器文档站的本地预览方式见各自文档中心。

- [域名发现与证书关联](DOMAIN_DISCOVERY.md)

[语言切换与多语言文档](LOCALIZATION.md)：语言规则、cookie 和中英统一构建。
