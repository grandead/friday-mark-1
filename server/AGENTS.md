# Friday server

Local voice assistant: ESP32 audio → WAV → Whisper → Ollama → device commands → Supertonic speech.
Next.js 16 App Router, React 19, shadcn/ui, Prisma 8 (RC) and PostgreSQL 18. One Node process and port: Next serves pages, HTTP API and SSE; `ws` handles `/audio`. Whisper and Ollama run as separate native processes with Metal on macOS; Docker runs PostgreSQL.

## Setup and commands

Run commands from `server/`. Requirements: Node.js matching `package.json`, npm, Docker, uv, Git, CMake and a C++ compiler (Xcode Command Line Tools on macOS).

1. Copy `.env.example` to `.env`; replace both database password placeholders with the same local password.
2. Run `npm ci`, `docker compose up -d --wait db`, then `npm run db:deploy`.
3. Run `npm run setup:whisper` and `npm run setup:home`. Keep `npm run stt:serve` running in another terminal. Whisper listens on `127.0.0.1:33001`.
4. Run `npm run setup:ollama`, keep `npm run llm:serve` running in another terminal, then run `npm run llm:pull`.
5. Extract the [Supertonic model archive](https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2) into `models/`, retaining its directory name. The default voice is F2.

- Development: `npm run dev`. Production: `npm run build && npm start`.
- Default URLs: journal `/`, home setup `/smart-home`, tasks `/tasks`, health `/api/health` on `http://localhost:33000`. Health returns an empty `200` response. `PORT` overrides the port.
- Audio: `GET /api/audio/[id]/[kind]`, where `id` is the interaction ID and `kind` is `input` or `output`. Supports byte ranges for playback. Journal responses expose `hasInputAudio` and `hasOutputAudio`; the UI builds audio URLs.
- Stop with Ctrl+C. The server has no authentication; use only a trusted local network.
- Keep `.env`, `.tools/`, speech weights in `models/` and `recordings/` out of Git. Back up both PostgreSQL and recordings; audio has no automatic retention policy.

## Architecture

- Import other services through explicit `index.ts` exports. Keep dependencies acyclic; `test/service-architecture.test.ts` enforces this.
- Keep the database client in module scope. Next bundles and the custom server may use separate clients. Import shared services directly; do not pass database clients, generators or drivers through function parameters. Queue, signal subscriptions and shutdown state must retain their identity across the custom server and Next bundles. Keep recordings, WAV writers, request identity and command arguments separate.
- `src/index.ts` starts and stops the server; `src/http/service.ts` connects Next and `ws`. Pages and route handlers live in `src/app`.
- `database` exports `db`, `orm` (`db.orm.public`) and database types. The client lives in module scope, without `globalThis`; `runtime` owns process cancellation. `interactions` exports `reserveInteraction`, `releaseInteraction`, `enqueueInteraction`, `getPendingInteractionCount` and `waitForInteractions`. Its shared queue runs `process-interaction.ts`: STT → assistant → TTS, with saved results and `interaction.updated` signals. `assistant` builds user history and uses `llm` and the generic `llm-tools` interface.
- `llm-tools` exports `TOOL_DEFINITIONS`, `getToolContext` and `executeTools`. The root registry combines sections and builds definitions from their Zod schemas. The shared executor validates calls and writes the journal. No tool factories or cached service objects. `smart-home` owns the device catalogue, model operations, state verification and drivers. Its public `executeDeviceCommand(deviceId, command)` validates the operation for the registered model and returns confirmed state. The voice adapter in `llm-tools/smart-home` maps tool names to model operations and formats replies. Register new sections in `llm-tools/registry.ts` with a name, tools, execute function and optional context function. Section results contain status, Russian reply and optional JSON data; keep credentials out of arguments and results.
- `signals` exports only `subscribe`, `unsubscribe` and `publish`, using one in-memory subscription store in `globalThis`. `/api/interactions/live` owns SSE, reads changed records and serializes them; it unsubscribes on disconnect or shutdown. Recordings publish after each status change, including interruption and finalization failure. The UI reloads history after reconnecting.
- `live-stream` exports `createLiveStream`, which creates a separate SSE stream for each connection from a map of signal names to data handlers. It depends only on `signals` and `runtime`. SSE event names match signal names; handlers return data or `null` to skip an event. Keep database access outside the stream.
- Keep dependency mocks in tests. Do not add production factories or options only for tests. Keep request data and callbacks as parameters; do not store per-request state on shared services.
- Validate user input at the UI-facing API boundary, mainly to show clear errors. Validate LLM tool calls against their schemas because the model can make mistakes. Trust database and internal application data; do not validate them again.

