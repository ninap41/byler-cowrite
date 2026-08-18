# Ink Room

A small, real-time co-writing space where writers enter a shared room and build a story together one submitted line at a time.

Ink Room is intentionally **not** a Google Docs clone. It does not synchronize every keystroke or maintain a character-level collaborative document. Writers compose privately, submit a finished line or passage, and the server appends accepted submissions to the shared story in a deterministic order.

This document is both the project README and the implementation guide for Claude or any other coding assistant working in the repository.

---

## Product Summary

Ink Room should make collaborative writing feel immediate without making the infrastructure unnecessarily expensive or complex.

A participant should be able to:

1. Create or join a writing room.
2. See who is currently present.
3. Read the shared story as it grows.
4. Draft a line privately.
5. Submit that line to the room.
6. See accepted lines appear for everyone in the same order.
7. Recover an unsent local draft after an accidental refresh or browser crash.
8. End a session and return to the saved story later.
9. Optionally ask Claude for bounded writing assistance without exposing the Anthropic API key to the browser.

The initial deployment will run on a **single reserved virtual machine**. Do not design the MVP around autoscaling, distributed sockets, Redis, Kafka, or other infrastructure that is not currently required.

---

## Core Product Rules

These rules are architectural requirements, not suggestions.

### 1. The server is the source of truth

The official story, participant state, event order, and saved snapshots come from the server.

Client state may improve responsiveness, but it must never override authoritative server state.

### 2. Collaboration is submission-based

Do not persist or broadcast every keystroke.

A participant writes in a private draft field. The shared story changes only after the participant explicitly submits a completed line or passage.

### 3. Every accepted submission is durable

Each accepted writing submission must be appended to Postgres as an immutable session event.

Do not rely exclusively on in-memory room state. A process restart must not erase accepted writing.

### 4. Writes are ordered per session

All mutations for the same writing session must pass through a per-session FIFO write queue.

Two participants submitting at nearly the same time must still receive a single deterministic server order.

### 5. Active rooms are held in memory

Rooms with connected participants may be represented by in-memory state for fast reads and broadcasts.

Postgres remains the durability layer. In-memory state is a cache of the currently active session, not the permanent record.

### 6. Full snapshots are server-generated

Create a full server-side story snapshot:

- every 60 seconds while a session is active and has changed; and
- when the writing session ends or is explicitly closed.

On restoration, load the newest snapshot and replay any later events.

### 7. LocalStorage is only for unsent drafts

LocalStorage may contain:

- the participant's current unsent draft;
- a room identifier needed to restore that draft; and
- minimal crash-recovery metadata.

LocalStorage must not be used to construct the official story, resolve event ordering, or create official snapshots.

### 8. The server permits at most three active socket rooms

Track active writing rooms on the server.

When three socket rooms are already active, attempting to activate another room must return a friendly capacity message. The rejection should also be logged with enough context for operational review.

Stored rooms that have no active socket participants do not count toward this limit.

### 9. Cost and abuse controls are mandatory

The server must enforce:

- input length limits;
- socket and HTTP rate limits;
- room membership checks;
- Claude request limits;
- a configurable AI spending cap or request budget;
- safe logging that excludes full private drafts and secrets.

---

## MVP Scope

### Included

- Create a writing room.
- Join a room by identifier or invite link.
- Participant display names and presence.
- Private draft composer.
- Submit a line or short passage.
- Server-assigned sequence numbers.
- Real-time broadcast of accepted submissions.
- Reconnection and room resynchronization.
- Postgres event persistence.
- Periodic and end-of-session snapshots.
- Unsent-draft recovery from LocalStorage.
- Three-active-room server capacity limit.
- Friendly validation and capacity errors.
- Optional Claude-assisted brainstorming, continuation, or revision requests.
- Basic health checks and structured logs.

### Explicitly excluded from the MVP

- Per-keystroke collaborative editing.
- CRDT or operational-transform document synchronization.
- Redis-backed socket adapters.
- Horizontal autoscaling.
- Autoscaling infrastructure.
- Multi-region deployment.
- Offline acceptance of official story submissions.
- Building official state from LocalStorage.
- Unbounded AI generation.
- Storing Anthropic credentials in the frontend.

---

## Recommended Technology Stack

The intended implementation is:

### Frontend

- Vue 3
- TypeScript
- Vite
- Pinia for application state
- Socket.IO Client for room communication
- Native `fetch` or the project's established HTTP client

