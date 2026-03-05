document.addEventListener('DOMContentLoaded', () => {
    const fetchBtn = document.getElementById('fetch-models-btn');
    const connectBtn = document.getElementById('connect-btn');
    const modelSelect = document.getElementById('model-select');
    const ollamaUrlInput = document.getElementById('ollama-url');

    // Kali fields
    const kaliCommandType = document.getElementById('kali-command-type');
    const customCommandGroup = document.getElementById('custom-command-group');
    const kaliCustomCommand = document.getElementById('kali-custom-command');
    const toolsConfigSection = document.getElementById('tools-config-section');

    const statusBadge = document.getElementById('status-badge');
    const statusText = statusBadge.querySelector('.status-text');
    const alertsContainer = document.getElementById('alerts-container');

    // UI toggle for custom command & tools config
    kaliCommandType.addEventListener('change', (e) => {
        const selected = e.target.value;

        // Show/hide custom command input
        if (selected === 'custom') {
            customCommandGroup.style.display = 'flex';
        } else {
            customCommandGroup.style.display = 'none';
        }

        // Hide Kali Tools Builder if using the pre-bundled docker/apt packages
        if (selected === 'docker' || selected === 'apt') {
            toolsConfigSection.style.display = 'none';
        } else {
            toolsConfigSection.style.display = 'block';
        }
    });



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

        // Sudo environments often mismatch $HOME. Check absolute root paths first, then try the user's home aliased paths
        const uvResolver = "$( [ -f /root/.local/bin/uv ] && echo /root/.local/bin/uv || [ -f /root/.cargo/bin/uv ] && echo /root/.cargo/bin/uv || [ -f ~/.local/bin/uv ] && echo ~/.local/bin/uv || echo ~/.cargo/bin/uv )";

        if (cmdType === 'python') {
            command = `bash -c '${uvResolver} run --with mcp mcp_kali.py'`;
        } else if (cmdType === 'apt') {
            command = `bash -c '${uvResolver} run --with mcp --with requests /usr/share/mcp-kali-server/mcp_server.py'`;
        } else if (cmdType === 'docker') {
            command = "docker run -i --rm -e KALI_HOST=your-host -e KALI_USER=your-user -e KALI_PASS=your-pass mcpmarket/mcp-kali-server"; // Placeholder
        } else {
            command = kaliCustomCommand.value.trim();
        }

        if (extraArgs) {
            command += " " + extraArgs;
        }

        const toolsConfigStr = document.getElementById('kali-tools-json').value;
        let toolsConfig = null;

        // Only parse and pass the tools JSON if we are using an engine that requires it (Native Python or Custom)
        if (cmdType !== 'apt' && cmdType !== 'docker') {
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
});
