const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const cron = require('node-cron');
const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
const { parsePhoneNumbers } = require('./phone-utils');

const DATA_DIR = path.resolve(process.env.DATA_DIR || __dirname);
fs.mkdirSync(DATA_DIR, { recursive: true });

function dataPath(filename) { return path.join(DATA_DIR, filename); }
function readJson(filename, fallback) {
    try {
        const value = fs.readFileSync(dataPath(filename), 'utf8').replace(/^\uFEFF/, '');
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

const config = readJson('config.json', {});
const envConfig = {
    aiProvider: process.env.AI_PROVIDER,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    geminiApiKey: process.env.GEMINI_API_KEY,
    deepseekApiKey: process.env.DEEPSEEK_API_KEY,
    codexCliPath: process.env.CODEX_CLI_PATH,
    whatsappClientId: process.env.WHATSAPP_CLIENT_ID
};
for (const [key, value] of Object.entries(envConfig)) {
    if (value) config[key] = value;
}
const PORT = Number(process.env.PORT || config.port || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const WA_CLIENT_ID = config.whatsappClientId || 'codex';
const ERROR_LOG = dataPath('error.log');

process.on('uncaughtException', (e) => {
    fs.appendFileSync(ERROR_LOG, `[${new Date().toISOString()}] uncaughtException: ${e.stack}\n`);
    console.error('\u672a\u6355\u83b7\u9519\u8bef\uff08server\u7ee7\u7eed\u8fd0\u884c\uff09\uff1a', e.message);
});
process.on('unhandledRejection', (e) => {
    fs.appendFileSync(ERROR_LOG, `[${new Date().toISOString()}] unhandledRejection: ${e}\n`);
    console.error('\u672a\u5904\u7406\u7684Promise\u9519\u8bef\uff08server\u7ee7\u7eed\u8fd0\u884c\uff09\uff1a', e);
});

function findBrowser() {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const local = process.env['LOCALAPPDATA'] || '';
    const candidates = [
        process.env.PUPPETEER_EXECUTABLE_PATH || '',
        process.env.CHROME_PATH || '',
        `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
        `${pf86}\\Google\\Chrome\\Application\\chrome.exe`,
        local ? `${local}\\Google\\Chrome\\Application\\chrome.exe` : '',
        `${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`,
        `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
        local ? `${local}\\Microsoft\\Edge\\Application\\msedge.exe` : '',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
    ].filter(Boolean);
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            console.log('\u627e\u5230\u6d4f\u89c8\u5668\uff1a' + p);
            return p;
        }
    }
    console.error('\u627e\u4e0d\u5230\u6d4f\u89c8\u5668\uff01\u8bf7\u5b89\u88c5 Chrome \u6216 Edge\u3002');
    return null;
}
let anthropicClient = null;
let geminiClient = null;
let openaiClient = null;
const DEFAULT_CODEX_CLI = path.join(process.env.APPDATA || '', 'npm', process.platform === 'win32' ? 'codex.cmd' : 'codex');
const DEFAULT_CODEX_JS = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');

function getCodexCliPath() {
    return config.codexCliPath || (fs.existsSync(DEFAULT_CODEX_CLI) ? DEFAULT_CODEX_CLI : 'codex');
}

function getCodexCommand() {
    if (config.codexCliPath) {
        return {
            command: config.codexCliPath,
            argsPrefix: [],
            shell: process.platform === 'win32' && config.codexCliPath.toLowerCase().endsWith('.cmd')
        };
    }
    if (fs.existsSync(DEFAULT_CODEX_JS)) {
        return { command: process.execPath, argsPrefix: [DEFAULT_CODEX_JS], shell: false };
    }
    return { command: getCodexCliPath(), argsPrefix: [], shell: process.platform === 'win32' };
}

function runCodexCli(prompt) {
    return new Promise((resolve, reject) => {
        const outputFile = path.join(os.tmpdir(), `whatsapp-codex-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
        const codex = getCodexCommand();
        const args = [
            'exec',
            '--skip-git-repo-check',
            '--ephemeral',
            '--sandbox', 'read-only',
            '--color', 'never',
            '-o', outputFile,
            '-'
        ];
        const child = spawn(codex.command, [...codex.argsPrefix, ...args], {
            cwd: __dirname,
            windowsHide: true,
            shell: codex.shell
        });
        let stderr = '';
        let stdout = '';
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error('Codex CLI \u751f\u6210\u8d85\u65f6\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5'));
        }, 180000);

        child.stdout.on('data', data => { stdout += data.toString(); });
        child.stderr.on('data', data => { stderr += data.toString(); });
        child.on('error', err => {
            clearTimeout(timer);
            reject(err);
        });
        child.on('close', code => {
            clearTimeout(timer);
            try {
                const text = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8').trim() : stdout.trim();
                if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
                if (code !== 0) {
                    reject(new Error((stderr || stdout || `Codex CLI exited with code ${code}`).trim()));
                    return;
                }
                if (!text) {
                    reject(new Error('Codex CLI \u6ca1\u6709\u8fd4\u56de\u5185\u5bb9'));
                    return;
                }
                resolve(text);
            } catch (err) {
                reject(err);
            }
        });
        child.stdin.end(prompt);
    });
}

function initAI() {
    anthropicClient = null; geminiClient = null; openaiClient = null;
    const p = config.aiProvider;
    if (p === 'gemini' && config.geminiApiKey) {
        geminiClient = new GoogleGenerativeAI(config.geminiApiKey);
    } else if (p === 'openai' && config.openaiApiKey) {
        openaiClient = new OpenAI({ apiKey: config.openaiApiKey });
    } else if (p === 'deepseek' && config.deepseekApiKey) {
        openaiClient = new OpenAI({ apiKey: config.deepseekApiKey, baseURL: 'https://api.deepseek.com' });
    } else if (config.anthropicApiKey) {
        anthropicClient = new Anthropic.default({ apiKey: config.anthropicApiKey });
        if (!p) config.aiProvider = 'claude';
    }
}
initAI();

let schedules = readJson('schedules.json', []);
let presets = readJson('presets.json', []);

function saveSchedules() { fs.writeFileSync(dataPath('schedules.json'), JSON.stringify(schedules, null, 2)); }

function convertToOgg(inputPath) {
    return new Promise((resolve, reject) => {
        const outputPath = inputPath.replace(/\.[^.]+$/, '.voice.ogg');
        ffmpeg(inputPath)
            .setFfmpegPath(ffmpegPath)
            .audioCodec('libopus')
            .audioChannels(1)
            .audioFrequency(48000)
            .audioBitrate('32k')
            .outputOptions(['-application voip'])
            .format('ogg')
            .on('end', () => resolve(outputPath))
            .on('error', reject)
            .save(outputPath);
    });
}

async function createVoiceMedia(inputPath) {
    const filePath = await convertToMp3(inputPath);
    const media = MessageMedia.fromFilePath(filePath);
    media.mimetype = 'audio/mpeg';
    media.filename = 'voice.mp3';
    return media;
}

function convertToMp3(inputPath) {
    return new Promise((resolve, reject) => {
        const outputPath = inputPath.replace(/\.[^.]+$/, '.audio.mp3');
        ffmpeg(inputPath)
            .setFfmpegPath(ffmpegPath)
            .audioCodec('libmp3lame')
            .audioChannels(1)
            .audioFrequency(44100)
            .audioBitrate('96k')
            .format('mp3')
            .on('end', () => resolve(outputPath))
            .on('error', reject)
            .save(outputPath);
    });
}

async function createPlayableAudioMedia(inputPath) {
    const filePath = await convertToMp3(inputPath);
    const media = MessageMedia.fromFilePath(filePath);
    media.mimetype = 'audio/mpeg';
    media.filename = 'audio.mp3';
    return media;
}

async function sendVoiceByMode(target, filePath, mode, prefix = '') {
    const voiceMode = mode === 'voice' ? 'voice' : 'audio';
    if (voiceMode === 'audio') {
        const audioMedia = await createPlayableAudioMedia(filePath);
        const sentAudio = await sendWithTimeout(target.id, audioMedia, { waitUntilMsgSent: true });
        console.log(`  \uD83C\uDFA4 ${prefix}\u97f3\u9891\u5df2\u4e0a\u4f20\uff1a${target.name} ${sentAudio?.id?._serialized || ''}`);
    }
    if (voiceMode === 'voice') {
        const voiceMedia = await createVoiceMedia(filePath);
        const sentVoice = await sendWithTimeout(target.id, voiceMedia, { sendAudioAsVoice: true, waitUntilMsgSent: true });
        console.log(`  \uD83C\uDFA4 ${prefix}\u8bed\u97f3\u6ce1\u6ce1\u5df2\u4e0a\u4f20\uff1a${target.name} ${sentVoice?.id?._serialized || ''}`);
    }
}
function savePresets() { fs.writeFileSync(dataPath('presets.json'), JSON.stringify(presets, null, 2)); }
function saveGroupsCache() {
    if (!groups.length) {
        console.log('群组为空，不覆盖已有群组缓存');
        return;
    }
    fs.writeFileSync(dataPath('groups_cache.json'), JSON.stringify({ groups, contacts, labels, communities }, null, 2));
}

const app = express();
const server = http.createServer(app);
const APP_USERNAME = process.env.APP_USERNAME || 'admin';
const APP_PASSWORD = process.env.APP_PASSWORD || '';

function safeEqual(left, right) {
    const a = Buffer.from(String(left));
    const b = Buffer.from(String(right));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isAuthorized(req) {
    if (!APP_PASSWORD) return true;
    const authorization = req.headers.authorization || '';
    if (!authorization.startsWith('Basic ')) return false;
    try {
        const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
        const separator = decoded.indexOf(':');
        if (separator < 0) return false;
        return safeEqual(decoded.slice(0, separator), APP_USERNAME)
            && safeEqual(decoded.slice(separator + 1), APP_PASSWORD);
    } catch {
        return false;
    }
}

const io = new Server(server, {
    allowRequest: (req, callback) => callback(null, isAuthorized(req))
});

app.use(express.json());
app.get('/api/health', (req, res) => res.json({
    ok: true,
    whatsappConnected: isReady,
    groupCount: groups.length
}));
app.use((req, res, next) => {
    if (isAuthorized(req)) return next();
    res.set('WWW-Authenticate', 'Basic realm="WhatsApp Sender", charset="UTF-8"');
    return res.status(401).send('需要登录 WhatsApp Sender');
});
app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));

const groupsCache = readJson('groups_cache.json', null);

io.on('connection', (socket) => {
    if (isReady) {
        socket.emit('status', { connected: true, groupCount: groups.length });
        socket.emit('groups', groups);
        socket.emit('contacts', contacts);
        socket.emit('labels', labels);
        socket.emit('communities', Object.values(communities));
    } else if (groupsCache) {
        socket.emit('status', { connected: false, message: '\u8fde\u63a5\u4e2d\uff0c\u663e\u793a\u4e0a\u6b21\u7fa4\u7ec4...' });
        socket.emit('groups', groupsCache.groups || []);
        socket.emit('contacts', groupsCache.contacts || []);
        socket.emit('labels', groupsCache.labels || []);
        socket.emit('communities', groupsCache.communities || []);
    } else {
        socket.emit('status', { connected: false, message: '正在生成二维码...' });
    }
    if (!isReady && lastQrImage) {
        socket.emit('qr', lastQrImage);
    }
});

const uploadDir = dataPath('uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

const browserPath = findBrowser();
const WWEBJS_AUTH_DIR = dataPath('wwebjs_auth');

function clearChromiumProfileLocks() {
    if (!fs.existsSync(WWEBJS_AUTH_DIR)) return;
    const lockNames = new Set(['SingletonLock', 'SingletonSocket', 'SingletonCookie']);
    const pending = [WWEBJS_AUTH_DIR];
    while (pending.length) {
        const current = pending.pop();
        let entries = [];
        try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
        for (const entry of entries) {
            const entryPath = path.join(current, entry.name);
            if (lockNames.has(entry.name)) {
                try { fs.unlinkSync(entryPath); } catch {}
            } else if (entry.isDirectory()) {
                pending.push(entryPath);
            }
        }
    }
}

clearChromiumProfileLocks();
const client = new Client({
    authStrategy: new LocalAuth({ clientId: WA_CLIENT_ID, dataPath: WWEBJS_AUTH_DIR }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-quic'],
        protocolTimeout: 300000,
        ...(browserPath ? { executablePath: browserPath } : {})
    }
});

let isReady = false;
let isSendingNow = false;
let stopSendingRequested = false;
let groups = [];
let contacts = [];
let labels = [];
let communities = {};
let sendCount = { date: '', count: 0 };
let lastQrImage = null;
let contactStats = {};
let isInitializing = false;

async function cleanupClientAfterFailure() {
    try {
        if (client.pupBrowser) await client.pupBrowser.close();
    } catch {}
    try {
        await client.destroy();
    } catch {}
}

async function getChatsWithCompatibilityFallback() {
    try {
        return await client.getChats();
    } catch (error) {
        console.log('getChats 兼容模式已启用：', error?.message || String(error));
        return client.pupPage.evaluate(() => {
            const chatCollection = window.require('WAWebCollections').Chat;
            return chatCollection.getModelsArray().map((chat) => {
                try {
                    const id = chat.id?._serialized || chat.id?.toString?.();
                    if (!id || !id.endsWith('@g.us')) return null;
                    const metadata = chat.groupMetadata;
                    const parent = metadata?.parentGroup;
                    const parentId = parent?._serialized || parent?.toString?.() || null;
                    let title = chat.formattedTitle || chat.name || '';
                    if (!title && typeof chat.title === 'function') {
                        const resolvedTitle = chat.title();
                        if (resolvedTitle && resolvedTitle !== '未知标题') title = resolvedTitle;
                    }
                    if (!title) title = `群组名称未同步 · ${id.split('@')[0].slice(-6)}`;
                    return {
                        id: { _serialized: id },
                        name: title,
                        formattedTitle: title,
                        isGroup: true,
                        labels: Array.isArray(chat.labels) ? chat.labels : [],
                        groupMetadata: metadata ? {
                            isParentGroup: Boolean(metadata.isParentGroup),
                            isCommunity: Boolean(metadata.isCommunity),
                            parentGroup: parentId ? { _serialized: parentId } : null,
                            announce: Boolean(metadata.announce)
                        } : null
                    };
                } catch {
                    return null;
                }
            }).filter(Boolean);
        });
    }
}

async function getChatsAfterSync(maxAttempts = 6) {
    let chats = [];
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            chats = await getChatsWithCompatibilityFallback();
            if (chats.length) return chats;
            console.log(`WhatsApp 已连接但对话尚未同步（${attempt}/${maxAttempts}），5 秒后重试...`);
        } catch (error) {
            lastError = error;
            console.log(`读取对话失败（${attempt}/${maxAttempts}）：${error?.message || String(error)}`);
        }
        if (attempt < maxAttempts) await new Promise(resolve => setTimeout(resolve, 5000));
    }
    if (lastError && !chats.length) throw lastError;
    return chats;
}

async function getContactsWithCompatibilityFallback() {
    return client.pupPage.evaluate(() => {
        const contactCollection = window.require('WAWebCollections').Contact;
        return contactCollection.getModelsArray().map((contact) => {
            try {
                const id = contact.phoneNumber?._serialized || contact.id?._serialized || contact.id?.toString?.();
                if (!id || id.endsWith('@g.us')) return null;
                const number = contact.number || contact.phoneNumber?.user || contact.id?.user || '';
                const name = contact.name || contact.pushname || contact.shortName || contact.verifiedName || number;
                if (!name && !number) return null;
                return {
                    id: { _serialized: id },
                    name,
                    pushname: contact.pushname || '',
                    shortName: contact.shortName || '',
                    number,
                    isGroup: false,
                    isMyContact: Boolean(contact.isMyContact)
                };
            } catch {
                return null;
            }
        }).filter(Boolean);
    });
}

function initializeClient() {
    if (isInitializing || isReady) return;
    if (client.pupBrowser?.connected && client.pupPage && !client.pupPage.isClosed()) {
        console.log('WhatsApp 隐藏浏览器仍在运行，不重复启动');
        return;
    }
    isInitializing = true;
    clearChromiumProfileLocks();
    client.initialize().catch(async (e) => {
        const message = e?.message || String(e);
        fs.appendFileSync(ERROR_LOG, `[${new Date().toISOString()}] initialize failed: ${e?.stack || message}\n`);
        console.error('WhatsApp 初始化失败，15 秒后重试：', message);
        io.emit('status', { connected: false, message: 'WhatsApp 连接失败，正在自动重试...' });
        await cleanupClientAfterFailure();
        setTimeout(initializeClient, 15000);
    }).finally(() => {
        isInitializing = false;
    });
}

function getTodayCount() {
    const today = new Date().toISOString().split('T')[0];
    if (sendCount.date !== today) {
        sendCount = { date: today, count: 0 };
    }
    return sendCount.count;
}

function incrementCount() {
    const today = new Date().toISOString().split('T')[0];
    if (sendCount.date !== today) sendCount = { date: today, count: 0 };
    sendCount.count++;
}

function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} 超时`)), ms))
    ]);
}