### Backend

- Node.js
- TypeScript
- Express
- Socket.IO
- PostgreSQL through `DATABASE_URL`

### AI integration

- Anthropic API called only by the backend
- Model name, token limits, and budget thresholds supplied through environment variables

### Deployment

- One reserved VM
- One application process unless measurement shows a need for a different local process arrangement
- Postgres as the durable store
- No autoscaling in the current architecture

Do not introduce a new framework, message broker, cache, or infrastructure service unless the repository already contains it or the change is explicitly requested.

---

## High-Level Architecture

```text
┌───────────────────────────────┐
│ Vue 3 client                  │
│                               │
│ - Shared story display        │
│ - Private draft composer      │
│ - Presence                    │
│ - Local unsent-draft recovery │
└───────────────┬───────────────┘
                │ HTTP + Socket.IO
                ▼
┌─────────────────────────────────────────┐
│ Express / Socket.IO server              │
│                                         │
│ - Authentication / membership checks   │
│ - ActiveRoomManager                     │
│ - Per-session FIFO write queues         │
│ - Validation and rate limits            │
│ - Snapshot scheduler                    │
│ - Claude API proxy and budget controls  │
└───────────────────┬─────────────────────┘
                    │ SQL transactions
                    ▼
┌─────────────────────────────────────────┐
│ PostgreSQL                              │
│                                         │
│ - rooms                                 │
│ - writing_sessions                      │
│ - session_participants                  │
│ - session_events                        │
│ - session_snapshots                     │
│ - ai_usage                              │
└─────────────────────────────────────────┘
```

---

## Authoritative Data Model

Names may be adapted to the repository's existing conventions, but the responsibilities should remain separate.

### `rooms`

Represents a reusable writing room.

Suggested fields:

```text
id
name
invite_code
created_by
created_at
updated_at
```

### `writing_sessions`

Represents one active or completed collaborative writing session within a room.

Suggested fields:

```text
id
room_id
status              // active | ended
next_sequence       // next event sequence number
started_at
ended_at
created_at
updated_at
```

### `session_participants`

Tracks durable membership or session participation.

Suggested fields:

```text
session_id
participant_id
role
joined_at
last_seen_at
```

Socket presence itself may remain in memory because connection state is ephemeral.

### `session_events`

Append-only record of accepted story mutations.

Suggested fields:

```text
id
session_id
sequence_number
participant_id
event_type          // line_submitted, session_ended, etc.
payload_json
created_at
```

Required constraints:

- Unique `(session_id, sequence_number)`.
- Indexed by `(session_id, sequence_number)`.
- Events are inserted, not rewritten in place.

For `line_submitted`, the payload should include the accepted text and only the metadata needed to reconstruct the story.

### `session_snapshots`

Stores a complete server-generated materialization of the story.

Suggested fields:

```text
id
session_id
through_sequence
story_content
created_at
```

Required index:

- `(session_id, through_sequence DESC)`.

### `ai_usage`

Tracks enough usage to enforce budgets and diagnose cost.

Suggested fields:

```text
id
participant_id
room_id
session_id
provider
model
input_tokens
output_tokens
estimated_cost
request_status
created_at
```

Do not store secrets or unnecessarily retain private prompt content in usage records.

---

## In-Memory Active Room State

Use one server-side manager responsible for active socket rooms.

Conceptual shape:

```ts
interface ActiveRoomState {
  roomId: string;
  sessionId: string;
  story: StoryLine[];
  latestSequence: number;
  participantSockets: Map<string, Set<string>>;
  dirtySinceSnapshot: boolean;
  activatedAt: Date;
  lastActivityAt: Date;
}
```

The manager should provide operations similar to:

```ts
activateRoom(roomId: string): Promise<ActiveRoomState>
getRoom(roomId: string): ActiveRoomState | undefined
deactivateRoom(roomId: string): Promise<void>
canActivateAnotherRoom(): boolean
getActiveRoomCount(): number
```

Activation behavior:

1. Return the existing active state when already loaded.
2. Check the three-room limit before loading a dormant room.
3. Load the newest server snapshot.
4. Replay events after the snapshot's `through_sequence`.
5. Register the room as active only after restoration succeeds.
6. Return a friendly capacity or restoration error when activation fails.

Deactivation behavior:

