# WhatsApp Sender

WhatsApp 群发管理工具，包含群组、联系人、标签筛选、定时发送、媒体发送和 AI 文案。网页与 WhatsApp 后台由同一个 Node.js 服务提供。

## 本机使用（Mac）

1. 安装 Node.js LTS 和 Google Chrome。
2. 运行 `npm ci`。
3. 双击桌面的 `WhatsApp Sender.command`，或运行 `npm start`。
4. 打开 <http://localhost:3000>。

本机默认只监听 `127.0.0.1`，不需要网页登录密码。

## 从 GitHub 部署成云端成品（Railway）

这个项目已经包含 `Dockerfile` 和 `railway.toml`。Railway 会从 GitHub 自动构建 Chromium + WhatsApp Sender，并由同一个 HTTPS 网址提供网页和后台。

1. 在 Railway 建立项目，选择 **Deploy from GitHub repo**，仓库选择 `yuhong488-ai/WA`。
2. 给服务增加一个 Volume，挂载路径填写 `/data`。没有这个磁盘，重新部署后会丢失 WhatsApp 登录。
3. 在 Variables 添加：
   - `APP_USERNAME=admin`
   - `APP_PASSWORD=自己设置的长密码`
   - `WHATSAPP_CLIENT_ID=codex-cloud`
   - `RAILWAY_SHM_SIZE_BYTES=268435456`
4. 如果要使用 AI 文案，增加 `AI_PROVIDER=openai` 和 `OPENAI_API_KEY=...`；也可改用 Claude、Gemini 或 DeepSeek 对应的环境变量。
5. 在 Networking 生成公网 Domain。打开该网址，输入第 3 步的账号密码，然后扫描 WhatsApp QR。

首次扫码后，WhatsApp session、群组缓存、排程、预设和上传文件都会保存在 `/data`。服务重新部署后会继续读取该数据。

## 安全设计

- 公开监听时，如果没有设置 `APP_PASSWORD`，服务会拒绝启动，防止群发页面裸露在互联网。
- `/api/health` 仅返回服务状态和群组数量，用于平台健康检查；其他网页、API 与 Socket.IO 都受密码保护。
- API Key、WhatsApp session、缓存、上传和日志均不会提交到 Git。

## 运行数据

可以用 `DATA_DIR` 指定持久目录。云端使用 `/data`，本机不设置时使用项目目录。相关文件包括：

- `wwebjs_auth/`：WhatsApp 登录 session
- `config.json`：本机设置
- `groups_cache.json`：群组/联系人/标签缓存
- `presets.json`、`schedules.json`：预设和排程
- `uploads/`、`error.log`：上传文件和运行日志

## 为什么不是 Vercel 或 GitHub Pages

WhatsApp Web 需要一个长期运行的 Chromium 浏览器、WebSocket 连接和持久磁盘。GitHub Pages 只能托管静态网页；Vercel Functions 会结束执行且本地文件系统不是持久磁盘，无法稳定保存 WhatsApp session。因此本项目保留在 GitHub，并由支持常驻容器与 Volume 的 Railway 运行。
