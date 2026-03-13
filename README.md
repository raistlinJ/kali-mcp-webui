# Kali MCP WebUI

A privacy-preserving, fully localized agentic penetration testing platform. Kali MCP WebUI bridges the gap between Large Language Models (LLMs) and native cybersecurity toolchains by utilizing the Model Context Protocol (MCP).

Unlike cloud-dependent conversational hacking tools, this platform ensures that your proprietary network layouts, vulnerability telemetry, and zero-day discoveries never leave your perimeter by orchestrating everything through a local LLM instance (like Ollama).

## Core Capabilities

*   **Fully Localized Execution**: Runs entirely on your local machine or trusted VM. No API keys, no cloud data leaks.
*   **Agentic Tool Execution**: The LLM autonomously triggers local Kali Linux utilities (e.g., `nmap`, `gobuster`, `ping`) via the MCP server and integrates the raw output directly into its reasoning loop.
*   **Synchronous Subprocess Blocking**: Prevents LLM hallucinations by forcing the agent to wait for long-running processes to complete in the foreground.
*   **Comprehensive Audit Trails**: Generates structured JSON tool execution logs and beautiful, human-readable Markdown transcripts for every session.
*   **Human-in-the-Loop (HITL) Annotations**: Analysts can actively insert timestamped notes and tag areas of interest mid-execution to guide the agent or flag data for later review.
*   **Live Span Analysis**: Seamlessly analyze the last *N* minutes of a live engagement using a one-shot LLM inference to generate rapid pivoting strategies or identify execution bottlenecks in real-time.
*   **Post-Mortem Session Analysis**: Feed an entire past session transcript (along with your manual annotations) back into the LLM to auto-generate narrative success summaries, highlight critical vulnerabilities, and pinpoint areas for methodological optimization.
*   **Session Archiving**: Download entire session directories—including the generated artifacts, tool schemas, and transcription—as self-contained ZIP archives.

## Architecture

*   **Frontend**: A responsive Vanilla HTML/JS/CSS WebUI with a persistent chat console, real-time token tracking, dynamic tool execution indicators, and a session browser.
*   **Middleware Orchestrator**: A Python Flask server (`app.py`) that handles RESTful routing and streams real-time interaction events to the frontend via Server-Sent Events (SSE).
*   **MCP Client Engine**: `mcp_client.py` acts as the intelligent broker, managing the context window, parsing LLM payloads, and mapping them to standard I/O subprocess executions.
*   **LLM Backend**: Powered by the Python `ollama` library, driving conversational endpoints against a local model (e.g., `llama3`).
*   **MCP Server (Kali)**: A localized script (`mcp_kali.py`) that securely wraps standard Kali utilities and exposes them as callable functions to the Client Engine.

## Requirements

*   **OS**: Kali Linux (recommended) or any Debian-based distribution with standard security tools installed.
*   **Python**: 3.10+
*   **LLM Provider**: [Ollama](https://ollama.com/) running locally.
*   **Model**: A capable tool-calling model pulled into Ollama (e.g., `ollama run llama3` or `llama3.1`).
*   **Python Dependencies**:
    *   `Flask`
    *   `mcp` (Official Model Context Protocol SDK)
    *   `ollama`
    *   `asyncio`

## Installation & Setup

1.  **Clone the Repository**
    ```bash
    git clone https://github.com/raistlinJ/kali-mcp-webui.git
    cd kali-mcp-webui
    ```

2.  **Set up a Virtual Environment (Optional but Recommended)**
    ```bash
    python3 -m venv venv
    source venv/bin/activate
    ```

3.  **Install Dependencies**
    ```bash
    pip install Flask mcp ollama
    ```

4.  **Ensure Ollama is Running**
    *   Start the Ollama service on your machine.
    *   Ensure you have downloaded your preferred model: `ollama pull llama3`

## Running the Application

1.  **Start the Web Server**
    From the project root directory, run:
    ```bash
    python3 app.py
    ```
    *(By default, the Flask server will launch on `http://localhost:5055`)*

2.  **Access the Dashboard**
    Open a web browser and navigate to `http://localhost:5055`.

3.  **Configure and Start the Engine**
    *   Navigate to the **Configuration** tab in the WebUI.
    *   Click **Fetch Models** to populate the dropdown with your local Ollama models.
    *   Select your model (e.g., `llama3`).
    *   Allocate your desired Context Window (Default: 8K).
    *   Click **Start Service**. The dot indicator should turn green.

4.  **Begin Testing**
    *   Switch to the **Live Chat** tab.
    *   Issue a natural language command (e.g., *"Run a fast nmap scan against scanme.nmap.org"*).
    *   Watch as the agent dynamically executes the tool in the foreground, streams the output, and returns an analysis!

## Using the Observation & Analysis Engine

### Live Span Analysis
If you get stuck during an engagement:
1. Click the **Annotate (pencil icon)** button next to the chat prompt.
2. Change the action dropdown to **🪄 Analyze Logs**.
3. Select a timeframe (e.g., **"Last 5 Minutes"**).
4. Click **Run Analysis**. The LLM will parse only that specific window of execution and inject tactical suggestions directly into your active chat feed.

### Post-Mortem Analysis
To review completed work:
1. Ensure the backend Service is active in the Configuration tab.
2. Navigate to the **Past Sessions** tab and select a previous run.
3. Click the **🪄 Analyze Session** button in the top right.
4. An **Analysis** tab will render an AI-generated review of the session, highlighting unused tools and efficiency optimizations. 

---
*Developed for advanced, privacy-first agentic infrastructure.*