1. Confirm that no sockets remain, allowing a short reconnect grace period if implemented.
2. Flush queued writes.
3. Create a final snapshot when the room changed since its previous snapshot.
4. Remove the room from active memory.

---

## Per-Session FIFO Write Queue

Do not allow multiple asynchronous mutations for one session to race each other.

A lightweight queue can be implemented by chaining promises per session:

```ts
class SessionWriteQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  enqueue<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(sessionId) ?? Promise.resolve();
    const next = previous.then(operation, operation);

    this.tails.set(
      sessionId,
      next.finally(() => {
        if (this.tails.get(sessionId) === next) {
          this.tails.delete(sessionId);
        }
      }),
    );

    return next;
  }
}
```

The exact implementation may differ, but it must preserve these properties:

- FIFO ordering within one session.
- Independent sessions do not block one another.
- A failed operation does not permanently poison the queue.
- Queued operations can be flushed before deactivation or shutdown.

---

## Line Submission Flow

A line submission should follow this order:

1. Client emits `story:submit-line` with a client request ID and submitted text.
2. Server confirms authentication, room membership, active session, rate limits, and text length.
3. Server places the mutation in the session's FIFO queue.
4. Inside the queue, the server starts a database transaction.
5. Server locks or atomically updates the session sequence counter.
6. Server inserts a `line_submitted` event with the assigned sequence number.
7. Server commits the transaction.
8. Server updates the in-memory active story.
9. Server marks the room dirty for snapshotting.
10. Server broadcasts `story:line-accepted` to the room.
11. Server acknowledges the original client request.

Do not broadcast an accepted line before the durable database transaction succeeds.

A repeated client request ID should not create duplicate accepted lines. Store or otherwise enforce enough idempotency information to safely handle reconnection retries.

---

## Suggested Socket Contract

Event names may follow existing repository conventions. Keep payloads typed and versionable.

### Client to server

#### `room:join`

```ts
interface JoinRoomRequest {
  roomId: string;
  lastKnownSequence?: number;
}
```

#### `room:leave`

```ts
interface LeaveRoomRequest {
  roomId: string;
}
```

#### `story:submit-line`

```ts
interface SubmitLineRequest {
  roomId: string;
  sessionId: string;
  clientRequestId: string;
  text: string;
}
```

#### `session:end`

```ts
interface EndSessionRequest {
  roomId: string;
  sessionId: string;
}
```

### Server to client

#### `room:state`

Full authoritative synchronization after joining or reconnecting.

```ts
interface RoomStateMessage {
  roomId: string;
  sessionId: string;
  status: "active" | "ended";
  story: StoryLine[];
  latestSequence: number;
  participants: ParticipantPresence[];
}
```

#### `story:line-accepted`

```ts
interface AcceptedLineMessage {
  roomId: string;
  sessionId: string;
  clientRequestId?: string;
  sequenceNumber: number;
  participantId: string;
  participantDisplayName: string;
  text: string;
  createdAt: string;
}
```

#### `presence:updated`

```ts
interface PresenceMessage {
  roomId: string;
  participants: ParticipantPresence[];
}
```

#### `room:capacity-reached`

```ts
interface RoomCapacityMessage {
  code: "ACTIVE_ROOM_CAPACITY_REACHED";
  message: string;
}
```

Suggested user-facing message:

> Ink Room is currently hosting the maximum number of active writing rooms. Please try joining again after another session ends.

#### `operation:error`

```ts
interface OperationErrorMessage {
  requestId?: string;
  code: string;
  message: string;
  retryable: boolean;
}
```

Do not expose stack traces, SQL details, internal hostnames, environment variables, or provider secrets to clients.

---

## Reconnection and Resynchronization

Socket reconnection must not assume that the client has complete state.

On join or reconnect:

1. Client sends its last known sequence number when available.
2. Server validates room membership.
3. Server activates or retrieves the room.
4. Server sends authoritative room state or a verified sequence delta.
5. Client replaces or reconciles its shared story from the server response.
6. The unsent private draft remains local and is not appended automatically.

The simplest safe MVP behavior is to send the complete current room state after reconnection. Delta synchronization can be added later when measurement shows it is necessary.

---

## Snapshot Strategy

Run a server-side snapshot check every 60 seconds.

For each active room:

1. Skip rooms that have not changed since their last snapshot.
2. Enter the room's FIFO queue so the snapshot has a defined sequence boundary.
3. Capture the current authoritative story and latest accepted sequence.
4. Insert a snapshot in Postgres.
5. Clear the dirty flag only after the snapshot succeeds.

