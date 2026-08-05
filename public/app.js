const socket = io();
let allGroups = [];
let allContacts = [];
let allLabels = [];
let allCommunities = [];
let selectedTargets = [];
let uploadedFiles = [];
let voiceFile = null;
let isSending = false;
let wasConnected = false;

const FAMILY_NAMES = new Set('刘黄陈李张王林吴杨周赵许郑孙何马朱胡江高钟曾邓彭谢萧苏叶吕白方余邱潘廖毛沈曹徐汪范熊姜冯汤钱戴韩侯龙邵罗邢程傅郭蔡梁宋谭魏蒋卢庄游颜严杜雷龚洪贾柯韦秦赖尹孟丁薛阮段纪欧武伍连翁温黎关符应甘袁莫石金安唐康覃卓向易岳文贺俞鲁万田古尤辜冼麦丘左涂祝阳邝陆'.split(''));
const _FAMILY_RE = /[刘黄陈李张王林吴杨周赵许郑孙何马朱胡江高钟曾邓彭谢萧苏叶吕白方余邱潘廖毛沈曹徐汪范熊姜冯汤钱戴韩侯龙邵罗邢程傅郭蔡梁宋谭魏蒋卢庄游颜严杜雷龚洪贾柯韦秦赖尹孟丁薛阮段纪欧武伍连翁温黎关符应甘袁莫石金安唐康覃卓向易岳文贺俞鲁万田古尤辜冼麦丘左涂祝阳邝陆][\u4e00-\u9fff]{1,2}/g;
const _EN_STOP = new Set(['pusat','tuisyen','harapan','group','tution','tuition','center','centre','class','kelas','school','learning','education','good','future','bahasa','math','maths','science','homework','study','belajar','pendidikan','english','malay','chinese']);

function _firstEnglishName(segment) {
    for (const word of segment.split(/\s+/).filter(w => w)) {
        if (/^\d+$/.test(word)) break;
        const letters = (word.match(/^[a-zA-Z]+/) || [])[0];
        if (!letters) break;
        if (_EN_STOP.has(letters.toLowerCase())) continue;
        return letters[0].toUpperCase() + letters.slice(1).toLowerCase();
    }
    return '';
}

