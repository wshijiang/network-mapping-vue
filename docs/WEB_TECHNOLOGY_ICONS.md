# 技术标签图标

[技术栈展示](WEB_DETECTION.md) · [文档中心](README.md)

搜索页、资产详情和任务详情共用 `WebTechnologies.vue`。摘要中的前三项和展开后的所有组件均通过 `WebTechnologyLabel.vue` 在文字前显示本地 SVG，保留名称、明确版本和版本冲突提示。图标为装饰，使用空 `alt` 和 `aria-hidden`，屏幕阅读器仍读取文字。图标背景透明，不再添加白色底色；彩色品牌图标沿用 SVG 自身填充。单色标记（Express、Next.js 的黑色填充，以及通用服务器/存储符号的 `currentColor` 描边经 `<img>` 渲染为黑色）在暗色主题下通过 `style.css` 的 `:root[data-theme="dark"] .tech-icon-mono { filter: invert(1) }` 反色保持可见，不恢复全局白底；`WebTechnologyLabel.vue` 按解析后的图标（含通用回退）自动附加 `tech-icon-mono` 类。

## 来源与覆盖

当前 100 个技术 ID 中，100 项使用品牌或框架家族图标，0 项使用通用符号（包含通用 S3）。图标身份由静态映射决定，不根据产品关系补出其他识别标签。

- Simple Icons **16.0.0**：36 个 SVG；仅增加集合提供的根 `fill` 颜色，路径不变。保留 CC0 集合许可及各图标单独许可。
- Devicon **v2.17.0**：Vue.js、.NET Core，MIT；原 SVG 不变。.NET Core 仅作为 ASP.NET 家族符号，不证明使用了 ASP.NET Core。
- Element Plus 官方仓库：原 SVG 不变，MIT；来源清单记录提取时的 Git blob SHA。
- Lucide **0.468.0**：通用服务器与数据库符号，ISC，保留 Feather MIT 通知。S3 使用通用存储图标，不使用 AWS 商标表示兼容协议。
- SvelteKit 使用 Svelte 家族图标；Swagger UI 使用 Swagger 家族图标。其余未选定品牌 SVG 的组件使用通用服务器符号，未识别 ID 也采用这一回退。

完整、可部署的[来源与修改清单](../public/assets/web-technologies/manifest.json)、[许可与署名](../public/assets/web-technologies/NOTICE.md)和许可证原文随 `public/assets/web-technologies/` 一同构建，部署后可访问 `/assets/web-technologies/NOTICE.md`。图标商标属于各自权利人；图标仅表示识别到的技术，不能作为授权、认证或依赖关系的证明。

