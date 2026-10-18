# Web 技术栈展示

[功能指南](FEATURES.md) · [前端维护](maintenance-guide.md)

搜索页、任务详情和资产详情的端口表使用 `WebTechnologies.vue` 显示后端返回的 `web`。
识别在服务端执行，浏览器只展示结果，不从扫描页面中自行推断技术栈。

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
