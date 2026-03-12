document.addEventListener('DOMContentLoaded', () => {
    // ---------------------------------------------------------------
    // DOM References
    // ---------------------------------------------------------------
    const fetchBtn = document.getElementById('fetch-models-btn');
    const startBtn = document.getElementById('start-service-btn');
    const stopBtn = document.getElementById('stop-service-btn');
    const modelSelect = document.getElementById('model-select');
    const ollamaUrlInput = document.getElementById('ollama-url');

    const kaliCommandType = document.getElementById('kali-command-type');
    const toolsConfigSection = document.getElementById('tools-config-section');

    const statusBadge = document.getElementById('status-badge');
    const statusText = statusBadge.querySelector('.status-text');
    const alertsContainer = document.getElementById('alerts-container');

    const configPanel = document.getElementById('config-panel');
    const liveLogPanel = document.getElementById('live-log-panel');
    const liveLogViewer = document.getElementById('live-log-viewer');
    const toolsBadge = document.getElementById('service-tools-badge');

    // Chat Console UI
    const chatConsoleBar = document.getElementById('chat-console-bar');
    const chatPromptInput = document.getElementById('chat-prompt-input');
    const sendPromptBtn = document.getElementById('chat-send-btn');
    const cancelPromptBtn = document.getElementById('chat-cancel-btn');

    let _eventSource = null;
    let _serviceRunning = false;
    let _chatBusy = false;

    // ---------------------------------------------------------------
    // Vertical Tab Navigation
    // ---------------------------------------------------------------
    const navBtns = document.querySelectorAll('.nav-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');
    const navChatBtn = document.getElementById('nav-chat-btn');

    function switchTab(targetPaneId) {
        // Update nav buttons
        navBtns.forEach(btn => {
            if (btn.getAttribute('data-target') === targetPaneId) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
        // Show target pane
        tabPanes.forEach(pane => {
            if (pane.id === targetPaneId) {
                pane.classList.add('active');
            } else {
                pane.classList.remove('active');
            }
        });
    }

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.disabled) return;
            switchTab(btn.getAttribute('data-target'));
        });
    });

    // Toggle tools config visibility
    kaliCommandType.addEventListener('change', (e) => {
        toolsConfigSection.style.display = e.target.value === 'apt' ? 'none' : 'block';
    });
    kaliCommandType.dispatchEvent(new Event('change'));

    // ---------------------------------------------------------------
    // Utility Alerts & Status
    // ---------------------------------------------------------------
    const showAlert = (message, type = 'error') => {
        const alertEl = document.createElement('div');
        alertEl.className = `alert alert-${type}`;
        const icon = type === 'error' ? 'ph-warning-circle' : 'ph-check-circle';
        alertEl.innerHTML = `<i class="ph ${icon}"></i> <span>${message}</span>`;
        alertsContainer.innerHTML = '';
        alertsContainer.appendChild(alertEl);
        setTimeout(() => {
            alertEl.style.opacity = '0';
            setTimeout(() => alertEl.remove(), 300);
        }, 5000);
    };

    const updateStatus = (state, message) => {
        statusBadge.classList.remove('hidden', 'success', 'error', 'running');
        if (state === 'success') {
            statusBadge.classList.add('success');
            statusText.textContent = message || 'Completed';
        } else if (state === 'error') {
            statusBadge.classList.add('error');
            statusText.textContent = message || 'Error';
        } else if (state === 'running') {
            statusBadge.classList.add('running');
            statusText.textContent = message || 'Running…';
        } else {
            statusText.textContent = message || 'Idle';
        }
    };

    // ---------------------------------------------------------------
    // Tools Config JSON
    // ---------------------------------------------------------------
    const toolCheckboxes = document.querySelectorAll('.tool-checkbox');
    const toolsJsonArea = document.getElementById('kali-tools-json');

    function updateToolsJson() {
        const selectedTools = [];
        toolCheckboxes.forEach(cb => {
            if (cb.checked) {
                selectedTools.push({ name: cb.value, command: cb.dataset.cmd, args: ["{args}"], allow_args: true });
            }
        });
        try {
            const currentJson = JSON.parse(toolsJsonArea.value || '{"tools": []}');
            currentJson.tools = selectedTools;
            toolsJsonArea.value = JSON.stringify(currentJson, null, 2);
        } catch (e) {
            toolsJsonArea.value = JSON.stringify({ tools: selectedTools }, null, 2);
        }
    }
    toolCheckboxes.forEach(cb => cb.addEventListener('change', updateToolsJson));
    updateToolsJson();

    // ---------------------------------------------------------------
    // Fetch Models
    // ---------------------------------------------------------------
    fetchBtn.addEventListener('click', async () => {
        const url = ollamaUrlInput.value.trim();
        if (!url) { showAlert('Please enter an Ollama Instance URL'); return; }

        const icon = fetchBtn.querySelector('i');
        icon.classList.add('spin');
        fetchBtn.disabled = true;

        try {
            const response = await fetch('/api/models', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            const data = await response.json();

            if (data.success) {
                modelSelect.innerHTML = '';
                if (data.models.length === 0) {
                    modelSelect.innerHTML = '<option value="" disabled selected>No models found</option>';
                    modelSelect.disabled = true;
                    startBtn.disabled = true;
                    showAlert('No models found in the specified Ollama instance.', 'error');
                } else {
                    data.models.forEach(model => {
                        const option = document.createElement('option');
                        option.value = model;
                        option.textContent = model;
                        modelSelect.appendChild(option);
                    });
                    modelSelect.disabled = false;
                    startBtn.disabled = false;
                    showAlert(`Successfully fetched ${data.models.length} models.`, 'success');
                }
            } else { throw new Error(data.error || 'Failed to fetch models'); }
        } catch (error) {
            showAlert(error.message);
            modelSelect.innerHTML = '<option value="" disabled selected>Failed to load models</option>';
            modelSelect.disabled = true;
            startBtn.disabled = true;
        } finally {
            icon.classList.remove('spin');
            fetchBtn.disabled = false;
        }
    });

    // ---------------------------------------------------------------
    // Log Helpers
    // ---------------------------------------------------------------
    function appendLog(html, cssClass = '') {
        const entry = document.createElement('div');
        entry.className = `log-entry ${cssClass}`;
        entry.innerHTML = html;
        liveLogViewer.appendChild(entry);
        liveLogViewer.scrollTop = liveLogViewer.scrollHeight;
    }
    function clearLog() { liveLogViewer.innerHTML = ''; }
    function closeSse() {
        if (_eventSource) { _eventSource.close(); _eventSource = null; }
    }

    // ---------------------------------------------------------------
    // Start Service
    // ---------------------------------------------------------------
    startBtn.addEventListener('click', async () => {
        const url = ollamaUrlInput.value.trim();
        const model = modelSelect.value;
        const cmdType = kaliCommandType.value;
        const extraArgs = document.getElementById('kali-args').value.trim();
        const contextWindow = parseInt(document.getElementById('context-window').value, 10);

        let command = '';
        if (cmdType === 'python') {
            command = 'uv run --with mcp mcp_kali.py';
        } else if (cmdType === 'apt') {
            command = 'python3 apt_logger_wrapper.py';
        }
        if (extraArgs) command += ' ' + extraArgs;

        let toolsConfig = null;
        if (cmdType !== 'apt') {
            try { toolsConfig = JSON.parse(toolsJsonArea.value); }
            catch (e) { showAlert('Invalid JSON formatting in kali_tools.json editor.', 'error'); return; }
        }

        if (!model || !command) return;

        setConfigEnabled(false);
        startBtn.querySelector('i').classList.remove('ph-power');
        startBtn.querySelector('i').classList.add('ph-spinner-gap', 'spin');
        startBtn.disabled = true;
        updateStatus('running', 'Starting service…');

        clearLog();
        liveLogPanel.style.display = 'flex';
        appendLog('<i class="ph ph-spinner-gap spin"></i> Launching MCP service…', 'log-status');

        try {
            const response = await fetch('/api/session/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, model, server_command: command, tools_config: toolsConfig, context_window: contextWindow })
            });
            const data = await response.json();

            if (data.success) {
                _serviceRunning = true;
                if (data.tools && data.tools.length) {
                    toolsBadge.textContent = `${data.tools.length} tool(s): ${data.tools.join(', ')}`;
                    toolsBadge.style.display = 'inline-block';
                }
                updateStatus('running', 'Service Running');
                startBtn.style.display = 'none';
                stopBtn.style.display = 'inline-flex';
                // Enable Chat Tab and switch to it
                navChatBtn.disabled = false;
                switchTab('chat-pane');
                
                // Show Console UI
                chatConsoleBar.classList.remove('hidden');

                openSseStream();
                showAlert('Service started! Use the Prompt console to chat.', 'success');
                setTimeout(() => chatPromptInput.focus(), 500);
            } else { throw new Error(data.error || 'Failed to start service'); }
        } catch (error) {
            console.error('Start error:', error);
            updateStatus('error', 'Start Failed');
            showAlert(error.message);
            setConfigEnabled(true);
            resetStartBtn();
        }
    });

    function resetStartBtn() {
        startBtn.querySelector('i').classList.remove('ph-spinner-gap', 'spin');
        startBtn.querySelector('i').classList.add('ph-power');
        startBtn.disabled = false;
        startBtn.style.display = 'inline-flex';
    }

    function setConfigEnabled(enabled) {
        const inputs = configPanel.querySelectorAll('input, select, textarea, button');
        inputs.forEach(el => {
            if (el.id === 'start-service-btn' || el.id === 'stop-service-btn') return;
            
            if (enabled) {
                el.removeAttribute('data-service-disabled');
                el.disabled = el.hasAttribute('data-originally-disabled');
            } else {
                if (el.disabled) el.setAttribute('data-originally-disabled', '');
                el.setAttribute('data-service-disabled', '');
                el.disabled = true;
            }
        });
        configPanel.classList.toggle('config-disabled', !enabled);
    }

    // ---------------------------------------------------------------
    // SSE Stream
    // ---------------------------------------------------------------
    function openSseStream() {
        closeSse();
        _eventSource = new EventSource('/api/session/stream');
        _eventSource.onmessage = (ev) => {
            try {
                const event = JSON.parse(ev.data);
                renderEvent(event);
                if (event.type === 'done') { closeSse(); handleServiceStopped(); }
            } catch (err) {}
        };
        _eventSource.onerror = () => {
            closeSse();
            if (_serviceRunning) {
                appendLog('<span class="log-label">⚠️</span> SSE connection lost. Reconnecting…', 'log-status');
                setTimeout(() => { if (_serviceRunning) openSseStream(); }, 2000);
            }
        };
    }

    // ---------------------------------------------------------------
    // Send Chat
    // ---------------------------------------------------------------
    sendPromptBtn.addEventListener('click', sendChat);
    chatPromptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendChat();
        }
    });

    async function sendChat() {
        const prompt = chatPromptInput.value.trim();
        if (!prompt || _chatBusy || !_serviceRunning) return;

        _chatBusy = true;
        chatPromptInput.value = '';
        
        chatPromptInput.disabled = true;
        
        sendPromptBtn.disabled = true;
        const sendIcon = sendPromptBtn.querySelector('i');
        if (sendIcon) sendIcon.className = 'ph ph-spinner-gap spin';
        
        cancelPromptBtn.style.display = 'flex';
        cancelPromptBtn.disabled = false;

        appendLog(`<span class="log-label">👤 You</span> ${escapeHtml(prompt)}`, 'log-prompt');

        try {
            const response = await fetch('/api/session/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt })
            });
            const data = await response.json();
            if (!data.success) {
                appendLog(`<span class="log-label">❌ Error</span> ${escapeHtml(data.error || 'Chat failed.')}`, 'log-error');
            }
        } catch (error) {
            appendLog(`<span class="log-label">❌ Error</span> ${escapeHtml(error.message)}`, 'log-error');
            setChatReady();
        }
    }

    function setChatReady() {
        _chatBusy = false;
        
        const sendIcon = sendPromptBtn.querySelector('i');
        if (sendIcon) sendIcon.className = 'ph ph-paper-plane-tilt';

        cancelPromptBtn.style.display = 'none';

        if (_serviceRunning) {
            chatPromptInput.disabled = false;
            sendPromptBtn.disabled = false;
            chatPromptInput.focus();
        }
    }

    cancelPromptBtn.addEventListener('click', async () => {
        if (!_chatBusy || !_serviceRunning) return;
        
        cancelPromptBtn.disabled = true;
        appendLog('<span class="log-label">⏹️</span> Cancelling prompt...', 'log-status');
        
        try {
            await fetch('/api/session/cancel_prompt', { method: 'POST' });
        } catch (error) {
            appendLog(`<span class="log-label">❌ Error</span> ${escapeHtml('Failed to send cancel signal.')}`, 'log-error');
            cancelPromptBtn.disabled = false;
        }
    });

    // ---------------------------------------------------------------
    // Stop Service
    // ---------------------------------------------------------------
    stopBtn.addEventListener('click', async () => {
        stopBtn.disabled = true;
        appendLog('<span class="log-label">⏹️</span> Stopping service…', 'log-status');
        try { await fetch('/api/session/stop', { method: 'POST' }); } 
        catch (err) { showAlert('Failed to send stop signal.'); }
    });

    function handleServiceStopped() {
        _serviceRunning = false;
        _chatBusy = false;
        updateStatus('success', 'Service Stopped');
        
        stopBtn.style.display = 'none';
        stopBtn.disabled = false;
        resetStartBtn();
        setConfigEnabled(true);
        toolsBadge.style.display = 'none';
        // Hide Console UI and Switch back to config
        navChatBtn.disabled = true;
        switchTab('config-pane');

        chatConsoleBar.classList.add('hidden');
        chatPromptInput.disabled = false;
        sendPromptBtn.disabled = false;

        loadSessions();
    }

    // ---------------------------------------------------------------
    // SSE Event Rendering
    // ---------------------------------------------------------------
    function renderEvent(event) {
        switch (event.type) {
            case 'prompt':
                appendLog(`<span class="log-label">👤 Prompt</span> ${escapeHtml(event.text)}`, 'log-prompt'); break;
            case 'response':
                appendLog(`<span class="log-label">🤖 Response</span>\n<pre class="log-pre">${escapeHtml(event.text)}</pre>`, 'log-response'); break;
            case 'tool_call':
                appendLog(`<span class="log-label">🔧 Tool Call</span> <strong>${escapeHtml(event.tool)}</strong> — args: <code>${escapeHtml(JSON.stringify(event.args))}</code>`, 'log-tool-call'); break;
            case 'tool_result': {
                const exitBadge = event.exit_code === 0 ? `<span class="exit-ok">exit 0</span>` : `<span class="exit-err">exit ${event.exit_code}</span>`;
                appendLog(`<span class="log-label">📋 Result</span> <strong>${escapeHtml(event.tool)}</strong> ${exitBadge} (${event.duration_ms}ms)\n<pre class="log-pre">${escapeHtml(event.result || '(no output)')}</pre>`, 'log-tool-result');
                break;
            }
            case 'status': appendLog(`<span class="log-label">ℹ️ Status</span> ${escapeHtml(event.message)}`, 'log-status'); break;
            case 'context_usage': updateContextBar(event); break;
            case 'service_started': appendLog(`<span class="log-label">🟢 Service Started</span>`, 'log-done'); break;
            case 'service_stopped': appendLog(`<span class="log-label">🔴 Service Stopped</span>`, 'log-status'); break;
            case 'chat_done':
                appendLog(`<span class="log-label">✅ Turn Complete</span> ${escapeHtml(event.message || 'Ready for next prompt.')}`, 'log-done');
                setChatReady(); break;
            case 'error':
                appendLog(`<span class="log-label">❌ Error</span>\n<pre class="log-pre log-error-text">${escapeHtml(event.message)}</pre>`, 'log-error');
                updateStatus('error', 'Error'); setChatReady(); break;
            case 'done': appendLog(`<span class="log-label">⏹️ Done</span>`, 'log-done'); break;
        }
    }

    function updateContextBar(event) {
        const bar = document.getElementById('context-usage-bar');
        const fill = document.getElementById('context-usage-fill');
        const text = document.getElementById('context-usage-text');
        const modelMaxEl = document.getElementById('context-model-max');
        bar.style.display = 'block';
        const used = event.used || 0;
        const budget = event.budget || 8192;
        const pct = Math.min(100, Math.round((used / budget) * 100));
        text.textContent = `${used.toLocaleString()} / ${budget.toLocaleString()} tokens (${pct}%)`;
        modelMaxEl.textContent = `model max: ${(event.model_max || budget).toLocaleString()}`;
        fill.style.width = pct + '%';
        fill.classList.remove('ctx-green', 'ctx-amber', 'ctx-red');
        if (pct < 50) fill.classList.add('ctx-green');
        else if (pct < 75) fill.classList.add('ctx-amber');
        else fill.classList.add('ctx-red');
    }

    // ---------------------------------------------------------------
    // Sessions Browser
    // ---------------------------------------------------------------
    let _browseRunId = null, _currentTab = 'transcript';
    const sessionsList = document.getElementById('sessions-list'), sessionDetail = document.getElementById('session-detail'), detailContent = document.getElementById('detail-content');

    async function loadSessions() {
        try {
            const res = await fetch('/api/sessions'); const data = await res.json();
            renderSessionList(data.sessions || []);
        } catch (e) { sessionsList.innerHTML = '<div class="empty-state">Could not load sessions.</div>'; }
    }

    function renderSessionList(sessions) {
        if (!sessions.length) { sessionsList.innerHTML = '<div class="empty-state">No sessions yet. Run an agent to start logging.</div>'; return; }
        sessionsList.innerHTML = sessions.map(s => {
            return `
            <div class="session-card ${s.run_id === _browseRunId ? 'active' : ''}" data-run="${s.run_id}">
                <div class="session-card-left">
                    <span class="session-run-id">${s.run_id}</span>
                    <span class="session-meta">${s.start_time ? new Date(s.start_time).toLocaleString() : '—'}</span>
                </div>
                <span class="session-status ${s.status || 'unknown'}">${s.status || 'unknown'}</span>
            </div>`;
        }).join('');
        sessionsList.querySelectorAll('.session-card').forEach(card => card.addEventListener('click', () => openSession(card.dataset.run)));
    }

    async function openSession(runId) {
        _browseRunId = runId; sessionDetail.style.display = 'block';
        sessionsList.querySelectorAll('.session-card').forEach(c => c.classList.toggle('active', c.dataset.run === runId));
        await renderTab(_currentTab);
    }

    async function renderTab(tab) {
        _currentTab = tab;
        document.querySelectorAll('.detail-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
        if (tab === 'transcript') {
            try { const res = await fetch(`/api/sessions/${_browseRunId}/transcript`); const data = await res.json(); detailContent.innerHTML = `<pre>${escapeHtml(data.content || '(empty)')}</pre>`; } catch { detailContent.innerHTML = '<div class="empty-state">Could not load transcript.</div>'; }
        } else if (tab === 'tool_calls') {
            try { 
                const res = await fetch(`/api/sessions/${_browseRunId}/tool_calls`); const data = await res.json(); const tcs = data.tool_calls || [];
                if (!tcs.length) { detailContent.innerHTML = '<div class="empty-state">No tool calls recorded.</div>'; return; }
                detailContent.innerHTML = tcs.map(tc => `<div class="tool-call-card"><div class="tool-call-header"><span class="tool-call-name"><i class="ph ph-wrench"></i> ${escapeHtml(tc.tool)}</span><span class="tool-call-meta">${tc.duration_ms}ms</span></div><div class="tool-call-result">${escapeHtml(tc.result || '(no output)')}</div></div>`).join('');
            } catch { detailContent.innerHTML = '<div class="empty-state">Could not load tool calls.</div>'; }
        } else if (tab === 'artifacts') {
            try {
                const res = await fetch(`/api/sessions/${_browseRunId}/artifacts`); const data = await res.json(); const arts = data.artifacts || [];
                if (!arts.length) { detailContent.innerHTML = '<div class="empty-state">No artifacts saved.</div>'; return; }
                detailContent.innerHTML = `<ul class="artifact-list">${arts.map(a => `<li class="artifact-item" data-artifact="${escapeHtml(a)}"><i class="ph ph-file-text"></i> ${escapeHtml(a)}</li>`).join('')}</ul>`;
                detailContent.querySelectorAll('.artifact-item').forEach(el => el.addEventListener('click', () => openArtifact(el.dataset.artifact)));
            } catch { detailContent.innerHTML = '<div class="empty-state">Could not load artifacts.</div>'; }
        }
    }

    async function openArtifact(filename) {
        try { const res = await fetch(`/api/sessions/${_browseRunId}/artifacts/${filename}`); const data = await res.json(); detailContent.innerHTML = `<div style="margin-bottom:0.5rem;"><button onclick="renderTab('artifacts')" style="background:none;border:none;color:var(--accent-primary);cursor:pointer;">← Back</button> &nbsp;${escapeHtml(filename)}</div><pre>${escapeHtml(data.content || '(empty)')}</pre>`; } catch { detailContent.innerHTML = '<div class="empty-state">Could not load artifact.</div>'; }
    }

    document.getElementById('detail-tabs').addEventListener('click', e => { const tab = e.target.closest('.detail-tab'); if (tab && _browseRunId) renderTab(tab.dataset.tab); });
    document.getElementById('refresh-sessions-btn').addEventListener('click', loadSessions);

    function escapeHtml(str) { return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    loadSessions();
});