function isWhatsAppPageError(error) {
    const message = error?.message || String(error);
    return /detached Frame|Execution context was destroyed|Target closed|Session closed|Protocol error|页面尚未恢复/i.test(message);
}

async function waitForWhatsAppPageReady(timeoutMs = 45000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const page = client.pupPage;
            if (page && !page.isClosed()) {
                const ready = await withTimeout(page.evaluate(() => {
                    const socket = window.require?.('WAWebSocketModel')?.Socket;
                    return document.readyState === 'complete'
                        && typeof window.WWebJS !== 'undefined'
                        && socket?.state === 'CONNECTED'
                        && socket?.hasSynced === true;
                }), 5000, '检查 WhatsApp 页面');
                if (ready) {
                    if (!isReady) {
                        isReady = true;
                        io.emit('status', { connected: true, groupCount: groups.length, message: 'WhatsApp 已恢复连接' });
                    }
                    return;
                }
            }
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 1500));
    }
    throw new Error('WhatsApp 页面尚未恢复');
}

async function sleepWithStop(ms) {
    const step = 500;
    let elapsed = 0;
    while (elapsed < ms && !stopSendingRequested) {
        const wait = Math.min(step, ms - elapsed);
        await new Promise(resolve => setTimeout(resolve, wait));
        elapsed += wait;
    }
}

