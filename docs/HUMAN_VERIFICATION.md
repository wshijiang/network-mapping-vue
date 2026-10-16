# 登录人机验证

[文档中心](README.md) · [服务端部署与配置](https://github.com/wshijiang/network-mapping/blob/main/docs/HUMAN_VERIFICATION.md)

登录页支持可选 Cloudflare Turnstile 小组件，开关、公开 site key 及受保护动作均来自服务端，无需设置前端环境变量。默认关闭时不加载厂商脚本或 iframe。

## 配套部署

先部署支持 `GET /api/auth/human-verification` 的服务端，再部署本前端。随后由服务端配置 `human_verification.provider=turnstile`、widget site key、secret key 和实际域名。服务端修改后需重启，Docker 环境变量更新需重建容器。前端不能持有 secret，也不能自行关闭已启用的策略。

新前端不会把旧服务端的 404、网络错误或未知配置视为关闭。如果配置加载失败，检查后端和代理版本并使用页面重试按钮；回退到旧服务端之前先恢复兼容前端。Docker 集成还须更新服务端的固定 `.github/frontend-ref`，见[镜像集成](DOCKER.md)。

浏览器需能访问 `https://challenges.cloudflare.com`。服务端会在开启时允许相应脚本和 iframe 的 CSP；上游代理自定义 CSP 也须同步配置。不要反代或自托管 `api.js`。

## 登录行为

启用时，组件完成验证后才允许点击登录或按 Enter 提交。证明随原有登录 JSON 的 `human_verification.token` 发送给后端。每次密码尝试之后均重新验证；过期、超时或错误会清除旧证明，错误状态提供“重新验证”。证明只保存在内存中。

密码验证成功并要求 TOTP 时，仍按原有流程切换到验证码卡片。该阶段不重复使用证明；返回密码卡片会重新创建组件。会话过期弹窗继续跳转统一登录页。明暗主题切换会重新渲染组件并作废旧证明。

## 维护与验证

- `src/components/HumanVerificationWidget.vue`：统一组件、状态与生命周期；暴露 reset。
- `src/utils/humanVerification.js`：严格解析公开配置、生成登录证明、选择服务商适配器。
- `src/utils/humanVerification/turnstile.js`：单例脚本加载、render/reset/remove、过期和错误回调。
- `src/Login.vue`：读取公开配置、提交证明、保留密码/TOTP 登录交互。

后续服务商通过统一适配器契约扩展；服务商网络和 token 规则留在适配器内，页面不直接调用 SDK。未知 provider/schema 会显示错误，不能静默跳过。

运行 `pnpm test:human-verification`、`node --test src/utils/*.test.js` 和 `pnpm build`。交互验收至少覆盖：默认关闭无外联、启用后的成功/失败/过期、脚本失败后重试、重复点击/Enter、明暗主题、窄屏、TOTP 返回，以及组件在脚本加载期间卸载。自动化联调使用官方测试 key 或本地 SDK/API mock，不使用真实生产密钥。