function extractDisplayName(groupName) {
    // 1. Chinese name scan
    const cnClean = groupName.replace(/[^\u4e00-\u9fff0-9&\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const cnMatches = cnClean.match(_FAMILY_RE) || [];
    if (cnMatches.length === 1) return cnMatches[0].slice(1);
    if (cnMatches.length > 1) return '';

    // 2. English name scan (fallback)
    const enClean = groupName.replace(/[^a-zA-Z0-9&\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const enNames = enClean.split('&').map(p => _firstEnglishName(p.trim())).filter(n => n);
    return enNames.length === 1 ? enNames[0] : '';
}

// Socket events
socket.on('qr', (qrImage) => {
    document.getElementById('qrContainer').innerHTML = `<img src="${qrImage}" alt="QR Code">`;
    document.getElementById('refreshQrBtn').disabled = false;
    document.getElementById('qrSection').style.display = 'block';
    document.getElementById('mainApp').style.display = 'none';
});

async function refreshQrNow() {
    const button = document.getElementById('refreshQrBtn');
    const container = document.getElementById('qrContainer');
    button.disabled = true;
    container.innerHTML = '<div class="loading">正在刷新二维码...</div>';
    try {
        const response = await fetch('/api/refresh-qr', { method: 'POST' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '刷新失败');
        let attempts = 0;
        const timer = setInterval(async () => {
            attempts++;
            try {
                const qrResponse = await fetch('/api/qr');
                const qrData = await qrResponse.json();
                if (qrData.qr) {
                    clearInterval(timer);
                    container.innerHTML = `<img src="${qrData.qr}" alt="QR Code">`;
                    button.disabled = false;
                } else if (attempts >= 20) {
                    clearInterval(timer);
                    container.innerHTML = '<div class="loading">二维码仍在生成，请再按一次刷新</div>';
                    button.disabled = false;
                }
            } catch {
                if (attempts >= 20) {
                    clearInterval(timer);
                    button.disabled = false;
                }
            }
        }, 1000);
    } catch (error) {
        container.innerHTML = `<div class="loading">${error.message}</div>`;
        button.disabled = false;
    }
}

function togglePairingBox() {
    const form = document.getElementById('pairingForm');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

async function requestPairingCode() {
    const phoneNumber = document.getElementById('pairingPhone').value.trim();
    const button = document.getElementById('pairingBtn');
    const result = document.getElementById('pairingResult');
    button.disabled = true;
    result.textContent = '正在生成...';
    try {
        const response = await fetch('/api/pairing-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '生成失败');
        result.textContent = String(data.code || '').replace(/(.{4})/g, '$1 ').trim();
        document.getElementById('pairingHelp').style.display = 'block';
    } catch (error) {
        result.textContent = error.message;
        document.getElementById('pairingHelp').style.display = 'none';
    } finally {
        button.disabled = false;
    }
}

async function loadLatestQr() {
    try {
        const res = await fetch('/api/qr');
        const data = await res.json();
        if (data.qr) {
            document.getElementById('qrContainer').innerHTML = `<img src="${data.qr}" alt="QR Code">`;
        }
    } catch (e) {
        console.error('loadLatestQr error', e);
    }
}

function applyConnectionStatus(data) {
    const bar = document.getElementById('statusBar');
    if (data.connected) {
        wasConnected = true;
        bar.textContent = `已连接 ✓  ${data.groupCount} 个群组`;
        bar.className = 'status connected';
        document.getElementById('qrSection').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
        document.getElementById('groupCount').textContent = data.groupCount;
        renderPreview();
        updateDailyStats();
        initAI();
        loadPresets();
    } else if (wasConnected) {
        bar.textContent = data.message || 'WhatsApp 正在恢复连接，请稍候...';
        bar.className = 'status disconnected';
        document.getElementById('qrSection').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
        const sendBtn = document.getElementById('sendBtn');
        sendBtn.disabled = true;
        if (!isSending) sendBtn.textContent = '等待 WhatsApp 恢复...';
    } else {
        bar.textContent = data.message || '未连接';
        bar.className = 'status disconnected';
        document.getElementById('qrSection').style.display = 'block';
        document.getElementById('mainApp').style.display = 'none';
    }
}

async function syncConnectionStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        applyConnectionStatus(data);
        if (data.connected) {
            const [groupsRes, contactsRes] = await Promise.all([
                fetch('/api/groups'),
                fetch('/api/contacts')
            ]);
            allGroups = await groupsRes.json();
            allContacts = await contactsRes.json();
            renderGroupsList();
            renderContactsList();
        }
    } catch (e) {
        console.error('syncConnectionStatus error', e);
    }
}

socket.on('status', applyConnectionStatus);

socket.on('groups', (data) => {
    allGroups = data;
    renderGroupsList();
});

socket.on('contacts', (data) => {
    allContacts = data;
    renderContactsList();
});

socket.on('labels', (data) => {
    allLabels = data;
    renderLabelList();
});

socket.on('communities', (data) => {
    allCommunities = data;
    renderCommunityList();
});

socket.on('sendProgress', (data) => {
    const pct = Math.round((data.index / data.total) * 100);
    document.getElementById('progressBar').style.width = pct + '%';
    const log = document.getElementById('progressLog');
    const item = document.createElement('div');
    item.className = `log-item ${data.success ? 'success' : 'fail'}`;
    item.textContent = data.success
        ? `✓ ${data.index}/${data.total} 已发送到「${data.name}」`
        : `✗ ${data.index}/${data.total} 发送失败「${data.name}」：${data.error}`;
    log.prepend(item);
    if (data.todayCount !== undefined) document.getElementById('todayCount').textContent = data.todayCount;
    updateDailyStats();
});

socket.on('sendComplete', (data) => {
    isSending = false;
    document.getElementById('sendBtn').disabled = false;
    document.getElementById('sendBtn').textContent = '立即发送';
    document.getElementById('stopBtn').disabled = false;
    document.getElementById('stopBtn').textContent = '停止发送';
    document.getElementById('stopBtn').style.display = 'none';
    const log = document.getElementById('progressLog');
    const item = document.createElement('div');
    item.className = 'log-item success';
    item.textContent = data.stopped ? `已停止。本次成功发送 ${data.total} 条消息` : `完成！共发送 ${data.total} 条消息`;
    log.prepend(item);
    document.getElementById('todayCount').textContent = data.todayCount;
    updateDailyStats();
    // 发完自动清空列表
    selectedTargets = [];
    renderPreview();
    renderGroupsList();
    renderContactsList();
});

// Daily stats
async function updateDailyStats() {
    const res = await fetch('/api/status');
    const data = await res.json();
    const limit = parseInt(document.getElementById('limitInput').value) || 50;
    document.getElementById('todayCount').textContent = data.todayCount || 0;
    document.getElementById('dailyLimit').textContent = limit;
    document.getElementById('remaining').textContent = Math.max(0, limit - (data.todayCount || 0));
    if (!data.isSending && isSending) {
        isSending = false;
        document.getElementById('sendBtn').disabled = false;
        document.getElementById('sendBtn').textContent = '立即发送';
        document.getElementById('stopBtn').disabled = false;
        document.getElementById('stopBtn').textContent = '停止发送';
        document.getElementById('stopBtn').style.display = 'none';
    }
}

document.getElementById('limitInput').addEventListener('input', updateDailyStats);

// Tab switching
function switchTab(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    document.getElementById('pasteTab').style.display = tab === 'paste' ? 'block' : 'none';
    document.getElementById('browseTab').style.display = tab === 'browse' ? 'block' : 'none';
    document.getElementById('communityTab').style.display = tab === 'community' ? 'block' : 'none';
    document.getElementById('labelTab').style.display = tab === 'label' ? 'block' : 'none';
    document.getElementById('contactsTab').style.display = tab === 'contacts' ? 'block' : 'none';
    document.getElementById('phonesTab').style.display = tab === 'phones' ? 'block' : 'none';
}

// Insert {名字}
function insertName() {
    const ta = document.getElementById('messageInput');
    const pos = ta.selectionStart;
    const val = ta.value;
    ta.value = val.slice(0, pos) + '{名字}' + val.slice(pos);
    ta.focus();
    ta.selectionStart = ta.selectionEnd = pos + 4;
}

// Upload media
async function uploadMedia(input) {
    const files = Array.from(input.files || []);
    if (!files.length) return;
    for (const file of files) {
        await addMediaFile(file);
    }
    input.value = '';
}

async function addMediaFile(file, displayName) {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    uploadedFiles.push({
        filename: data.filename,
        originalname: displayName || data.originalname,
        mimetype: data.mimetype,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : ''
    });
    renderMediaPreview();
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[ch]));
}

function renderMediaPreview() {
    const preview = document.getElementById('mediaPreview');
    const nameBox = document.getElementById('mediaName');
    if (!uploadedFiles.length) {
        preview.style.display = 'none';
        document.getElementById('mediaThumb').style.display = 'none';
        return;
    }
    nameBox.innerHTML = uploadedFiles.map((file, index) => `
        <span class="media-pill">
            ${file.previewUrl ? `<img class="media-thumb-small" src="${file.previewUrl}" alt="">` : '📎'}
            <span class="media-file-name">${escapeHtml(file.originalname)}</span>
            <button class="btn-remove mini-remove" onclick="removeMedia(${index})">x</button>
        </span>
    `).join('');
    document.getElementById('mediaThumb').style.display = 'none';
    document.getElementById('mediaPreview').style.display = 'flex';
}

function removeMedia(index) {
    if (index === undefined) {
        uploadedFiles.forEach(file => fetch(`/api/upload/${file.filename}`, { method: 'DELETE' }));
        uploadedFiles = [];
    } else {
        const file = uploadedFiles[index];
        if (file) fetch(`/api/upload/${file.filename}`, { method: 'DELETE' });
        if (file?.previewUrl) URL.revokeObjectURL(file.previewUrl);
        uploadedFiles.splice(index, 1);
    }
    renderMediaPreview();
}

// Recording
let mediaRecorder = null;
let audioChunks = [];
let recordingInterval = null;
let recordingSeconds = 0;

async function toggleRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        return;
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mimeType = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
            ? 'audio/ogg;codecs=opus'
            : 'audio/webm;codecs=opus';
        mediaRecorder = new MediaRecorder(stream, { mimeType });
        audioChunks = [];
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
        mediaRecorder.onstop = async () => {
            stream.getTracks().forEach(t => t.stop());
            clearInterval(recordingInterval);
            document.getElementById('recordingStatus').style.display = 'none';
            const btn = document.getElementById('recordBtn');
            btn.textContent = '🎤 录音';
            btn.classList.remove('recording');
            if (audioChunks.length === 0) return;
            const ext = mimeType.includes('ogg') ? 'ogg' : 'webm';
            const blob = new Blob(audioChunks, { type: mimeType });
            const formData = new FormData();
            formData.append('file', blob, `recording.${ext}`);
            const res = await fetch('/api/upload', { method: 'POST', body: formData });
            const data = await res.json();
            voiceFile = data.filename;
            const audio = document.getElementById('recordAudio');
            audio.src = URL.createObjectURL(blob);
            audio.style.display = 'inline';
            document.getElementById('voiceName').textContent = `🎤 录音 ${formatSeconds(recordingSeconds)}`;
            document.getElementById('voicePreview').style.display = 'flex';
        };
        mediaRecorder.start(100);
        recordingSeconds = 0;
        document.getElementById('recordingTimer').textContent = '0:00';
        document.getElementById('recordingStatus').style.display = 'flex';
        const btn = document.getElementById('recordBtn');
        btn.textContent = '⏹ 停止';
        btn.classList.add('recording');
        recordingInterval = setInterval(() => {
            recordingSeconds++;
            document.getElementById('recordingTimer').textContent = formatSeconds(recordingSeconds);
        }, 1000);
    } catch (e) {
        alert('无法使用麦克风，请检查浏览器权限');
    }
}

function cancelRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        audioChunks = [];
        mediaRecorder.stop();
    }
    clearInterval(recordingInterval);
    document.getElementById('recordingStatus').style.display = 'none';
    const btn = document.getElementById('recordBtn');
    btn.textContent = '🎤 录音';
    btn.classList.remove('recording');
}