async function sendWithTimeout(targetId, content, options = {}) {
    let lastError;
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            await waitForWhatsAppPageReady();
            return await withTimeout(client.sendMessage(targetId, content, options), 60000, 'WhatsApp 发送');
        } catch (error) {
            if (!isWhatsAppPageError(error)) throw error;
            lastError = error;
            isReady = false;
            io.emit('status', { connected: false, message: `WhatsApp 页面刷新中，等待恢复（${attempt}/2）...` });
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }
    throw lastError || new Error('WhatsApp 页面尚未恢复');
}

client.on('qr', async (qr) => {
    const qrImage = await QRCode.toDataURL(qr, {
        width: 480,
        margin: 4,
        errorCorrectionLevel: 'M'
    });
    lastQrImage = qrImage;
    io.emit('qr', qrImage);
});

client.on('authenticated', () => {
    lastQrImage = null;
    io.emit('status', { connected: false, message: '\u9a8c\u8bc1\u6210\u529f\uff0c\u6b63\u5728\u8fde\u63a5...' });
});

client.on('ready', handleClientReady);

async function handleClientReady() {
    if (isReady) return;
    const previousGroups = groups;
    const previousContacts = contacts;
    const previousLabels = labels;
    const previousCommunities = communities;
    isReady = true;
    lastQrImage = null;
    io.emit('status', { connected: true, groupCount: 0 });
    console.log('\u5df2\u8fde\u63a5\uff01\u6b63\u5728\u8f7d\u5165\u7fa4\u7ec4...');
    try {
        const chats = await getChatsAfterSync();
        console.log(`getChats \u8fd4\u56de ${chats.length} \u4e2a\u5bf9\u8bdd`);
        if (!chats.length) {
            const cachedGroups = previousGroups.length ? previousGroups : (groupsCache?.groups || []);
            if (cachedGroups.length) {
                groups = cachedGroups;
                contacts = previousContacts.length ? previousContacts : (groupsCache?.contacts || []);
                labels = previousLabels.length ? previousLabels : (groupsCache?.labels || []);
                communities = Object.keys(previousCommunities).length ? previousCommunities : (groupsCache?.communities || {});
                io.emit('status', { connected: true, groupCount: groups.length, message: '已连接，等待 WhatsApp 完成同步' });
                io.emit('groups', groups);
                io.emit('contacts', contacts);
                io.emit('labels', labels);
                io.emit('communities', Object.values(communities));
                console.log(`本次对话为空，保留 ${groups.length} 个已有群组`);
                return;
            }
            throw new Error('WhatsApp 已连接但对话仍未同步');
        }
        groups = chats
            .filter(c => (c.isGroup || c.id?._serialized?.endsWith('@g.us')) && !c.groupMetadata?.isParentGroup && !c.groupMetadata?.isCommunity)
            .map(g => ({
                id: g.id._serialized,
                name: g.name,
                labels: g.labels || [],
                communityId: g.groupMetadata?.parentGroup?._serialized || null
            }))
            .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
        io.emit('status', { connected: true, groupCount: groups.length });
        io.emit('groups', groups);
        console.log(`\u627e\u5230 ${groups.length} \u4e2a\u7fa4\u7ec4\uff0c\u6b63\u5728\u8f7d\u5165\u8054\u7cfb\u4eba...`);

        let allContacts = [];
        try {
            allContacts = await withTimeout(getContactsWithCompatibilityFallback(), 20000, '读取联系人');
            if (!allContacts.length && groupsCache?.contacts?.length) {
                console.log('本次联系人为空，保留上次联系人缓存');
                allContacts = groupsCache.contacts.map(c => ({
                    ...c,
                    id: { _serialized: c.id }
                }));
            }
        } catch (e) {
            console.log('读取联系人失败，尝试保留上次缓存：', e.message);
            if (groupsCache?.contacts?.length) {
                allContacts = groupsCache.contacts.map(c => ({
                    ...c,
                    id: { _serialized: c.id }
                }));
            }
        }
        contactStats = {
            chats: chats.length,
            nonGroupChats: chats.filter(c => !c.isGroup && !c.id?._serialized?.endsWith('@g.us')).length,
            allContacts: allContacts.length,
            myContacts: allContacts.filter(c => c.isMyContact).length,
            nonGroupContacts: allContacts.filter(c => !c.isGroup && !c.id?._serialized?.endsWith('@g.us')).length
        };
        console.log('联系人诊断：' + JSON.stringify(contactStats));
        const contactMap = new Map();
        const addContact = (c) => {
            const id = c.id?._serialized;
            if (!id || c.isGroup || id.endsWith('@g.us')) return;
            const number = c.number || c.id?.user || '';
            const name = c.name || c.pushname || c.shortName || number;
            if (!name && !number) return;
            contactMap.set(id, { id, name, number });
        };
        allContacts.forEach(addContact);
        chats.filter(c => !c.isGroup && !c.id?._serialized?.endsWith('@g.us')).forEach(addContact);
        contacts = Array.from(contactMap.values())
            .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
        io.emit('contacts', contacts);
        console.log(`\u627e\u5230 ${contacts.length} \u4e2a\u8054\u7cfb\u4eba\uff0c\u6b63\u5728\u8f7d\u5165\u6807\u7b7e\u548c\u793e\u7fa4...`);

        // Load labels (WhatsApp Business)
        try {
            const allLabels = await client.getLabels();
            labels = [];
            for (const l of allLabels) {
                const directGroupIds = groups
                    .filter(g => (g.labels || []).some(labelId => String(labelId) === String(l.id)))
                    .map(g => g.id);
                try {
                    const labelChats = await client.getChatsByLabelId(l.id);
                    const chatIds = [...new Set([
                        ...labelChats.map(c => c.id._serialized),
                        ...directGroupIds
                    ])];
                    labels.push({ id: l.id, name: l.name, color: l.hexColor || '#25D366', chatIds });
                } catch {
                    labels.push({ id: l.id, name: l.name, color: l.hexColor || '#25D366', chatIds: directGroupIds });
                }
            }
            io.emit('labels', labels);
            console.log(`\u627e\u5230 ${labels.length} \u4e2a\u6807\u7b7e`);
        } catch (e) {
            console.log('\u65e0\u6cd5\u8f7d\u5165\u6807\u7b7e\uff1a', e.message);
        }

        // Load communities
        try {
            const communityChats = chats.filter(c =>
                c.isGroup && (c.groupMetadata?.isParentGroup || c.groupMetadata?.isCommunity)
            );
            communities = {};
            communityChats.forEach(cg => {
                communities[cg.id._serialized] = { id: cg.id._serialized, name: cg.name };
            });
            // Match subgroups to communities
            chats.filter(c => c.isGroup && c.groupMetadata?.parentGroup).forEach(g => {
                const parentId = g.groupMetadata.parentGroup._serialized || g.groupMetadata.parentGroup;
                if (!communities[parentId]) {
                    communities[parentId] = { id: parentId, name: '\u672a\u547d\u540d\u793e\u7fa4' };
                }
            });
            // Update groups with communityId
            groups = groups.map(g => {
                const chat = chats.find(c => c.id._serialized === g.id);
                const parentId = chat?.groupMetadata?.parentGroup?._serialized || chat?.groupMetadata?.parentGroup || null;
                return { ...g, communityId: parentId };
            });
            io.emit('groups', groups);
            io.emit('communities', Object.values(communities));
            console.log(`\u627e\u5230 ${Object.keys(communities).length} \u4e2a\u793e\u7fa4`);
        } catch (e) {
            console.log('\u8f7d\u5165\u793e\u7fa4\u5931\u8d25\uff1a', e.message);
        }

        saveGroupsCache();
        console.log('\u7fa4\u7ec4\u7f13\u5b58\u5df2\u4fdd\u5b58');

    } catch (e) {
        fs.appendFileSync(ERROR_LOG, `[${new Date().toISOString()}] ready load failed: ${e?.stack || e?.message || String(e)}\n`);
        console.error('\u8f7d\u5165\u5931\u8d25\uff0c\u4f7f\u7528\u4e0a\u6b21\u7fa4\u7ec4\u7f13\u5b58\uff1a', e.message);
        if (groupsCache?.groups?.length) {
            groups = groupsCache.groups || [];
            contacts = groupsCache.contacts || [];
            labels = groupsCache.labels || [];
            communities = groupsCache.communities || [];
            isReady = true;
            io.emit('status', { connected: true, groupCount: groups.length, message: '\u5df2\u8fde\u63a5\uff0c\u4f7f\u7528\u4e0a\u6b21\u7fa4\u7ec4\u7f13\u5b58' });
            io.emit('groups', groups);
            io.emit('contacts', contacts);
            io.emit('labels', labels);
            io.emit('communities', Object.values(communities));
        } else {
            isReady = false;
            groups = [];
            contacts = [];
            io.emit('status', { connected: false, message: '\u8f7d\u5165\u5931\u8d25\uff0c\u6b63\u5728\u81ea\u52a8\u91cd\u542f...' });
            await cleanupClientAfterFailure();
            setTimeout(initializeClient, 5000);
        }
    }
}

