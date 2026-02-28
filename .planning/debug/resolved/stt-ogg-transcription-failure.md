---
status: resolved
trigger: "Telegram OGG voice notes sent to gateway /api/voice/turn return 400 STT_TRANSCRIPTION_FAILED"
created: 2026-02-28T00:00:00Z
updated: 2026-02-28T00:02:00Z
---

## Current Focus

hypothesis: CONFIRMED and FIXED - WhisperX returns text in .result.segments[].text, not .result.text. Gateway was ignoring segments array.
test: All 182 tests pass (12 in whisperx-provider including 5 new regression tests for segment extraction)
expecting: n/a - verified
next_action: Archive and commit

## Symptoms

expected: POST /api/voice/turn with an OGG voice note file should return a valid transcription and AI response
actual: Returns HTTP 400 with error STT_TRANSCRIPTION_FAILED and empty transcription text
errors: STT_TRANSCRIPTION_FAILED - empty text returned from transcription step
reproduction: curl POST file_176*.ogg to gateway :4400 /api/voice/turn -- returns 400. Direct WhisperX python script on same file returns valid transcript.
started: Current behavior. Gateway healthz/readyz are OK. Issue is specific to OGG format voice notes from Telegram.

## Eliminated

- hypothesis: Content-type validation rejects OGG files
  evidence: VALID_AUDIO_TYPES includes "audio/ogg"; validateAudioContentType correctly strips params like "codecs=opus"
  timestamp: 2026-02-28T00:00:30Z

- hypothesis: File extension mapping is wrong for OGG
  evidence: getExtension() has "audio/ogg" -> "ogg" mapping
  timestamp: 2026-02-28T00:00:30Z

- hypothesis: Binary data corrupted during Buffer -> Blob conversion
  evidence: Node.js Blob correctly accepts Buffer (Uint8Array); same path used for all formats
  timestamp: 2026-02-28T00:00:40Z

## Evidence

- timestamp: 2026-02-28T00:00:30Z
  checked: whisperx-provider.ts pollForResult() completed case (line 207)
  found: Code reads `task.result?.text ?? ""` -- only looks at top-level .result.text field
  implication: If WhisperX returns text only in segments array, this would be empty string

- timestamp: 2026-02-28T00:00:40Z
  checked: ~/.openclaw/workspace/skills/whisperx/scripts/transcribe.sh (lines 96-110)
  found: Bash script FIRST tries `.result.segments[].text` (joining with spaces), and only falls back to `.result.text`. Comment explicitly says "WhisperX returns segments with text fields"
  implication: This confirms WhisperX standard output is in segments, not top-level text

- timestamp: 2026-02-28T00:00:45Z
  checked: WhisperXTaskStatus interface in whisperx-provider.ts
  found: Interface defines `segments?: Array<{ text: string }>` but this field is NEVER USED in result extraction
  implication: The interface was written knowing about segments but the extraction code was not updated

- timestamp: 2026-02-28T00:00:50Z
  checked: transcribe.sh submit command (lines 53-58)
  found: Bash script sends language/task/model as FORM FIELDS (-F), while gateway sends them as URL QUERY PARAMETERS (url.searchParams). This is a secondary difference.
  implication: May cause issues with some WhisperX API versions that expect form fields

## Resolution

root_cause: WhisperX API (logingrupa/whisperX-FastAPI) returns transcription text in `.result.segments[].text` array, not in `.result.text`. The gateway's WhisperXProvider.pollForResult() only reads `.result.text` (which is undefined/empty), falls into the empty-text error branch, and throws UserError(STT_TRANSCRIPTION_FAILED). The reference bash script (transcribe.sh) correctly extracts text from segments first.

fix: Added extractTranscriptText() private method to WhisperXProvider that mirrors the bash script logic -- tries segments first (joins with spaces), falls back to result.text. Updated pollForResult() completed case to use this method.

verification: All 182 tests pass (19 test files). 5 new regression tests added covering: segments-only response, segments-with-empty-text, text-only fallback, empty-segments-and-text error, and OGG Telegram voice note path. TypeScript compiles cleanly (no new errors). Package dist rebuilt.

files_changed:
  - packages/stt-whisperx/src/whisperx-provider.ts
  - packages/stt-whisperx/src/whisperx-provider.test.ts