| 技术 ID | 图标 | 来源集合 | 许可 |
| --- | --- | --- | --- |
| `alpinejs` | Alpine.js | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/alpinedotjs.svg) | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `angular` | Angular | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/angular.svg) | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) |
| `antd` | Ant Design | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/antdesign.svg) | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `apache` | Apache | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/apache.svg) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) |
| `apexcharts` | 通用服务器 | [Lucide 0.468.0](https://github.com/lucide-icons/lucide/blob/0.468.0/icons/server.svg) | [ISC](https://opensource.org/license/isc) |
| `aspnet` | .NET Core (ASP.NET family) | [Devicon v2.17.0](https://github.com/devicons/devicon/blob/v2.17.0/icons/dotnetcore/dotnetcore-original.svg) | [MIT](https://opensource.org/license/mit) |
| `astro` | Astro | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/astro.svg) | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `bootstrap` | Bootstrap | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/bootstrap.svg) | [MIT](https://opensource.org/license/mit) |
| `caddy` | Caddy | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/caddy.svg) | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `chartjs` | Chart.js | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/chartdotjs.svg) | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `discuz` | 通用服务器 | [Lucide 0.468.0](https://github.com/lucide-icons/lucide/blob/0.468.0/icons/server.svg) | [ISC](https://opensource.org/license/isc) |
| `docusaurus` | Docusaurus | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/docusaurus.svg) | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `drupal` | Drupal | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/drupal.svg) | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `echarts` | Apache ECharts | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/apacheecharts.svg) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) |
| `element-plus` | Element Plus | [Element Plus](https://github.com/element-plus/element-plus/blob/dev/docs/public/images/element-plus-logo.svg) | [MIT](https://opensource.org/license/mit) |
| `express` | Express | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/express.svg) | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `gatsby` | Gatsby | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/gatsby.svg) | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `ghost` | Ghost | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/ghost.svg) | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `git` | Git | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/git.svg) | [CC-BY-3.0](https://creativecommons.org/licenses/by/3.0/) |
| `gitlab` | GitLab | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/gitlab.svg) | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `grafana` | Grafana | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/grafana.svg) | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `gunicorn` | Gunicorn | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/gunicorn.svg) | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `highcharts` | 通用服务器 | [Lucide 0.468.0](https://github.com/lucide-icons/lucide/blob/0.468.0/icons/server.svg) | [ISC](https://opensource.org/license/isc) |
| `htmx` | htmx | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/htmx.svg) | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `jenkins` | Jenkins | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/jenkins.svg) | [CC-BY-SA-3.0](https://creativecommons.org/licenses/by-sa/3.0/) |
| `jetty` | Eclipse Jetty | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/eclipsejetty.svg) | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `joomla` | Joomla | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/joomla.svg) | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `jquery` | jQuery | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/jquery.svg) | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `laravel` | Laravel | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/laravel.svg) | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `layui` | 通用服务器 | [Lucide 0.468.0](https://github.com/lucide-icons/lucide/blob/0.468.0/icons/server.svg) | [ISC](https://opensource.org/license/isc) |
| `lighttpd` | 通用服务器 | [Lucide 0.468.0](https://github.com/lucide-icons/lucide/blob/0.468.0/icons/server.svg) | [ISC](https://opensource.org/license/isc) |
| `litespeed` | 通用服务器 | [Lucide 0.468.0](https://github.com/lucide-icons/lucide/blob/0.468.0/icons/server.svg) | [ISC](https://opensource.org/license/isc) |
| `microsoft-iis` | 通用服务器 | [Lucide 0.468.0](https://github.com/lucide-icons/lucide/blob/0.468.0/icons/server.svg) | [ISC](https://opensource.org/license/isc) |
| `minio` | MinIO | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/minio.svg) | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `nextjs` | Next.js | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/nextdotjs.svg) | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `nginx` | NGINX | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/nginx.svg) | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `nuxt` | Nuxt | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/nuxt.svg) | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `openresty` | 通用服务器 | [Lucide 0.468.0](https://github.com/lucide-icons/lucide/blob/0.468.0/icons/server.svg) | [ISC](https://opensource.org/license/isc) |
| `php` | PHP | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/php.svg) | [CC-BY-SA-4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `phpmyadmin` | phpMyAdmin | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/phpmyadmin.svg) | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `react` | React | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/react.svg) | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `s3` | Generic storage (S3 compatible) | [Lucide 0.468.0](https://github.com/lucide-icons/lucide/blob/0.468.0/icons/database.svg) | [ISC](https://opensource.org/license/isc) |
| `sveltekit` | Svelte | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/svelte.svg) | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `swagger-ui` | Swagger | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/swagger.svg) | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `thinkphp` | 通用服务器 | [Lucide 0.468.0](https://github.com/lucide-icons/lucide/blob/0.468.0/icons/server.svg) | [ISC](https://opensource.org/license/isc) |
| `tornado` | 通用服务器 | [Lucide 0.468.0](https://github.com/lucide-icons/lucide/blob/0.468.0/icons/server.svg) | [ISC](https://opensource.org/license/isc) |
| `uvicorn` | 通用服务器 | [Lucide 0.468.0](https://github.com/lucide-icons/lucide/blob/0.468.0/icons/server.svg) | [ISC](https://opensource.org/license/isc) |
| `vitepress` | VitePress | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/vitepress.svg) | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `vue` | Vue.js | [Devicon v2.17.0](https://github.com/devicons/devicon/blob/v2.17.0/icons/vuejs/vuejs-original.svg) | [MIT](https://opensource.org/license/mit) |
| `vuetify` | Vuetify | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/vuetify.svg) | [MIT](https://opensource.org/license/mit) |
| `werkzeug` | 通用服务器 | [Lucide 0.468.0](https://github.com/lucide-icons/lucide/blob/0.468.0/icons/server.svg) | [ISC](https://opensource.org/license/isc) |
| `wordpress` | WordPress | [Simple Icons 16.0.0](https://github.com/simple-icons/simple-icons/blob/16.0.0/icons/wordpress.svg) | [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) |

## 维护约定

1. 优先从官方或可信图标集合提取 SVG，固定版本或记录上游文件的 blob SHA，保留来源、许可、署名和修改说明。品牌图标不可用于暗示额外识别结果。
2. 文件放入 `public/assets/web-technologies/`，同时维护 `manifest.json`、`NOTICE.md`、许可证及 `src/utils/webTechnologyIcons.js` 的静态白名单。文件名使用服务端技术 ID。
3. 只接受无脚本、无事件处理器、无外部引用的 SVG。以本地 `img` 加载，不内联原始 SVG，不使用 `v-html`，不把服务端 ID 或资源 URL 直接拼成图标路径。
4. 未知 ID、非字符串 ID 或不在白名单内的值回退为通用服务器图标；加载失败也回退。图标请求不发往第三方，页面不要求外网连接。
5. 图标在有已识别技术的 `identified/partial` 状态中显示；`pending`、`unsupported`、`unknown` 和空结果不展示旧组件图标。CSV 继续只导出文字。
6. 运行 `pnpm test:web` 和 `pnpm build`，检查摘要、展开明细、长标签、明暗主题及未知技术回退。

## 数据库类别通用符号

category=database 的技术使用已安装 `@lucide/vue` 的 `Database` 组件（Lucide ISC 许可），替代静态品牌图标；图形固定在构建代码中，继承 currentColor，不内联服务端 SVG。Elasticsearch 名称由识别结果提供，通用符号不表示额外产品身份。其他技术继续使用静态 manifest 和白名单；CSV 不导出图形。