// whatsapp-web.js can miss the sync event when a saved session reconnects
// before its event bridge is attached. Detect that healthy state and finish
// initialization so the UI does not remain stuck on an expired QR screen.
setInterval(async () => {
    if (isReady || !client.pupPage) return;
    try {
        const state = await client.pupPage.evaluate(() => {
            const socket = window.require?.('WAWebSocketModel')?.Socket;
            return {
                connected: socket?.state === 'CONNECTED' && socket?.hasSynced === true,
                injected: typeof window.WWebJS !== 'undefined'
            };
        });
        if (state.connected && state.injected) {
            console.log('检测到已恢复的 WhatsApp 登录，继续载入群组...');
            await handleClientReady();
        }
    } catch {}
}, 5000);

client.on('disconnected', (reason) => {
    isReady = false;
    console.log(`WhatsApp 已断开（${reason || '未知原因'}），保留当前隐藏浏览器等待恢复`);
    io.emit('status', { connected: false, message: 'WhatsApp 暂时断开，正在等待恢复...' });
});

app.post('/api/compose', async (req, res) => {
    if (config.aiProvider !== 'codex' && !anthropicClient && !geminiClient && !openaiClient) return res.status(400).json({ error: '\u8bf7\u5148\u9009\u62e9 Codex CLI\uff0c\u6216\u5728\u8bbe\u7f6e\u4e2d\u586b\u5165 API Key' });
    const { prompt, tone, language } = req.body;
    if (!prompt) return res.status(400).json({ error: '\u8bf7\u8f93\u5165\u63cf\u8ff0' });

    const systemPrompt = `\u4f60\u662f\u4e00\u4e2a\u64c5\u957f\u5199 WhatsApp \u7fa4\u53d1\u6587\u6848\u7684\u4e2d\u6587\u52a9\u624b\u3002
\u8bed\u6c14\uff1a${tone || '\u53cb\u5584\u4e13\u4e1a'}
\u8bed\u8a00\uff1a${language || '\u4e2d\u6587'}
\u8981\u6c42\uff1a
- \u5199\u5f97\u81ea\u7136\u3001\u6e05\u695a\u3001\u6709\u6e29\u5ea6\uff0c\u50cf\u771f\u4eba\u53d1\u7ed9\u7fa4\u7ec4\u7684\u6d88\u606f
- \u4e0d\u8981\u592a\u957f\uff0c\u4f18\u5148 1 \u5230 3 \u6bb5\uff0c\u9002\u5408\u76f4\u63a5\u590d\u5236\u5230 WhatsApp
- emoji \u8981\u9002\u91cf\uff0c\u53ea\u5728\u5408\u9002\u7684\u4f4d\u7f6e\u52a0\u5165\uff0c\u4e0d\u8981\u5806\u6ee1
- \u5982\u679c\u9700\u8981\u4e2a\u6027\u5316\u540d\u5b57\uff0c\u7528 {\u540d\u5b57} \u4ee3\u66ff
- \u4fdd\u7559\u7528\u6237\u7ed9\u51fa\u7684\u65f6\u95f4\u3001\u5730\u70b9\u3001\u91d1\u989d\u3001\u65e5\u671f\u7b49\u5173\u952e\u4fe1\u606f
- \u76f4\u63a5\u8f93\u51fa\u6700\u7ec8\u6d88\u606f\u5185\u5bb9\uff0c\u4e0d\u8981\u52a0\u89e3\u91ca\u3001\u6807\u9898\u6216\u5f15\u53f7`;

    try {
        let text;
        if (config.aiProvider === 'codex') {
            text = await runCodexCli(`${systemPrompt}\n\n\u7528\u6237\u8981\u53d1\u7684\u6d88\u606f\u5185\u5bb9\uff1a${prompt}`);
        } else if (anthropicClient) {
            const result = await anthropicClient.messages.create({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 1024,
                system: systemPrompt,
                messages: [{ role: 'user', content: prompt }]
            });
            text = result.content[0].text.trim();
        } else if (geminiClient) {
            const model = geminiClient.getGenerativeModel({ model: 'gemini-1.5-flash' });
            const result = await model.generateContent(systemPrompt + '\n\n\u7528\u6237\u8981\u53d1\u7684\u6d88\u606f\u5185\u5bb9\uff1a' + prompt);
            text = result.response.text().trim();
        } else if (openaiClient) {
            const result = await openaiClient.chat.completions.create({
                model: config.aiProvider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt }
                ]
            });
            text = result.choices[0].message.content.trim();
        }
        res.json({ message: text });
    } catch (e) {
        console.error('AI \u751f\u6210\u5931\u8d25\uff1a', e.message);
        res.status(500).json({ error: 'AI \u751f\u6210\u5931\u8d25\uff1a' + e.message });
    }
});