function formatSeconds(s) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

async function uploadVoice(input) {
    const file = input.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    voiceFile = data.filename;
    document.getElementById('voiceName').textContent = `🎤 ${file.name}`;
    document.getElementById('voicePreview').style.display = 'flex';
}

function removeVoice() {
    if (voiceFile) fetch(`/api/upload/${voiceFile}`, { method: 'DELETE' });
    voiceFile = null;
    document.getElementById('voicePreview').style.display = 'none';
    const voiceInput = document.getElementById('voiceInput');
    if (voiceInput) voiceInput.value = '';
    const audio = document.getElementById('recordAudio');
    audio.src = '';
    audio.style.display = 'none';
}

// Ctrl+V paste image
document.addEventListener('paste', async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    let pastedCount = 0;
    for (const item of items) {
        if (item.type.startsWith('image/') || item.type.startsWith('video/') || item.type.startsWith('audio/')) {
            const file = item.getAsFile();
            if (!file) continue;
            const ext = file.type.split('/')[1] || 'file';
            pastedCount++;
            await addMediaFile(file, `粘贴附件 ${pastedCount}.${ext}`);
        }
    }
});

// Match names
async function matchNames() {
    const raw = document.getElementById('namesInput').value;
    const names = raw.split(/[,，\n]/).map(n => n.trim()).filter(n => n);
    if (!names.length) return alert('请先输入名字');

    const res = await fetch('/api/match-names', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names })
    });
    const results = await res.json();
    renderMatchResults(results);
}

