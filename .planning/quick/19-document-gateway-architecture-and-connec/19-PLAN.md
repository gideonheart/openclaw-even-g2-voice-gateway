---
phase: quick-19
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - README.md
  - docs/architecture.md
  - .env.example
autonomous: true
requirements: [DOC-01]

must_haves:
  truths:
    - "README.md explains the PORT vs OPENCLAW_GATEWAY_URL distinction clearly"
    - "README.md contains an ASCII connection flow diagram showing G2 Frontend -> Voice Gateway -> OpenClaw"
    - "Remote access guidance is documented (use server IP/hostname instead of localhost)"
    - ".env.example has inline comments clarifying each URL's role"
  artifacts:
    - path: "README.md"
      provides: "Connection architecture section with flow diagram and port explanation"
      contains: "Connection Architecture"
    - path: "docs/architecture.md"
      provides: "Updated system context diagram showing ports and URLs"
      contains: "4400"
    - path: ".env.example"
      provides: "Annotated env template with URL role comments"
      contains: "gateway listen port"
  key_links:
    - from: "README.md"
      to: "docs/architecture.md"
      via: "cross-reference link"
      pattern: "docs/architecture.md"
---

<objective>
Document the gateway connection architecture, URL/port distinction, and connection flow in README.md, docs/architecture.md, and .env.example.

