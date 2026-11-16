# 技术栈展示

[功能指南](FEATURES.md) · [前端维护](maintenance-guide.md)

搜索页、任务详情和资产详情的端口表使用 `WebTechnologies.vue` 显示后端返回的 `web`。
识别在服务端执行，浏览器只展示结果，不从扫描页面中自行推断技术栈。展示标签由「Web 技术栈」
更名为「技术栈」；后端响应字段仍为 `web`，搜索 DSL 仍为 `tech`，CSV 首列改为「技术栈」。

## 搜索页紧凑展示

搜索结果表（`SearchResultsTable.vue`）以紧凑模式展示技术栈与系统线索，**不展开证据**：
`WebTechnologies.vue` / `OsFingerprint.vue` 传入 `compact`，无识别结果时统一显示 `-`，不再显示
「未识别到组件 / 非 Web 服务 / 未知 / 暂无识别结果」等状态文案。任务详情与资产详情仍保留
可展开的证据三角（`compact` 默认关闭，详情页行为与测试不变）。

技术栈项过多或列宽不足时，折叠为单个 daisyUI `badge-soft badge-primary` 徽标（如「nginx 共5条」），
其 tooltip 自动定位（优先底部、空间不足翻顶部）列出全部技术；屏幕阅读器经 `sr-only` 列表读取完整内容。
表格采用 `table-fixed` + `colgroup` 列宽，默认自适应容器宽度（无横向滚动条），支持表头拖拽调整列宽
（双击重置、可持久化）与表头客户端排序（lucide chevron 图标，三态切换，仅排序当前页）；服务端排序
下拉保留用于跨页全局排序。扫描时间仅显示年月日，并附 `UTC+8` 短徽标，tooltip 显示 IANA 时区名。

摘要及展开明细在每个技术名称前展示本地 SVG；品牌或框架家族图标与通用符号的覆盖、
来源、许可及维护方式见 [Web 技术标签图标](WEB_TECHNOLOGY_ICONS.md)。未知技术回退为
通用服务器图标；图标不改变识别结果或搜索语义，也不向第三方发起请求。

展开组件可查看名称、明确版本、置信等级、证据类型、规则 ID、字段路径、观察引用及时间。
版本冲突不显示为确定版本，`partial` 保留已识别项并提示证据不完整，`stale` 提示可能过期。
`pending` 隐藏组件明细；旧服务端缺少字段时显示“暂无识别结果”。证据始终通过 Vue 文本插值
转义，不使用 `v-html` 或执行资源 URL。

任务详情在当前页仍有 `web.status = pending` 的端点时每 30 秒自动刷新，即使扫描执行和
端点投影已经完成；Web 结果完成后，不再仅因 Web 识别而继续轮询。离开页面会清理定时器。

当前结果针对 IP 端点，无法代表该 IP 上所有域名。页面引用 JS/CSS 不代表运行时使用，
置信度是规则分级。支持范围及未来采集能力以
[服务端说明](https://github.com/wshijiang/network-mapping/blob/main/docs/WEB_DETECTION.md)为准。

搜索示例：

```text
tech = nginx
tech = "jquery@3.7.1"
web.status = partial
```

`ID@版本` 在同一个组件内匹配；不要拆成无关联的组件和版本条件。
搜索当前页 CSV 包含技术栈、状态、证据时间、过期标记和规则版本。

从本仓库执行：

```sh
pnpm test:web
node --test src/utils/*.test.js
pnpm build
```

SSR 测试验证证据文本转义、本地图标路径、未知技术回退、版本冲突、截断和过期提示及 pending 状态。
任务详情生命周期测试覆盖 Web 等待识别时的刷新、识别完成后停止刷新及离开页面时清理定时器。
本仓库没有独立 MkDocs 配置，文档入口维护在 `docs/README.md`，后端专题同时加入其 MkDocs 导航。

## 扩展技术目录

新增产品沿用同一 `web` 返回结构，前端无需按产品硬编码。完整清单和分批状态见
[服务端技术目录](https://github.com/wshijiang/network-mapping/blob/main/docs/WEB_TECHNOLOGY_CATALOG.md)。
第一批新增 MinIO、通用 S3、GitLab 等明确特征规则；可使用 `tech = minio`、`tech = s3`、
`tech = gitlab`。S3 兼容性不等于 MinIO 产品身份，GitLab 页面也不等于已识别 Git 协议服务。

第二批增加 `tech = git`，表示已观察到合法的 Git smart HTTP 广告响应。
MinIO 与 S3、GitLab 与 Git 可分别出现或同时出现，界面不根据产品关系自动补标签。
组合判定、支持目录和协议范围以服务端技术目录为准；本轮扩展无需更改前端字段或升级扫描器。

## Elasticsearch 数据库标签

服务端新规则以 category=database 返回 Elasticsearch，现有三个页面共用同一标签组件。使用已安装 @lucide/vue 的 Database 通用符号（ISC）和 daisyUI badge-outline，不使用 Elasticsearch 品牌图标，也不向外部图标服务请求资源。图标继承 currentColor，浅/深主题沿用现有样式。旧服务端没有 category 时保持原标签；不从端口号推断数据库。

查询使用 `tech = elasticsearch` 或 `tech = "elasticsearch@8.19.0"`。响应只含产品头时不展示版本；多个版本显示冲突，截断/过期状态沿用既有提示。该标签指 HTTP/HTTPS REST 产品证据，不证明无需认证，也不代表已经识别 TCP Transport。

UDP 创建任务、TCP/UDP 同端口展示和原生 Transport 将在后续批次交付，见[服务探测分批计划](https://github.com/wshijiang/network-mapping/blob/main/docs/SERVICE_DETECTION_ROADMAP.md)。
