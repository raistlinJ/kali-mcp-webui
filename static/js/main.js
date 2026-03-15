document.addEventListener('DOMContentLoaded', () => {
    // ---------------------------------------------------------------
    // DOM References
    // ---------------------------------------------------------------
    const fetchBtn = document.getElementById('fetch-models-btn');
    const startBtn = document.getElementById('start-service-btn');
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
    const annotateBtn = document.getElementById('chat-annotate-btn');
    const annotationMenu = document.getElementById('annotation-menu');
    const annotationModalOverlay = document.getElementById('annotation-modal-overlay');
    const annotationPopup = document.getElementById('annotation-popup'); // modal container
    const closeAnnotationBtn = document.getElementById('close-annotation-btn');
    const cancelAnnotationBtn = document.getElementById('cancel-annotation-btn');
    const saveAnnotationBtn = document.getElementById('save-annotation-btn');
    const chatStopBtn = document.getElementById('chat-stop-btn');
    const confirmModalOverlay = document.getElementById('confirm-modal-overlay');
    const confirmStopBtn = document.getElementById('confirm-stop-btn');
    const confirmCancelBtn = document.getElementById('confirm-cancel-btn');
    
    const annotationAction = document.getElementById('annotation-action');
    const annotationText = document.getElementById('annotation-text');
    const annotationTextGroup = document.getElementById('annotation-text-group');
    const annotationSpan = document.getElementById('annotation-span');
    const modalTitle = document.getElementById('modal-title');
    
    const chatDownloadBtn = document.getElementById('chat-download-btn');
    const sessionDownloadBtn = document.getElementById('session-download-btn');
    const sessionAnalyzeBtn = document.getElementById('session-analyze-btn');
    const tabAnalysis = document.getElementById('tab-analysis');
    const analysisJobsList = document.getElementById('analysis-jobs-list');
    const clearJobsBtn = document.getElementById('clear-jobs-btn');
    
    let _analysisCache = {};
    let _analysisJobsInterval = null;

    let _eventSource = null;
    let _serviceRunning = false;
    let _chatBusy = false;
    let _logInitialCleared = false;
    
    // SVG Templates
    const ICON_SVG = {
        POWER: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 256 256"><path d="M128,24a8,8,0,0,1,8,8v80a8,8,0,0,1-16,0V32A8,8,0,0,1,128,24ZM198.63,62.63a8,8,0,0,0-11.26,11.4c26.46,26.11,26.46,68.63,0,94.74a67,67,0,0,1-94.74,0c-26.46-26.11-26.46-68.63,0-94.74a8,8,0,0,0-11.26-11.4c-32.73,32.31-32.73,84.89,0,117.2a83,83,0,0,0,117.26,0C231.36,147.52,231.36,94.94,198.63,62.63Z"></path></svg>`,
        STOP: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 256 256"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216ZM160,104v48a8,8,0,0,1-8,8H104a8,8,0,0,1-8-8V104a8,8,0,0,1,8-8h48A8,8,0,0,1,160,104Z"></path></svg>`,
        SEND: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 256 256"><path d="M231.87,114l-168-104A16,16,0,0,0,40.92,37.32L71.55,112H136a8,8,0,0,1,0,16H71.55L40.92,202.68A16,16,0,0,0,63.87,222a15.88,15.88,0,0,0,10-3.51l168-104a16,16,0,0,0,0-27.18Z"></path></svg>`,
        SPINNER: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 256 256" class="spinning"><path d="M136,32v40a8,8,0,0,1-16,0V32a8,8,0,0,1,16,0Z"></path><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Z" opacity="0.3"></path></svg>`
    };

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
            const targetId = btn.getAttribute('data-target');
            switchTab(targetId);
            
            // Handle analysis polling
            if (targetId === 'analysis-pane') {
                loadAnalysisJobs();
                startAnalysisJobsPolling();
            } else {
                stopAnalysisJobsPolling();
            }
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
                const name = cb.value;
                const cmd = cb.dataset.cmd;

                if (name === 'msf_search') {
                    selectedTools.push({
                        name: "msf_search",
                        description: "Search for Metasploit modules by keyword (e.g., 'jboss').",
                        command: "msfconsole",
                        base_args: ["-q", "-x", "search {args}; exit"],
                        allow_args: true
                    });
                } else if (name === 'msf_run') {
                    selectedTools.push({
                        name: "msf_run",
                        description: "Execute a Metasploit module. Format: '<module_path>; set RHOSTS <target>; run'.",
                        command: "msfconsole",
                        base_args: ["-q", "-x", "use {args}; exit"],
                        allow_args: true
                    });
                } else {
                    selectedTools.push({ name: name, command: cmd, args: ["{args}"], allow_args: true });
                }
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
        if (!_logInitialCleared) {
            liveLogViewer.innerHTML = '';
            _logInitialCleared = true;
        }
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
    // Start / Stop Service
    // ---------------------------------------------------------------
    function askToStopSession() {
        confirmModalOverlay.style.display = 'flex';
    }

    confirmCancelBtn.addEventListener('click', () => {
        confirmModalOverlay.style.display = 'none';
    });

    confirmStopBtn.addEventListener('click', () => {
        confirmModalOverlay.style.display = 'none';
        stopService();
    });

    chatStopBtn.addEventListener('click', askToStopSession);

    async function stopService() {
        if (!_serviceRunning) {
            console.warn("stopService called but _serviceRunning is false. Checking backend status...");
            const statusRes = await fetch('/api/session/status');
            const statusData = await statusRes.json();
            if (statusData.status === 'idle') return;
            // Otherwise, we might be out of sync, proceed with stop signal
        }
        
        startBtn.disabled = true;
        startBtn.innerHTML = ICON_SVG.SPINNER + '<span>Stopping service…</span>';
        updateStatus('running', 'Stopping service…');

        try {
            const response = await fetch('/api/session/stop', { method: 'POST' });
            const data = await response.json();
            if (data.success) {
                // handleServiceStopped will be called via SSE 'done' or 'service_stopped'
                // But we call it here too for immediate UI feedback
                handleServiceStopped();
                appendLog('Service stop signal sent.', 'log-status');
            } else {
                throw new Error(data.error || 'Failed to stop service');
            }
        } catch (error) {
            showAlert(error.message);
            startBtn.disabled = false;
        }
    }

    startBtn.addEventListener('click', async () => {
        if (_serviceRunning) {
            askToStopSession();
            return;
        }

        const url = ollamaUrlInput.value.trim();
        const model = modelSelect.value;
        const cmdType = kaliCommandType.value;
        const extraArgs = document.getElementById('kali-args').value.trim();
        const contextWindow = parseInt(document.getElementById('context-window').value, 10);

        let command = '';
        if (cmdType === 'python') {
            command = 'python3 mcp_kali.py';
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
        startBtn.querySelector('i').className = 'ph ph-spinner-gap spin';
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
                _currentRunId = data.run_id;
                
                // Switch button to Stop state
                startBtn.className = 'btn btn-danger';
                startBtn.querySelector('i').className = 'ph ph-stop';
                startBtn.querySelector('span').textContent = 'Stop Service';
                startBtn.disabled = false;

                if (data.tools && data.tools.length) {
                    toolsBadge.textContent = `${data.tools.length} tool(s): ${data.tools.join(', ')}`;
                    toolsBadge.style.display = 'inline-block';
                }
                
                updateStatus('running', 'Service Running - Chat Active');
                
                // Switch to Chat tab
                navChatBtn.disabled = false;
                switchTab('chat-pane');
                
                // Enable Chat Console inputs
                chatPromptInput.disabled = false;
                chatPromptInput.placeholder = "Type your prompt and press Enter to run...";
                sendPromptBtn.disabled = false;
                annotateBtn.disabled = false;
                chatStopBtn.disabled = false;
                chatDownloadBtn.style.display = 'inline-block';

                openSseStream();
                showAlert('Service started! Use the Prompt console to chat.', 'success');
                setTimeout(() => chatPromptInput.focus(), 500);
            } else {
                throw new Error(data.error || 'Failed to start session');
            }
        } catch (error) {
            showAlert(error.message);
            setConfigEnabled(true);
            updateStatus('error', 'Error');
            resetStartBtn();
        }
    });

    function resetStartBtn() {
        startBtn.classList.remove('btn-danger');
        startBtn.classList.add('btn-primary');
        startBtn.innerHTML = ICON_SVG.POWER + '<span>Start Service</span>';
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
    sendPromptBtn.addEventListener('click', () => {
        if (_chatBusy) {
            cancelChat();
        } else {
            sendChat();
        }
    });

    chatPromptInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = this.scrollHeight + 'px';
    });

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
        chatPromptInput.style.height = 'auto';
        chatPromptInput.disabled = true;
        
        // Morph the send button into a stop button
        sendPromptBtn.classList.remove('btn-primary');
        sendPromptBtn.classList.add('btn-danger');
        sendPromptBtn.title = "Cancel/Abort";
        sendPromptBtn.innerHTML = ICON_SVG.STOP;

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
        
        // Restore the send button
        sendPromptBtn.classList.remove('btn-danger', 'btn-secondary');
        sendPromptBtn.classList.add('btn-primary');
        sendPromptBtn.title = "Send";
        sendPromptBtn.disabled = false;
        sendPromptBtn.innerHTML = ICON_SVG.SEND;

        if (_serviceRunning) {
            chatPromptInput.disabled = false;
            chatPromptInput.focus();
        }
    }

    async function cancelChat() {
        if (!_chatBusy || !_serviceRunning) return;
        
        // Disable the stop button and turn into spinner so they can't spam it
        sendPromptBtn.disabled = true;
        const sendIcon = sendPromptBtn.querySelector('i');
        if (sendIcon) {
            sendIcon.classList.remove('ph-stop-circle');
            sendIcon.classList.add('ph-spinner-gap', 'spin');
        }

        appendLog('<span class="log-label">⏹️</span> Cancelling prompt...', 'log-status');
        
        try {
            await fetch('/api/session/cancel_prompt', { method: 'POST' });
        } catch (error) {
            appendLog(`<span class="log-label">❌ Error</span> ${escapeHtml('Failed to send cancel signal.')}`, 'log-error');
            sendPromptBtn.disabled = false;
            if (sendIcon) {
                sendIcon.classList.remove('ph-spinner-gap', 'spin');
                sendIcon.classList.add('ph-stop-circle');
            }
        }
    }

    // ---------------------------------------------------------------
    // Annotations & Live Analysis
    // ---------------------------------------------------------------
    annotateBtn.addEventListener('click', (e) => {
        if (!_serviceRunning) return;
        e.stopPropagation();
        annotationMenu.classList.toggle('show');
    });

    // Close dropdown on click-away
    window.addEventListener('click', () => {
        annotationMenu.classList.remove('show');
    });

    annotationMenu.querySelectorAll('li').forEach(item => {
        item.addEventListener('click', () => {
            const action = item.getAttribute('data-action');
            openAnnotationModal(action);
        });
    });

    function openAnnotationModal(action) {
        if (!_serviceRunning) return;
        annotationModalOverlay.style.display = 'flex';
        annotationAction.value = action;
        
        if (action === 'analyze') {
            modalTitle.innerHTML = '<i class="ph ph-magic-wand"></i> Analyze Logs';
            annotationTextGroup.style.display = 'none';
            saveAnnotationBtn.textContent = 'Run Analysis';
        } else {
            modalTitle.innerHTML = '<i class="ph ph-note-pencil"></i> Add Observation';
            annotationTextGroup.style.display = 'flex';
            saveAnnotationBtn.textContent = 'Save Note';
            setTimeout(() => annotationText.focus(), 100);
        }
        annotationMenu.classList.remove('show');
    }

    const closeAndResetModal = () => {
        annotationModalOverlay.style.display = 'none';
        annotationText.value = '';
        annotationSpan.value = 'Event Point';
        annotationAction.value = 'annotate';
        annotationTextGroup.style.display = 'flex';
        saveAnnotationBtn.textContent = 'Save Note';
    };

    closeAnnotationBtn.addEventListener('click', closeAndResetModal);
    cancelAnnotationBtn.addEventListener('click', closeAndResetModal);

    // Also close on overlay click
    annotationModalOverlay.addEventListener('click', (e) => {
        if (e.target === annotationModalOverlay) closeAndResetModal();
    });

    saveAnnotationBtn.addEventListener('click', async () => {
        const action = annotationAction.value;
        const text = annotationText.value.trim();
        const span = annotationSpan.value;
        if (!_currentRunId) {
            showAlert('Cannot save: No active session ID found.', 'error');
            return;
        }
        if (action === 'annotate' && !text) {
            showAlert('Please enter an observation note.', 'warning');
            return;
        }

        saveAnnotationBtn.disabled = true;
        saveAnnotationBtn.textContent = action === 'analyze' ? 'Running...' : 'Saving...';

        try {
            if (action === 'analyze') {
                const response = await fetch(`/api/sessions/${_currentRunId}/analyze`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ span })
                });
                const data = await response.json();
                
                if (data.success) {
                    showAlert('Background analysis job started. Check the Analysis Jobs tab.', 'success');
                    closeAndResetModal();
                    // Switch to analysis tab automatically to show progress? 
                    // Let's do it to guide the user.
                    switchTab('analysis-pane');
                    loadAnalysisJobs();
                    startAnalysisJobsPolling();
                } else {
                    showAlert('Live Analysis failed: ' + (data.error || 'Unknown error'), 'error');
                }
            } else {
                const response = await fetch(`/api/sessions/${_currentRunId}/annotate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text, span })
                });
                const data = await response.json();
                
                if (data.success) {
                    appendLog(`<span class="log-label">📝 Annotation saved</span> <em>Scope: ${span}</em><br/>${escapeHtml(text)}`, 'log-prompt');
                    closeAndResetModal();
                } else {
                    showAlert('Failed to save annotation: ' + (data.error || 'Unknown error'), 'error');
                }
            }
        } catch (err) {
            showAlert(`Failed to ${action}: ` + err.message, 'error');
        } finally {
            saveAnnotationBtn.disabled = false;
            saveAnnotationBtn.textContent = action === 'analyze' ? 'Run Analysis' : 'Save Note';
        }
    });

    // Stop Service (Handled by startBtn toggle)
    // ---------------------------------------------------------------
    function handleServiceStopped() {
        if (!_serviceRunning && statusText.textContent === 'Idle') return; // Already cleaned up

        _serviceRunning = false;
        _chatBusy = false;
        _currentRunId = null;
        _logInitialCleared = false; // Reset for next run
        updateStatus('success', 'Service Stopped');
        
        resetStartBtn();
        setConfigEnabled(true);
        toolsBadge.style.display = 'none';
        
        // Disable active chat inputs
        chatPromptInput.disabled = true;
        chatPromptInput.placeholder = "Start the service in the Configuration tab to begin...";
        sendPromptBtn.disabled = true;
        annotateBtn.disabled = true;
        chatStopBtn.disabled = true;
        chatDownloadBtn.style.display = 'none';

        // We DON'T force a tab switch to config here anymore to prevent jarring jumps.
        // The user can switch back when they are ready to reconfigure.
        // Just disable the Live Chat tab if we're not on it, or let them see logs.
        navChatBtn.disabled = true; 

        loadSessions(); // Refresh history
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
                <div style="display: flex; align-items: center;">
                    <span class="session-status ${s.status || 'unknown'}">${s.status || 'unknown'}</span>
                    ${s.status === 'running' ? `<button class="btn-stop-session" title="Stop Running Session" data-stop-run="${s.run_id}"><i class="ph ph-stop"></i></button>` : ''}
                </div>
            </div>`;
        }).join('');
        
        sessionsList.querySelectorAll('.session-card').forEach(card => card.addEventListener('click', (e) => {
            if (e.target.closest('.btn-stop-session')) return; // Ignore card click if stop button pressed
            openSession(card.dataset.run)
        }));

        sessionsList.querySelectorAll('.btn-stop-session').forEach(btn => btn.addEventListener('click', (e) => {
            e.stopPropagation();
            askToStopSession();
        }));
    }

    async function openSession(runId) {
        _browseRunId = runId; sessionDetail.style.display = 'block';
        sessionsList.querySelectorAll('.session-card').forEach(c => c.classList.toggle('active', c.dataset.run === runId));
        sessionDownloadBtn.style.display = 'inline-block';
        sessionAnalyzeBtn.style.display = 'inline-block';
        if (_analysisCache[runId]) tabAnalysis.style.display = 'inline-block';
        await renderTab(_currentTab === 'analysis' && !_analysisCache[runId] ? 'transcript' : _currentTab);
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
        } else if (tab === 'analysis') {
            if (_analysisCache[_browseRunId]) {
                detailContent.innerHTML = `<div class="analysis-result" style="padding: 1rem;"><pre style="white-space: pre-wrap; font-family: 'Inter', sans-serif; line-height: 1.5; font-size: 0.95rem;">${escapeHtml(_analysisCache[_browseRunId])}</pre></div>`;
            } else {
                detailContent.innerHTML = '<div class="empty-state">No analysis generated yet. Click "Analyze Session" to run inference.</div>';
            }
        }
    }

    async function openArtifact(filename) {
        try { const res = await fetch(`/api/sessions/${_browseRunId}/artifacts/${filename}`); const data = await res.json(); detailContent.innerHTML = `<div style="margin-bottom:0.5rem;"><button onclick="renderTab('artifacts')" style="background:none;border:none;color:var(--accent-primary);cursor:pointer;">← Back</button> &nbsp;${escapeHtml(filename)}</div><pre>${escapeHtml(data.content || '(empty)')}</pre>`; } catch { detailContent.innerHTML = '<div class="empty-state">Could not load artifact.</div>'; }
    }

    document.getElementById('detail-tabs').addEventListener('click', e => { const tab = e.target.closest('.detail-tab'); if (tab && _browseRunId) renderTab(tab.dataset.tab); });
    document.getElementById('refresh-sessions-btn').addEventListener('click', loadSessions);

    chatDownloadBtn.addEventListener('click', () => {
        if (_currentRunId) window.location.href = `/api/sessions/${_currentRunId}/download`;
    });
    
    sessionDownloadBtn.addEventListener('click', () => {
        if (_browseRunId) window.location.href = `/api/sessions/${_browseRunId}/download`;
    });
    
    sessionAnalyzeBtn.addEventListener('click', async () => {
        if (!_browseRunId) return;
        if (!_serviceRunning) {
            showAlert("You must Start the backend Service (in Config tab) to use Ollama for Analysis.", "warning");
            return;
        }

        const originalText = sessionAnalyzeBtn.innerHTML;
        sessionAnalyzeBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Analyzing...';
        sessionAnalyzeBtn.disabled = true;

        try {
            const res = await fetch(`/api/sessions/${_browseRunId}/analyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ span: 'Entire Session' })
            });
            const data = await res.json();
            
            if (data.success) {
                showAlert('Background analysis job started.', 'success');
                switchTab('analysis-pane');
                loadAnalysisJobs();
                startAnalysisJobsPolling();
            } else {
                showAlert('Analysis failed: ' + (data.error || 'Unknown error'), 'error');
            }
        } catch (err) {
            showAlert('Failed to analyze session: ' + err.message, 'error');
        } finally {
            sessionAnalyzeBtn.innerHTML = originalText;
            sessionAnalyzeBtn.disabled = false;
        }
    });

    async function checkServiceStatus() {
        try {
            const response = await fetch('/api/session/status');
            const data = await response.json();
            
            if (data.status === 'running' || data.status === 'starting') {
                console.log("Service is already active, restoring UI state...", data);
                _serviceRunning = true;
                _currentRunId = data.run_id;

                // Sync UI elements
                setConfigEnabled(false);
                startBtn.className = 'btn btn-danger';
                startBtn.querySelector('i').className = 'ph ph-stop';
                startBtn.querySelector('span').textContent = 'Stop Service';
                startBtn.disabled = false;

                updateStatus('running', 'Service Running - Chat Active');
                
                // Enable Chat Console inputs
                navChatBtn.disabled = false;
                chatPromptInput.disabled = false;
                chatPromptInput.placeholder = "Type your prompt and press Enter to run...";
                sendPromptBtn.disabled = false;
                annotateBtn.disabled = false;
                chatStopBtn.disabled = false;
                chatDownloadBtn.style.display = 'inline-block';

                // Re-open log stream
                openSseStream();
                
                // Optional: switch to chat tab if running
                switchTab('chat-pane');
            }
        } catch (err) {
            console.error("Failed to check initial service status:", err);
        }
    }

    function escapeHtml(str) { return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    
    // Initialize
    loadSessions();
    checkServiceStatus();
    
    // ---------------------------------------------------------------
    // Analysis Job Management
    // ---------------------------------------------------------------
    async function loadAnalysisJobs() {
        try {
            const res = await fetch('/api/analysis/jobs');
            const data = await res.json();
            renderAnalysisJobs(data.jobs || []);
        } catch (err) {
            console.error('Failed to load analysis jobs:', err);
        }
    }

    function renderAnalysisJobs(jobs) {
        if (!jobs.length) {
            analysisJobsList.innerHTML = `
                <div class="empty-state">
                    <i class="ph ph-tray" style="font-size: 2.5rem; opacity: 0.3; margin-bottom: 1rem;"></i>
                    <p>No analysis jobs found. Run an analysis from Chat or Past Sessions.</p>
                </div>`;
            return;
        }

        analysisJobsList.innerHTML = jobs.map(job => {
            const date = new Date(job.start_time).toLocaleString();
            const statusClass = `status-${job.status}`;
            const statusIcon = job.status === 'running' ? 'ph-spinner spinning' : (job.status === 'success' ? 'ph-check-circle' : 'ph-x-circle');
            
            return `
                <div class="job-card">
                    <div class="job-header">
                        <div class="job-info">
                            <div class="job-id">${job.job_id}</div>
                            <div class="job-title">Analysis: ${job.run_id}</div>
                        </div>
                        <div class="job-status-badge ${statusClass}">
                            <i class="ph ${statusIcon}"></i>
                            <span>${job.status}</span>
                        </div>
                    </div>
                    <div class="job-footer">
                        <div class="job-meta">
                            <span><i class="ph ph-calendar"></i> ${date}</span>
                            <span><i class="ph ph-clock"></i> ${job.span}</span>
                        </div>
                        ${job.status === 'success' ? `
                            <button class="btn btn-primary btn-sm" onclick="viewAnalysisResult('${job.job_id}')" style="width: auto; padding: 0.3rem 0.8rem;">
                                <i class="ph ph-eye"></i> View Result
                            </button>
                        ` : ''}
                        ${job.status === 'failed' ? `
                            <div class="status-error" style="font-size: 0.8rem;">Error: ${escapeHtml(job.error)}</div>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    window.viewAnalysisResult = async function(jobId) {
        try {
            const res = await fetch('/api/analysis/jobs');
            const data = await res.json();
            const job = data.jobs.find(j => j.job_id === jobId);
            
            if (job && job.result) {
                // Show in a modal
                const modal = document.createElement('div');
                modal.className = 'modal-overlay';
                modal.style.display = 'flex';
                modal.innerHTML = `
                    <div class="annotation-modal" style="max-width: 800px; width: 90%;">
                        <div class="modal-header">
                            <h3><i class="ph ph-brain"></i> Analysis Result: ${job.run_id}</h3>
                            <button type="button" class="icon-btn" onclick="this.closest('.modal-overlay').remove()"><i class="ph ph-x"></i></button>
                        </div>
                        <div class="modal-body" style="max-height: 60vh; overflow-y: auto; padding: 1.5rem; background: rgba(0,0,0,0.2); border-radius: 12px; margin: 1rem;">
                            <div class="markdown-body" style="font-size: 0.95rem; line-height: 1.6; color: var(--text-primary);">
                                ${marked.parse(job.result)}
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Close</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
                // Close on overlay click
                modal.addEventListener('click', (e) => {
                    if (e.target === modal) modal.remove();
                });
            }
        } catch (err) {
            showAlert('Failed to load analysis result: ' + err.message, 'error');
        }
    };

    function startAnalysisJobsPolling() {
        if (_analysisJobsInterval) return;
        _analysisJobsInterval = setInterval(loadAnalysisJobs, 3000);
    }

    function stopAnalysisJobsPolling() {
        if (_analysisJobsInterval) {
            clearInterval(_analysisJobsInterval);
            _analysisJobsInterval = null;
        }
    }

    clearJobsBtn.addEventListener('click', async () => {
        if (!confirm('Clear all analysis job history?')) return;
        try {
            await fetch('/api/analysis/jobs/clear', { method: 'POST' });
            loadAnalysisJobs();
        } catch (err) {
            showAlert('Failed to clear jobs: ' + err.message, 'error');
        }
    });
});