app.post('/api/save-config', (req, res) => {
    const { anthropicApiKey, geminiApiKey, openaiApiKey, deepseekApiKey, aiProvider } = req.body;
    const setOrDel = (key, val) => { if (val !== undefined) { if (val === '') delete config[key]; else config[key] = val; } };
    setOrDel('anthropicApiKey', anthropicApiKey);
    setOrDel('geminiApiKey', geminiApiKey);
    setOrDel('openaiApiKey', openaiApiKey);
    setOrDel('deepseekApiKey', deepseekApiKey);
    if (aiProvider !== undefined) config.aiProvider = aiProvider || undefined;
    fs.writeFileSync(dataPath('config.json'), JSON.stringify(config, null, 2));
    initAI();
    res.json({ success: true });
});

app.get('/api/config', (req, res) => {
    const hasKey = !!(config.anthropicApiKey || config.geminiApiKey || config.openaiApiKey || config.deepseekApiKey);
    const provider = config.aiProvider || (config.anthropicApiKey ? 'claude' : config.geminiApiKey ? 'gemini' : config.openaiApiKey ? 'openai' : config.deepseekApiKey ? 'deepseek' : 'codex');
    res.json({ hasApiKey: hasKey, hasAI: hasKey || provider === 'codex', provider });
});

app.get('/api/localip', (req, res) => {
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    let ip = 'localhost';
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                ip = net.address;
                break;
            }
        }
    }
    res.json({ ip, url: `http://${ip}:${PORT}` });
});

