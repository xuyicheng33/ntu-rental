# Windows 一站式更新器

目标：Windows 用户双击一个脚本，自动完成 PropertyGuru 数据更新、校验、提交到 GitHub，并触发 Vercel 重新部署。

## 用户入口

双击：

```text
windows-updater/Update-Rental-OneClick.bat
```

## 第一次使用前只需要安装

1. Node.js LTS
2. Git
3. 能 push 到项目 GitHub 仓库的权限

## 脚本自动做什么

1. `git fetch origin main`
2. `git pull --ff-only`
3. `npm ci`
4. `npx playwright install chromium`
5. 启动真实 Chrome / Edge / Chromium 持久化浏览器 Profile
6. 自动打开 PropertyGuru
7. 自动等待 / 尝试验证
8. 如果自动阶段没有通过，保留浏览器窗口让用户手动完成验证
9. 保存浏览器 Profile 和 storage state
10. `npm run build`
11. 启动本地 Next 生产服务
12. 请求 `/api/scrape?source=propertyguru`
13. 校验 `data/listing.json`
14. `npm run lint`
15. `npm run build:static`
16. `git add data/listing.json`
17. `git commit`
18. `git push origin main`
19. GitHub push 后由 Vercel 自动部署

## 人工兜底逻辑

脚本目标是尽量全自动：

```text
自动打开 PropertyGuru
自动等待页面放行
自动尝试点击常见验证区域
自动检测真实租房页面
自动保存 session
```

如果 Cloudflare / PropertyGuru 当次仍要求人工确认，脚本会停在可见浏览器窗口，用户只需要在浏览器里完成验证。脚本会持续轮询，检测到真实 PropertyGuru 页面后自动继续。

## 可配置环境变量

可在运行前设置：

```bat
set MIN_LISTINGS=100
set PORT=3003
set SCRAPER_PROXY=http://127.0.0.1:7897
set PG_AUTO_TIMEOUT_SECONDS=120
set PG_MANUAL_TIMEOUT_SECONDS=900
set ONECLICK_ALLOW_DIRTY=true
```

常用说明：

- `MIN_LISTINGS`：最低有效房源数，默认 100。
- `SCRAPER_PROXY`：代理地址，不设置时会自动检测 `127.0.0.1:7897` 和 `127.0.0.1:7890`。
- `PG_AUTO_TIMEOUT_SECONDS`：自动验证阶段等待秒数。
- `PG_MANUAL_TIMEOUT_SECONDS`：人工兜底最大等待秒数。
- `ONECLICK_ALLOW_DIRTY=true`：工作区有其他改动时不询问，仍继续，只提交 `data/listing.json`。

## 生成/复用的本地状态

这些文件不会提交到 Git：

```text
data/propertyguru-profile/
data/propertyguru-storage-state.json
data/listing.json.bak
tmp/windows-update-*/
```

## 线上部署关系

Vercel 不跑爬虫。Vercel 只读取 GitHub 仓库里的 `data/listing.json` 静态快照。

```text
Windows 一键脚本更新 data/listing.json
  ↓
git push origin main
  ↓
Vercel 自动重新部署
  ↓
线上网站更新
```
