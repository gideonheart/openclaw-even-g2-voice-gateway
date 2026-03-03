# ARCHITECTURE — Even G2 Frontend + Gateway Contract

## System Pair

This project is the **backend half** of a two-repo system:

- Frontend: `even-g2-openclaw-chat-app`
- Backend (this repo): `openclaw-even-g2-voice-gateway`

## Responsibilities

### Frontend

Owns:

- Hub UI (text/settings/sessions/history)
- Glasses runtime UX (gestures, mic capture, display updates)
- Sending text/audio turns to gateway
- Rendering streamed responses and local conversation/session state

### Gateway (this repo)

Owns:

- STT provider integration
- OpenClaw agent orchestration
- Structured JSON response output (standard HTTP request/response)
- Server-side integrations and secret handling

## End-to-End Flow

1. User interacts in Hub UI and/or through glasses gestures + mic.
2. Frontend submits turn (text/audio) to gateway.
3. Gateway runs STT (if audio) and OpenClaw agent orchestration.
4. Gateway returns structured JSON response.
5. Frontend renders live output on glasses runtime and updates Hub conversation/session state.

## Trust + Security Boundary

- Frontend remains public-safe.
- **Secrets stay in gateway** (provider credentials, privileged tokens, internal integrations).
- Gateway is the policy and orchestration enforcement point.

## Canonical Paths (local)

- Frontend: `/home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app`
- Gateway: `/home/forge/openclaw-even-g2-voice-gateway`

## API/Contract Notes

- Keep frontend↔gateway contract explicit and stable.
- Version contract changes; coordinate both repos.
- Prefer additive changes and document migration steps for breakages.