app.get('/api/status', (req, res) => {
    res.json({ connected: isReady, groupCount: groups.length, todayCount: getTodayCount(), hasQr: !!lastQrImage, isSending: isSendingNow });
});

app.get('/api/qr', (req, res) => {
    res.json({ qr: lastQrImage });
});

app.post('/api/pairing-code', async (req, res) => {
    if (isReady) return res.status(400).json({ error: 'WhatsApp 已连接，无需生成连接码' });
    const phoneNumber = String(req.body?.phoneNumber || '').replace(/\D/g, '');
    if (!/^\d{8,15}$/.test(phoneNumber)) {
        return res.status(400).json({ error: '请输入含国家代码的手机号，例如 60123456789' });
    }
    if (!client.pupPage) {
        return res.status(503).json({ error: 'WhatsApp 正在启动，请稍后再试' });
    }
    try {
        const code = await withTimeout(
            client.requestPairingCode(phoneNumber, true, 180000),
            30000,
            '生成连接码'
        );
        res.json({ code });
    } catch (error) {
        res.status(500).json({ error: '生成连接码失败：' + (error?.message || String(error)) });
    }
});

app.post('/api/refresh-qr', async (req, res) => {
    if (isReady) return res.json({ ok: true, connected: true });
    if (!client.pupPage) {
        return res.status(503).json({ error: 'WhatsApp 正在启动，请稍后再试' });
    }
    try {
        lastQrImage = null;
        await withTimeout(client.pupPage.evaluate(() => {
            if (window.codeInterval) {
                clearInterval(window.codeInterval);
                window.codeInterval = undefined;
            }
            window.require('WAWebLaunchSocketUtils').refreshQR();
            Promise.resolve(
                window.require('WAWebAltDeviceLinkingApi').initializeQRLinking()
            ).catch(() => {});
            return true;
        }), 10000, '刷新二维码');
        io.emit('status', { connected: false, message: '正在生成新二维码...' });
        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ error: '刷新二维码失败：' + (error?.message || String(error)) });
    }
});

app.get('/api/groups', (req, res) => res.json(groups));
app.get('/api/contacts', (req, res) => res.json(contacts));
app.get('/api/contact-stats', (req, res) => res.json(contactStats));

app.post('/api/refresh', async (req, res) => {
    if (!isReady) return res.status(400).json({ error: '\u672a\u8fde\u63a5' });
    res.json({ message: '\u6b63\u5728\u5237\u65b0' });
    try {
        const chats = await getChatsWithCompatibilityFallback();
        console.log(`\u5237\u65b0: getChats \u8fd4\u56de ${chats.length} \u4e2a\u5bf9\u8bdd`);
        groups = chats
            .filter(c => (c.isGroup || c.id?._serialized?.endsWith('@g.us')) && !c.groupMetadata?.isParentGroup && !c.groupMetadata?.isCommunity)
            .map(g => ({
                id: g.id._serialized,
                name: g.name,
                labels: g.labels || [],
                communityId: g.groupMetadata?.parentGroup?._serialized || null
            }))
            .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
        io.emit('groups', groups);
        io.emit('status', { connected: true, groupCount: groups.length });
        console.log(`\u5237\u65b0\u5b8c\u6210\uff0c\u627e\u5230 ${groups.length} \u4e2a\u7fa4\u7ec4`);
    } catch (e) {
        console.error('\u5237\u65b0\u5931\u8d25\uff1a', e.message);
    }
});