function renderMatchResults(results) {
    const container = document.getElementById('matchResults');
    container.innerHTML = '';

    results.forEach((r, i) => {
        const div = document.createElement('div');
        const hasMatch = r.matches.length > 0;
        const isMultiple = r.matches.length > 1;
        div.className = `match-item ${hasMatch ? (isMultiple ? 'multiple' : 'found') : 'not-found'}`;

        let badge = hasMatch
            ? (isMultiple ? `<span class="badge yellow">找到 ${r.matches.length} 个，请选择</span>` : `<span class="badge green">✓ 已匹配</span>`)
            : `<span class="badge red">✗ 未找到</span>`;

        let groupSelector = '';
        if (r.matches.length === 1) {
            groupSelector = `<div class="match-group">群组：${r.matches[0].name}</div>`;
        } else if (r.matches.length > 1) {
            const options = r.matches.map(m => `<option value="${m.id}" data-name="${m.name}">${m.name}</option>`).join('');
            groupSelector = `<div class="match-group">选择群组：<select id="select_${i}" onchange="updateMatchSelection(${i})">${options}</select></div>`;
        }

        div.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center">
                <span class="match-fullname">${r.fullName}</span>${badge}
            </div>
            <div class="match-shortname">
                发送时称呼：<input type="text" id="name_${i}" value="${r.customName}" placeholder="称呼">
                <span style="color:#999;font-size:12px">（可修改）</span>
            </div>
            ${groupSelector}
        `;
        container.appendChild(div);

        // Store match data
        div.dataset.index = i;
        div.dataset.fullname = r.fullName;
        if (r.matches.length === 1) {
            div.dataset.groupId = r.matches[0].id;
            div.dataset.groupName = r.matches[0].name;
        } else if (r.matches.length > 1) {
            div.dataset.groupId = r.matches[0].id;
            div.dataset.groupName = r.matches[0].name;
        }
    });

    // Add to targets button
    const btn = document.createElement('button');
    btn.className = 'btn-primary';
    btn.style.marginTop = '12px';
    btn.textContent = '加入发送列表';
    btn.onclick = () => addMatchesToTargets(results);
    container.appendChild(btn);
}

function updateMatchSelection(i) {
    const select = document.getElementById(`select_${i}`);
    const option = select.options[select.selectedIndex];
    const item = document.querySelector(`[data-index="${i}"]`);
    if (item) {
        item.dataset.groupId = select.value;
        item.dataset.groupName = option.dataset.name;
    }
}

function addMatchesToTargets(results) {
    results.forEach((r, i) => {
        const item = document.querySelector(`[data-index="${i}"]`);
        if (!item || !item.dataset.groupId) return;
        const customName = document.getElementById(`name_${i}`)?.value || r.shortName;
        const target = {
            id: item.dataset.groupId,
            name: item.dataset.groupName,
            displayName: customName
        };
        if (!selectedTargets.find(t => t.id === target.id)) {
            selectedTargets.push(target);
        }
    });
    renderPreview();
}

let lastPhoneResults = [];

async function checkPhones() {
    const input = document.getElementById('phoneInput').value.trim();
    if (!input) return alert('请先粘贴电话号码');

    const btn = document.getElementById('checkPhonesBtn');
    const box = document.getElementById('phoneResults');
    btn.disabled = true;
    btn.textContent = '检查中...';
    box.innerHTML = '<p class="hint">正在检查号码，请等一下...</p>';

    try {
        const res = await fetch('/api/check-phones', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                numbers: input,
                countryCode: document.getElementById('phoneCountry').value
            })
        });
        const data = await res.json();
        if (!res.ok) {
            alert(data.error || '检查失败');
            box.innerHTML = '';
            return;
        }
        lastPhoneResults = data.valid || [];
        renderPhoneResults(data);
    } catch (e) {
        alert('检查号码失败：' + e.message);
        box.innerHTML = '';
    } finally {
        btn.disabled = false;
        btn.textContent = '检查号码';
    }
}

function renderPhoneResults(data) {
    const box = document.getElementById('phoneResults');
    const valid = data.valid || [];
    const invalid = data.invalid || [];
    if (!valid.length && !invalid.length) {
        box.innerHTML = '<p class="hint">没有找到号码。</p>';
        return;
    }

    const validHtml = valid.map((p, i) => {
        const already = selectedTargets.find(t => t.id === p.id);
        return `
            <div class="phone-result-item valid">
                <label><input type="checkbox" class="phone-check" data-index="${i}" ${already ? 'checked disabled' : 'checked'}> +${escapeHtml(p.number)}</label>
                <input type="text" class="inline-name-input phone-name-input" data-index="${i}" placeholder="称呼">
            </div>
        `;
    }).join('');

    const invalidHtml = invalid.map(p => `
        <div class="phone-result-item invalid">
            <span>+${escapeHtml(p.number)}</span>
            <small>${escapeHtml(p.reason || '没有 WhatsApp')}</small>
        </div>
    `).join('');

    box.innerHTML = `
        <div class="phone-summary">有效 ${valid.length} 个，无效 ${invalid.length} 个</div>
        ${validHtml ? `<div class="phone-section-title">可以发送</div>${validHtml}<button class="btn-primary phone-add-btn" onclick="addCheckedPhonesToTargets()">加入发送列表</button>` : ''}
        ${invalidHtml ? `<div class="phone-section-title">不能发送</div>${invalidHtml}` : ''}
    `;
}

function addCheckedPhonesToTargets() {
    let added = 0;
    document.querySelectorAll('.phone-check').forEach(cb => {
        if (!cb.checked || cb.disabled) return;
        const i = Number(cb.getAttribute('data-index'));
        const item = lastPhoneResults[i];
        if (!item || selectedTargets.find(t => t.id === item.id)) return;
        const nameInput = document.querySelector(`.phone-name-input[data-index="${i}"]`);
        selectedTargets.push({
            id: item.id,
            name: `+${item.number}`,
            displayName: nameInput ? nameInput.value.trim() : ''
        });
        cb.disabled = true;
        added++;
    });
    renderPreview();
    if (added) alert(`已加入 ${added} 个电话号码`);
}

function clearPhoneResults() {
    document.getElementById('phoneInput').value = '';
    document.getElementById('phoneResults').innerHTML = '';
    lastPhoneResults = [];
}
// Groups list
function renderGroupsList() {
    const search = document.getElementById('groupSearch').value.toLowerCase();
    const container = document.getElementById('groupsList');
    const filtered = allGroups.filter(g => g.name.toLowerCase().includes(search));
    container.innerHTML = filtered.map(g => {
        const sel = selectedTargets.find(t => t.id === g.id);
        const dispName = sel ? (sel.displayName || '').replace(/"/g, '&quot;') : '';
        return `
        <div class="group-item">
            <input type="checkbox" id="g_${g.id}" value="${g.id}"
                ${sel ? 'checked' : ''}
                onchange="toggleGroup('${g.id}', '${g.name.replace(/'/g, "\\'")}', this.checked)">
            <label for="g_${g.id}">${g.name}</label>
            <input type="text" class="inline-name-input" data-gid="${g.id}" value="${dispName}" placeholder="称呼" ${sel ? '' : 'style="display:none"'}
                oninput="updateTargetName('${g.id}', this.value)">
        </div>
        `;
    }).join('');
}

function filterGroups() { renderGroupsList(); }

function getInputsByGid(id) {
    return Array.from(document.querySelectorAll('.inline-name-input')).filter(el => el.getAttribute('data-gid') === id);
}

function toggleGroup(id, name, checked) {
    if (checked) {
        if (!selectedTargets.find(t => t.id === id)) {
            const autoName = extractDisplayName(name);
            selectedTargets.push({ id, name, displayName: autoName });
            getInputsByGid(id).forEach(el => { el.style.display = ''; el.value = autoName; });
        } else {
            getInputsByGid(id).forEach(el => el.style.display = '');
        }
    } else {
        selectedTargets = selectedTargets.filter(t => t.id !== id);
        getInputsByGid(id).forEach(el => { el.style.display = 'none'; el.value = ''; });
    }
    renderPreview();
}

function selectAll() {
    const search = document.getElementById('groupSearch').value.toLowerCase();
    allGroups.filter(g => g.name.toLowerCase().includes(search)).forEach(g => {
        if (!selectedTargets.find(t => t.id === g.id)) {
            selectedTargets.push({ id: g.id, name: g.name, displayName: extractDisplayName(g.name) });
        }
    });
    renderGroupsList();
    renderPreview();
}

function clearAll() {
    const search = document.getElementById('groupSearch').value.toLowerCase();
    const toRemove = allGroups.filter(g => g.name.toLowerCase().includes(search)).map(g => g.id);
    selectedTargets = selectedTargets.filter(t => !toRemove.includes(t.id));
    renderGroupsList();
    renderPreview();
}

// Preview
function renderPreview() {
    const msg = document.getElementById('messageInput').value;
    const container = document.getElementById('previewList');
    const noTargets = document.getElementById('noTargets');
    const sendBtn = document.getElementById('sendBtn');

    if (selectedTargets.length === 0) {
        container.innerHTML = '';
        noTargets.style.display = 'block';
        sendBtn.disabled = true;
        document.getElementById('targetCount').textContent = '';
        document.getElementById('clearAllBtn').style.display = 'none';
        return;
    }

    noTargets.style.display = 'none';
    sendBtn.disabled = false;
    document.getElementById('targetCount').textContent = `已选择 ${selectedTargets.length} 个`;
    document.getElementById('clearAllBtn').style.display = 'inline-block';

    container.innerHTML = selectedTargets.map((t, i) => {
        const preview = msg.replace(/{名字}/g, t.displayName || '');
        const displayVal = (t.displayName || '').replace(/"/g, '&quot;');
        const hasName = msg.includes('{名字}');
        return `
            <div class="preview-item">
                <div class="preview-top">
                    <span class="name" title="${t.name}">${t.name}</span>
                    ${hasName ? `<input type="text" class="display-name-input" value="${displayVal}" placeholder="称呼"
                        oninput="updateDisplayName(${i}, this.value)"
                        onchange="updateDisplayName(${i}, this.value)">` : ''}
                    <span class="remove-btn" onclick="removeTarget(${i})">×</span>
                </div>
                <div class="msg" id="preview_msg_${i}">${preview || '（无消息内容）'}</div>
            </div>
        `;
    }).join('');
}

function updateDisplayName(i, val) {
    if (!selectedTargets[i]) return;
    selectedTargets[i].displayName = val;
    const msg = document.getElementById('messageInput').value;
    const span = document.getElementById(`preview_msg_${i}`);
    if (span) span.textContent = msg.replace(/{名字}/g, val) || '（无消息内容）';
}

function updateTargetName(id, val) {
    const t = selectedTargets.find(s => s.id === id);
    if (!t) return;
    t.displayName = val;
    const i = selectedTargets.indexOf(t);
    const msg = document.getElementById('messageInput').value;
    const span = document.getElementById(`preview_msg_${i}`);
    if (span) span.textContent = msg.replace(/{名字}/g, val) || '（无消息内容）';
}

function removeTarget(i) {
    selectedTargets.splice(i, 1);
    renderPreview();
    renderGroupsList();
}

function clearAllTargets() {
    if (!confirm(`确定清空全部 ${selectedTargets.length} 个发送对象？`)) return;
    selectedTargets = [];
    renderPreview();
    renderGroupsList();
    renderContactsList();
    renderCommunityList();
    renderLabelList();
}

// Send
async function startSend() {
    if (isSending) return;
    const msg = document.getElementById('messageInput').value.trim();
    if (!msg && uploadedFiles.length === 0 && !voiceFile) return alert('请先输入消息内容');
    if (selectedTargets.length === 0) return alert('请先选择发送对象');

    const confirm = window.confirm(`确认发送给 ${selectedTargets.length} 个群组/联系人？`);
    if (!confirm) return;

    isSending = true;
    document.getElementById('sendBtn').disabled = true;
    document.getElementById('sendBtn').textContent = '发送中...';
    document.getElementById('stopBtn').disabled = false;
    document.getElementById('stopBtn').textContent = '停止发送';
    document.getElementById('stopBtn').style.display = 'block';
    document.getElementById('progressSection').style.display = 'block';
    document.getElementById('progressBar').style.width = '0%';
    document.getElementById('progressLog').innerHTML = '';
    const voiceModeValue = document.getElementById('voiceMode').value === 'voice' ? 'voice' : 'audio';

    try {
        const res = await fetch('/api/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targets: selectedTargets,
                messageTemplate: msg,
                mediaFiles: uploadedFiles,
                voiceFile: voiceFile,
                voiceMode: voiceModeValue,
                minDelay: parseInt(document.getElementById('delayMin').value),
                maxDelay: parseInt(document.getElementById('delayMax').value),
                dailyLimit: parseInt(document.getElementById('limitInput').value)
            })
        });
        const result = await res.json();
        if (!res.ok && result.error) {
            isSending = false;
            document.getElementById('sendBtn').disabled = false;
            document.getElementById('sendBtn').textContent = '立即发送';
            document.getElementById('stopBtn').disabled = false;
            document.getElementById('stopBtn').textContent = '停止发送';
            document.getElementById('stopBtn').style.display = 'none';
            alert(result.error);
            return;
        }
    } catch (e) {
        isSending = false;
        document.getElementById('sendBtn').disabled = false;
        document.getElementById('sendBtn').textContent = '立即发送';
        document.getElementById('stopBtn').disabled = false;
        document.getElementById('stopBtn').textContent = '停止发送';
        document.getElementById('stopBtn').style.display = 'none';
        alert('发送请求失败，请刷新页面后再试');
    }
}

async function stopSend() {
    document.getElementById('stopBtn').disabled = true;
    document.getElementById('stopBtn').textContent = '正在停止...';
    await fetch('/api/stop-send', { method: 'POST' });
    const log = document.getElementById('progressLog');
    const item = document.createElement('div');
    item.className = 'log-item fail';
    item.textContent = '已要求停止，当前这一条完成后会停下';
    log.prepend(item);
}

// Community list
function renderCommunityList() {
    const container = document.getElementById('communityList');
    if (!allCommunities.length) {
        container.innerHTML = '<div class="empty-hint">没有找到社群，或社群资料还在载入中</div>';
        return;
    }
    container.innerHTML = allCommunities.map(comm => {
        const commGroups = allGroups.filter(g => g.communityId === comm.id);
        const allSelected = commGroups.length > 0 && commGroups.every(g => selectedTargets.find(t => t.id === g.id));
        return `
        <div class="section-group">
            <div class="section-header">
                <span class="section-title">📢 ${comm.name}</span>
                <div style="display:flex;gap:6px">
                    <button class="btn-outline" style="padding:4px 10px;font-size:12px" onclick="selectCommunity('${comm.id}')">全选</button>
                    <button class="btn-outline" style="padding:4px 10px;font-size:12px" onclick="clearCommunity('${comm.id}')">清除</button>
                </div>
            </div>
            ${commGroups.map(g => {
                const sel = selectedTargets.find(t => t.id === g.id);
                const dispName = sel ? (sel.displayName || '').replace(/"/g, '&quot;') : '';
                return `
                <div class="group-item" style="padding-left:24px">
                    <input type="checkbox" id="cg_${g.id}" ${sel ? 'checked' : ''}
                        onchange="toggleGroup('${g.id}', '${g.name.replace(/'/g, "\\'")}', this.checked)">
                    <label for="cg_${g.id}">${g.name}</label>
                    <input type="text" class="inline-name-input" data-gid="${g.id}" value="${dispName}" placeholder="称呼" ${sel ? '' : 'style="display:none"'}
                        oninput="updateTargetName('${g.id}', this.value)">
                </div>
                `;
            }).join('') || '<div style="padding:8px 24px;color:#aaa;font-size:13px">此社群没有子群组</div>'}
        </div>`;
    }).join('');

    // Groups not in any community
    const ungrouped = allGroups.filter(g => !g.communityId);
    if (ungrouped.length) {
        container.innerHTML += `
        <div class="section-group">
            <div class="section-header">
                <span class="section-title">💬 其他群组</span>
                <div style="display:flex;gap:6px">
                    <button class="btn-outline" style="padding:4px 10px;font-size:12px" onclick="selectUngrouped()">全选</button>
                    <button class="btn-outline" style="padding:4px 10px;font-size:12px" onclick="clearUngrouped()">清除</button>
                </div>
            </div>
            ${ungrouped.map(g => {
                const sel = selectedTargets.find(t => t.id === g.id);
                const dispName = sel ? (sel.displayName || '').replace(/"/g, '&quot;') : '';
                return `
                <div class="group-item" style="padding-left:24px">
                    <input type="checkbox" id="cg_${g.id}" ${sel ? 'checked' : ''}
                        onchange="toggleGroup('${g.id}', '${g.name.replace(/'/g, "\\'")}', this.checked)">
                    <label for="cg_${g.id}">${g.name}</label>
                    <input type="text" class="inline-name-input" data-gid="${g.id}" value="${dispName}" placeholder="称呼" ${sel ? '' : 'style="display:none"'}
                        oninput="updateTargetName('${g.id}', this.value)">
                </div>
                `;
            }).join('')}
        </div>`;
    }
}

function selectCommunity(commId) {
    allGroups.filter(g => g.communityId === commId).forEach(g => {
        if (!selectedTargets.find(t => t.id === g.id))
            selectedTargets.push({ id: g.id, name: g.name, displayName: extractDisplayName(g.name) });
    });
    renderCommunityList(); renderPreview();
}
function clearCommunity(commId) {
    const ids = allGroups.filter(g => g.communityId === commId).map(g => g.id);
    selectedTargets = selectedTargets.filter(t => !ids.includes(t.id));
    renderCommunityList(); renderPreview();
}
function selectUngrouped() {
    allGroups.filter(g => !g.communityId).forEach(g => {
        if (!selectedTargets.find(t => t.id === g.id))
            selectedTargets.push({ id: g.id, name: g.name, displayName: extractDisplayName(g.name) });
    });
    renderCommunityList(); renderPreview();
}
function clearUngrouped() {
    const ids = allGroups.filter(g => !g.communityId).map(g => g.id);
    selectedTargets = selectedTargets.filter(t => !ids.includes(t.id));
    renderCommunityList(); renderPreview();
}

// Label list
function renderLabelList() {
    const container = document.getElementById('labelList');
    if (!allLabels.length) {
        container.innerHTML = '<div class="empty-hint">没有找到标签（需要 WhatsApp Business）</div>';
        return;
    }
    container.innerHTML = allLabels.map(label => {
        const chatIds = label.chatIds || [];
        const labelGroups = allGroups.filter(g => chatIds.includes(g.id));
        const labelContacts = allContacts.filter(c => chatIds.includes(c.id));
        const all = [...labelGroups, ...labelContacts];
        return `
        <div class="section-group">
            <div class="section-header">
                <span class="section-title">
                    <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${label.color};margin-right:6px;vertical-align:middle"></span>
                    ${label.name}
                </span>
                <div style="display:flex;gap:6px">
                    <button class="btn-outline" style="padding:4px 10px;font-size:12px" onclick="selectLabel('${label.id}')">全选</button>
                    <button class="btn-outline" style="padding:4px 10px;font-size:12px" onclick="clearLabel('${label.id}')">清除</button>
                </div>
            </div>
            ${all.map(item => {
                const sel = selectedTargets.find(t => t.id === item.id);
                const dispName = sel ? (sel.displayName || '').replace(/"/g, '&quot;') : '';
                return `
                <div class="group-item" style="padding-left:24px">
                    <input type="checkbox" id="l_${item.id}" ${sel ? 'checked' : ''}
                        onchange="toggleGroup('${item.id}', '${item.name.replace(/'/g, "\\'")}', this.checked)">
                    <label for="l_${item.id}">${item.name}</label>
                    <input type="text" class="inline-name-input" data-gid="${item.id}" value="${dispName}" placeholder="称呼" ${sel ? '' : 'style="display:none"'}
                        oninput="updateTargetName('${item.id}', this.value)">
                </div>
                `;
            }).join('') || '<div style="padding:8px 24px;color:#aaa;font-size:13px">此标签没有群组或联系人</div>'}
        </div>`;
    }).join('');
}

function selectLabel(labelId) {
    const label = allLabels.find(l => l.id === labelId);
    const chatIds = label?.chatIds || [];
    const items = [
        ...allGroups.filter(g => chatIds.includes(g.id)),
        ...allContacts.filter(c => chatIds.includes(c.id))
    ];
    items.forEach(item => {
        if (!selectedTargets.find(t => t.id === item.id))
            selectedTargets.push({ id: item.id, name: item.name, displayName: extractDisplayName(item.name) });
    });
    renderLabelList();
    renderPreview();
}
function clearLabel(labelId) {
    const label = allLabels.find(l => l.id === labelId);
    const chatIds = label?.chatIds || [];
    const ids = [
        ...allGroups.filter(g => chatIds.includes(g.id)),
        ...allContacts.filter(c => chatIds.includes(c.id))
    ].map(i => i.id);
    selectedTargets = selectedTargets.filter(t => !ids.includes(t.id));
    renderLabelList();
    renderPreview();
}

// Contacts list
function renderContactsList() {
    const search = document.getElementById('contactSearch').value.toLowerCase();
    const container = document.getElementById('contactsList');
    const filtered = allContacts.filter(c => c.name.toLowerCase().includes(search));
    container.innerHTML = filtered.map(c => {
        const sel = selectedTargets.find(t => t.id === c.id);
        const dispName = sel ? (sel.displayName || '').replace(/"/g, '&quot;') : '';
        return `
        <div class="group-item">
            <input type="checkbox" id="c_${c.id}" value="${c.id}"
                ${sel ? 'checked' : ''}
                onchange="toggleContact('${c.id}', '${c.name.replace(/'/g, "\\'")}', this.checked)">
            <label for="c_${c.id}">${c.name} <span style="color:#aaa;font-size:12px">${c.number || ''}</span></label>
            <input type="text" class="inline-name-input" data-gid="${c.id}" value="${dispName}" placeholder="称呼" ${sel ? '' : 'style="display:none"'}
                oninput="updateTargetName('${c.id}', this.value)">
        </div>
        `;
    }).join('') || '<div class="empty-hint">没有找到联系人</div>';
}

function filterContacts() { renderContactsList(); }

function toggleContact(id, name, checked) {
    if (checked) {
        if (!selectedTargets.find(t => t.id === id)) {
            selectedTargets.push({ id, name, displayName: name });
            getInputsByGid(id).forEach(el => { el.style.display = ''; el.value = name; });
        } else {
            getInputsByGid(id).forEach(el => el.style.display = '');
        }
    } else {
        selectedTargets = selectedTargets.filter(t => t.id !== id);
        getInputsByGid(id).forEach(el => { el.style.display = 'none'; el.value = ''; });
    }
    renderPreview();
}

function selectAllContacts() {
    const search = document.getElementById('contactSearch').value.toLowerCase();
    allContacts.filter(c => c.name.toLowerCase().includes(search)).forEach(c => {
        if (!selectedTargets.find(t => t.id === c.id)) {
            selectedTargets.push({ id: c.id, name: c.name, displayName: c.name });
        }
    });
    renderContactsList();
    renderPreview();
}

function clearAllContacts() {
    const search = document.getElementById('contactSearch').value.toLowerCase();
    const toRemove = allContacts.filter(c => c.name.toLowerCase().includes(search)).map(c => c.id);
    selectedTargets = selectedTargets.filter(t => !toRemove.includes(t.id));
    renderContactsList();
    renderPreview();
}

// Listen for message input changes to update preview
document.getElementById('messageInput').addEventListener('input', renderPreview);

// AI Compose
function updateProviderUI() {
    const provider = document.getElementById('aiProvider').value;
    const info = {
        claude:   { placeholder: '填入 Claude API Key (sk-ant-...)',   link: 'https://console.anthropic.com' },
        gemini:   { placeholder: '填入 Gemini API Key',                link: 'https://aistudio.google.com/app/apikey' },
        openai:   { placeholder: '填入 OpenAI API Key (sk-...)',        link: 'https://platform.openai.com/api-keys' },
        deepseek: { placeholder: '填入 DeepSeek API Key (sk-...)',      link: 'https://platform.deepseek.com' },
        codex:    { placeholder: 'Codex CLI 使用本机登录状态，不需要 API Key', link: '' },
    };
    const { placeholder, link } = info[provider] || info.claude;
    const needsKey = provider !== 'codex';
    const keyInput = document.getElementById('apiKeyInput');
    const keyLink = document.getElementById('aiKeyLink');
    const saveBtn = document.getElementById('aiSaveBtn');
    keyInput.placeholder = placeholder;
    keyInput.value = needsKey ? keyInput.value : '';
    keyInput.disabled = !needsKey;
    keyInput.style.display = needsKey ? '' : 'none';
    keyLink.href = link || '#';
    keyLink.style.display = needsKey ? '' : 'none';
    if (saveBtn) saveBtn.textContent = needsKey ? '保存' : '使用 Codex';
}

function setAIConnected(providerName) {
    document.getElementById('aiStatus').textContent = `✓ 已启用 ${providerName}`;
    document.getElementById('aiStatus').style.color = '#25D366';
    const btn = document.getElementById('aiDisconnectBtn');
    if (btn) btn.style.display = 'inline-block';
    document.getElementById('aiSetup').style.display = 'none';
}

function setAIDisconnected() {
    document.getElementById('aiStatus').textContent = '请选择 AI 引擎';
    document.getElementById('aiStatus').style.color = '';
    const btn = document.getElementById('aiDisconnectBtn');
    if (btn) btn.style.display = 'none';
    document.getElementById('aiSetup').style.display = 'flex';
}

async function disconnectAI() {
    await fetch('/api/save-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anthropicApiKey: '', geminiApiKey: '', openaiApiKey: '', deepseekApiKey: '', aiProvider: '' })
    });
    setAIDisconnected();
}

async function initAI() {
    try {
    const res = await fetch('/api/config');
    const data = await res.json();
    if (data.hasAI || data.hasApiKey) {
        const nameMap = { claude: 'Claude', gemini: 'Gemini', openai: 'OpenAI', deepseek: 'DeepSeek', codex: 'Codex CLI' };
        const name = nameMap[data.provider] || data.provider || 'AI';
        if (data.provider && document.getElementById('aiProvider')) {
            document.getElementById('aiProvider').value = data.provider;
            updateProviderUI();
        }
        setAIConnected(name);
    } else {
        setAIDisconnected();
    }
    } catch(e) { console.error('initAI error', e); }
}

async function saveApiKey() {
    const key = document.getElementById('apiKeyInput').value.trim();
    const provider = document.getElementById('aiProvider').value;
    if (provider !== 'codex' && !key) return alert('请输入 API Key，或选择 Codex CLI');
    const keyField = { claude: 'anthropicApiKey', gemini: 'geminiApiKey', openai: 'openaiApiKey', deepseek: 'deepseekApiKey' };
    const body = provider === 'codex' ? { aiProvider: 'codex' } : { [keyField[provider] || 'anthropicApiKey']: key, aiProvider: provider };
    await fetch('/api/save-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const nameMap = { claude: 'Claude', gemini: 'Gemini', openai: 'OpenAI', deepseek: 'DeepSeek', codex: 'Codex CLI' };
    setAIConnected(nameMap[provider] || provider);
    document.getElementById('apiKeyInput').value = '';
}

async function composeWithAI() {
    const prompt = document.getElementById('aiPrompt').value.trim();
    if (!prompt) return alert('请先描述你想说什么');
    const btn = document.getElementById('aiBtn');
    btn.disabled = true;
    btn.textContent = '润色文案中...';
    try {
        const res = await fetch('/api/compose', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt,
                tone: document.getElementById('aiTone').value,
                language: document.getElementById('aiLang').value
            })
        });
        const data = await res.json();
        if (data.error) return alert(data.error);
        document.getElementById('messageInput').value = data.message;
        renderPreview();
    } catch (e) {
        alert('生成失败，请重试');
    } finally {
        btn.disabled = false;
        btn.textContent = '生成消息';
    }
}

// Presets
async function loadPresets() {
    const res = await fetch('/api/presets');
    const data = await res.json();
    renderPresets(data);
}

function renderPresets(data) {
    const container = document.getElementById('presetList');
    if (!data.length) {
        container.innerHTML = '<span class="empty-hint" style="padding:8px 0">还没有保存的组合</span>';
        return;
    }
    container.innerHTML = data.map(p => `
        <div class="preset-tag" onclick="loadPreset('${p.id}')">
            ⭐ ${p.name} <span style="color:#aaa;font-size:11px">(${p.targets.length}个)</span>
            <span class="del" onclick="deletePreset(event,'${p.id}')">×</span>
        </div>
    `).join('');
}

async function savePreset() {
    if (!selectedTargets.length) return alert('请先选择发送对象');
    const name = prompt('请输入组合名称：');
    if (!name) return;
    const res = await fetch('/api/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, targets: selectedTargets })
    });
    const preset = await res.json();
    loadPresets();
}

async function loadPreset(id) {
    const res = await fetch('/api/presets');
    const data = await res.json();
    const preset = data.find(p => p.id === id);
    if (!preset) return;
    preset.targets.forEach(t => {
        if (!selectedTargets.find(s => s.id === t.id)) selectedTargets.push(t);
    });
    renderPreview();
    renderGroupsList();
}

async function deletePreset(e, id) {
    e.stopPropagation();
    if (!confirm('确定删除这个组合？')) return;
    await fetch(`/api/presets/${id}`, { method: 'DELETE' });
    loadPresets();
}

// Schedule
function setMode(mode) {
    document.getElementById('modeNow').classList.toggle('active', mode === 'now');
    document.getElementById('modeSched').classList.toggle('active', mode === 'schedule');
    document.getElementById('scheduleOptions').style.display = mode === 'schedule' ? 'block' : 'none';
    document.getElementById('sendBtn').style.display = mode === 'now' ? 'block' : 'none';
    document.getElementById('scheduleBtn').style.display = mode === 'schedule' ? 'block' : 'none';
    // Set default date to today
    if (mode === 'schedule') {
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('scheduleDate').min = today;
        if (!document.getElementById('scheduleDate').value) {
            document.getElementById('scheduleDate').value = today;
        }
    }
}

async function createSchedule() {
    if (!selectedTargets.length) return alert('请先选择发送对象');
    const msg = document.getElementById('messageInput').value.trim();
    if (!msg && uploadedFiles.length === 0 && !voiceFile) return alert('请先输入消息内容');

    const dateVal = document.getElementById('scheduleDate').value;
    const time = document.getElementById('scheduleTime').value;
    const name = document.getElementById('scheduleName').value || `定时任务 ${dateVal} ${time}`;

    if (!dateVal) return alert('请选择日期');
    const date = new Date(`${dateVal}T${time}:00`);

    if (date <= new Date()) return alert('请选择未来的时间');
    const voiceModeValue = document.getElementById('voiceMode').value === 'voice' ? 'voice' : 'audio';

    await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name,
            scheduledTime: date.toISOString(),
            targets: selectedTargets,
            messageTemplate: msg,
            mediaFiles: uploadedFiles,
            voiceFile: voiceFile,
            voiceMode: voiceModeValue
        })
    });

    alert(`已设定！将在 ${date.toLocaleString()} 发送给 ${selectedTargets.length} 个对象`);
    setMode('now');
    loadSchedules();
}

async function loadSchedules() {
    const res = await fetch('/api/schedules');
    const data = await res.json();
    renderSchedules(data);
}

function renderSchedules(data) {
    const card = document.getElementById('scheduledCard');
    const container = document.getElementById('scheduleList');
    const pending = data.filter(s => s.status !== 'done');
    const done = data.filter(s => s.status === 'done').slice(-3);
    const all = [...pending, ...done];

    if (!all.length) { card.style.display = 'none'; return; }
    card.style.display = 'block';

    container.innerHTML = all.map(s => {
        const time = new Date(s.scheduledTime).toLocaleString('zh', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' });
        const statusText = s.status === 'done' ? '✓ 已发送' : s.status === 'sending' ? '发送中...' : `⏰ ${time}`;
        return `
        <div class="schedule-item ${s.status}">
            <div class="schedule-info">
                <div class="schedule-name">${s.name}</div>
                <div class="schedule-time">${statusText} · ${s.targets.length} 个对象 · ${s.messageTemplate.slice(0,30)}${s.messageTemplate.length>30?'...':''}</div>
            </div>
            ${s.status === 'pending' ? `<button class="btn-remove" onclick="deleteSchedule('${s.id}')">取消</button>` : ''}
        </div>`;
    }).join('');
}

async function deleteSchedule(id) {
    if (!confirm('确定取消这个定时任务？')) return;
    await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
    loadSchedules();
}

socket.on('schedules', renderSchedules);
socket.on('scheduleProgress', (data) => {
    const section = document.getElementById('progressSection');
    const bar = document.getElementById('progressBar');
    const log = document.getElementById('progressLog');
    section.style.display = 'block';
    const pct = Math.round(data.index / data.total * 100);
    bar.style.width = pct + '%';
    const item = document.createElement('div');
    item.className = 'log-item ' + (data.success ? 'success' : 'fail');
    item.textContent = data.success
        ? `✓ 已发送给 ${data.name}（${data.index}/${data.total}）`
        : `✗ 发送失败：${data.name}（${data.index}/${data.total}）`;
    log.prepend(item);
});
socket.on('scheduleComplete', (data) => {
    const log = document.getElementById('progressLog');
    const item = document.createElement('div');
    item.className = 'log-item success';
    item.textContent = `✓ 定时任务「${data.name}」已完成`;
    log.prepend(item);
    loadSchedules();
});

// Refresh groups from WhatsApp
async function refreshGroups() {
    const btn = document.getElementById('refreshBtn');
    if (btn) { btn.disabled = true; btn.textContent = '刷新中...'; }
    try {
        await fetch('/api/refresh', { method: 'POST' });
        // Groups will update via socket.on('groups', ...)
        setTimeout(() => {
            if (btn) { btn.disabled = false; btn.textContent = '刷新群组'; }
        }, 3000);
    } catch (e) {
        if (btn) { btn.disabled = false; btn.textContent = '刷新群组'; }
    }
}

// Show local IP for mobile access
fetch('/api/localip').then(r => r.json()).then(data => {
    document.getElementById('localIP').textContent = data.url;
});

// Initial load
syncConnectionStatus();
updateDailyStats();
loadLatestQr();
initAI();
loadPresets();
loadSchedules();