## Code style

- Export functions only when they are used outside their module or required by the framework. Remove unused exports and re-exports.
- Omit trailing `/index` in imports and re-exports. Use the folder path, such as `@/services/runtime`.
- Do not define functions inside other functions. Short, single-line arrow functions are allowed.
- Do not call a function inside another call's arguments. Store each result in a clearly named variable first, including awaited calls and error responses. Keep processing steps on separate lines.

## Naming

- Files and folders use `kebab-case` by default, including API, services, utilities and test helpers. Keep the file extension.
- Dot suffixes are allowed: `home-commands.test.ts`, `user-errors.ru.ts`, `types.d.ts`.
- UI component files: `PascalCase.tsx`. React hook files: `useCamelCase.ts`.
- shadcn/ui files in `src/components/ui` keep their registry names so CLI updates and imports work. Component names remain `PascalCase`.
- TypeScript/JavaScript constants (fixed values and shared schemas): `CAPITALIZED_SNAKE_CASE`.
- In TypeScript files, put module-level constants such as `PAGE_SIZE` after imports, before functions. In `route.ts`, keep request validation schemas after HTTP handlers as specified below. For Python, follow PEP 8.
- TypeScript/JavaScript variables and functions: `camelCase`, including local `const` bindings. Components: `PascalCase`.
- Python follows [PEP 8 naming](https://peps.python.org/pep-0008/#naming-conventions): scripts and modules use `snake_case.py`; variables, functions, methods and parameters use `snake_case`; classes use `PascalCase`; constants use `CAPITALIZED_SNAKE_CASE`. Use short lowercase package names, `_name` for non-public members, `self` for instance methods and `cls` for class methods. Error classes end in `Error`; keep standard names such as `__init__`.
- Python test files use `test_snake_case.py`.
- Migration files and third-party skills keep their original names.
- Keep standard and tool-required names, such as `AGENTS.md`, `SKILL.md`, `package.json`, `next.config.ts` and generated contract files.
- Keep Next.js file and export names (`page.tsx`, `layout.tsx`, `route.ts`, `GET`, `POST`, `runtime`, `dynamic`, `metadata`) and special folder names (`_data`, `_lib`, `[id]`, route groups and slots).

## Web server code

- Keep each route's code next to its `route.ts`; do not add handler factories or service wrappers.
- Put database reads and writes in `_data/`; put data preparation and response formatting in `_lib/`.
- Keep `route.ts` to HTTP handlers, request schemas and error handling inside the handlers, plus Next route settings.
- Use default Next.js route settings unless a handler needs different behavior.
- Order: GET/POST/etc. first, validation next, then data functions in `_data/`.
- Keep code shared with voice services outside route folders. Services must not import routes or their helpers.

## UI

Use shadcn/ui (Radix, New York), Tailwind CSS 4 and Lucide. Add components from `server/` with `npx shadcn@latest add <component>`; `components.json` configures the CLI and MCP.
Components live in `src/components/ui`; `@/` maps to `src/`. Import `cn` from `@/lib/utils`.
The theme is in `src/app/shadcn.css`; existing layout styles are in `src/app/style.css`. Tailwind Preflight is omitted. Check new components against existing element styles, including Select.

The journal filters by terminal, user and browser-local dates, loads older entries and refreshes through SSE. Preserve playing audio when entries update; reconcile history after reconnecting. Home setup stores the selected home in the URL. Device forms save credentials without testing connectivity.

## Database and devices

- Keep the Prisma schema in `src/services/database/schema/`, split into `users.prisma` (also owns the datasource and generator), `interactions.prisma`, `smart-home.prisma` and `tasks.prisma`. Keep migrations in `src/services/database/migrations/`. Run `npm run db:emit` after schema edits; generated contracts live in `src/services/database/generated/`. Restart the server after changing the client or contract. Review migrations before applying them. Migration files are CLI artifacts, excluded from application type checks, Biome and service dependency checks.
- Tasks have many users through `TaskUser`. Creation records `createdAt` and `createdBy` and includes the creator among the members. Deletion archives the task for all members by setting `deletedAt` and `deletedBy`. Keep its membership rows for live removal events. Status starts at `Pending` and can change to `Done`.
- The tasks API uses the seeded user ID from `src/config/identity.ts` until authentication supplies the current user. `GET /api/tasks` lists that member's active tasks by ascending creation time and ID. `POST /api/tasks` accepts a title (1–120 characters after trimming), optional description and optional array of additional member IDs (`userIds`). `PATCH /api/tasks/{id}` accepts one or more of `title`, `description` and `status`; a null description clears it. `DELETE` on the same URL returns HTTP 204. Both mutations return HTTP 404 for inaccessible or archived tasks.
- The task page subscribes to `task.updated` and `task.deleted` through `/api/tasks/live` and reconciles on reconnect. Both signals carry only the task ID. The backend checks membership in the database before sending either event; archived tasks produce a removal with no task contents.
- `npm run db:deploy` applies migrations and seeds missing terminal, user and model catalogue rows. Startup does not run migrations. To adopt another existing database, verify with `npx prisma db verify --schema-only`, then sign with `npx prisma db sign`; do not reset it.
- Use explicit `select` fields in application queries and returned write rows; never use `SELECT *`. Use `first(filter)` or `firstOrThrow(filter)` for one row and object filters for equality. Keep queries near their callers; do not add query wrappers.
- PostgreSQL listens on local port 55432. IDs are UUIDv7. Voice terminals use `Device`; appliances use `Home → Room → HomeDevice`, with a fixed `HomeDeviceType` catalogue. Parent deletion is restricted while children exist.
- Names contain 1–120 characters. The catalogue selects the registration schema: `miioToken` uses `{ ip, token }`; `hommynShareUrl` uses `{ shareUrl }`. Validate credentials before saving in the API. Trust stored credentials when running commands; do not validate them again. Registration schemas live next to the device API handler.
- Supported appliances: Xiaomi Smart Humidifier 2 and Smartmi Fresh Air over local miIO; Ballu ONEAIR ASP-100 over Syncleo UDP with mDNS discovery. Qingping Air Monitor Lite uses local MIoT for readings and supported settings. Ballu requires the same network and multicast access.
- Register models in `smart-home/models.ts`. Each model in `smart-home/devices/` owns its operation schemas, handlers, state descriptions and action confirmation. Keep voice tool names, prompts and argument hints for rejected commands in `llm-tools/smart-home/devices/`. The voice registry binds each tool to the operation and its schema through `getDeviceOperation`. JSON Schema comes from Zod; do not maintain a second schema or reparse validated arguments. Xiaomi, Smartmi and Qingping use the in-process Node.js miIO transport. The Ballu Python adapter receives credentials through stdin and runs offline after setup.
- Every model has its own state tool; appliances also have power tools. Smartmi supports modes, three manual speeds, screen brightness, buzzer, child lock, VA4 heater and filter reset. The humidifier supports levels, constant-humidity mode, a 40–70% target, sound, indicators and protection settings. Qingping has no remote power-on command. Protocol mappings and limits: [smart-home-devices-capabilities.md](smart-home-devices-capabilities.md). Ballu also supports manual/night/turbo/eco modes, speed 1–7, heater target 5–25 °C, button sound, automatic backlight timeout, ambient sounds and filter reset. These Ballu units have no CO₂ sensor; do not offer automatic mode or substitute unsupported actions.
- Read the device catalogue for each LLM request: `id`, `name`, `room`, `home`, `model`, `commands`. Tools take `deviceId`; reject unknown IDs and model mismatches. The LLM must clarify ambiguous names before calling a tool, including identical devices in one room. Never infer a target from tool availability.
- Execute up to eight tool calls in order, journal accepted and rejected calls, and preserve partial success. Reject larger batches before execution and journal their size in one `reject_batch` action. Do not log unvalidated arguments or credentials. Journal failures must propagate. Require device confirmation before claiming success; filter reset always needs fresh confirmation. Speak verified tool replies directly, without a second LLM pass.

## Speech and protocol

`npm run setup:whisper` checks out pinned whisper.cpp sources in `.tools/whisper.cpp`, verifies model SHA-256 checksums and builds `build/bin/whisper-server`. Whisper Small and Silero VAD 5.1.2 live in `models/whisper/`. Existing verified weights at the old paths are moved there. Setup can be repeated; a different source revision or corrupt weights cause an error instead of being overwritten.
`npm run stt:serve` loads `.env` through Node and runs `scripts/start-whisper.sh` via the internal `stt:process` command. The shell uses `exec` to start the native server. `WHISPER_PORT` defaults to 33001; `WHISPER_SERVER_BIN`, `WHISPER_MODEL` and `WHISPER_VAD_MODEL` override launch paths. Relative paths resolve from `server/`.
`stt` exports only `transcribe(wav: Uint8Array): Promise<string>`. It sends WAV bytes as multipart data to `WHISPER_BASE_URL` (default `http://127.0.0.1:33001`) and returns text. `WHISPER_LANGUAGE` defaults to `ru`; `auto` enables detection. `WHISPER_TIMEOUT_MS` defaults to 300000. Timeout and server shutdown cancel the HTTP request. Always disable previous-request context and temperature fallback. Do not enable Whisper's `--convert` option: WAV bytes are decoded in memory.
Recordings are always archived for history. The recorder also buffers the same bytes for STT, so recognition never rereads the file. The interaction pipeline saves `.txt` transcripts; STT owns no files or child processes. Vosk is not supported. Wake-word preparation lives in `firmware/scripts/`, separate from server STT.
`tts` exports only `synthesizeSpeech(text: string, output: string): Promise<void>`. It runs Supertonic in a child process so native inference does not block the server. Use Russian, voice F2, eight steps and three CPU threads. Each call loads the model and writes the WAV atomically; timeout (60 seconds) and server shutdown cancel the process. `npm run voice -- reply.wav "Reply text"` runs the same worker directly.
`llm` exports one function: `generateResponse(messages, tools?)`. It calls Ollama and returns text, tool calls and usage stats. It handles response validation, timeout and shutdown; `assistant` owns prompts, history and tool execution.
Ollama defaults to `qwen3.5:4b` at `127.0.0.1:11434`; configure `OLLAMA_BASE_URL`, `OLLAMA_MODEL` and `LLM_TIMEOUT_MS` in `.env`. History includes at most six completed exchanges from the same user in 30 minutes, within 6000 characters including the current transcript. Identity comes from the registered `userId`, not voice recognition.

The `/audio` protocol accepts one active ESP32 connection; reconnecting replaces the old one:

1. Send JSON `start` with registered `deviceId`, `userId`, `sampleRate` (16000 or 20000), `channels: 1` and `format: "s16le"`.
2. Send binary PCM16 LE frames, at most 8192 bytes each, with an even byte count.
3. Send JSON `end` with the exact `samples` count, or `abort` on lost audio.

Replies: `started`, `saved`, `transcript`, `aborted`, `error`, `transcription_error`, `processing_error`. `saved` confirms the WAV, not completion of recognition. Preserve frame order. Recording limits: 120 seconds, 10 seconds idle; the sequential processing queue holds at most four jobs including the active one.
Recordings use `.wav`, transcripts `.txt`, replies `.reply.wav`; interrupted recordings use `.incomplete.wav` and are not transcribed. Crashes can leave `.partial` files. Preserve WAVs on processing failures and reply text on TTS failure. Reply audio is served through the journal, not streamed back to ESP32. MCP and per-home user permissions are not implemented.

## Language and secrets

Documentation, identifiers, JSON keys, enum values, logs and system errors are English. UI copy, LLM instructions, tool descriptions and spoken replies are Russian. Preserve user-owned names and history.
`shared/errors.ts` defines stable English diagnostics; `shared/user-errors.ru.ts` maps codes to safe UI copy. API errors return `{ code, message }`. History and SSE expose this same shape for non-null interaction and action errors, including legacy diagnostics. WebSocket errors use stable codes and public English messages. Never show raw errors to users or expose device credentials through API lists, logs, journal actions or LLM context.
A clearly foreign text reply gets one tool-free Russian repair; never repeat device actions for language repair. Keep infrastructure failures distinct from device failures. An unconfirmed action may still have affected the physical device.

## Checks

- Run `npm run check`, `npm run lint`, `npm test` and `npm run build`. Tests create and remove their own PostgreSQL databases; keep the database service running.
- Biome: `npm run lint:fix` or `npm run format`. Husky installs through `npm ci`; pre-commit runs lint-staged on server files. Type checks and tests run separately. Device model modules are source code, not ignored speech weights.
- Live checks: `npm run test:whisper -- /absolute/path/voice.wav` requires the local Whisper server; `npm run test:assistant -- /absolute/path/question.wav` also requires Ollama and TTS. `npm run send:wav -- /absolute/path/voice.wav` targets the running server.
- `npm run test:home` uses real Ollama with simulated appliances; `npm run test:ballu` and `npm run test:miio` check protocol handling without network access. Neither controls physical devices.
- Vendor skill sources: `.agents/README.md`. Read the installed, version-matched Prisma skill before changing its API; use connected MCP tools for dependency documentation and component lookup.