app.post('/api/match-names', (req, res) => {
    const { names } = req.body;
    if (!names) return res.json([]);
    const results = names
        .filter(n => n.trim())
        .map(fullName => {
            const name = fullName.trim();
            const shortName = name.length >= 3 ? name.slice(1) : name;
            const groupMatches = groups
                .filter(g => g.name.includes(name) || g.name.includes(shortName))
                .map(g => ({ ...g, type: 'group' }));
            const contactMatches = contacts
                .filter(c => c.name.includes(name) || c.name.includes(shortName))
                .map(c => ({ ...c, type: 'contact' }));
            const matches = [...groupMatches, ...contactMatches];
            return { fullName: name, shortName, customName: shortName, matches, selectedMatch: matches.length === 1 ? matches[0] : null };
        });
    res.json(results);
});

app.post('/api/check-phones', async (req, res) => {
    if (!isReady) return res.status(400).json({ error: 'WhatsApp 未连接' });
    const numbers = parsePhoneNumbers(req.body.numbers || '', req.body.countryCode || '60');
    if (!numbers.length) return res.json({ valid: [], invalid: [] });

    const valid = [];
    const invalid = [];
    for (const number of numbers.slice(0, 300)) {
        try {
            const numberId = await withTimeout(client.getNumberId(number), 30000, '检查号码');
            if (numberId && numberId._serialized) {
                valid.push({ id: numberId._serialized, number, name: `+${number}`, displayName: '' });
            } else {
                invalid.push({ number, reason: '没有 WhatsApp' });
            }
        } catch (e) {
            invalid.push({ number, reason: e?.message || '检查失败' });
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }

    res.json({ valid, invalid, total: numbers.length, checked: Math.min(numbers.length, 300) });
});

app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: '\u6ca1\u6709\u6587\u4ef6' });
    res.json({ filename: req.file.filename, originalname: req.file.originalname, mimetype: req.file.mimetype });
});

app.delete('/api/upload/:filename', (req, res) => {
    const filePath = path.join(uploadDir, req.params.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ success: true });
});

app.post('/api/stop-send', (req, res) => {
    if (!isSendingNow) return res.json({ success: true, message: '当前没有发送任务' });
    stopSendingRequested = true;
    res.json({ success: true, message: '已请求停止，当前这一条完成后会停下' });
});

app.post('/api/send', async (req, res) => {
    if (!isReady) return res.status(400).json({ error: 'WhatsApp \u672a\u8fde\u63a5' });
    if (isSendingNow) return res.status(400).json({ error: '\u6b63\u5728\u53d1\u9001\u4e2d\uff0c\u8bf7\u7b49\u5f85\u5b8c\u6210\u540e\u518d\u8bd5' });
    const { targets, messageTemplate, mediaFile, mediaFiles, voiceFile, voiceMode = 'audio', minDelay = 5, maxDelay = 10, dailyLimit = 50 } = req.body;
    const attachedFiles = Array.isArray(mediaFiles) ? mediaFiles : (mediaFile ? [{ filename: mediaFile }] : []);
    if (!targets || targets.length === 0) return res.status(400).json({ error: '\u6ca1\u6709\u9009\u62e9\u53d1\u9001\u5bf9\u8c61' });

    const todayCount = getTodayCount();
    if (todayCount >= dailyLimit) {
        return res.status(400).json({ error: `\u4eca\u5929\u5df2\u53d1\u9001 ${todayCount} \u6761\uff0c\u5df2\u8fbe\u5230\u6bcf\u65e5\u4e0a\u9650 ${dailyLimit} \u6761` });
    }

    const remaining = dailyLimit - todayCount;
    const actualTargets = targets.slice(0, remaining);

    res.json({ message: '\u5f00\u59cb\u53d1\u9001', total: actualTargets.length });

    isSendingNow = true;
    stopSendingRequested = false;
    (async () => {
        let sentCount = 0;
        try {
            for (let i = 0; i < actualTargets.length; i++) {
                if (stopSendingRequested) break;
                const target = actualTargets[i];
                const message = messageTemplate.replace(/\{\u540d\u5b57\}/g, target.displayName || '');

                try {
                    if (attachedFiles.length) {
                        for (let fileIndex = 0; fileIndex < attachedFiles.length; fileIndex++) {
                            const attached = attachedFiles[fileIndex];
                            const filePath = path.join(uploadDir, attached.filename || attached);
                            const media = MessageMedia.fromFilePath(filePath);
                            const isLastMedia = fileIndex === attachedFiles.length - 1;
                            const canUseCaption = !voiceFile && isLastMedia && message;
                            await sendWithTimeout(target.id, media, canUseCaption ? { caption: message } : {});
                        }
                    }
                    if (voiceFile) {
                        let filePath = path.join(uploadDir, voiceFile);
                        await sendVoiceByMode(target, filePath, voiceMode);
                        if (message) await sendWithTimeout(target.id, message);
                    } else if (!attachedFiles.length) {
                        await sendWithTimeout(target.id, message);
                    }
                    incrementCount();
                    sentCount++;
                    io.emit('sendProgress', { index: i + 1, total: actualTargets.length, name: target.name, success: true, todayCount: getTodayCount() });
                } catch (e) {
                    const errMsg = e?.message || String(e);
                    fs.appendFileSync(ERROR_LOG, `[${new Date().toISOString()}] sendMessage failed: ${e?.stack || errMsg}\n`);
                    io.emit('sendProgress', { index: i + 1, total: actualTargets.length, name: target.name, success: false, error: errMsg });
                    if (isWhatsAppPageError(e)) {
                        stopSendingRequested = true;
                        io.emit('status', { connected: false, message: 'WhatsApp 页面刷新/断线，已停止本次发送' });
                        break;
                    }
                }

                if (i < actualTargets.length - 1) {
                    const delay = (Math.random() * (maxDelay - minDelay) + minDelay) * 1000;
                    await sleepWithStop(delay);
                }
            }
            io.emit('sendComplete', { total: sentCount, stopped: stopSendingRequested, todayCount: getTodayCount() });
        } finally {
            isSendingNow = false;
            stopSendingRequested = false;
        }
    })();
});

// Presets API
app.get('/api/presets', (req, res) => res.json(presets));

app.post('/api/presets', (req, res) => {
    const { name, targets } = req.body;
    if (!name || !targets) return res.status(400).json({ error: '\u7f3a\u5c11\u540d\u79f0\u6216\u6536\u4ef6\u4eba' });
    const preset = { id: Date.now().toString(), name, targets, createdAt: new Date().toISOString() };
    presets.push(preset);
    savePresets();
    res.json(preset);
});

