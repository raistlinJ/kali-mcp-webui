document.addEventListener('DOMContentLoaded', () => {
    // ---------------------------------------------------------------
    // DOM References
    // ---------------------------------------------------------------
    const fetchBtn = document.getElementById('fetch-models-btn');
    const progressModal = document.getElementById('progress-modal-overlay');
    const progressTitle = document.getElementById('progress-title');
    const progressMsg = document.getElementById('progress-message');
    const ollamaFetchError = document.getElementById('ollama-fetch-error');
    const analysisConfigModalOverlay = document.getElementById('analysis-config-modal-overlay');
    const analysisConfigTitle = document.getElementById('analysis-config-title');
    const analysisConfigDescription = document.getElementById('analysis-config-description');
    const analysisOllamaUrlInput = document.getElementById('analysis-ollama-url');
    const analysisModelSelect = document.getElementById('analysis-model-select');
    const analysisSpanGroup = document.getElementById('analysis-span-group');
    const analysisSpanSelect = document.getElementById('analysis-span-select');
    const analysisFetchBtn = document.getElementById('analysis-fetch-models-btn');
    const analysisFetchError = document.getElementById('analysis-fetch-error');
    const confirmAnalysisConfigBtn = document.getElementById('confirm-analysis-config-btn');
    const cancelAnalysisConfigBtn = document.getElementById('cancel-analysis-config-btn');
    const closeAnalysisConfigBtn = document.getElementById('close-analysis-config-btn');
    const startBtn = document.getElementById('start-service-btn');
    const modelSelect = document.getElementById('model-select');
    const ollamaUrlInput = document.getElementById('ollama-url');
    const maxTurnsInput = document.getElementById('max-turns');
    const allowTargetsInput = document.getElementById('allow-targets');
    const disallowTargetsInput = document.getElementById('disallow-targets');

    const kaliCommandType = document.getElementById('kali-command-type');
    const toolsConfigSection = document.getElementById('tools-config-section');
    const toolsConfigEmpty = document.getElementById('tools-config-empty');
    const configToolsTabBtn = document.getElementById('config-tools-tab-btn');
    const proxychainsRouteAllCheckbox = document.getElementById('proxychains-route-all');
    const configSubtabBtns = document.querySelectorAll('.config-subtab-btn');
    const configSubtabPanels = document.querySelectorAll('.config-subtab-panel');

    const statusBadge = document.getElementById('status-badge');
    const statusText = statusBadge.querySelector('.status-text');
    const alertsContainer = document.getElementById('alerts-container');

    const configPanel = document.getElementById('config-panel');
    const liveLogPanel = document.getElementById('live-log-panel');
    const liveLogViewer = document.getElementById('live-log-viewer');
    const toolsBadge = document.getElementById('service-tools-badge');
    const policyBadge = document.getElementById('service-policy-badge');

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
    const postToolReplyModalOverlay = document.getElementById('post-tool-reply-modal-overlay');
    const postToolReplyMessage = document.getElementById('post-tool-reply-message');
    const retryPostToolReplyBtn = document.getElementById('retry-post-tool-reply-btn');
    const cancelPostToolReplyBtn = document.getElementById('cancel-post-tool-reply-btn');
    const dangerousToolModalOverlay = document.getElementById('dangerous-tool-modal-overlay');
    const dangerousToolMessage = document.getElementById('dangerous-tool-message');
    const dangerousToolCommand = document.getElementById('dangerous-tool-command');
    const approveDangerousToolBtn = document.getElementById('approve-dangerous-tool-btn');
    const cancelDangerousToolBtn = document.getElementById('cancel-dangerous-tool-btn');
    
    const annotationAction = document.getElementById('annotation-action');
    const annotationText = document.getElementById('annotation-text');
    const annotationTextGroup = document.getElementById('annotation-text-group');
    const annotationSpan = document.getElementById('annotation-span');
    const modalTitle = document.getElementById('modal-title');
    
    const chatDownloadBtn = document.getElementById('chat-download-btn');
    const sessionDownloadBtn = document.getElementById('session-download-btn');
    const sessionAnalyzeBtn = document.getElementById('session-analyze-btn');
    const sessionSummaryPanel = document.getElementById('session-summary-panel');
    const tabAnalysis = document.getElementById('tab-analysis');
    const analysisJobsList = document.getElementById('analysis-jobs-list');
    const clearJobsBtn = document.getElementById('clear-jobs-btn');
    
    let _analysisCache = {};
    let _analysisJobsInterval = null;
    let _sessionsById = {};

    let _eventSource = null;
    let _serviceRunning = false;
    let _chatBusy = false;
    let _logInitialCleared = false;
    let _sessionToStopId = null;
    let _currentRunId = null;
    let _awaitingPostToolReplyDecision = false;
    let _awaitingDangerousToolApproval = false;
    const LIVE_LOG_STORAGE_PREFIX = 'live-log:';
    const LAST_ACTIVE_RUN_STORAGE_KEY = 'live-log:last-active-run';
    let _analysisConfigResolver = null;
    let _analysisConfigOptions = null;
    
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

    function switchConfigSubtab(targetPanelId) {
        configSubtabBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.configTarget === targetPanelId);
        });
        configSubtabPanels.forEach(panel => {
            panel.classList.toggle('active', panel.id === targetPanelId);
        });
    }

    configSubtabBtns.forEach(btn => {
        btn.addEventListener('click', () => switchConfigSubtab(btn.dataset.configTarget));
    });

    // Toggle tools config visibility
    kaliCommandType.addEventListener('change', (e) => {
        const usesApt = e.target.value === 'apt';
        toolsConfigSection.style.display = usesApt ? 'none' : 'flex';
        toolsConfigEmpty.style.display = usesApt ? 'flex' : 'none';
        configToolsTabBtn.classList.toggle('config-subtab-btn-muted', usesApt);
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
    const shellExtendedCheckbox = document.querySelector('.tool-checkbox[value="shell_extended"]');
    const shellSequenceCheckbox = document.querySelector('.tool-checkbox[value="shell_sequence"]');
    const toolsJsonArea = document.getElementById('kali-tools-json');

    function wrapToolWithProxychains(toolDefinition) {
        if (!toolDefinition || toolDefinition.name === 'proxychains' || toolDefinition.name === 'shell' || toolDefinition.name === 'shell_extended' || toolDefinition.name === 'shell_sequence' || toolDefinition.name === 'shell_dangerous') {
            return toolDefinition;
        }

        const wrappedTool = { ...toolDefinition };
        const existingBaseArgs = Array.isArray(toolDefinition.base_args) ? [...toolDefinition.base_args] : [];

        wrappedTool.command = '/usr/bin/proxychains4';
        wrappedTool.base_args = [toolDefinition.command, ...existingBaseArgs];
        wrappedTool.allow_args = true;

        if (wrappedTool.args) {
            delete wrappedTool.args;
        }

        if (wrappedTool.description) {
            wrappedTool.description = `${wrappedTool.description} Routed through proxychains4.`;
        }

        return wrappedTool;
    }

    function buildSelectedToolsConfig() {
        const selectedTools = [];
        const routeViaProxychains = Boolean(proxychainsRouteAllCheckbox?.checked);
        const shellExtendedEnabled = Boolean(shellExtendedCheckbox?.checked);

        toolCheckboxes.forEach(cb => {
            if (!cb.checked) {
                return;
            }

            const name = cb.value;
            const cmd = cb.dataset.cmd;
            let toolDefinition;

            if (name === 'msf_search') {
                toolDefinition = {
                    name: "msf_search",
                    description: "Search for Metasploit modules by keyword (e.g., 'jboss').",
                    command: "msfconsole",
                    base_args: ["-q", "-x", "search {args}; exit"],
                    allow_args: true
                };
            } else if (name === 'msf_run') {
                toolDefinition = {
                    name: "msf_run",
                    description: "Execute a Metasploit command sequence in batch mode. Example: 'use auxiliary/scanner/http/jboss_vulnscan; set RHOSTS 10.0.2.2; run'. Exploit modules get a short default WfsDelay and non-interactive session handling unless you override them.",
                    command: "msfconsole",
                    base_args: ["-q", "-x", "{args}; exit"],
                    timeout_seconds: 90,
                    allow_args: true
                };
            } else if (name === 'proxychains') {
                toolDefinition = {
                    name: 'proxychains',
                    description: 'Run a network command through proxychains. Example args: "nmap -sT scanme.nmap.org" or "curl http://example.com".',
                    command: cmd,
                    args: ['{args}'],
                    allow_args: true
                };
            } else if (name === 'ssh') {
                toolDefinition = {
                    name: 'ssh',
                    description: 'Open an SSH client connection or run a remote command. Example args: "user@host" or "user@host uname -a".',
                    command: cmd,
                    args: ['{args}'],
                    allow_args: true
                };
            } else if (name === 'shell') {
                toolDefinition = {
                    name: 'shell',
                    description: 'Run an allowlisted local shell command for host inspection. Allowed commands: ls, cat, grep, docker, ip, ss, ps, uname, id, pwd, whoami, find.',
                    command: cmd,
                    args: ['{args}'],
                    allow_args: true
                };
            } else if (name === 'shell_extended') {
                toolDefinition = {
                    name: 'shell_extended',
                    description: 'Run an extended allowlisted shell command for read-oriented network inspection. Allowed commands: curl, dig, host, nslookup, openssl s_client, tracepath, traceroute, ping. curl is restricted to read-only HTTP(S) requests, openssl is limited to s_client, and ping is count-limited.',
                    command: cmd,
                    args: ['{args}'],
                    timeout_seconds: 90,
                    allow_args: true
                };
            } else if (name === 'shell_sequence') {
                if (!shellExtendedEnabled) {
                    return;
                }
                toolDefinition = {
                    name: 'shell_sequence',
                    description: 'Run up to 3 shell_extended-compatible commands in sequence without a shell interpreter. Args must be either a JSON array of command strings or newline-separated commands. Each command is validated under shell_extended rules before execution.',
                    command: cmd,
                    args: ['{args}'],
                    timeout_seconds: 120,
                    allow_args: true
                };
            } else if (name === 'shell_dangerous') {
                toolDefinition = {
                    name: 'shell_dangerous',
                    description: 'Run a much less restricted shell command for advanced workflows, including file edits, redirection, and multi-step shell logic. Every execution requires explicit user approval before the command is run.',
                    command: cmd,
                    args: ['{args}'],
                    timeout_seconds: 120,
                    allow_args: true
                };
            } else {
                toolDefinition = { name: name, command: cmd, args: ["{args}"], allow_args: true };
            }

            if (routeViaProxychains) {
                toolDefinition = wrapToolWithProxychains(toolDefinition);
            }

            selectedTools.push(toolDefinition);
        });

        return { tools: selectedTools };
    }

    function updateShellSequenceDependency() {
        if (!shellSequenceCheckbox) {
            return;
        }

        const shellExtendedEnabled = Boolean(shellExtendedCheckbox?.checked);
        shellSequenceCheckbox.disabled = !shellExtendedEnabled;
        if (shellExtendedEnabled) {
            shellSequenceCheckbox.removeAttribute('title');
        } else {
            shellSequenceCheckbox.checked = false;
            shellSequenceCheckbox.title = 'Enable shell_extended first';
        }
    }

    function updateToolsJson() {
        const generatedConfig = buildSelectedToolsConfig();
        try {
            const currentJson = JSON.parse(toolsJsonArea.value || '{"tools": []}');
            currentJson.tools = generatedConfig.tools;
            toolsJsonArea.value = JSON.stringify(currentJson, null, 2);
        } catch (e) {
            toolsJsonArea.value = JSON.stringify(generatedConfig, null, 2);
        }
    }
    shellExtendedCheckbox?.addEventListener('change', () => {
        updateShellSequenceDependency();
        updateToolsJson();
    });
    toolCheckboxes.forEach(cb => cb.addEventListener('change', updateToolsJson));
    proxychainsRouteAllCheckbox?.addEventListener('change', updateToolsJson);
    updateShellSequenceDependency();
    updateToolsJson();

    function parsePolicyList(rawValue, defaultValue = []) {
        const lines = String(rawValue || '')
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean);
        return lines.length ? lines : defaultValue;
    }

    // ---------------------------------------------------------------
    // Fetch Models
    // ---------------------------------------------------------------
    async function fetchModelsIntoSelect({ url, button, errorLabel, selectElement, progressTitleText, successMessage, onSuccess, onFailure }) {
        if (!url) {
            showAlert('Please enter an Ollama Instance URL');
            return false;
        }

        button.disabled = true;
        if (errorLabel) {
            errorLabel.style.display = 'none';
            errorLabel.innerText = '';
        }

        progressTitle.innerText = progressTitleText || 'Fetching Models';
        progressMsg.innerText = `Connecting to ${url}...`;
        progressModal.style.display = 'flex';

        try {
            const response = await fetch('/api/models', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to fetch models');
            }

            selectElement.innerHTML = '';
            if (!data.models.length) {
                selectElement.innerHTML = '<option value="" disabled selected>No models found</option>';
                selectElement.disabled = true;
                if (onFailure) onFailure();
                showAlert('No models found in the specified Ollama instance.', 'error');
                return false;
            }

            data.models.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                selectElement.appendChild(option);
            });

            selectElement.disabled = false;
            if (onSuccess) onSuccess(data.models);
            showAlert(successMessage || `Successfully fetched ${data.models.length} models.`, 'success');
            return true;
        } catch (error) {
            showAlert(error.message, 'error');
            if (errorLabel) {
                errorLabel.innerText = `❌ ${error.message}`;
                errorLabel.style.display = 'block';
            }
            selectElement.innerHTML = '<option value="" disabled selected>Failed to load models</option>';
            selectElement.disabled = true;
            if (onFailure) onFailure(error);
            return false;
        } finally {
            button.disabled = false;
            progressModal.style.display = 'none';
        }
    }

    fetchBtn.addEventListener('click', async () => {
        const url = ollamaUrlInput.value.trim();
        await fetchModelsIntoSelect({
            url,
            button: fetchBtn,
            errorLabel: ollamaFetchError,
            selectElement: modelSelect,
            progressTitleText: 'Fetching Models',
            onSuccess: () => { startBtn.disabled = false; },
            onFailure: () => { startBtn.disabled = true; },
        });
    });

    function closeAnalysisConfigModal(result = null) {
        analysisConfigModalOverlay.style.display = 'none';
        _analysisConfigOptions = null;
        if (_analysisConfigResolver) {
            _analysisConfigResolver(result);
            _analysisConfigResolver = null;
        }
    }

    async function openAnalysisConfigModal({
        suggestedUrl = '',
        suggestedModel = '',
        title = 'Analysis Configuration',
        description = 'Choose which Ollama instance and model should be used for this analysis job.',
        confirmLabel = 'Run Analysis',
        includeSpan = false,
        defaultSpan = 'Entire Session',
        fixedSpan = null,
    } = {}) {
        if (_analysisConfigResolver) {
            closeAnalysisConfigModal(null);
        }

        _analysisConfigOptions = { includeSpan, fixedSpan };
        analysisConfigTitle.innerHTML = `<i class="ph ph-brain"></i> ${escapeHtml(title)}`;
        analysisConfigDescription.textContent = description;
        confirmAnalysisConfigBtn.textContent = confirmLabel;
        analysisOllamaUrlInput.value = suggestedUrl || ollamaUrlInput.value.trim() || 'http://localhost:11434';
        analysisFetchError.style.display = 'none';
        analysisFetchError.innerText = '';
        analysisSpanGroup.style.display = includeSpan ? 'flex' : 'none';
        analysisSpanSelect.value = defaultSpan;
        analysisModelSelect.innerHTML = suggestedModel
            ? `<option value="${escapeHtml(suggestedModel)}" selected>${escapeHtml(suggestedModel)}</option>`
            : '<option value="" disabled selected>Fetch models to load options</option>';
        analysisModelSelect.disabled = !suggestedModel;
        analysisConfigModalOverlay.style.display = 'flex';

        return new Promise(resolve => {
            _analysisConfigResolver = resolve;
        });
    }

    analysisFetchBtn.addEventListener('click', async () => {
        const url = analysisOllamaUrlInput.value.trim();
        const currentSelectedModel = analysisModelSelect.value;

        await fetchModelsIntoSelect({
            url,
            button: analysisFetchBtn,
            errorLabel: analysisFetchError,
            selectElement: analysisModelSelect,
            progressTitleText: 'Fetching Analysis Models',
            successMessage: 'Analysis models fetched successfully.',
            onSuccess: models => {
                if (currentSelectedModel && models.includes(currentSelectedModel)) {
                    analysisModelSelect.value = currentSelectedModel;
                }
            },
        });
    });

    confirmAnalysisConfigBtn.addEventListener('click', () => {
        const ollamaUrl = analysisOllamaUrlInput.value.trim();
        const model = analysisModelSelect.value;
        const span = _analysisConfigOptions?.includeSpan
            ? analysisSpanSelect.value
            : (_analysisConfigOptions?.fixedSpan || 'Entire Session');

        if (!ollamaUrl) {
            showAlert('Please enter an Ollama Instance URL', 'error');
            return;
        }
        if (!model) {
            showAlert('Fetch models and select one before running analysis.', 'error');
            return;
        }

        closeAnalysisConfigModal({ ollama_url: ollamaUrl, model, span });
    });

    cancelAnalysisConfigBtn.addEventListener('click', () => closeAnalysisConfigModal(null));
    closeAnalysisConfigBtn.addEventListener('click', () => closeAnalysisConfigModal(null));
    analysisConfigModalOverlay.addEventListener('click', (e) => {
        if (e.target === analysisConfigModalOverlay) {
            closeAnalysisConfigModal(null);
        }
    });

    // ---------------------------------------------------------------
    // Log Helpers
    // ---------------------------------------------------------------
    function getLiveLogStorageKey(runId = _currentRunId) {
        return runId ? `${LIVE_LOG_STORAGE_PREFIX}${runId}` : null;
    }

    function persistLiveLog(runId = _currentRunId) {
        const storageKey = getLiveLogStorageKey(runId);
        if (!storageKey) return;

        try {
            localStorage.setItem(storageKey, JSON.stringify({
                html: liveLogViewer.innerHTML,
                cleared: _logInitialCleared,
                savedAt: Date.now(),
            }));
            localStorage.setItem(LAST_ACTIVE_RUN_STORAGE_KEY, runId);
        } catch (err) {
            console.warn('Failed to persist live log state:', err);
        }
    }

    function restoreLiveLog(runId = _currentRunId) {
        const storageKey = getLiveLogStorageKey(runId);
        if (!storageKey) return false;

        try {
            const raw = localStorage.getItem(storageKey);
            if (!raw) return false;

            const payload = JSON.parse(raw);
            if (!payload || typeof payload.html !== 'string') return false;

            liveLogViewer.innerHTML = payload.html;
            _logInitialCleared = Boolean(payload.cleared || payload.html.trim());
            return true;
        } catch (err) {
            console.warn('Failed to restore live log state:', err);
            return false;
        }
    }

    function normalizePolicy(policy) {
        const allow = Array.isArray(policy?.allow) && policy.allow.length ? policy.allow : ['*'];
        const disallow = Array.isArray(policy?.disallow) ? policy.disallow : [];
        return { allow, disallow };
    }

    function policyPreview(entries, emptyLabel) {
        if (!entries.length) return emptyLabel;
        if (entries.length === 1) return entries[0];
        return `${entries[0]} +${entries.length - 1}`;
    }

    function formatPolicyBadge(policy) {
        const normalized = normalizePolicy(policy);
        return `Targets: allow ${policyPreview(normalized.allow, 'none')} | block ${policyPreview(normalized.disallow, 'none')}`;
    }

    function formatPolicyTooltip(policy) {
        const normalized = normalizePolicy(policy);
        const allowText = normalized.allow.length ? normalized.allow.join('\n') : 'None';
        const disallowText = normalized.disallow.length ? normalized.disallow.join('\n') : 'None';
        return `Allowed targets:\n${allowText}\n\nBlocked targets:\n${disallowText}`;
    }

    function setLiveToolsBadge(tools) {
        const toolList = Array.isArray(tools) ? tools : [];
        if (!toolList.length) {
            toolsBadge.style.display = 'none';
            toolsBadge.textContent = '';
            toolsBadge.title = '';
            toolsBadge.classList.remove('tools-badge-warning');
            return;
        }

        const hasDangerousShell = toolList.includes('shell_dangerous');
        toolsBadge.textContent = hasDangerousShell
            ? `${toolList.length} tool(s): ${toolList.join(', ')} | dangerous approval required`
            : `${toolList.length} tool(s): ${toolList.join(', ')}`;
        toolsBadge.title = hasDangerousShell
            ? `${toolList.join('\n')}\n\nWarning: shell_dangerous is enabled and requires explicit user approval before execution.`
            : toolList.join('\n');
        toolsBadge.classList.toggle('tools-badge-warning', hasDangerousShell);
        toolsBadge.style.display = 'inline-block';
    }

    function renderPolicyList(entries, emptyLabel) {
        if (!entries.length) {
            return `<li>${escapeHtml(emptyLabel)}</li>`;
        }
        return entries.map(entry => `<li>${escapeHtml(entry)}</li>`).join('');
    }

    function renderSessionSummary(session) {
        if (!session) {
            sessionSummaryPanel.style.display = 'none';
            sessionSummaryPanel.innerHTML = '';
            return;
        }

        const policy = normalizePolicy(session.network_policy);
        const availableTools = Array.isArray(session.available_tools) ? session.available_tools : [];
        const startTime = session.start_time ? new Date(session.start_time).toLocaleString() : '—';
        const model = session.model || '—';
        const ollamaUrl = session.ollama_url || '—';
        const toolCount = session.available_tool_count || availableTools.length || 0;
        const toolSummary = toolCount ? `${toolCount} tool(s)` : 'No tool inventory saved';
        const hasDangerousShell = availableTools.includes('shell_dangerous');
        const dangerousShellSummary = hasDangerousShell ? 'Enabled: user approval required before execution' : 'Not enabled';

        sessionSummaryPanel.innerHTML = `
            <div class="session-summary-grid">
                <div class="session-summary-item">
                    <span class="session-summary-label">Run ID</span>
                    <span class="session-summary-value">${escapeHtml(session.run_id || '—')}</span>
                </div>
                <div class="session-summary-item">
                    <span class="session-summary-label">Started</span>
                    <span class="session-summary-value">${escapeHtml(startTime)}</span>
                </div>
                <div class="session-summary-item">
                    <span class="session-summary-label">Model</span>
                    <span class="session-summary-value">${escapeHtml(model)}</span>
                </div>
                <div class="session-summary-item">
                    <span class="session-summary-label">Ollama URL</span>
                    <span class="session-summary-value">${escapeHtml(ollamaUrl)}</span>
                </div>
                <div class="session-summary-item">
                    <span class="session-summary-label">Tool Inventory</span>
                    <span class="session-summary-value">${escapeHtml(toolSummary)}</span>
                </div>
                <div class="session-summary-item ${hasDangerousShell ? 'session-summary-item-warning' : ''}">
                    <span class="session-summary-label">Dangerous Shell</span>
                    <span class="session-summary-value">${escapeHtml(dangerousShellSummary)}</span>
                </div>
                <div class="session-summary-item">
                    <span class="session-summary-label">Target Policy</span>
                    <span class="session-summary-value">${escapeHtml(formatPolicyBadge(policy))}</span>
                </div>
            </div>
            <div class="session-policy-blocks">
                <div class="session-policy-card">
                    <h4>Allowed Targets</h4>
                    <ul class="session-policy-list">${renderPolicyList(policy.allow, 'None')}</ul>
                </div>
                <div class="session-policy-card">
                    <h4>Blocked Targets</h4>
                    <ul class="session-policy-list">${renderPolicyList(policy.disallow, 'None')}</ul>
                </div>
            </div>
        `;
        sessionSummaryPanel.style.display = 'flex';
    }

    function setLivePolicyBadge(policy) {
        if (!policyBadge) return;
        if (!policy) {
            policyBadge.style.display = 'none';
            policyBadge.textContent = '';
            policyBadge.title = '';
            return;
        }

        policyBadge.textContent = formatPolicyBadge(policy);
        policyBadge.title = formatPolicyTooltip(policy);
        policyBadge.style.display = 'inline-block';
    }

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
        persistLiveLog();
    }
    function clearLog() {
        liveLogViewer.innerHTML = '';
        _logInitialCleared = false;
        persistLiveLog();
    }
    function closeSse() {
        if (_eventSource) { _eventSource.close(); _eventSource = null; }
    }

    // ---------------------------------------------------------------
    // Start / Stop Service
    // ---------------------------------------------------------------
    function askToStopSession(runId = null) {
        _sessionToStopId = runId;
        confirmModalOverlay.style.display = 'flex';
    }

    confirmCancelBtn.addEventListener('click', () => {
        confirmModalOverlay.style.display = 'none';
        _sessionToStopId = null;
    });

    confirmStopBtn.addEventListener('click', () => {
        confirmModalOverlay.style.display = 'none';
        if (_sessionToStopId) {
            stopTargetedSession(_sessionToStopId);
        } else {
            stopService();
        }
    });

    chatStopBtn.addEventListener('click', () => askToStopSession(null));

    function closePostToolReplyModal() {
        _awaitingPostToolReplyDecision = false;
        postToolReplyModalOverlay.style.display = 'none';
        retryPostToolReplyBtn.disabled = false;
        cancelPostToolReplyBtn.disabled = false;
    }

    async function resolvePostToolReply(action) {
        if (!_serviceRunning || !_awaitingPostToolReplyDecision) return;

        retryPostToolReplyBtn.disabled = true;
        cancelPostToolReplyBtn.disabled = true;

        try {
            const response = await fetch('/api/session/post_tool_reply_action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action })
            });
            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Could not resolve post-tool reply decision.');
            }

            closePostToolReplyModal();
        } catch (error) {
            retryPostToolReplyBtn.disabled = false;
            cancelPostToolReplyBtn.disabled = false;
            showAlert(error.message, 'error');
        }
    }

    retryPostToolReplyBtn.addEventListener('click', () => resolvePostToolReply('retry'));
    cancelPostToolReplyBtn.addEventListener('click', () => resolvePostToolReply('cancel'));

    function closeDangerousToolModal() {
        _awaitingDangerousToolApproval = false;
        dangerousToolModalOverlay.style.display = 'none';
        approveDangerousToolBtn.disabled = false;
        cancelDangerousToolBtn.disabled = false;
    }

    async function resolveDangerousToolApproval(action) {
        if (!_serviceRunning || !_awaitingDangerousToolApproval) return;

        approveDangerousToolBtn.disabled = true;
        cancelDangerousToolBtn.disabled = true;

        try {
            const response = await fetch('/api/session/dangerous_tool_action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action })
            });
            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Could not resolve dangerous tool approval.');
            }

            closeDangerousToolModal();
        } catch (error) {
            approveDangerousToolBtn.disabled = false;
            cancelDangerousToolBtn.disabled = false;
            showAlert(error.message, 'error');
        }
    }

    approveDangerousToolBtn.addEventListener('click', () => resolveDangerousToolApproval('approve'));
    cancelDangerousToolBtn.addEventListener('click', () => resolveDangerousToolApproval('cancel'));

    async function stopTargetedSession(runId) {
        try {
            const response = await fetch(`/api/sessions/${runId}/stop`, { method: 'POST' });
            const data = await response.json();
            if (data.success) {
                showAlert(data.message, 'success');
                loadSessions(); 
                if (runId === _currentRunId) {
                    handleServiceStopped();
                }
            } else {
                throw new Error(data.error || 'Failed to stop session');
            }
        } catch (error) {
            showAlert(error.message);
        } finally {
            _sessionToStopId = null;
        }
    }

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
        const maxTurns = parseInt(maxTurnsInput.value, 10);
        const networkPolicy = {
            allow: parsePolicyList(allowTargetsInput?.value, ['*']),
            disallow: parsePolicyList(disallowTargetsInput?.value, []),
        };

        if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 100) {
            showAlert('Max tool/model turns per prompt must be between 1 and 100.', 'error');
            return;
        }

        let command = '';
        if (cmdType === 'python') {
            command = 'python3 mcp_kali.py';
        } else if (cmdType === 'apt') {
            command = 'python3 apt_logger_wrapper.py';
        }
        if (extraArgs) command += ' ' + extraArgs;

        let toolsConfig = null;
        if (cmdType !== 'apt') {
            updateToolsJson();
            try { toolsConfig = JSON.parse(toolsJsonArea.value); }
            catch (e) { showAlert('Invalid JSON formatting in kali_tools.json editor.', 'error'); return; }
            if (!Array.isArray(toolsConfig.tools) || toolsConfig.tools.length === 0) {
                showAlert('Select at least one Kali tool before starting a native session.', 'error');
                return;
            }
        }

        if (!model || !command) return;

        setConfigEnabled(false);
        startBtn.innerHTML = ICON_SVG.SPINNER + '<span>Starting service…</span>';
        startBtn.disabled = true;
        updateStatus('running', 'Starting service…');

        clearLog();
        liveLogPanel.style.display = 'flex';
        appendLog('<i class="ph ph-spinner-gap spin"></i> Launching MCP service…', 'log-status');

        try {
            const response = await fetch('/api/session/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, model, server_command: command, tools_config: toolsConfig, context_window: contextWindow, max_turns: maxTurns, network_policy: networkPolicy })
            });
            const data = await response.json();

            if (data.success) {
                _serviceRunning = true;
                _currentRunId = data.run_id;
                _sessionsById[data.run_id] = {
                    run_id: data.run_id,
                    network_policy: data.network_policy || networkPolicy,
                    available_tools: Array.isArray(data.tools) ? data.tools : [],
                    available_tool_count: Array.isArray(data.tools) ? data.tools.length : 0,
                    ...(data.metadata || {}),
                };
                persistLiveLog();
                
                // Switch button to Stop state
                startBtn.className = 'btn btn-danger';
                startBtn.innerHTML = ICON_SVG.STOP + '<span>Stop Service</span>';
                startBtn.disabled = false;

                if (data.tools && data.tools.length) {
                    setLiveToolsBadge(data.tools);
                }
                setLivePolicyBadge(data.network_policy || networkPolicy);
                
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

    function resizeChatPromptInput() {
        const minHeight = 52;
        const maxHeight = 250;
        const viewportScrollY = window.scrollY;

        chatPromptInput.style.height = 'auto';
        const nextHeight = Math.max(minHeight, Math.min(maxHeight, chatPromptInput.scrollHeight));
        chatPromptInput.style.height = `${nextHeight}px`;

        // Keep the viewport stable while the auto-growing prompt recalculates.
        if (document.activeElement === chatPromptInput && window.scrollY !== viewportScrollY) {
            window.scrollTo({ top: viewportScrollY, left: window.scrollX });
        }
    }

    chatPromptInput.addEventListener('input', function() {
        resizeChatPromptInput();
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
        resizeChatPromptInput();
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
        closePostToolReplyModal();
        
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
        sendPromptBtn.innerHTML = ICON_SVG.SPINNER;

        appendLog('<span class="log-label">⏹️</span> Cancelling prompt...', 'log-status');
        
        try {
            await fetch('/api/session/cancel_prompt', { method: 'POST' });
        } catch (error) {
            appendLog(`<span class="log-label">❌ Error</span> ${escapeHtml('Failed to send cancel signal.')}`, 'log-error');
            sendPromptBtn.disabled = false;
            sendPromptBtn.innerHTML = ICON_SVG.STOP;
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
        if (action === 'analyze') {
            annotationMenu.classList.remove('show');
            openAnalysisConfigModal({
                suggestedUrl: ollamaUrlInput.value.trim(),
                suggestedModel: modelSelect.value,
                title: 'Analyze Live Logs',
                description: 'Choose a log window plus the Ollama instance and model for this background analysis job.',
                includeSpan: true,
                defaultSpan: 'Event Point',
                confirmLabel: 'Run Analysis',
            }).then(async analysisConfig => {
                if (!analysisConfig || !_currentRunId) {
                    return;
                }

                try {
                    const response = await fetch(`/api/sessions/${_currentRunId}/analyze`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(analysisConfig)
                    });
                    const data = await response.json();

                    if (data.success) {
                        showAlert('Background analysis job started. Check the Analysis Jobs tab.', 'success');
                        switchTab('analysis-pane');
                        loadAnalysisJobs();
                        startAnalysisJobsPolling();
                    } else {
                        showAlert('Live Analysis failed: ' + (data.error || 'Unknown error'), 'error');
                    }
                } catch (err) {
                    showAlert('Failed to analyze logs: ' + err.message, 'error');
                }
            });
            return;
        }

        annotationModalOverlay.style.display = 'flex';
        annotationAction.value = action;

        if (action === 'annotate') {
            modalTitle.innerHTML = '<i class="ph ph-note-pencil"></i> Add Observation';
            annotationTextGroup.style.display = 'flex';
            saveAnnotationBtn.textContent = 'Save Note';
            setTimeout(() => annotationText.focus(), 100);
        } else {
            modalTitle.innerHTML = '<i class="ph ph-note-pencil"></i> Add Observation';
            annotationTextGroup.style.display = 'flex';
            saveAnnotationBtn.textContent = 'Save Note';
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
            if (action === 'annotate') {
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
            } else {
                showAlert('Unsupported annotation action.', 'error');
            }
        } catch (err) {
            showAlert(`Failed to ${action}: ` + err.message, 'error');
        } finally {
            saveAnnotationBtn.disabled = false;
            saveAnnotationBtn.textContent = 'Save Note';
        }
    });

    // Stop Service (Handled by startBtn toggle)
    // ---------------------------------------------------------------
    function handleServiceStopped() {
        if (!_serviceRunning && statusText.textContent === 'Idle') return; // Already cleaned up

        const stoppedRunId = _currentRunId;
        _serviceRunning = false;
        _chatBusy = false;
        _currentRunId = null;
        _logInitialCleared = false; // Reset for next run
        updateStatus('success', 'Service Stopped');
        closePostToolReplyModal();

        if (stoppedRunId) {
            persistLiveLog(stoppedRunId);
        }
        
        resetStartBtn();
        setConfigEnabled(true);
        setLiveToolsBadge([]);
        setLivePolicyBadge(null);
        
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
            case 'status': {
                const transientRecoveryStatuses = [
                    'Model failed to produce a final reply after tools. Waiting for user decision: retry or cancel and restore.',
                    'Model returned an empty post-tool reply; retrying once without tools for a final answer …',
                ];
                if (!transientRecoveryStatuses.includes(event.message || '')) {
                    appendLog(`<span class="log-label">ℹ️ Status</span> ${escapeHtml(event.message)}`, 'log-status');
                }
                break;
            }
            case 'context_usage': updateContextBar(event); break;
            case 'service_started': appendLog(`<span class="log-label">🟢 Service Started</span>`, 'log-done'); break;
            case 'service_stopped': appendLog(`<span class="log-label">🔴 Service Stopped</span>`, 'log-status'); break;
            case 'post_tool_reply_decision':
                _awaitingPostToolReplyDecision = true;
                postToolReplyMessage.textContent = event.message || 'The model completed the tool calls but returned an empty final reply.';
                postToolReplyModalOverlay.style.display = 'flex';
                break;
            case 'dangerous_tool_approval':
                _awaitingDangerousToolApproval = true;
                dangerousToolMessage.textContent = event.message || 'The model requested a dangerous shell command.';
                dangerousToolCommand.textContent = String(event.command || '');
                dangerousToolModalOverlay.style.display = 'flex';
                break;
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
            _sessionsById = Object.fromEntries((data.sessions || []).map(session => [session.run_id, session]));
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
                    ${s.status === 'running' ? `<button class="btn-stop-session" title="Stop Running Session" data-stop-run="${s.run_id}">${ICON_SVG.STOP}</button>` : ''}
                </div>
            </div>`;
        }).join('');
        
        sessionsList.querySelectorAll('.session-card').forEach(card => card.addEventListener('click', (e) => {
            if (e.target.closest('.btn-stop-session')) return; // Ignore card click if stop button pressed
            openSession(card.dataset.run)
        }));

        sessionsList.querySelectorAll('.btn-stop-session').forEach(btn => btn.addEventListener('click', (e) => {
            e.stopPropagation();
            askToStopSession(btn.dataset.stopRun);
        }));
    }

    async function openSession(runId) {
        _browseRunId = runId; sessionDetail.style.display = 'block';
        sessionsList.querySelectorAll('.session-card').forEach(c => c.classList.toggle('active', c.dataset.run === runId));
        sessionDownloadBtn.style.display = 'inline-block';
        sessionAnalyzeBtn.style.display = 'inline-block';
        renderSessionSummary(_sessionsById[runId]);
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

        const analysisConfig = await openAnalysisConfigModal({
            suggestedUrl: ollamaUrlInput.value.trim(),
            suggestedModel: modelSelect.value,
            title: 'Analyze Session',
            description: 'Choose which Ollama instance and model should be used for this session analysis job.',
            fixedSpan: 'Entire Session',
        });
        if (!analysisConfig) {
            return;
        }

        const originalText = sessionAnalyzeBtn.innerHTML;
        sessionAnalyzeBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Analyzing...';
        sessionAnalyzeBtn.disabled = true;

        try {
            const res = await fetch(`/api/sessions/${_browseRunId}/analyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(analysisConfig)
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
                if (data.metadata?.run_id) {
                    _sessionsById[data.metadata.run_id] = data.metadata;
                }

                // Sync UI elements
                setConfigEnabled(false);
                startBtn.className = 'btn btn-danger';
                startBtn.innerHTML = ICON_SVG.STOP + '<span>Stop Service</span>';
                startBtn.disabled = false;

                updateStatus('running', 'Service Running - Chat Active');

                if (Array.isArray(data.metadata?.available_tools) && data.metadata.available_tools.length) {
                    setLiveToolsBadge(data.metadata.available_tools);
                }
                setLivePolicyBadge(data.metadata?.network_policy || null);

                if (!restoreLiveLog(_currentRunId)) {
                    _logInitialCleared = liveLogViewer.children.length > 0;
                }
                
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
            } else {
                setLiveToolsBadge([]);
                setLivePolicyBadge(null);
                const lastRunId = localStorage.getItem(LAST_ACTIVE_RUN_STORAGE_KEY);
                if (lastRunId) {
                    restoreLiveLog(lastRunId);
                }
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
            const statusDetail = String(job.status_detail || '').trim();
            const lastUpdateText = job.last_update_time ? new Date(job.last_update_time).toLocaleTimeString() : '';
            const responsePreviewSource = String(job.response || job.result || job.result_preview || '').trim();
            const responsePreview = responsePreviewSource
                ? escapeHtml(responsePreviewSource.replace(/\s+/g, ' ').slice(0, 280))
                : '';
            
            return `
                <div class="job-card">
                    <div class="job-header">
                        <div class="job-info">
                            <div class="job-id">${job.job_id}</div>
                            <div class="job-title">Analysis: ${job.run_id}</div>
                        </div>
                        <div class="job-card-controls">
                            <div class="job-status-badge ${statusClass}">
                                <i class="ph ${statusIcon}"></i>
                                <span>${job.status}</span>
                            </div>
                            <div class="dropdown job-actions-dropdown">
                                <button class="btn btn-secondary job-actions-toggle" type="button" data-job-id="${job.job_id}">
                                    <span>Actions</span>
                                    <i class="ph ph-caret-down"></i>
                                </button>
                                <ul class="dropdown-menu job-actions-menu" data-job-id="${job.job_id}">
                                    <li data-action="view" data-job-id="${job.job_id}"><i class="ph ph-eye"></i> View</li>
                                    <li data-action="copy" data-job-id="${job.job_id}"><i class="ph ph-copy"></i> Copy Response</li>
                                    <li data-action="download" data-job-id="${job.job_id}"><i class="ph ph-download-simple"></i> Download</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                    ${(job.status === 'running' || statusDetail) ? `
                        <div class="job-progress ${job.status === 'running' ? 'job-progress-active' : ''}">
                            <span class="job-progress-label">${escapeHtml(statusDetail || (job.status === 'running' ? 'Working' : job.status || 'Unknown'))}</span>
                            ${lastUpdateText ? `<span class="job-progress-meta">Updated ${escapeHtml(lastUpdateText)}</span>` : ''}
                        </div>
                    ` : ''}
                    ${job.status === 'success' && responsePreview ? `
                        <div class="job-preview">
                            <span class="job-preview-label">Response Preview</span>
                            <p class="job-preview-text">${responsePreview}</p>
                        </div>
                    ` : ''}
                    <div class="job-footer">
                        <div class="job-meta">
                            <span><i class="ph ph-calendar"></i> ${date}</span>
                            <span><i class="ph ph-clock"></i> ${job.span}</span>
                        </div>
                        ${job.status === 'failed' ? `
                            <div class="status-error" style="font-size: 0.8rem;">Error: ${escapeHtml(job.error)}</div>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');

        analysisJobsList.querySelectorAll('.job-actions-toggle').forEach(btn => {
            btn.addEventListener('click', (event) => {
                event.stopPropagation();
                const jobId = btn.dataset.jobId;
                const menu = analysisJobsList.querySelector(`.job-actions-menu[data-job-id="${jobId}"]`);
                const isOpen = menu.classList.contains('show');
                closeAnalysisJobMenus();
                if (!isOpen) {
                    menu.classList.add('show');
                }
            });
        });

        analysisJobsList.querySelectorAll('.job-actions-menu li').forEach(item => {
            item.addEventListener('click', (event) => {
                event.stopPropagation();
                const { action, jobId } = item.dataset;
                closeAnalysisJobMenus();
                if (action === 'view') {
                    window.viewAnalysisResult(jobId);
                } else if (action === 'copy') {
                    window.copyAnalysisJobResponse(jobId);
                } else if (action === 'download') {
                    window.downloadAnalysisJob(jobId);
                }
            });
        });
    }

    function closeAnalysisJobMenus() {
        analysisJobsList.querySelectorAll('.job-actions-menu.show').forEach(menu => {
            menu.classList.remove('show');
        });
    }

    window.viewAnalysisResult = async function(jobId) {
        try {
            const res = await fetch(`/api/analysis/jobs/${jobId}`);
            const job = await res.json();
            
            if (job) {
                const responseSource = String(
                    job.response
                    || job.result
                    || job.raw_response?.message?.content
                    || 'No response captured yet.'
                );
                const modal = document.createElement('div');
                modal.className = 'modal-overlay';
                modal.style.display = 'flex';
                const renderedResponse = responseSource ? marked.parse(responseSource) : '<p>No response captured yet.</p>';
                const renderedSystemPrompt = escapeHtml(job.system_prompt || 'Not captured.');
                const renderedUserPrompt = escapeHtml(job.user_prompt || 'Not captured.');
                const renderedError = job.error ? `<div class="status-error" style="margin-bottom: 1rem;">${escapeHtml(job.error)}</div>` : '';
                modal.innerHTML = `
                    <div class="annotation-modal" style="max-width: 800px; width: 90%;">
                        <div class="modal-header">
                            <h3><i class="ph ph-brain"></i> Analysis Job: ${job.run_id}</h3>
                            <button type="button" class="icon-btn" onclick="this.closest('.modal-overlay').remove()"><i class="ph ph-x"></i></button>
                        </div>
                        <div class="modal-body" style="max-height: 60vh; overflow-y: auto; padding: 1.5rem; background: rgba(0,0,0,0.2); border-radius: 12px; margin: 1rem;">
                            <div style="display: grid; gap: 1rem; font-size: 0.95rem; line-height: 1.6; color: var(--text-primary);">
                                <div>
                                    <strong>Status:</strong> ${escapeHtml(job.status || 'unknown')}<br>
                                    <strong>Span:</strong> ${escapeHtml(job.span || 'unknown')}<br>
                                    <strong>Ollama URL:</strong> ${escapeHtml(job.ollama_url || 'unknown')}<br>
                                    <strong>Model:</strong> ${escapeHtml(job.model || 'unknown')}
                                </div>
                                ${renderedError}
                                <div>
                                    <h4 style="margin-bottom: 0.5rem;">System Prompt</h4>
                                    <pre class="log-pre" style="white-space: pre-wrap;">${renderedSystemPrompt}</pre>
                                </div>
                                <div>
                                    <h4 style="margin-bottom: 0.5rem;">User Prompt</h4>
                                    <pre class="log-pre" style="white-space: pre-wrap;">${renderedUserPrompt}</pre>
                                </div>
                                <div>
                                    <h4 style="margin-bottom: 0.5rem;">Response</h4>
                                    <div class="markdown-body" style="font-size: 0.95rem; line-height: 1.6; color: var(--text-primary);">
                                        ${renderedResponse}
                                    </div>
                                </div>
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

    window.downloadAnalysisJob = function(jobId) {
        window.location.href = `/api/analysis/jobs/${jobId}/download`;
    };

    window.copyAnalysisJobResponse = async function(jobId) {
        try {
            const res = await fetch(`/api/analysis/jobs/${jobId}`);
            const job = await res.json();
            const responseSource = String(
                job.response
                || job.result
                || job.raw_response?.message?.content
                || ''
            ).trim();

            if (!responseSource) {
                showAlert('No analysis response is available to copy.', 'error');
                return;
            }

            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(responseSource);
            } else {
                const tempArea = document.createElement('textarea');
                tempArea.value = responseSource;
                tempArea.setAttribute('readonly', '');
                tempArea.style.position = 'absolute';
                tempArea.style.left = '-9999px';
                document.body.appendChild(tempArea);
                tempArea.select();
                document.execCommand('copy');
                tempArea.remove();
            }

            showAlert('Analysis response copied to clipboard.', 'success');
        } catch (err) {
            showAlert('Failed to copy analysis response: ' + err.message, 'error');
        }
    };

    document.addEventListener('click', (event) => {
        if (!event.target.closest('.job-actions-dropdown')) {
            closeAnalysisJobMenus();
        }
    });

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
