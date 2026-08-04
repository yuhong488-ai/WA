# WhatsApp Sender 安装 Agent 指令

你是负责安装和验收 WhatsApp Sender 本地工具的 Codex。请按下面步骤执行，直到工具可用或明确说明卡在哪一步。

## 基本原则

- 先判断当前电脑是 Windows 还是 Mac。
- 不要直接在 zip 里面运行工具。
- 把工具解压或复制到专用文件夹，例如桌面上的 `WhatsApp群发工具`。
- 不要删除用户其他文件。
- 不要关闭用户其他程序；如果需要关闭 Node、Chrome、旧 Sender 或占用 3000 的进程，必须先问用户。
- 不要混用旧版网页和旧版后台。最终启动的必须是当前 zip 里的新版。
- 安装完成不等于验收完成。群组数量必须大于 0，才可以说群组功能正常。

## Windows 安装

1. 检查是否已安装系统版 Node.js LTS。
2. 如果没有 Node.js/npm，请提醒用户安装 Node.js LTS，或打开 Node.js LTS 下载页面。
3. 在工具文件夹里安装依赖。
4. 如果可以，确认 `ffmpeg-static` 是否安装成功。没有它时，文字、电话号码功能仍可用，但音频和语音泡泡不能算验收通过。
5. 使用 `start.vbs` 或 `启动后台.bat` 启动工具。
6. 打开 `http://localhost:3000`。
7. 在桌面创建可用启动快捷方式，之后用户双击这个启动。

## Mac 安装

1. 检查是否已安装系统版 Node.js LTS。
2. 如果没有 Node.js/npm，请提醒用户安装 Node.js LTS，或打开 Node.js LTS 下载页面。
3. 在工具文件夹里安装依赖。
4. 如果可以，确认 `ffmpeg-static` 是否安装成功。没有它时，文字、电话号码功能仍可用，但音频和语音泡泡不能算验收通过。
5. 使用 `启动Mac.command` 启动工具。
6. 必须确认 `.command` 文件可以双击运行：
   - 设置执行权限。
   - 移除 macOS quarantine 标记。
   - 不要只依赖 Codex 沙盒启动后台服务，因为命令结束后服务可能会被系统收掉。
7. 确认 server 监听 `127.0.0.1:3000`。
8. 打开 `http://localhost:3000`。
9. 在桌面创建可用启动文件或快捷方式，并说明用户以后必须双击桌面启动文件。

## Codex CLI 设置

1. 检查是否已安装 Codex CLI。
2. 如果没有安装，且电脑已有 Node.js/npm，可以帮用户安装：
   `npm install -g @openai/codex`
3. 安装后运行：
   `codex --version`
4. 如果需要登录，运行：
   `codex login`
   并打开浏览器让用户完成授权。
5. 登录完成后确认 `codex` 命令可用。
6. Windows 优先寻找：
   `C:\Users\当前用户\AppData\Roaming\npm\codex.cmd`
7. 如果 Codex CLI 可用，请把 WhatsApp Sender 的 AI 提供方设为 `Codex CLI`。
8. 如果无法安装或无法登录，就保留 API Key 方式，不要卡住整个安装。

## 必须验收

完成前必须检查：

1. 网页可以打开 `http://localhost:3000`。
2. WhatsApp 可以登录并显示已连接。
3. 群组数量必须大于 0。
4. “全部群组”列表可以刷出来。
5. “电话号码”tab 可以看到。
6. 发送一条文字到安全测试目标成功。
7. Codex 写文案可以生成一次。
8. 如果 `ffmpeg-static` 已安装，测试普通音频和语音泡泡都可以听。

## 如果群组数量是 0

不要说安装完成。请先检查：

- 是否新版网页配旧版后台。
- 是否多个 Node 进程抢 3000。
- 是否 WhatsApp session、session-codex 或隐藏 Chrome 冲突。
- 是否 `whatsapp-web.js` 的 `getChats()` 出现内部错误 `r`。

必要时运行群组兼容补丁，并再次验证群组数量大于 0。

## 最后回复用户

完成后请告诉用户：

- 工具安装在哪个文件夹。
- 桌面以后要双击哪个启动文件。
- 当前群组数量。
- 电话号码功能是否可见。
- Codex 写文案是否可用。
- 音频/语音泡泡是否验收通过。