app.delete('/api/presets/:id', (req, res) => {
    presets = presets.filter(p => p.id !== req.params.id);
    savePresets();
    res.json({ success: true });
});

// Schedules API
app.get('/api/schedules', (req, res) => res.json(schedules));

app.post('/api/schedules', (req, res) => {
    const { name, scheduledTime, targets, messageTemplate, mediaFile, mediaFiles, voiceFile, voiceMode = 'audio' } = req.body;
    const attachedFiles = Array.isArray(mediaFiles) ? mediaFiles : (mediaFile ? [{ filename: mediaFile }] : []);
    if (!scheduledTime || !targets) return res.status(400).json({ error: '\u7f3a\u5c11\u5fc5\u8981\u8d44\u6599' });
    if (!messageTemplate && attachedFiles.length === 0 && !voiceFile) return res.status(400).json({ error: '\u8bf7\u5148\u8f93\u5165\u6d88\u606f\u5185\u5bb9' });
    const schedule = {
        id: Date.now().toString(),
        name: name || '\u5b9a\u65f6\u4efb\u52a1',
        scheduledTime,
        targets,
        messageTemplate,
        mediaFile: mediaFile || null,
        mediaFiles: attachedFiles,
        voiceFile: voiceFile || null,
        voiceMode,
        status: 'pending',
        createdAt: new Date().toISOString()
    };
    schedules.push(schedule);
    saveSchedules();
    io.emit('schedules', schedules);
    res.json(schedule);
});

app.delete('/api/schedules/:id', (req, res) => {
    schedules = schedules.filter(s => s.id !== req.params.id);
    saveSchedules();
    io.emit('schedules', schedules);
    res.json({ success: true });
});

// Scheduler - check every minute
cron.schedule('* * * * *', async () => {
    if (!isReady || isSendingNow) return;
    const now = new Date();
    const due = schedules.filter(s => s.status === 'pending' && new Date(s.scheduledTime) <= now);
    for (const task of due) {
        if (isSendingNow) break;
        task.status = 'sending';
        isSendingNow = true;
        stopSendingRequested = false;
        io.emit('schedules', schedules);
        console.log(`\u6267\u884c\u5b9a\u65f6\u4efb\u52a1\uff1a${task.name}\uff0c\u5171 ${task.targets.length} \u4e2a\u5bf9\u8c61`);
        let successCount = 0;
        try {
            for (let i = 0; i < task.targets.length; i++) {
                if (stopSendingRequested) break;
                const target = task.targets[i];
                const message = task.messageTemplate.replace(/\{\u540d\u5b57\}/g, target.displayName || '');
                try {
                    const attachedFiles = Array.isArray(task.mediaFiles)
                        ? task.mediaFiles
                        : (task.mediaFile ? [{ filename: task.mediaFile }] : []);
                    if (attachedFiles.length) {
                        for (let fileIndex = 0; fileIndex < attachedFiles.length; fileIndex++) {
                            const attached = attachedFiles[fileIndex];
                            const filePath = path.join(uploadDir, attached.filename || attached);
                            if (!fs.existsSync(filePath)) continue;
                            const media = MessageMedia.fromFilePath(filePath);
                            const isLastMedia = fileIndex === attachedFiles.length - 1;
                            const canUseCaption = !task.voiceFile && isLastMedia && message;
                            await sendWithTimeout(target.id, media, canUseCaption ? { caption: message } : {});
                        }
                    }
                    if (task.voiceFile) {
                        let filePath = path.join(uploadDir, task.voiceFile);
                        if (fs.existsSync(filePath)) {
                            await sendVoiceByMode(target, filePath, task.voiceMode || 'audio', '\u5b9a\u65f6');
                            if (message) await sendWithTimeout(target.id, message);
                        } else {
                            await sendWithTimeout(target.id, message);
                        }
                    } else if (!attachedFiles.length) {
                        await sendWithTimeout(target.id, message);
                    }
                    incrementCount();
                    successCount++;
                    console.log(`  \u2713 \u53d1\u9001\u6210\u529f\uff1a${target.name} (${i + 1}/${task.targets.length})`);
                    io.emit('scheduleProgress', { taskId: task.id, index: i + 1, total: task.targets.length, name: target.name, success: true });
                } catch (e) {
                    console.error(`  \u2717 \u53d1\u9001\u5931\u8d25\uff1a${target.name} - ${e.message}`);
                    io.emit('scheduleProgress', { taskId: task.id, index: i + 1, total: task.targets.length, name: target.name, success: false, error: e.message });
                    if (isWhatsAppPageError(e)) {
                        stopSendingRequested = true;
                        io.emit('status', { connected: false, message: 'WhatsApp 页面刷新/断线，已停止定时发送' });
                        break;
                    }
                }
                if (i < task.targets.length - 1) {
                    const delay = (Math.random() * 5 + 5) * 1000;
                    await sleepWithStop(delay);
                }
            }
            task.status = stopSendingRequested ? 'stopped' : 'done';
            saveSchedules();
            io.emit('schedules', schedules);
            console.log(`\u5b9a\u65f6\u4efb\u52a1\u5b8c\u6210\uff1a${task.name}\uff0c\u6210\u529f ${successCount}/${task.targets.length}`);
            io.emit('scheduleComplete', { taskId: task.id, name: task.name, successCount, total: task.targets.length });
        } finally {
            isSendingNow = false;
            stopSendingRequested = false;
        }
    }
});

if ((HOST === '0.0.0.0' || HOST === '::') && !APP_PASSWORD && process.env.ALLOW_INSECURE_PUBLIC !== 'true') {
    console.error('拒绝公开启动：请先设置 APP_PASSWORD，或明确设置 ALLOW_INSECURE_PUBLIC=true。');
    process.exit(1);
}

server.listen(PORT, HOST, () => {
    const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
    console.log(`打开浏览器访问：http://${displayHost}:${PORT}`);
    console.log(`数据目录：${DATA_DIR}`);
});

if (process.env.DISABLE_WHATSAPP !== 'true') initializeClient();

let shuttingDown = false;
async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal}：正在安全关闭 WhatsApp Sender...`);
    const forceExit = setTimeout(() => process.exit(1), 10000);
    forceExit.unref();
    try { await client.destroy(); } catch {}
    server.close(() => process.exit(0));
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));



