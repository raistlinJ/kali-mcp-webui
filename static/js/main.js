document.addEventListener('DOMContentLoaded', () => {
    const fetchBtn = document.getElementById('fetch-models-btn');
    const connectBtn = document.getElementById('connect-btn');
    const modelSelect = document.getElementById('model-select');
    const ollamaUrlInput = document.getElementById('ollama-url');

    // Kali fields
    const kaliCommandType = document.getElementById('kali-command-type');
    const toolsConfigSection = document.getElementById('tools-config-section');

    const statusBadge = document.getElementById('status-badge');
    const statusText = statusBadge.querySelector('.status-text');
    const alertsContainer = document.getElementById('alerts-container');

    // Toggle tools config visibility: hide for APT (tools are bundled in mcp_server.py)
    kaliCommandType.addEventListener('change', (e) => {
        toolsConfigSection.style.display = e.target.value === 'apt' ? 'none' : 'block';
    });

    // Sync UI on page load
    kaliCommandType.dispatchEvent(new Event('change'));

    // Utility to show alerts
    const showAlert = (message, type = 'error') => {
        const alertEl = document.createElement('div');
        alertEl.className = `alert alert-${type}`;

        const icon = type === 'error' ? 'ph-warning-circle' : 'ph-check-circle';
        alertEl.innerHTML = `<i class="ph ${icon}"></i> <span>${message}</span>`;

        alertsContainer.innerHTML = ''; // Clear previous
        alertsContainer.appendChild(alertEl);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            alertEl.style.opacity = '0';
            setTimeout(() => alertEl.remove(), 300);
        }, 5000);
    };

    // Update Status Badge
    const updateStatus = (state, message) => {
        statusBadge.classList.remove('hidden', 'success', 'error');

        if (state === 'success') {
            statusBadge.classList.add('success');
            statusText.textContent = message || 'Connected to ollmcp';
        } else if (state === 'error') {
            statusBadge.classList.add('error');
            statusText.textContent = message || 'Connection Failed';
        } else {
            statusText.textContent = message || 'Disconnected';
        }
    };

    // Tools Configuration Logic
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
            const newJson = { tools: selectedTools };
            toolsJsonArea.value = JSON.stringify(newJson, null, 2);
        }
    }

    toolCheckboxes.forEach(cb => cb.addEventListener('change', updateToolsJson));
    // Run once on load to sync any browser-restored checkbox states
    updateToolsJson();

    // Fetch Models logic
    fetchBtn.addEventListener('click', async () => {
        const url = ollamaUrlInput.value.trim();
        if (!url) {
            showAlert('Please enter an Ollama Instance URL');
            return;
        }

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
                // Populate select
                modelSelect.innerHTML = '';
                if (data.models.length === 0) {
                    modelSelect.innerHTML = '<option value="" disabled selected>No models found</option>';
                    modelSelect.disabled = true;
                    connectBtn.disabled = true;
                    showAlert('No models found in the specified Ollama instance.', 'error');
                } else {
                    data.models.forEach(model => {
                        const option = document.createElement('option');
                        option.value = model;
                        option.textContent = model;
                        modelSelect.appendChild(option);
                    });
                    modelSelect.disabled = false;
                    connectBtn.disabled = false;
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
            connectBtn.disabled = true;
        } finally {
            icon.classList.remove('spin');
            fetchBtn.disabled = false;
        }
    });

    // Connect logic
    document.getElementById('mcp-form').addEventListener('submit', async (e) => {
        e.preventDefault();

        const url = ollamaUrlInput.value.trim();
        const model = modelSelect.value;
        const cmdType = kaliCommandType.value;
        const extraArgs = document.getElementById('kali-args').value.trim();
        let command = "";

        // Build the server command based on the selected mode
        if (cmdType === 'python') {
            command = "/usr/local/bin/uv run --with mcp mcp_kali.py";
        } else if (cmdType === 'apt') {
            // apt_logger_wrapper.py proxies mcp_server.py while logging all tool calls to runs/.
            // kali_server.py (Flask API) is started separately as a pre-step in the copy-paste snippet.
            command = "python3 apt_logger_wrapper.py";
        }

        if (extraArgs) {
            command += " " + extraArgs;
        }

        const toolsConfigStr = document.getElementById('kali-tools-json').value;
        let toolsConfig = null;

        // Only parse and pass the tools JSON for Native Python mode (APT bundles its own tool list)
        if (cmdType !== 'apt') {
            try {
                toolsConfig = JSON.parse(toolsConfigStr);
            } catch (e) {
                showAlert('Invalid JSON formatting in kali_tools.json editor.', 'error');
                return;
            }
        }

        if (!model) return;
        if (!command) {
            showAlert('Please specify a server command.');
            return;
        }

        const icon = connectBtn.querySelector('i');
        icon.classList.remove('ph-lightning');
        icon.classList.add('ph-spinner-gap', 'spin');
        connectBtn.disabled = true;
        updateStatus('default', 'Launching Term...');

        try {
            const response = await fetch('/api/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url,
                    model,
                    server_command: command,
                    tools_config: toolsConfig
                })
            });

            const data = await response.json();

            if (data.success) {
                updateStatus('success', `Launch Configured`);
                // Open the modal and set the command
                document.getElementById('generated-command').textContent = data.command;
                document.getElementById('command-modal').classList.remove('hidden');
            } else {
                throw new Error(data.error || 'Failed to connect');
            }
        } catch (error) {
            console.error('Connection error:', error);
            updateStatus('error', 'Launch Failed');
            showAlert(error.message);
        } finally {
            icon.classList.remove('ph-spinner-gap', 'spin');
            icon.classList.add('ph-lightning');
            connectBtn.disabled = false;
        }
    });

    // Modal logic
    const modal = document.getElementById('command-modal');
    const copyBtn = document.getElementById('copy-command-btn');

    document.getElementById('close-modal-btn').addEventListener('click', () => modal.classList.add('hidden'));
    document.getElementById('done-modal-btn').addEventListener('click', () => modal.classList.add('hidden'));

    copyBtn.addEventListener('click', async () => {
        const cmd = document.getElementById('generated-command').textContent;
        try {
            await navigator.clipboard.writeText(cmd);
            copyBtn.innerHTML = '<i class="ph ph-check"></i> Copied!';
            copyBtn.classList.add('btn-success');
            setTimeout(() => {
                copyBtn.innerHTML = '<i class="ph ph-copy"></i> Copy';
                copyBtn.classList.remove('btn-success');
            }, 2000);
        } catch (err) {
            console.error('Failed to copy: ', err);
            showAlert('Failed to copy command to clipboard');
        }
    });

    // ---------------------------------------------------------------
    // Sessions Browser
    // ---------------------------------------------------------------
    let _currentRunId = null;
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
            sessionsList.innerHTML = '<div class="empty-state">No sessions yet. Connect to start logging.</div>';
            return;
        }
        sessionsList.innerHTML = sessions.map(s => {
            const startTime = s.start_time ? new Date(s.start_time).toLocaleString() : '—';
            const tools = s.total_tool_calls != null ? `${s.total_tool_calls} tool call(s)` : '';
            const status = s.status || 'unknown';
            return `
            <div class="session-card ${s.run_id === _currentRunId ? 'active' : ''}" data-run="${s.run_id}">
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
        _currentRunId = runId;
        sessionDetail.style.display = 'block';
        // Update active state
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
                const res = await fetch(`/api/sessions/${_currentRunId}/transcript`);
                const data = await res.json();
                detailContent.innerHTML = `<pre>${escapeHtml(data.content || '(empty)')}</pre>`;
            } catch { detailContent.innerHTML = '<div class="empty-state">Could not load transcript.</div>'; }
        } else if (tab === 'tool_calls') {
            try {
                const res = await fetch(`/api/sessions/${_currentRunId}/tool_calls`);
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
                const res = await fetch(`/api/sessions/${_currentRunId}/artifacts`);
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
            const res = await fetch(`/api/sessions/${_currentRunId}/artifacts/${filename}`);
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
        if (tab && _currentRunId) renderTab(tab.dataset.tab);
    });

    // Refresh button
    document.getElementById('refresh-sessions-btn').addEventListener('click', loadSessions);

    // Auto-refresh sessions list after a successful connect
    const origConnect = document.getElementById('connect-btn');

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