Purpose: New users and operators need to understand that PORT=4400 is where the gateway listens for G2 frontend connections, while OPENCLAW_GATEWAY_URL is where the gateway connects upstream to OpenClaw. The connection chain (G2 Frontend -> ws://localhost:4400 -> Voice Gateway -> ws://127.0.0.1:3434 -> OpenClaw) must be visually clear. Remote access guidance (use server IP/hostname) must also be documented.

Output: Updated README.md with Connection Architecture section, updated docs/architecture.md with port-annotated diagram, and annotated .env.example.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@README.md
@docs/architecture.md
@.env.example
@ARCHITECTURE.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add Connection Architecture section to README.md and update .env.example</name>
  <files>README.md, .env.example</files>
  <action>
In README.md, add a new "## Connection Architecture" section immediately after the existing "## How It Works" section. This section must contain:

1. A clear explanation of the two distinct network roles:
   - **PORT** (default 4400): The port this gateway listens on. The G2 frontend (chat app) connects here.
   - **OPENCLAW_GATEWAY_URL** (e.g., ws://127.0.0.1:3434): The upstream OpenClaw WebSocket endpoint that the gateway connects TO as a client.

2. An ASCII connection flow diagram:
```
G2 Frontend (Chat App)
       |
       |  HTTP POST /api/voice/turn
       v
ws://localhost:4400          <-- Gateway listens here (PORT=4400)
  Voice Gateway (this repo)
       |
       |  WebSocket (connect.challenge / hello-ok)
       v
ws://127.0.0.1:3434         <-- Gateway connects here (OPENCLAW_GATEWAY_URL)
  OpenClaw Agent
```

3. A "### Remote Access" subsection explaining:
   - By default, localhost URLs only work when frontend and gateway run on the same machine.
   - For remote G2 devices or frontends on other machines, replace `localhost` with the server's LAN IP or hostname (e.g., `ws://192.168.1.x:4400` or `ws://your-server.domain:4400`).
   - The HOST=0.0.0.0 default already binds to all interfaces, so remote connections work without config changes on the gateway side -- only the frontend's target URL needs updating.
   - OPENCLAW_GATEWAY_URL similarly should use the OpenClaw server's actual IP if it runs on a different machine.

In .env.example, add inline comments to clarify the role of each URL-related variable. Update the file to:

```
# === OpenClaw Upstream Connection ===
# The WebSocket URL where this gateway connects TO the OpenClaw agent.
# This is NOT where the gateway listens -- it's the upstream target.
# Use the actual IP/hostname if OpenClaw runs on a different machine.
OPENCLAW_GATEWAY_URL=ws://localhost:3000
OPENCLAW_GATEWAY_TOKEN=your-auth-token-here
OPENCLAW_SESSION_KEY=your-session-key-here

# === STT Provider ===
# Provider selection: whisperx | openai | custom
STT_PROVIDER=whisperx

# WhisperX (self-hosted)
WHISPERX_BASE_URL=https://your-whisperx-host

# OpenAI STT
OPENAI_API_KEY=your-openai-api-key-here

# Custom HTTP STT
CUSTOM_STT_URL=https://your-stt-endpoint
CUSTOM_STT_AUTH=Bearer your-token-here

# === Server (Gateway Listen Port) ===
# PORT is where THIS gateway listens for incoming connections from the
# G2 frontend chat app. Clients connect TO this port.
# For remote access, clients should use ws://<server-ip>:4400 instead of localhost.
PORT=4400
HOST=0.0.0.0
CORS_ORIGINS=http://localhost:3001
```
  </action>
  <verify>
    <automated>grep -q "Connection Architecture" README.md && grep -q "gateway listen" .env.example && grep -q "Remote Access" README.md && echo "PASS" || echo "FAIL"</automated>
  </verify>
  <done>README.md has a Connection Architecture section with flow diagram, port distinction explanation, and remote access guidance. .env.example has inline comments clarifying URL roles.</done>
</task>

<task type="auto">
  <name>Task 2: Update docs/architecture.md with port-annotated connection diagram</name>
  <files>docs/architecture.md</files>
  <action>
In docs/architecture.md, update the existing "## System Context" ASCII diagram to include port numbers and URL annotations. Replace the current diagram with a more detailed version that shows the actual ports and connection URLs:

```
## System Context

```
┌─────────────────────┐                          ┌──────────────────────┐
│  Even G2 Chat App   │   HTTP POST :4400        │   Voice Gateway      │
│  (separate repo)    │ ───────────────────────►  │   (this repo)        │
│                     │ ◄───────────────────────  │   PORT=4400          │
└─────────────────────┘   JSON response           └──────┬───────┬───────┘
                                                         │       │
                                                STT API  │       │  WebSocket
                                                         │       │  :3434
                                                         ▼       ▼
                                                  ┌──────────┐ ┌──────────┐
                                                  │ STT      │ │ OpenClaw │
                                                  │ Provider │ │ Gateway  │
                                                  └──────────┘ └──────────┘
```

Also add a new "## Connection URLs" section after the System Context section with this content:

### Connection URLs

The gateway participates in two network roles:

| Role | Variable | Default | Description |
|------|----------|---------|-------------|
| **Listen** (inbound) | `PORT` | `4400` | Where the gateway accepts requests from the G2 chat app |
| **Connect** (outbound) | `OPENCLAW_GATEWAY_URL` | `ws://localhost:3000` | Where the gateway connects to OpenClaw as a WebSocket client |

The gateway binds to `HOST=0.0.0.0` by default (all interfaces). Remote G2 frontends should target `ws://<server-ip>:4400` rather than `localhost`.

### End-to-End Connection Flow

```
G2 Frontend ──► ws://{gateway-host}:4400 ──► Voice Gateway ──► ws://{openclaw-host}:3434 ──► OpenClaw
                (PORT, inbound)                                 (OPENCLAW_GATEWAY_URL, outbound)
```

Do NOT remove or rewrite any other existing sections of docs/architecture.md. Only update the System Context diagram and add the Connection URLs section immediately after it.
  </action>
  <verify>
    <automated>grep -q "Connection URLs" docs/architecture.md && grep -q "PORT=4400" docs/architecture.md && grep -q "inbound" docs/architecture.md && echo "PASS" || echo "FAIL"</automated>
  </verify>
  <done>docs/architecture.md has port-annotated system context diagram and a Connection URLs section explaining inbound vs outbound roles with end-to-end flow.</done>
</task>

</tasks>

<verification>
- README.md contains "## Connection Architecture" section with ASCII flow diagram
- README.md contains "### Remote Access" subsection with IP/hostname guidance
- README.md mentions PORT=4400 as listen port and OPENCLAW_GATEWAY_URL as upstream
- docs/architecture.md has port numbers in system context diagram
- docs/architecture.md has "## Connection URLs" section with role table
- .env.example has section headers and inline comments explaining URL roles
- All existing content in each file is preserved (additions only, no deletions of working content)
</verification>

<success_criteria>
A new user reading README.md can immediately understand: (1) PORT=4400 is where the gateway listens for G2 frontend connections, (2) OPENCLAW_GATEWAY_URL is where it connects upstream to OpenClaw, (3) the full connection chain from glasses to AI, and (4) how to connect from a remote machine. The same information is consistently reflected in docs/architecture.md and .env.example.
</success_criteria>

<output>
After completion, create `.planning/quick/19-document-gateway-architecture-and-connec/19-SUMMARY.md`
</output>
