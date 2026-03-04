document.addEventListener('DOMContentLoaded', () => {
    const fetchBtn = document.getElementById('fetch-models-btn');
    const connectBtn = document.getElementById('connect-btn');
    const modelSelect = document.getElementById('model-select');
    const ollamaUrlInput = document.getElementById('ollama-url');

    // Kali fields
    const kaliCommandType = document.getElementById('kali-command-type');
    const customCommandGroup = document.getElementById('custom-command-group');
    const kaliCustomCommand = document.getElementById('kali-custom-command');

    const statusBadge = document.getElementById('status-badge');
    const statusText = statusBadge.querySelector('.status-text');
    const alertsContainer = document.getElementById('alerts-container');

    // UI toggle for custom command
    kaliCommandType.addEventListener('change', (e) => {
        if (e.target.value === 'custom') {
            customCommandGroup.style.display = 'flex';
        } else {
            customCommandGroup.style.display = 'none';
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
        let command = "";

        if (cmdType === 'npx') {
            command = "npx -y @smithery/cli run mcp-kali-server";
        } else if (cmdType === 'docker') {
            command = "docker run -i --rm -e KALI_HOST=your-host -e KALI_USER=your-user -e KALI_PASS=your-pass mcpmarket/mcp-kali-server"; // Placeholder
        } else {
            command = kaliCustomCommand.value.trim();
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
                body: JSON.stringify({ url, model, server_command: command })
            });

            const data = await response.json();

            if (data.success) {
                updateStatus('success', `Launched ${model}`);
                showAlert('Terminal launched with ollmcp and Kali server connected!', 'success');
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
});