Also create a snapshot when:

- the session is explicitly ended;
- an active room is safely deactivated; or
- the application performs a graceful shutdown and the room contains unsnapshotted changes.

Snapshot failure must be logged and retried later. It must not erase accepted events or prevent continued event persistence unless the database itself is unavailable.

---

## Local Draft Recovery

The browser may save a private unsent draft under a key scoped to the participant and room, for example:

```text
ink-room:draft:<roomId>:<participantId>
```

Suggested value:

```ts
interface LocalDraft {
  text: string;
  updatedAt: string;
}
```

Rules:

- Save only the unsent composer contents.
- Clear the local draft after the server acknowledges the matching accepted submission.
- Do not clear it merely because the socket emitted an event.
- Never merge LocalStorage content directly into the shared story.
- Never send a recovered draft automatically without a deliberate participant action.

---

## Claude Integration

Claude is an optional writing assistant, not an authoritative collaborator and not part of story persistence unless a participant explicitly submits generated text.

### Allowed MVP actions

- Brainstorm possible next beats.
- Suggest several continuation options.
- Rephrase selected text.
- Identify continuity issues in a supplied excerpt.
- Help a participant privately develop an unsent line.

### Required boundaries

- Call Anthropic only from the backend.
- Never expose `ANTHROPIC_API_KEY` to the client.
- Limit input length, output tokens, requests per participant, and concurrent requests.
- Enforce a configurable daily or monthly spending cap.
- Return a friendly message when the cap is reached.
- Do not automatically append model output to the shared story.
- Require the participant to review and explicitly submit any generated text.
- Do not silently send an entire private room history when a smaller excerpt will satisfy the request.
- Avoid logging complete prompts and completions by default.

Suggested environment variables:

```text
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=
CLAUDE_MAX_INPUT_CHARS=
CLAUDE_MAX_OUTPUT_TOKENS=
CLAUDE_REQUESTS_PER_USER_PER_HOUR=
CLAUDE_DAILY_SPEND_LIMIT_USD=
```

The application should deny further AI calls when its configured budget is exhausted while leaving normal collaborative writing available.

---

## Validation and Limits

All limits must be enforced on the server even when the frontend also validates them.

Suggested configurable limits:

```text
MAX_ACTIVE_SOCKET_ROOMS=3
MAX_PARTICIPANTS_PER_ROOM=
MAX_SUBMISSION_CHARACTERS=
MAX_ROOM_NAME_CHARACTERS=
MAX_DISPLAY_NAME_CHARACTERS=
SUBMISSIONS_PER_MINUTE=
SOCKET_EVENTS_PER_MINUTE=
SNAPSHOT_INTERVAL_SECONDS=60
ROOM_RECONNECT_GRACE_SECONDS=
```

Do not bury limits as unexplained magic numbers. Keep them in validated configuration with sensible production defaults.

Text validation should:

- reject empty or whitespace-only submissions;
- normalize line endings;
- enforce character limits before database work;
- preserve ordinary punctuation and Unicode writing;
- prevent control characters that have no legitimate writing purpose;
- render participant content as text rather than unsafe HTML.

---

## Capacity Behavior

The initial production server supports no more than three active socket writing rooms.

A room becomes active when the first participant attempts to establish its live socket state. A room may become inactive after its last participant disconnects and any reconnect grace period expires.

When capacity is full:

- Do not partially activate a fourth room.
- Do not silently evict another active room.
- Do not crash the process.
- Return a friendly, retryable error.
- Log the attempted room ID, active-room count, timestamp, and a request or correlation ID.
- Do not log private draft or story text as part of the capacity event.

This is a deliberate resource boundary for the reserved VM, not a temporary frontend-only check.

---

## Error Handling

Use stable error codes and friendly messages.

Examples:

```text
ACTIVE_ROOM_CAPACITY_REACHED
ROOM_NOT_FOUND
NOT_A_ROOM_MEMBER
SESSION_NOT_ACTIVE
SUBMISSION_TOO_LONG
SUBMISSION_RATE_LIMITED
DUPLICATE_REQUEST
DATABASE_UNAVAILABLE
AI_RATE_LIMITED
AI_BUDGET_EXHAUSTED
AI_PROVIDER_UNAVAILABLE
```

Errors should be classified as retryable or non-retryable.

