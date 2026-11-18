# 服务端 Docker 镜像集成

[返回首页](../README.md) · [文档中心](README.md)

前端无需单独运行镜像。服务端仓库的 Dockerfile 会构建本仓库固定提交的 dist，并交给 Rust 后端托管。
前端版本独立于后端版本；服务端镜像标签使用后端版本，BUILD-INFO/OCI labels 另外记录前端版本及完整提交。

本仓库 `.github/workflows/ci.yml` 自动验证 main、dev 和常见开发分支的提交及 PR，使用 Node 24.16.0、
pnpm 11.9.0，冻结锁文件安装，执行所有工具测试、目标校验、构建并保存 dist；它不发布 GHCR 或 GitHub Release。

更新服务端镜像所包含的前端：

1. 提交前端变更，完成 CI；正式集成的前端提交先进入远端 main。跨仓库 release PR 预检可暂时固定前端 release 分支的完整提交；正式合并服务端 release PR 前，确认该提交已由普通 merge 保留在 main，或在 squash/rebase 后更新为最终 main 提交并重验。
2. 在后端仓库将 `.github/frontend-ref` 改为该前端完整 40 位 SHA，通过开发分支 PR 合入 main。
3. 后端分支 CI 构建并测试含该前端的镜像；经用户对具体组件与版本批准后发布新的服务端版本。

前端 main/dev 提交不会自动移动已发布服务端镜像，也不会自动更新后端的固定 ref。
服务端 CI 私有检出需要只读 FRONTEND_REPO_TOKEN；前端代码不能通过 VITE_*、构建参数或 dist 含有生产秘密。
本地使用相邻仓库作为 named context 时，先确认该仓库提交与 frontend-ref 相同且工作区干净。

完整流程、GitHub 设置及 Compose 见服务端仓库 [Docker 部署指南](https://github.com/wshijiang/network-mapping/blob/main/docs/DOCKER.md)。

本次配套版本为控制台 **0.1.25**、服务端 **0.1.31**、扫描器 **0.1.22**。PR 保留待审，tag 仅在本地准备，未触发正式发布；合并后检查与升级次序见[配套发布指南](https://github.com/wshijiang/network-mapping/blob/main/docs/RELEASING.md)。
