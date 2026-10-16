# Network Mapping Web

**Network Mapping 的 Web 控制台**

基于 Vue 3 与 Vite，提供扫描任务、扫描器管理、资产搜索、分析报告及运维界面。使用 Tailwind CSS 与 daisyUI 保持一致的页面布局和交互。

[快速开始](#快速开始) · [功能指南](docs/FEATURES.md) · [开发指南](docs/maintenance-guide.md) · [文档中心](docs/README.md)

## 功能概览

| 区域 | 功能 |
| --- | --- |
| 扫描管理 | 目标校验、四种扫描模式、多节点分配、任务与执行实例详情 |
| 资产检索 | 高级表达式搜索、资产标签、端口/服务及地理信息 |
| 节点管理 | 双栈能力、远程配置、错误与日志诊断 |
| 数据分析 | 扫描统计、请求性能、平台周报与月报 |
| 管理运维 | 用户、审计、健康告警、备份、运行时配置与邮件模板 |

配套组件：[服务端](https://github.com/wshijiang/network-mapping) · [扫描器](https://github.com/wshijiang/Network-Mapping-Scanner)

## 快速开始

### 1. 准备环境

Node.js 版本要求为 `^20.19.0 || >=22.12.0`，使用 pnpm 安装和运行。页面依赖已部署的服务端 API，登录后才能访问受保护功能。

### 2. 安装依赖

```sh
git clone https://github.com/wshijiang/network-mapping-vue.git
cd network-mapping-vue
pnpm install --frozen-lockfile
```

### 3. 启动开发服务

```sh
pnpm dev
```

开发服务将 `/api` 和 `/logout` 转发到 `https://localhost:9999`。后端地址不同时修改 `vite.config.js` 的代理目标。仓库上一级存在 `ssl/key.pem` 和 `ssl/cert.pem` 时启用 HTTPS，否则使用 HTTP。登录与会话依赖后端，静态开发服务不能单独完成完整业务流程。

## 构建与部署

```sh
pnpm build
```

GitHub 自动构建及服务端 Docker 镜像集成见 [Docker 集成指南](docs/DOCKER.md)。

构建产物位于 `dist/`，由 Network Mapping 服务端托管。服务端配置示例：

```toml
[frontend]
directory = "../network-mapping-vue/dist"
```

此相对路径以服务端配置文件所在目录为基准。构建包含控制台、登录、搜索和资产独立入口；服务端按已声明路由提供页面，未知路径和缺失资源返回真实 404。

`pnpm preview` 可本地预览构建产物，但不替代服务端的鉴权、API 和生产页面托管。

## 项目结构

```text
src/
├── views/        页面与业务交互
├── components/   通用界面组件
├── composables/  共享组合逻辑
├── router/       控制台路由
├── utils/        HTTP、时间、校验等工具
├── App.vue       控制台布局
└── main.js       控制台入口
public/           公共静态资源
docs/             使用与开发文档
```

其他页面入口由 `vite.config.js` 声明。API 请求复用 `src/utils/http.js`，新增界面优先复用本地组件与既有样式。

## 开发与验证

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 开发服务 |
| `pnpm test:time` | 系统时间与报告工具测试 |
| `pnpm test:reports` | 单独运行报告工具测试，已包含在 `test:time` 中 |
| `pnpm test:targets` | 扫描目标校验测试 |
| `pnpm test:theme` | 主题工具测试 |
| `pnpm test:human-verification` | 登录验证配置、脚本加载和组件适配器测试 |
| `pnpm build` | 生产构建 |
| `pnpm preview` | 本地预览构建产物 |

按改动选择相关检查；工具脚本不覆盖完整 UI，页面变更仍需手动检查路由、加载、空状态和错误状态。问题反馈请附复现步骤和截图，提交界面改动时说明验证结果。

## 文档导航

| 我想了解 | 阅读入口 |
| --- | --- |
| 搜索与扫描页面行为 | [功能指南](docs/FEATURES.md) |
| 路由、组件、HTTP 与扩展约定 | [维护与扩展指南](docs/maintenance-guide.md) |
| 主题及扫描器诊断面板 | [文档中心](docs/README.md) |

## 许可证

本项目采用 [MIT License](LICENSE)。第三方依赖遵循各自许可证。
