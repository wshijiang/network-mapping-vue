# Web 控制台功能指南

LLM 一级导航提供基础配置、供应商与模型管理、全局覆盖和在线调试，见 [LLM 使用说明](LLM.md)。威胁情报页保留实际提取状态与跳转入口。

[返回项目首页](../README.md) · [文档索引](README.md)

本指南说明搜索与扫描页面的交互约束。接口协议由服务端定义；开发结构和扩展约定见[维护指南](maintenance-guide.md)。

[高级搜索界面](#高级搜索界面) · [双栈扫描界面](#双栈扫描界面) · [Nuclei 漏洞扫描界面](#nuclei-漏洞扫描界面) · [扫描器错误与日志](#扫描器错误与日志)

## 威胁情报与自动标记

管理员在 `/admin/intel` 配置可信来源、本地/远程同步、周期和结构化审核策略，并管理
MITRE 基准、名称映射、文章与同步作业。可信结构化 IOC 默认直接接纳；AI 可独立开关，
文章提取始终需要人工审核。搜索、资产和域名关联页展示精确匹配的恶意/可疑证据。
配置与边界见[威胁情报管理](THREAT_INTELLIGENCE.md)。

## 高级搜索界面

独立入口 `/search.html` 使用 `POST /api/search/v2`，支持 IP/CIDR、端口、服务、Banner、
地理信息和资产标签的组合查询。搜索框直接提交完整表达式，语法校验由服务端完成；HTTP
`422` 响应中的 UTF-16 `span` 会用于选中错误位置。页面还会加载标签目录，点击标签即可
追加精确标签条件。

```text
country = CN AND port = 443 AND tag = "生产环境"
has_endpoint(port = 80) AND has_endpoint(port = 443)
```

完整语法、字段表、标签和跨端点语义参见服务端仓库的
[资产搜索语法与 API](https://github.com/wshijiang/network-mapping/blob/dev/docs/SEARCH_SYNTAX.md)。

## 双栈扫描界面

- 扫描器列表用 IPv4/IPv6 badge 显示当前协议是否就绪。
- 扫描器详情显示探测到的公网地址、失败原因及最后检测时间。
- 创建任务使用单一目标输入框，完整校验并自动识别 IPv4/CIDR、IPv6/CIDR 或域名。
- 多目标支持逗号或换行分隔，但一次只能使用一种分隔符；混合目标类型时阻止提交。
- 域名目标必须至少包含一个点，仅允许 ASCII 字母、数字和非首尾连字符；单标签不超过 63
  octets，点分形式（不含末尾根点）不超过 253 octets。
- 指定扫描器模式下，不兼容当前地址族的扫描器会被禁用。
- 任务列表和任务详情展示服务端返回的 `address_family`。

协议能力来自 `GET /api/scanner/list` 和 `GET /api/scanner/{id}`。前端只用于提前提示，
服务端仍会重新解析目标并执行最终兼容性校验。

## Nuclei 漏洞扫描界面

- 创建页对 IP/CIDR 和域名统一提供“全部”“仅端口”“服务识别”“仅 DNS”四种模式；
- 前端根据统一目标输入自动选择 IP 或域名创建接口，并在输入区实时显示识别类型和错误原因；
- “全部”提交 `scan_profile=vulnerability_scan`；域名目标先解析，再由服务端对授权地址生成扫描任务；
- “仅 DNS”提交 `scan_profile=dns_records`，只在域名目标下可选且不显示端口输入；
- 域名目标同样支持自动分配、指定扫描器和全部扫描器，列表按 DNS 阶段及解析器能力过滤；
- 目标切换为 IP/CIDR 时会移除“仅 DNS”选择，提交函数仍会执行同样校验；
- 指定扫描器时，只允许选择声明该 profile 且目标地址族就绪的节点；
- 管理员可在设置页将漏洞扫描设为新任务和自动任务的默认模式；
- 任务详情显示漏洞总数，并最多展示最近 500 条漏洞的严重级别、模板、匹配位置、说明、
  修复建议、标签、提取结果和 HTTP(S) 引用；
- 漏洞详情来自服务端结构化结果，不渲染 Nuclei 原始请求或响应。

前端选择项不会远程启用 Nuclei，也不能指定模板或 CLI 参数。扫描节点必须提前安装并启用
Nuclei，且使用经过审核的本地签名模板目录。协议、上线顺序和存储语义参见服务端仓库的
[扫描计划与结果协议](https://github.com/wshijiang/network-mapping/blob/dev/docs/SCAN_PIPELINE.md)。

## 扫描器错误与日志

扫描器详情提供目录刷新、日志快照采集/下载、错误筛选、证据行号和告警确认，支持离线和旧扫描器提示。使用与验证说明参见[扫描器诊断面板](scanner-diagnostics.md)。

## 健康告警

管理员可在 `/health` 按时间、告警类型与级别查询 Web 请求、PostgreSQL 和 Elasticsearch 告警。概览中的总数覆盖当前筛选的全部分页，严重、警告和涉及服务仅统计当前页；冷却去重后的记录数不等同于实际异常次数，也不代表服务的实时健康状态。

展开记录可查看完整诊断字段、请求 ID / Trace ID、SQL 文本、触发时的规则快照及排查建议，并复制原始 JSON。规则快照与当前监控配置分开展示；未保存快照的历史记录会明确提示。SQL 的本周期平均耗时与历史峰值分别展示，服务端记录的 SQL 文本最多 2000 个字符。同路径请求入口沿用请求日志的路径筛选，可继续按请求 ID 定位。

刷新失败保留上次成功加载的数据并显示提示；“重试”沿用失败查询的页码与筛选条件，不受后续筛选草稿编辑影响，分页只在请求成功后更新。窄屏使用卡片查看与展开详情。

## 智能目标与扫描器分配

创建页支持分配预览，展示目标与节点的自动地域信息及选择原因。任务详情展示独立任务组、执行分配原因和目标连接样本；运行时配置增加智能分配开关、优先领取有效期，以及智能刷新、失败退避和资产变化后复核策略。无需配置扫描器可达网段。

## 操作系统线索

搜索结果、任务端口和资产端口提供“系统线索”；资产详情另有“推测操作系统”摘要。
点击结果可展开证据、协议、命中字段和证据时间。识别中时稍后刷新；未知表示证据不足，
冲突表示不同返回特征指向不同系统。过期标识与端口最近发现时间分开计算。

搜索支持 `os.family = windows`、`os.distribution = ubuntu`、`os.status = conflict` 等条件。
CSV 导出同步包含系统字段、状态、置信度、判断对象、证据时间和过期标识。
字段来自服务端，前端不解析 Banner 或连接扫描目标。旧服务端没有 `os` 时显示“暂无识别结果”。
完整语义见[服务端操作系统识别说明](https://github.com/wshijiang/network-mapping/blob/main/docs/OS_DETECTION.md)。

## Web 技术栈

搜索、任务详情和资产端口表支持框架与组件、版本及识别证据，搜索页支持 CSV 导出。
状态、识别边界与测试命令见 [Web 技术栈展示](WEB_DETECTION.md)。

## DNS 域名排除

设置 → 运行策略 → DNS 排除与解析后扫描：每行一个精确域名或 `*.example.com`（各级子域，不包含根域），最多 256 条。搜索、手工创建、OpenAPI 和后续发现任务共用排除。解析后 IP 扫描继续使用独立 CIDR 策略。旧域名白名单升级后关闭域名搜索生成，设置排除规则后可重新开启。

## 扩展服务协议识别

IP/CIDR 的“服务识别”与“全部”可选 DNS TCP、DoT、DoH、VNC、Modbus TCP、EtherNet/IP、经典 S7comm、OPC UA、MQTT/MQTTS。按协议展示 TLS 服务名/DoH 路径/公开 CA、Unit ID、TSAP 或 MQTT 版本；沿用现有 daisyUI 控件和样式。

新增独立“UDP 服务识别”模式，自动协议集、显式端口并限制地址/端口预算。早期的“UDP 被动识别”模式已随扫描模式收敛移除，创建页不再提供；历史被动结果仍按实际来源只读展示。

节点筛选、预览和服务端领取同时校验协议及 `max_service_probes`。搜索/任务/资产共享 daisyUI 服务徽标和转义证据，显示 MQTT 认证拒绝及历史被动来源；资产历史请求带传输协议，表格键区分 TCP/UDP 同端口。服务版本不是产品版本，识别不等同于漏洞或授权访问判断。

配套升级要求 IPC 3 Worker 和新的服务端协议端点投影；旧部署须停服重建。准确协议子集、任务 JSON、限制和回滚步骤见[服务协议识别与部署](https://github.com/wshijiang/network-mapping/blob/main/docs/SERVICE_PROTOCOLS.md)。当前未完成真实设备或线上发布验收。

## 用户与权限管理

管理员进入 **用户管理** 可以按四种角色筛选账户。创建普通、只读或审计用户后，在用户行选择 **编辑权限**，勾选操作、填写资源范围和变更原因，再保存。需要重新验证时，输入当前密码及已启用的双因素验证码。角色变化后，被管理用户需要重新登录。

有扫描授权的普通用户进入 **创建任务**，可以选择授权的扫描模式和扫描器。只读用户在获得读取权限后可以查阅本人任务、资产和统计。审计用户通过 **日志 → 审计日志** 查看授权类别的事件，导出按钮需要单独授权。

详细授权字段、CLI 和升级注意事项见[服务端权限管理指南](https://github.com/wshijiang/network-mapping/blob/main/docs/USER_ACCESS.md)。

## 查看 C2 产品候选

搜索结果和资产端口的「服务」列将服务端 `products[]` 与 `https`、`tls` 等协议并列显示。证书或 HTTP 管理页候选显示黄色「疑似」徽标，通用 Web 组件在「技术栈」列查看。候选用于核对端口上的部署特征。[服务端产品表](https://github.com/wshijiang/network-mapping/blob/main/docs/SERVICE_PROTOCOLS.md#当前支持与判断范围)

展开资产端口，在「服务识别 → C2 产品识别」查看匹配规则、原始证据路径、观察时间及研究来源；规则证据和检测方式可展开查看。采集不完整和过期观察以状态徽标显示，检测方式表可在窄屏上横向滚动。端口历史弹窗按对应观察展示产品证据，不使用当前产品覆盖历史结果。来自扫描目标的内容按文本显示。

高级搜索可使用 `product = cobalt_strike`、`product IN (cobalt_strike, asyncrat_family)`，普通 Web 技术沿用 `tech = nginx` 等查询。产品识别独立于威胁情报，不需要先导入 IOC；未匹配不能解释为正常。旧索引中退役的普通软件条目会在查询时过滤，物理清理见[服务端重建说明](https://github.com/wshijiang/network-mapping/blob/main/docs/SERVICE_PROTOCOLS.md#服务产品识别)。

`products[]` 是产品匹配列表，`product_identification` 是该次规则分析的状态和来源信息。从服务端规则 v7 起，`suspected` 表示至少有一条证书或 HTTP 管理页候选。`not_matched` 表示已有证据未命中规则。`insufficient_evidence` 表示证据不足。`coverage=complete` 只针对当前相关观察。`stale` 表示结果落后于较新观察或规则修订。

识别依据中的路径相对于该次原始观察的 `data` 对象；关键值是用于复核的摘要，不是完整抓包。研究来源说明规则依据，不能代替目标本身的观察。检测方式表中的「已采集」表示存在该类记录，可能是部分结果；JARM 区域的「完成探测」计数对应 `completed_probes`，包括明确拒绝或正常关闭，应结合采集状态和指纹查看。没有 JARM 记录也可能是取消或预算不足，不能单凭缺省值断言未尝试连接。

需要配套新版服务端返回 `products` 和 `product_identification`。缺少这些字段时，协议与现有识别展示保持可用，资产详情兼容旧版证书线索。服务端返回上次证书线索时，资产端口详情会单独标明其观察时间。产品候选不自动增加 IP 级恶意标签，旧标签仍需管理员复核。

### Sliver 与 QakBot

配套服务端从产品规则 v2 起支持 `sliver` 和 `qakbot`，当前规则修订见服务端文档。Sliver 显示「Sliver · Multiplayer · 疑似」，表示默认多人管理端的证书候选，不代表已确认植入体通信监听器。

QakBot 在完整详情中额外显示 daisyUI「历史证书启发式」徽标和复核说明，紧凑徽标的提示也说明该限制；不能将其视为已确认家族或当前恶意活动。来源和原始证据继续在现有折叠详情内显示，沿用明暗主题。

高级搜索使用 `product = sliver`、`product = qakbot` 或 `product IN (sliver, qakbot)`。无需配置 IOC 来源；已有端点何时进入搜索、缺失证据的处理及规则依据见[服务端使用说明](https://github.com/wshijiang/network-mapping/blob/main/docs/SERVICE_PROTOCOLS.md#sliver-与-qakbot-的候选边界)。

### Mythic 与 Empire 管理端

配套服务端从内置规则 v5 起输出「Mythic · Web UI · 疑似」和「Empire · Starkiller · 疑似」。在「识别依据」中可查看匹配的页面结构和正文来源，候选限定到观察到的管理界面。高级搜索可使用 `product IN (mythic, empire)`。v6 支持服务端加载外部规则包，控制台按服务端实际返回的候选和规则修订号展示。[服务端证据与覆盖范围](https://github.com/wshijiang/network-mapping/blob/main/docs/SERVICE_PROTOCOLS.md#mythic-与-empire-管理端) · [服务端规则包](https://github.com/wshijiang/network-mapping/blob/main/docs/SERVICE_PRODUCT_RULES.md)

### 检测方式与 JARM

端口「C2 产品识别」增加 daisyUI 检测方式表，分别说明 JARM、TLS Certificate、HTTP Fingerprint、Protocol Fingerprint 的主动采集、额外连接、采集情况和基本原理。每条产品证据标明实际采用的方式；方式清单不代表已经存在对应的 C2 产品规则。

实际得到可用 JARM 结果时，以 62 个十六进制字符展示 TLS 配置指纹，服务列增加紧凑 JARM 徽标；不完整或全部拒绝显示采集状态，旧服务端没有这些字段时保留既有显示。JARM 可与产品候选并列查看，但不会单独生成家族或恶意结论。

在「扫描器 → 配置 → JARM 主动采集」设置开关、并发端点（1–32）、单次握手超时（1–30 秒）和块级预算（1–3600 秒）。默认关闭；还需扫描节点本地 `[service_detection.jarm].enabled=true` 及配套新版 worker。对已有 TLS 证据的端点额外最多建立 10 次连接，并受每 IP 限速和任务预算约束。JARM 每槽发送 ClientHello 并读取 ServerHello 或拒绝结果，不要求完成 10 次 TLS 会话。配置在下次任务生效。完整配置、采集边界、API 与旧数据说明见[服务端使用文档](https://github.com/wshijiang/network-mapping/blob/main/docs/SERVICE_PROTOCOLS.md#检测方式与-jarm-主动采集)。


JARM 配置页与服务器 CLI 共用配置文档、修订和审计。CLI 可用 `network_mapping_server scanner-config show <ID>` 查看配置，使用 `scanner-config set-jarm <ID> --enabled true --concurrency 4 --probe-timeout-seconds 3 --max-stage-seconds 60` 修改；`--enabled false` 可暂停额外握手。只给出需要修改的字段即可，Web 发布时保留其他配置；修订冲突会重新加载最新文档。完整命令和参数边界见[服务端 Web/CLI 使用说明](https://github.com/wshijiang/network-mapping/blob/main/docs/SERVICE_PROTOCOLS.md#通过-web-或服务器-cli-管理-jarm)。

历史记录即使只保留产品元数据、没有 Banner 或原始数据，也可点击「查看」展开对应产品证据和采集状态。

重新加载缺少 `jarm` 配置段的旧服务端文档时，Web 表单恢复关闭的默认值，避免沿用此前编辑的开关。扫描节点面对旧服务端未下发该配置段时则保留本地配置；两者分别描述表单展示与节点执行逻辑。
