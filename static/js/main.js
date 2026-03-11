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
    const chatInputBar = document.getElementById('chat-input-bar');
    const chatPromptInput = document.getElementById('chat-prompt-input');
    const chatSendBtn = document.getElementById('chat-send-btn');
    const toolsBadge = document.getElementById('service-tools-badge');

    let _eventSource = null;
    let _serviceRunning = false;
    let _chatBusy = false;

    // Toggle tools config visibility: hide for APT (tools are bundled in mcp_server.py)
    kaliCommandType.addEventListener('change', (e) => {
        toolsConfigSection.style.display = e.target.value === 'apt' ? 'none' : 'block';
    });
    kaliCommandType.dispatchEvent(new Event('change'));

    // ---------------------------------------------------------------
    // Utility: Alerts
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

    // ---------------------------------------------------------------
    // Utility: Status Badge
    // ---------------------------------------------------------------
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
    // Tools Configuration Logic
    // ---------------------------------------------------------------
    const toolCheckboxes = document.querySelectorAll('.tool-checkbox');
    const toolsJsonArea = document.getElementById('kali-tools-json');

    function updateToolsJson() {
        const selectedTools = [];
        toolCheckboxes.forEach(cb => {
            if (cb.checked) {
                selectedTools.push({
                    name: cb.value,
                    command: cb.dataset.cmd,
                    args: ["{args}"],
                    allow_args: true
                });
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
            } else {
                throw new Error(data.error || 'Failed to fetch models');
            }
        } catch (error) {
            console.error('Error fetching models:', error);
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
            command = '/usr/local/bin/uv run --with mcp mcp_kali.py';
        } else if (cmdType === 'apt') {
            command = 'python3 apt_logger_wrapper.py';
        }
        if (extraArgs) command += ' ' + extraArgs;

        const toolsConfigStr = toolsJsonArea.value;
        let toolsConfig = null;
        if (cmdType !== 'apt') {
            try {
                toolsConfig = JSON.parse(toolsConfigStr);
            } catch (e) {
                showAlert('Invalid JSON formatting in kali_tools.json editor.', 'error');
                return;
            }
        }

        if (!model) { showAlert('Please select a model first.'); return; }
        if (!command) { showAlert('Please specify a server command.'); return; }

        // Disable config, show loading
        setConfigEnabled(false);
        startBtn.querySelector('i').classList.remove('ph-power');
        startBtn.querySelector('i').classList.add('ph-spinner-gap', 'spin');
        startBtn.disabled = true;
        updateStatus('running', 'Starting service…');

        // Show log panel
        clearLog();
        appendLog('<i class="ph ph-spinner-gap spin"></i> Launching MCP service…', 'log-status');
        liveLogPanel.classList.remove('hidden');

        try {
            const response = await fetch('/api/session/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url, model, server_command: command,
                    tools_config: toolsConfig,
                    context_window: contextWindow,
                })
            });
            const data = await response.json();

            if (data.success) {
                _serviceRunning = true;

                // Show tools badge
                if (data.tools && data.tools.length) {
                    toolsBadge.textContent = `${data.tools.length} tool(s): ${data.tools.join(', ')}`;
                    toolsBadge.style.display = 'inline-block';
                }

                updateStatus('running', 'Service Running');

                // Switch buttons: hide Start, show Stop
                startBtn.style.display = 'none';
                stopBtn.style.display = 'inline-flex';

                // Show chat input
                chatInputBar.style.display = 'block';
                chatPromptInput.focus();

                // Open SSE stream
                openSseStream();

                showAlert('Service started! Type a prompt below.', 'success');
            } else {
                throw new Error(data.error || 'Failed to start service');
            }
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
        // Disable/enable all inputs in the config panel
        const inputs = configPanel.querySelectorAll('input, select, textarea, button');
        inputs.forEach(el => {
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

                if (event.type === 'done') {
                    closeSse();
                    handleServiceStopped();
                }
            } catch (err) {
                console.error('SSE parse error:', err);
            }
        };

        _eventSource.onerror = () => {
            // SSE connection lost — check if service is still running
            closeSse();
            if (_serviceRunning) {
                appendLog('<span class="log-label">⚠️</span> SSE connection lost. Reconnecting…', 'log-status');
                setTimeout(() => {
                    if (_serviceRunning) openSseStream();
                }, 2000);
            }
        };
    }

    // ---------------------------------------------------------------
    // Chat Send
    // ---------------------------------------------------------------
    chatSendBtn.addEventListener('click', sendChat);
    chatPromptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendChat();
        }
    });

    async function sendChat() {
        const prompt = chatPromptInput.value.trim();
        if (!prompt || _chatBusy) return;

        _chatBusy = true;
        chatSendBtn.disabled = true;
        chatPromptInput.disabled = true;
        chatPromptInput.value = '';

        // Show the user prompt in the log
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
            // Results will arrive via SSE — chat_done event will re-enable input
        } catch (error) {
            appendLog(`<span class="log-label">❌ Error</span> ${escapeHtml(error.message)}`, 'log-error');
            setChatReady();
        }
    }

    function setChatReady() {
        _chatBusy = false;
        chatSendBtn.disabled = false;
        chatPromptInput.disabled = false;
        chatPromptInput.focus();
    }

    // ---------------------------------------------------------------
    // Stop Service
    // ---------------------------------------------------------------
    stopBtn.addEventListener('click', async () => {
        stopBtn.disabled = true;
        appendLog('<span class="log-label">⏹️</span> Stopping service…', 'log-status');

        try {
            await fetch('/api/session/stop', { method: 'POST' });
        } catch (err) {
            showAlert('Failed to send stop signal.');
        }
        // Service stopped event will come through SSE → handleServiceStopped()
    });

    function handleServiceStopped() {
        _serviceRunning = false;
        _chatBusy = false;
        updateStatus('success', 'Service Stopped');

        // Switch buttons
        stopBtn.style.display = 'none';
        stopBtn.disabled = false;
        resetStartBtn();

        // Hide chat input
        chatInputBar.style.display = 'none';
        chatSendBtn.disabled = false;
        chatPromptInput.disabled = false;

        // Re-enable config
        setConfigEnabled(true);

        // Hide tools badge
        toolsBadge.style.display = 'none';

        // Refresh sessions list
        loadSessions();
    }

    // ---------------------------------------------------------------
    // SSE Event Rendering
    // ---------------------------------------------------------------
    function renderEvent(event) {
        switch (event.type) {
            case 'prompt':
                appendLog(`<span class="log-label">👤 Prompt</span> ${escapeHtml(event.text)}`, 'log-prompt');
                break;
            case 'response':
                appendLog(`<span class="log-label">🤖 Response</span>\n<pre class="log-pre">${escapeHtml(event.text)}</pre>`, 'log-response');
                break;
            case 'tool_call':
                appendLog(`<span class="log-label">🔧 Tool Call</span> <strong>${escapeHtml(event.tool)}</strong> — args: <code>${escapeHtml(JSON.stringify(event.args))}</code>`, 'log-tool-call');
                break;
            case 'tool_result': {
                const exitBadge = event.exit_code === 0
                    ? `<span class="exit-ok">exit 0</span>`
                    : `<span class="exit-err">exit ${event.exit_code}</span>`;
                appendLog(
                    `<span class="log-label">📋 Result</span> <strong>${escapeHtml(event.tool)}</strong> ${exitBadge} (${event.duration_ms}ms)\n<pre class="log-pre">${escapeHtml(event.result || '(no output)')}</pre>`,
                    'log-tool-result'
                );
                break;
            }
            case 'status':
                appendLog(`<span class="log-label">ℹ️ Status</span> ${escapeHtml(event.message)}`, 'log-status');
                break;
            case 'context_usage':
                updateContextBar(event);
                break;
            case 'service_started':
                appendLog(`<span class="log-label">🟢 Service Started</span> ${event.tools ? event.tools.length + ' tool(s) available' : ''}`, 'log-done');
                break;
            case 'service_stopped':
                appendLog(`<span class="log-label">🔴 Service Stopped</span> ${escapeHtml(event.message || '')}`, 'log-status');
                break;
            case 'chat_done':
                appendLog(`<span class="log-label">✅ Turn Complete</span> ${escapeHtml(event.message || 'Ready for next prompt.')}`, 'log-done');
                setChatReady();
                break;
            case 'error':
                appendLog(`<span class="log-label">❌ Error</span>\n<pre class="log-pre log-error-text">${escapeHtml(event.message)}</pre>`, 'log-error');
                updateStatus('error', 'Error');
                setChatReady();
                break;
            case 'done':
                appendLog(`<span class="log-label">⏹️ Done</span> ${escapeHtml(event.message || 'Session ended.')}`, 'log-done');
                break;
            default:
                appendLog(`<span class="log-label">${escapeHtml(event.type)}</span> ${escapeHtml(JSON.stringify(event))}`, 'log-status');
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
        const modelMax = event.model_max || budget;
        const pct = Math.min(100, Math.round((used / budget) * 100));

        text.textContent = `${used.toLocaleString()} / ${budget.toLocaleString()} tokens (${pct}%)`;
        modelMaxEl.textContent = `model max: ${modelMax.toLocaleString()}`;

        fill.style.width = pct + '%';
        fill.classList.remove('ctx-green', 'ctx-amber', 'ctx-red');
        if (pct < 50) fill.classList.add('ctx-green');
        else if (pct < 75) fill.classList.add('ctx-amber');
        else fill.classList.add('ctx-red');
    }

    // ---------------------------------------------------------------
    // Sessions Browser
    // ---------------------------------------------------------------
    let _browseRunId = null;
    let _currentTab = 'transcript';

    const sessionsList = document.getElementById('sessions-list');
    const sessionDetail = document.getElementById('session-detail');
    const detailContent = document.getElementById('detail-content');

    async function loadSessions() {
        try {
            const res = await fetch('/api/sessions');
            const data = await res.json();
            renderSessionList(data.sessions || []);
        } catch (e) {
            sessionsList.innerHTML = '<div class="empty-state">Could not load sessions.</div>';
        }
    }

    function renderSessionList(sessions) {
        if (!sessions.length) {
            sessionsList.innerHTML = '<div class="empty-state">No sessions yet. Run an agent to start logging.</div>';
            return;
        }
        sessionsList.innerHTML = sessions.map(s => {
            const startTime = s.start_time ? new Date(s.start_time).toLocaleString() : '—';
            const tools = s.total_tool_calls != null ? `${s.total_tool_calls} tool call(s)` : '';
            const status = s.status || 'unknown';
            return `
            <div class="session-card ${s.run_id === _browseRunId ? 'active' : ''}" data-run="${s.run_id}">
                <div class="session-card-left">
                    <span class="session-run-id">${s.run_id}</span>
                    <span class="session-meta">${startTime} · ${s.model || '?'} · ${s.server_type || '?'}${tools ? ' · ' + tools : ''}</span>
                </div>
                <span class="session-status ${status}">${status}</span>
            </div>`;
        }).join('');

        sessionsList.querySelectorAll('.session-card').forEach(card => {
            card.addEventListener('click', () => openSession(card.dataset.run));
        });
    }

    async function openSession(runId) {
        _browseRunId = runId;
        sessionDetail.style.display = 'block';
        sessionsList.querySelectorAll('.session-card').forEach(c => {
            c.classList.toggle('active', c.dataset.run === runId);
        });
        await renderTab(_currentTab);
    }

    async function renderTab(tab) {
        _currentTab = tab;
        document.querySelectorAll('.detail-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));

        if (tab === 'transcript') {
            try {
                const res = await fetch(`/api/sessions/${_browseRunId}/transcript`);
                const data = await res.json();
                detailContent.innerHTML = `<pre>${escapeHtml(data.content || '(empty)')}</pre>`;
            } catch { detailContent.innerHTML = '<div class="empty-state">Could not load transcript.</div>'; }
        } else if (tab === 'tool_calls') {
            try {
                const res = await fetch(`/api/sessions/${_browseRunId}/tool_calls`);
                const data = await res.json();
                const tcs = data.tool_calls || [];
                if (!tcs.length) {
                    detailContent.innerHTML = '<div class="empty-state">No tool calls recorded.</div>';
                    return;
                }
                detailContent.innerHTML = tcs.map(tc => `
                    <div class="tool-call-card">
                        <div class="tool-call-header">
                            <span class="tool-call-name"><i class="ph ph-wrench"></i> ${escapeHtml(tc.tool)}</span>
                            <span class="tool-call-meta">${tc.duration_ms}ms · exit ${tc.exit_code}</span>
                        </div>
                        <div style="font-size:0.78rem;color:var(--text-secondary);">Args: ${escapeHtml(JSON.stringify(tc.args))}</div>
                        <div class="tool-call-result">${escapeHtml(tc.result || '(no output)')}</div>
                    </div>`).join('');
            } catch { detailContent.innerHTML = '<div class="empty-state">Could not load tool calls.</div>'; }
        } else if (tab === 'artifacts') {
            try {
                const res = await fetch(`/api/sessions/${_browseRunId}/artifacts`);
                const data = await res.json();
                const arts = data.artifacts || [];
                if (!arts.length) {
                    detailContent.innerHTML = '<div class="empty-state">No artifacts saved.</div>';
                    return;
                }
                detailContent.innerHTML = `<ul class="artifact-list">${arts.map(a =>
                    `<li class="artifact-item" data-artifact="${escapeHtml(a)}"><i class="ph ph-file-text"></i> ${escapeHtml(a)}</li>`
                ).join('')}</ul>`;
                detailContent.querySelectorAll('.artifact-item').forEach(el => {
                    el.addEventListener('click', () => openArtifact(el.dataset.artifact));
                });
            } catch { detailContent.innerHTML = '<div class="empty-state">Could not load artifacts.</div>'; }
        }
    }

    async function openArtifact(filename) {
        try {
            const res = await fetch(`/api/sessions/${_browseRunId}/artifacts/${filename}`);
            const data = await res.json();
            detailContent.innerHTML = `
                <div style="margin-bottom:0.5rem;font-size:0.8rem;color:var(--text-secondary);">
                    <button onclick="renderTab('artifacts')" style="background:none;border:none;color:var(--accent-primary);cursor:pointer;font-size:0.8rem;">← Back</button>
                    &nbsp;${escapeHtml(filename)}
                </div>
                <pre>${escapeHtml(data.content || '(empty)')}</pre>`;
        } catch { detailContent.innerHTML = '<div class="empty-state">Could not load artifact.</div>'; }
    }

    // Tab click
    document.getElementById('detail-tabs').addEventListener('click', e => {
        const tab = e.target.closest('.detail-tab');
        if (tab && _browseRunId) renderTab(tab.dataset.tab);
    });

    // Refresh button
    document.getElementById('refresh-sessions-btn').addEventListener('click', loadSessions);

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // Load sessions on page load
    loadSessions();
});
