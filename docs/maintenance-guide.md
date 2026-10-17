# 前端开发指南

[项目首页](../README.md) · [功能指南](FEATURES.md) · [文档中心](README.md)

本文面向前端维护者，说明应用入口、路由、共享组件和交互约定。安装与构建命令见[项目首页](../README.md#开发与验证)；依赖和版本要求以 `package.json` 为准。

## 应用入口

| 入口 | 代码 | 职责 |
| --- | --- | --- |
| `index.html` | `src/main.js` / `src/App.vue` | 控制台、布局和 Vue Router |
| `login.html` | `src/login.js` | 登录 |
| `search.html` | `src/search.js` / `src/Search.vue` | 独立高级搜索 |
| `asset.html` | `src/asset.js` / `src/views/AssetDetail.vue` | 独立资产详情 |

控制台启动先检查 CSRF cookie；缺失时跳转 `/login`。有 cookie 时先加载系统偏好，成功后挂载应用并启动偏好同步；失败时显示重试入口。cookie 存在不代表会话有效，鉴权结果仍由服务端决定。

图表按页面需要加载，避免在主入口注册所有大型组件。新增独立页面时，同步更新 `vite.config.js` 的构建入口、主题初始化和服务端托管路径。

## 路由与导航

| 路径 | 文件 | 标题 | 说明 |
|------|------|------|------|
| `/` | `src/views/dashboard.vue` | Dashboard | 仪表盘首页 |
| `/create_scan` | `src/views/createscan.vue` | 创建任务 | 创建扫描任务 |
| `/task` | `src/views/task.vue` | 任务 | 任务列表、筛选、分页 |
| `/task/:taskid` | `src/views/taskdetail.vue` | 任务详情 | 单个任务详情（UUID 路由参数） |
| `/scanner` | `src/views/Scanner.vue` | 扫描器 | 扫描器列表 |
| `/scanner/:id` | `src/views/ScannerDetail.vue` | 扫描器详情 | 单个扫描器详情 |
| `/analysis` | `src/views/AnalysisLayout.vue` | — | 分析布局，重定向至 `/analysis/scan` |
| `/analysis/scan` | `src/views/analysis.vue` | 扫描分析 | 扫描统计图表 |
| `/analysis/performance` | `src/views/RequestPerformance.vue` | 性能基线 | 请求性能分析 |
| `/open-source` | `src/views/open-source.vue` | 开源项目 | 依赖声明列表 |
| `/setting` | `src/views/setting.vue` | 设置 | 监听/安全/通知配置 |
| `/user/info` | `src/views/PersonalInfo.vue` | 个人信息 | 用户资料编辑 |
| `/user/security` | `src/views/UserSecurity.vue` | 用户安全 | 2FA 设置 |
| `/testpage` | `src/views/TestPage.vue` | Alert 测试 | 组件测试页 |
| `/scanner/:id/configuration` | `src/views/ScannerConfiguration.vue` | 扫描器配置 | 远程配置发布与应用状态 |
| `/audit` | `src/views/AuditLog.vue` | 审计日志 | 操作审计 |
| `/requests` | `src/views/Requests.vue` | 请求日志 | 请求查询 |
| `/reports` | `src/views/reports.vue` | 报告中心 | 周报/月报与发送计划 |
| `/reports/:id` | `src/views/reportdetail.vue` | 报告详情 | 报告查看与发送 |
| `/health` | `src/views/Health.vue` | 健康告警 | 告警历史 |
| `/admin/users` | `src/views/UserManagement.vue` | 用户管理 | 管理员用户操作 |
| `/admin/tags` | `src/views/TagManagement.vue` | 标签管理 | 资产标签 |
| `/admin/backups` | `src/views/BackupManagement.vue` | 数据备份 | pgBackRest 管理 |
| `/setting/maintenance` | `src/views/SystemMaintenance.vue` | 系统维护 | 维护状态 |
| `/setting/scan` | `src/views/ScanSettings.vue` | 扫描设置 | 默认扫描模式 |
| `/setting/runtime` | `src/views/RuntimeSettings.vue` | 运行时配置 | 全局运行策略发布 |
| `/setting/mail-templates` | `src/views/MailTemplateEditor.vue` | 邮件模板 | 模板编辑与发布 |
| `/:pathMatch(.*)*` | `src/views/NotFound-404.vue` | 404 | 未匹配路由 |

> **注意**：任务与新建扫描器均使用 UUIDv7。任务路由显式限制版本位为 7；扫描器路由为兼容已有数据接受任意标准 UUID 版本格式。

路由定义以 `src/router/index.js` 为准。独立搜索、登录和资产页面不经过此路由表。`App.vue` 根据 `route.meta.title` 设置页面标题；新增页面时同时检查侧边栏入口和服务端 SPA 白名单。

管理员菜单的可见性用于界面提示；操作权限必须由服务端检查。

## HTTP 与会话

业务请求复用 `src/utils/http.js`：

- 使用 `withCredentials: true`。
- 同源 `/api` 和 `/logout` 请求附加 `X-CSRF-Token`，`/api/login` 除外。
- 会话相关 401 响应清除 CSRF cookie，并通过 `session-expired` 事件通知页面；登录页的登录和 TOTP 验证失败单独处理。

页面处理业务错误和 403 权限状态，不应重复实现全局会话过期逻辑。成功 HTTP 状态之外，还需检查接口约定的业务成功标志和数据结构。分页与筛选参数遵循具体接口，不能将所有列表统一假设为页码分页。

有轮询、筛选请求或路由切换的页面，应在卸载时停止定时器并取消未完成请求，避免旧响应覆盖新状态。参考 `src/views/reports.vue` 的取消与轮询处理。

### 版本更新检查与 CSP

`src/utils/versionUpdates.js` 在浏览器中直接请求 `https://api.github.com/repos/{repository}/tags`，检查前端、服务端和扫描端的最新稳定标签。请求不携带站点凭据或 CSRF Token；成功结果缓存 1 小时，失败结果缓存 5 分钟，完整刷新页面可清除内存缓存。

托管页面的服务端在 `network-mapping/src/middlewares/hmiddleware.rs` 下发 CSP，必须包含 `connect-src 'self' https://api.github.com`。只有 `default-src 'self'` 时，浏览器会按该默认规则拦截 GitHub API。此修复需要更新并重启服务端，单独重新构建前端不能改变响应头。

如果反向代理也下发 CSP，应确保每一条生效策略都允许上述连接；浏览器会同时执行多条策略，额外添加一个宽松响应头不能覆盖原有严格策略。验收时检查页面文档响应的 `Content-Security-Policy`，刷新页面后确认 GitHub tags 请求返回成功。无需将 GitHub 域名加入 `default-src` 或脚本来源。

## 共享组件与工具

| 组件 / 工具 | 用途 |
| --- | --- |
| `AppAlert.vue` | 成功、错误、警告与信息通知 |
| `EmptyState.vue` | 空数据和首次加载失败 |
| `AssetTags.vue` | 资产标签展示与管理 |
| `SystemDateTimeInput.vue` | 系统时区下的日期时间输入 |
| `ScannerDiagnostics.vue` | 扫描器错误、日志采集与告警 |
| `useUnsavedChanges` | 未保存变更的离开提示 |
| `systemTime` / `systemPreferences` | 系统时间格式及偏好加载 |
| `useTheme` / `useChartTheme` | 页面主题和图表主题 |

### 通知组件

`AppAlert` 必填 `title`；`type` 支持 `info`、`success`、`warning`、`error`，默认为 `info`。可选 `description` 默认空，`closable` 默认 `true`，`timeout` 默认 7000 毫秒；非正值关闭自动计时。组件通过 `close` 事件请求移除，悬停或聚焦时暂停计时。

页面负责保存和移除通知状态，通知容器沿用周围页面的布局。

### 空状态组件

`EmptyState` 用于空数据和错误提示；必填 `title`，可选 `message`，`type` 默认为 `info`，支持 `error`。加载、无结果和请求失败需要分别处理，不能以同一空列表掩盖三种状态。

## 交互与样式

- 页面使用 `<script setup>`，复用现有 Tailwind CSS、daisyUI 和本地组件。
- 保持相邻页面的布局、间距、控件尺寸和语义颜色；主题规则见[外观主题](theme-guide.md)。
- 初次异步加载可使用骨架屏或加载指示，保留标题和必要操作入口；静态内容无需人为延迟。
- 后台刷新保留已有数据，请求失败时提示刷新失败；不要把旧数据误标为本次空结果。
- 提交期间防止重复操作，在完成或失败后恢复状态。字段校验和错误说明应靠近对应输入。
- 涉及删除、重签凭据等操作时，复用既有确认交互。含未保存变更的配置页使用离开保护。

IPv4/IPv6 就绪表示节点内核可为对应地址族选择路由与源地址，不要求公网 IP 查询成功。前端能力提示和目标校验用于改善输入体验，服务端仍执行最终校验。

## 功能文档边界

页面说明集中在[功能指南](FEATURES.md)，不在本页重复字段清单和按钮布局。扫描器诊断的权限、离线提示及下载验证见[诊断面板](scanner-diagnostics.md)。搜索语法、扫描计划和结果协议由服务端定义，修改时同步对应服务端文档。

Nuclei 结果只展示结构化字段；引用链接使用 `rel="noopener noreferrer"`。不新增原始请求和响应渲染。

## 变更检查

1. 检查路由、标题、菜单以及独立入口是否齐全。
2. 检查请求成功、首次失败、空结果、后台刷新失败和权限不足状态。
3. 检查重复提交、请求取消、轮询清理及未保存变更处理。
4. 检查主题、窄屏、键盘操作和焦点状态。
5. 运行相关工具测试及 `pnpm build`；手动验证受影响页面，并在提交说明中记录结果。

## 操作系统结果组件

`OsFingerprint.vue` 统一展示服务环境与宿主机推断。`utils/osDetection.js` 集中管理名称、
状态和 CSV 字段，`Search.vue`、`AssetDetail.vue`、`taskdetail.vue` 复用该组件。

`os` 可以缺失；`pending`、`unknown`、`conflict` 不能显示为已确认系统，也不能将冲突时
保留的候选家族导出为确定结论。文本证据使用 Vue 插值转义，禁止通过 `v-html` 渲染返回片段。
时间使用现有业务时区工具。置信度只展示分级，不把规则得分转换为百分比。

接口联调核对空状态、未知、冲突、证据过期、服务环境与宿主机标签，以及 CSV 列对齐。
执行 `pnpm test:os`、`node --test src/utils/*.test.js` 和 `pnpm build`。
后端字段与权限约束见[识别维护说明](https://github.com/wshijiang/network-mapping/blob/main/docs/OS_DETECTION_DEVELOPMENT.md)。