Expected behavior:

- Database failure: do not acknowledge or broadcast the line as accepted.
- Socket disconnection after commit: the line remains durable and appears on resynchronization.
- Duplicate retry: return the previously accepted result or a safe duplicate acknowledgement.
- Snapshot failure: retain events and the dirty snapshot flag.
- Claude failure: leave normal writing features available.
- Capacity rejection: preserve the user's unsent local draft.

---

## Logging and Monitoring

Use structured logs with a request or correlation ID.

Log:

- room activation and deactivation;
- current active-room count;
- capacity rejections;
- socket joins and disconnects at an operationally useful level;
- line submission success or failure without full submitted text;
- queue latency and database latency;
- snapshot success and failure;
- Claude request status, token counts, and estimated cost;
- graceful shutdown and queue-flush results.

Never log:

- API keys;
- database credentials;
- session cookies or authorization headers;
- complete private drafts;
- complete room stories by default;
- raw provider responses when they may contain user writing.

Useful initial metrics:

```text
active_socket_rooms
connected_participants
line_submissions_total
line_submission_failures_total
line_submission_latency_ms
session_write_queue_depth
snapshot_success_total
snapshot_failure_total
claude_requests_total
claude_estimated_cost_usd
capacity_rejections_total
```

---

## Security Requirements

- Keep secrets in environment variables or the deployment secret manager.
- Validate room access on every privileged HTTP and socket operation.
- Treat socket payloads as untrusted input.
- Apply HTTP and socket rate limiting.
- Use secure, HTTP-only cookies when cookie-based authentication is used.
- Configure CORS to known production origins.
- Escape user-provided text when rendered.
- Do not allow clients to choose sequence numbers, participant IDs, authorship metadata, or trusted timestamps.
- Keep database operations parameterized.
- Set request body and socket payload size limits.

---

## Graceful Shutdown

The reserved VM may restart during deployment or maintenance. The server should handle termination signals deliberately.

Recommended sequence:

1. Mark the process as shutting down and reject new room activations.
2. Stop accepting new mutations.
3. Allow already queued operations to finish within a bounded shutdown window.
4. Snapshot dirty active sessions when the database is available.
5. Close Socket.IO connections with a service-restart reason.
6. Close the HTTP server.
7. Close the Postgres connection pool.
8. Exit with a meaningful status code.

Durable accepted events are more important than completing a final snapshot. If the shutdown window expires, the next startup must be able to restore from the latest snapshot plus later events.

---

## Suggested Project Structure

Follow the existing repository if one already exists. For a greenfield implementation, a structure like this keeps responsibilities explicit:

```text
src/
  client/
    components/
    composables/
    stores/
    services/
    types/
    views/
  server/
    config/
    database/
    http/
    sockets/
    rooms/
      ActiveRoomManager.ts
      SessionWriteQueue.ts
      roomRestore.ts
      roomSnapshot.ts
    sessions/
    ai/
    middleware/
    observability/
    types/
  shared/
    contracts/
    validation/
    types/
```

Shared socket contracts should not import browser-only or server-only modules.

---

## Testing Requirements

### Unit tests

Cover:

- input validation;
- active-room capacity tracking;
- per-session FIFO ordering;
- independent queues for different sessions;
- queue recovery after a failed operation;
- event replay from a snapshot;
- LocalStorage draft keying and clearing rules;
- Claude budget calculations and rejection behavior.

### Integration tests

Cover:

- successful durable line submission;
- two nearly simultaneous submissions receiving distinct ordered sequences;
- database failure preventing broadcast and acknowledgement;
- duplicate client request IDs not creating duplicate events;
- snapshot creation at a known sequence boundary;
- restoration from snapshot plus later events;
- fourth active room receiving a friendly capacity error;
- a dormant stored room not counting toward active capacity;
- session end flushing writes and creating a final snapshot.

### Socket tests

Cover:

- room join and authoritative state delivery;
- presence updates;
- line broadcast to all room participants;
- reconnect and full resynchronization;
- unauthorized room access;
- rate limiting;
- capacity rejection;
- preservation of an unsent local draft after connection failure.

### AI tests

Mock the Anthropic API. Tests must not spend real money.

Cover:

- provider request construction;
- input and output limits;
- per-user rate limiting;
- budget exhaustion;
- provider timeout or failure;
- confirmation that generated content is not automatically appended to the story.

---

## Environment Variables

Example only; do not commit real production secrets.

```text
NODE_ENV=development
PORT=3000
CLIENT_ORIGIN=http://localhost:5173
DATABASE_URL=postgresql://user:password@localhost:5432/ink_room

MAX_ACTIVE_SOCKET_ROOMS=3
MAX_PARTICIPANTS_PER_ROOM=8
MAX_SUBMISSION_CHARACTERS=2000
SUBMISSIONS_PER_MINUTE=20
SOCKET_EVENTS_PER_MINUTE=120
SNAPSHOT_INTERVAL_SECONDS=60
ROOM_RECONNECT_GRACE_SECONDS=30

ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=
CLAUDE_MAX_INPUT_CHARS=12000
CLAUDE_MAX_OUTPUT_TOKENS=800
CLAUDE_REQUESTS_PER_USER_PER_HOUR=20
CLAUDE_DAILY_SPEND_LIMIT_USD=
```

Validate configuration at startup. Fail fast when required values are absent or malformed.

---

## Local Development

Expected workflow:

```bash
npm install
```

Create a local environment file from the checked-in example:

```bash
cp .env.example .env
```

Start Postgres and apply migrations using the repository's chosen migration command.

Run the application:

```bash
npm run dev
```

Run checks before committing:

```bash
npm run typecheck
npm run lint
npm test
```

Update these commands to match the actual `package.json`; do not create duplicate scripts when an established command already exists.

---

## Instructions for Claude and Other Coding Assistants

Before changing code:

1. Inspect the relevant implementation, tests, types, configuration, and neighboring modules.
2. Identify the existing pattern and follow it.
3. Distinguish observed repository behavior from a proposed recommendation.
4. Make the smallest coherent change that satisfies the task.
5. Preserve server authority, durable event ordering, and the active-room limit.
6. Add or update tests for changed behavior.
7. Run the most relevant available checks.
8. Report any check that could not be run.

### Never do the following without explicit instruction

- Convert the app into per-keystroke collaborative editing.
- Add CRDT or operational-transform libraries.
- Replace Postgres with LocalStorage or an in-memory-only store.
- Construct official snapshots from client state.
- Broadcast a line as accepted before its database transaction commits.
- Remove the per-session FIFO write queue.
- Remove or bypass the three-active-room server limit.
- Add autoscaling as a hidden assumption.
- Add Redis, Kafka, or another infrastructure dependency merely for theoretical scale.
- Expose the Anthropic API key to the browser.
- Automatically append Claude output to the shared story.
- Log full private drafts, stories, secrets, or credentials.
- Perform broad framework rewrites or unrelated refactors.

### Change-report format

When completing an implementation task, report:

```text
Summary
- What changed and why.

Files changed
- Path: important implementation details.

Validation
- Commands or tests run.
- Results.

Limitations
- Anything not verified or intentionally left unchanged.
```

Do not claim that a test passed unless it was actually run successfully.

---

## Definition of Done

A feature is complete when:

- the server remains authoritative;
- accepted submissions are durably persisted;
- per-session ordering remains deterministic;
- reconnecting clients can obtain correct server state;
- LocalStorage contains only private unsent-draft recovery data;
- the three-active-room limit is enforced server-side;
- validation and friendly error behavior are present;
- AI usage remains bounded and optional;
- relevant tests pass;
- logs avoid secrets and private writing content;
- documentation and environment examples reflect the implementation.

---

## Future Improvements

These are valid later improvements, not current MVP requirements:

- Measure reserved-VM CPU, memory, socket count, and queue latency under realistic room activity.
- Tune participant and submission limits using observed capacity.
- Add dashboards and spend alerts.
- Add richer session history and exports.
- Add story branches or alternate takes while preserving server-owned ordering.
- Add invitation and role-management features.
- Add more granular event types with versioned payloads.
- Add snapshot retention or compaction policies.
- Introduce Redis-backed socket coordination only if the application is deliberately moved beyond one server process.
- Revisit autoscaling only after persistence, socket affinity, coordination, and cost requirements are explicitly designed.

---

## Guiding Principle

Build the smallest reliable version of Ink Room that makes collaborative writing feel live.

The app should be fast because active state is nearby in memory, safe because accepted writing is appended to Postgres, recoverable because the server creates snapshots, affordable because activity and Claude usage are bounded, and understandable because it avoids distributed complexity before that complexity is actually needed.
