# Nanobot Architecture Analysis: Channels, Bus, and Session Management

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [Channels System (`nanobot/channels/`)](#2-channels-system)
   - [Base Channel Abstraction](#21-base-channel-abstraction-basepy)
   - [Channel Manager](#22-channel-manager-managerpy)
   - [Telegram Channel](#23-telegram-channel-telegrampy)
   - [WhatsApp Channel](#24-whatsapp-channel-whatsapppy)
   - [Discord Channel](#25-discord-channel-discordpy)
   - [Feishu/Lark Channel](#26-feishulark-channel-feishupy)
3. [WhatsApp Bridge (`bridge/`)](#3-whatsapp-bridge)
   - [Entry Point](#31-entry-point-indexts)
   - [Bridge Server](#32-bridge-server-serverts)
   - [WhatsApp Client](#33-whatsapp-client-whatsappts)
4. [Message Bus (`nanobot/bus/`)](#4-message-bus)
   - [Event Types](#41-event-types-eventspy)
   - [Message Queue](#42-message-queue-queuepy)
5. [Session Management (`nanobot/session/`)](#5-session-management)
   - [Session Dataclass](#51-session-dataclass)
   - [Session Manager](#52-session-manager)
6. [End-to-End Message Flow](#6-end-to-end-message-flow)
7. [Concurrency Model](#7-concurrency-model)
8. [Authentication and Access Control](#8-authentication-and-access-control)
9. [Architecture Patterns and Design Decisions](#9-architecture-patterns-and-design-decisions)
10. [Cross-Component Integration Map](#10-cross-component-integration-map)

---

## 1. Executive Summary

Nanobot's communication layer implements a **hub-and-spoke architecture** centered on an asynchronous message bus. Four channel implementations (Telegram, WhatsApp, Discord, Feishu/Lark) connect to external messaging platforms and normalize all inbound messages into a common `InboundMessage` format. Responses flow back through `OutboundMessage` objects dispatched by the `ChannelManager`. Sessions provide conversation persistence through JSONL files on disk.

Key architectural characteristics:
- **Decoupled design**: Channels and the agent core never reference each other directly; all communication passes through `MessageBus` async queues.
- **Plugin-style channels**: A shared `BaseChannel` ABC defines the contract; each channel implements `start()`, `stop()`, and `send()`.
- **Language boundary**: WhatsApp requires a separate Node.js/TypeScript bridge process communicating over a local WebSocket, because the Baileys library (WhatsApp Web protocol) is JavaScript-only.
- **Single-process Python concurrency**: All channels, the bus, and the agent run in a single asyncio event loop (except the Feishu WebSocket thread).
- **File-based session persistence**: Sessions stored as JSONL files in `~/.nanobot/sessions/`, with in-memory caching.

---

## 2. Channels System

### File Tree
```
nanobot/channels/
  __init__.py        # Exports BaseChannel, ChannelManager
  base.py            # Abstract base class for all channels
  manager.py         # Lifecycle management and outbound routing
  telegram.py        # Telegram integration (python-telegram-bot, long polling)
  whatsapp.py        # WhatsApp integration (WebSocket to Node.js bridge)
  discord.py         # Discord integration (Gateway WebSocket, REST API)
  feishu.py          # Feishu/Lark integration (lark-oapi SDK, WebSocket)
```

### 2.1 Base Channel Abstraction (`base.py`)

**Purpose**: Defines the common interface that all channel implementations must follow, and provides shared logic for access control and message bus publishing.

**Class: `BaseChannel(ABC)`**

```python
class BaseChannel(ABC):
    name: str = "base"                    # Channel identifier string

    def __init__(self, config: Any, bus: MessageBus): ...

    @abstractmethod
    async def start(self) -> None: ...    # Long-running: connect & listen

    @abstractmethod
    async def stop(self) -> None: ...     # Cleanup resources

    @abstractmethod
    async def send(self, msg: OutboundMessage) -> None: ...  # Deliver outbound

    def is_allowed(self, sender_id: str) -> bool: ...        # Allowlist check

    async def _handle_message(                                # Shared inbound handler
        self, sender_id, chat_id, content, media=None, metadata=None
    ) -> None: ...

    @property
    def is_running(self) -> bool: ...
```

**Key Design Decisions**:

1. **Template Method Pattern**: `_handle_message()` is the shared hook that subclasses call after extracting platform-specific data. It performs allowlist checking and publishes to the bus. Channels never call `bus.publish_inbound()` directly.

2. **Allowlist with pipe-delimited IDs**: The `is_allowed()` method supports compound sender IDs (e.g., `"12345|username"` for Telegram) by splitting on `|` and checking each part against the config's `allow_from` list. If no allowlist is configured, all senders are permitted.

3. **Config agnostic**: The constructor accepts `Any` for config, allowing each channel to cast to its specific config type.

**Access Control Flow**:
```
sender_id → is_allowed() checks:
  1. allow_from list empty? → allow everyone
  2. sender_id in list? → allow
  3. Split sender_id on "|", any part in list? → allow
  4. Otherwise → deny (logs warning)
```

### 2.2 Channel Manager (`manager.py`)

**Purpose**: Orchestrates the lifecycle of all enabled channels and routes outbound messages from the bus to the correct channel's `send()` method.

**Class: `ChannelManager`**

```python
class ChannelManager:
    def __init__(self, config: Config, bus: MessageBus): ...

    def _init_channels(self) -> None: ...           # Conditional init per config
    async def start_all(self) -> None: ...           # Launches channels + dispatcher
    async def stop_all(self) -> None: ...            # Graceful shutdown
    async def _dispatch_outbound(self) -> None: ...  # Outbound routing loop
    def get_channel(self, name: str) -> BaseChannel | None: ...
    def get_status(self) -> dict[str, Any]: ...
    @property
    def enabled_channels(self) -> list[str]: ...
```

**Channel Initialization (`_init_channels`)**:
- Checks each channel's `config.channels.<name>.enabled` flag
- Uses **lazy imports** inside conditionals to avoid hard dependencies
- Catches `ImportError` gracefully and logs a warning (e.g., if `python-telegram-bot` is not installed)
- Passes Groq API key to Telegram channel for voice transcription
- Stores channels in `self.channels: dict[str, BaseChannel]`

**Startup (`start_all`)**:
```
1. Spawn _dispatch_outbound() as an asyncio Task
2. For each enabled channel, spawn channel.start() as an asyncio Task
3. await asyncio.gather(*tasks, return_exceptions=True)
   → All channels run concurrently in the same event loop
   → Tasks run "forever" until stop() is called
```

**Outbound Dispatch Loop (`_dispatch_outbound`)**:
```
while True:
    msg = await bus.consume_outbound(timeout=1.0s)
    channel = self.channels.get(msg.channel)
    if channel:
        await channel.send(msg)
    else:
        log warning "Unknown channel"
```
- Uses `asyncio.wait_for` with 1-second timeout to remain responsive to cancellation
- Exception in one channel's `send()` does not crash the dispatcher
- Each outbound message's `.channel` field determines routing

**Shutdown (`stop_all`)**:
1. Cancels the dispatch task
2. Calls `channel.stop()` on every channel
3. Logs errors but continues stopping remaining channels

### 2.3 Telegram Channel (`telegram.py`)

**Purpose**: Integrates with Telegram using `python-telegram-bot` library in long-polling mode.

**Class: `TelegramChannel(BaseChannel)`**

| Field | Type | Description |
|---|---|---|
| `name` | `str` | `"telegram"` |
| `config` | `TelegramConfig` | Bot token, allowlist |
| `groq_api_key` | `str` | For voice transcription |
| `_app` | `Application \| None` | python-telegram-bot Application |
| `_chat_ids` | `dict[str, int]` | Maps sender_id to chat_id for replies |

**Methods**:
- `start()`: Builds `Application`, adds handlers for text/photo/voice/audio/document messages and `/start` command, calls `start_polling(drop_pending_updates=True)`, then loops with `await asyncio.sleep(1)` until stopped
- `stop()`: Stops updater, app, and shutdown cleanly
- `send(msg)`: Converts markdown to Telegram HTML, sends via `bot.send_message()` with HTML parse mode, falls back to plain text on parse error
- `_on_start()`: Handles `/start` command with welcome message
- `_on_message()`: The main message handler

**Inbound Message Processing (`_on_message`)**:
```
1. Extract user info (id, username) → compound sender_id "id|username"
2. Store chat_id mapping for future replies
3. Build content from text/caption
4. Handle media:
   a. Photos → download largest, save to ~/.nanobot/media/
   b. Voice/Audio → download, transcribe via GroqTranscriptionProvider
   c. Documents → download, append path to content
5. Call self._handle_message(sender_id, chat_id, content, media, metadata)
```

**Markdown-to-HTML Conversion (`_markdown_to_telegram_html`)**:
A standalone function that converts GitHub-flavored Markdown to Telegram-safe HTML. Uses a protection/restoration approach:
1. Extract and protect code blocks and inline code with placeholders
2. Strip headers (`#`) and blockquotes (`>`)
3. Escape HTML entities (`&`, `<`, `>`)
4. Convert links, bold, italic, strikethrough to HTML tags
5. Convert bullet points (`-`/`*`) to `*` unicode bullet
6. Restore protected code blocks with `<pre><code>` and `<code>` tags

**Voice Transcription**: When a voice or audio message is received, Telegram downloads the file and passes it to `GroqTranscriptionProvider` for speech-to-text. The transcription is appended as `[transcription: ...]` to the message content.

### 2.4 WhatsApp Channel (`whatsapp.py`)

**Purpose**: Connects to WhatsApp through a separate Node.js bridge process over a local WebSocket.

**Class: `WhatsAppChannel(BaseChannel)`**

| Field | Type | Description |
|---|---|---|
| `name` | `str` | `"whatsapp"` |
| `config` | `WhatsAppConfig` | Bridge URL, allowlist |
| `_ws` | `WebSocket \| None` | Active WebSocket connection |
| `_connected` | `bool` | WhatsApp connection state |

**Connection Architecture**:
```
Python (WhatsAppChannel) ←WebSocket→ Node.js (BridgeServer) ←Baileys→ WhatsApp Web
```

**Methods**:
- `start()`: Opens WebSocket to `config.bridge_url`, iterates messages in a loop, reconnects on failure after 5 seconds
- `stop()`: Sets running=False, closes WebSocket
- `send(msg)`: Sends JSON `{"type": "send", "to": msg.chat_id, "text": msg.content}` over WebSocket
- `_handle_bridge_message(raw)`: Parses JSON, dispatches by message type

**Bridge Message Types**:

| Type | Action |
|---|---|
| `"message"` | Extract sender (strip JID `@s.whatsapp.net`), handle voice messages, call `_handle_message()` |
| `"status"` | Update `_connected` flag, log status |
| `"qr"` | Log instruction to scan QR code in bridge terminal |
| `"error"` | Log the error |

**JID Handling**: WhatsApp identifies users by JID (e.g., `1234567890@s.whatsapp.net`). The channel strips the domain portion to get the phone number as `sender_id`, but passes the full JID as `chat_id` (needed for sending replies back).

**Voice Messages**: Currently limited -- voice messages are received but transcription is not yet implemented for WhatsApp. The content is replaced with a placeholder: `"[Voice Message: Transcription not available for WhatsApp yet]"`.

### 2.5 Discord Channel (`discord.py`)

**Purpose**: Integrates with Discord using a raw Gateway WebSocket connection (not discord.py library) and REST API for sending.

**Class: `DiscordChannel(BaseChannel)`**

| Field | Type | Description |
|---|---|---|
| `name` | `str` | `"discord"` |
| `config` | `DiscordConfig` | Token, gateway_url, intents |
| `_ws` | `WebSocket \| None` | Gateway WebSocket |
| `_seq` | `int \| None` | Sequence number for heartbeats |
| `_heartbeat_task` | `asyncio.Task \| None` | Periodic heartbeat sender |
| `_typing_tasks` | `dict[str, Task]` | Per-channel typing indicators |
| `_http` | `httpx.AsyncClient \| None` | REST client for sending |

**Gateway Protocol Implementation**:
```
1. Connect to WebSocket at config.gateway_url
2. Receive op=10 (HELLO) → start heartbeat at specified interval, send IDENTIFY
3. Receive op=0, t=READY → logged in
4. Receive op=0, t=MESSAGE_CREATE → process incoming message
5. Receive op=7 (RECONNECT) or op=9 (INVALID_SESSION) → reconnect
```

**Heartbeat**: Sends `{"op": 1, "d": self._seq}` at the interval specified by Discord's HELLO payload.

**IDENTIFY Payload**:
```python
{
    "op": 2,
    "d": {
        "token": config.token,
        "intents": config.intents,
        "properties": {"os": "nanobot", "browser": "nanobot", "device": "nanobot"}
    }
}
```

**Inbound Messages (`_handle_message_create`)**:
1. Skip bot messages (`author.bot == True`)
2. Check allowlist via `is_allowed(sender_id)`
3. Build content from text + attachments
4. Download attachments up to 20MB to `~/.nanobot/media/`
5. Start typing indicator in the channel
6. Call `_handle_message()` with metadata including `guild_id` and `reply_to`

**Sending Messages**: Uses REST API (`POST /channels/{id}/messages`) with:
- Rate limit handling (429 responses → wait `retry_after` seconds, retry up to 3 times)
- Reply threading via `message_reference` if `msg.reply_to` is set
- Automatic typing indicator stop after send

**Typing Indicators**: Periodically posts to Discord's typing endpoint every 8 seconds while processing a message, creating a "bot is typing..." effect.

### 2.6 Feishu/Lark Channel (`feishu.py`)

**Purpose**: Integrates with Feishu (Lark) using the official `lark-oapi` SDK with WebSocket long connections (no webhook needed).

**Class: `FeishuChannel(BaseChannel)`**

| Field | Type | Description |
|---|---|---|
| `name` | `str` | `"feishu"` |
| `config` | `FeishuConfig` | app_id, app_secret, encrypt_key, verification_token |
| `_client` | `lark.Client \| None` | Feishu API client |
| `_ws_client` | `lark.ws.Client \| None` | WebSocket event receiver |
| `_ws_thread` | `Thread \| None` | Dedicated daemon thread for WS |
| `_processed_message_ids` | `OrderedDict` | Deduplication cache (max 1000) |
| `_loop` | `AbstractEventLoop \| None` | Reference to main asyncio loop |

**Threading Architecture**:
```
Main asyncio event loop (Python)
  └── FeishuChannel.start() [async, keeps running]

Separate daemon thread
  └── lark.ws.Client.start() [blocking, receives events]
      └── _on_message_sync() [called from WS thread]
          └── asyncio.run_coroutine_threadsafe(_on_message(), main_loop)
              └── _on_message() runs in main event loop
```

This is the only channel that uses a dedicated thread, because the Feishu SDK's WebSocket client uses a blocking API.

**Message Deduplication**:
```python
# OrderedDict used as LRU cache
if message_id in self._processed_message_ids:
    return  # Skip duplicate
self._processed_message_ids[message_id] = None
# Trim to 1000 entries
while len(self._processed_message_ids) > 1000:
    self._processed_message_ids.popitem(last=False)
```

**Message Processing**:
1. Skip bot messages (`sender_type == "bot"`)
2. Extract `sender_id` from `sender.sender_id.open_id`
3. Extract `chat_id` and `chat_type` (group vs. p2p)
4. Add thumbs-up reaction to message (as "seen" indicator)
5. Parse text content from JSON (`{"text": "..."}`) or map non-text types to placeholders
6. Determine reply target: use `chat_id` for groups, `sender_id` for DMs
7. Call `_handle_message()`

**Sending**: Uses Feishu API `im.v1.message.create` with:
- `receive_id_type`: `"chat_id"` for group chats (IDs starting with `oc_`), `"open_id"` for DMs
- Content serialized as JSON `{"text": "..."}`

**Reaction Feature**: Adds emoji reactions to incoming messages via `im.v1.message_reaction.create`. Uses `run_in_executor` to avoid blocking the async loop since the Feishu SDK uses synchronous HTTP.

**Optional SDK**: The `lark_oapi` import is wrapped in try/except, setting `FEISHU_AVAILABLE = False` if not installed. The `start()` method checks this flag and logs an error with install instructions.

---

## 3. WhatsApp Bridge

### File Tree
```
bridge/
  package.json       # Dependencies: baileys, ws, qrcode-terminal, pino
  tsconfig.json       # ES2022/ESNext, strict mode
  src/
    index.ts          # Entry point, environment config, graceful shutdown
    server.ts         # WebSocket server for Python<->Node communication
    whatsapp.ts       # Baileys wrapper for WhatsApp Web protocol
    types.d.ts        # Type declaration for qrcode-terminal
```

### 3.1 Entry Point (`index.ts`)

**Purpose**: Bootstrap the bridge process with configuration from environment variables.

```typescript
const PORT = parseInt(process.env.BRIDGE_PORT || '3001', 10);
const AUTH_DIR = process.env.AUTH_DIR || join(homedir(), '.nanobot', 'whatsapp-auth');
```

- Polyfills `globalThis.crypto` for Baileys ESM compatibility
- Creates `BridgeServer(PORT, AUTH_DIR)` and starts it
- Handles `SIGINT`/`SIGTERM` for graceful shutdown (`server.stop()` then `process.exit`)
- Requires Node.js >= 20.0.0

### 3.2 Bridge Server (`server.ts`)

**Purpose**: WebSocket server that bridges Python's WhatsApp channel to the Baileys WhatsApp client.

**Class: `BridgeServer`**

```typescript
class BridgeServer {
    private wss: WebSocketServer | null;
    private wa: WhatsAppClient | null;
    private clients: Set<WebSocket>;

    constructor(port: number, authDir: string);
    async start(): Promise<void>;       // Create WSS, init WhatsApp client, connect
    async stop(): Promise<void>;        // Close all connections
    private async handleCommand(cmd: SendCommand): Promise<void>;
    private broadcast(msg: BridgeMessage): void;
}
```

**Communication Protocol**:

Python → Bridge (commands):
```json
{"type": "send", "to": "1234567890@s.whatsapp.net", "text": "Hello"}
```

Bridge → Python (events):
```json
{"type": "message", "id": "...", "sender": "...", "content": "...", "timestamp": 123, "isGroup": false}
{"type": "qr", "qr": "..."}
{"type": "status", "status": "connected|disconnected"}
{"type": "error", "error": "..."}
```

**Client Management**: Maintains a `Set<WebSocket>` of all connected Python clients. The `broadcast()` method sends to all clients with `readyState === OPEN`. When a command succeeds, it sends a `{"type": "sent", "to": ...}` acknowledgment back to the specific client.

**Initialization Flow**:
```
1. Create WebSocketServer on specified port
2. Create WhatsAppClient with callbacks for message/qr/status
3. Register connection handlers (message, close, error)
4. Call wa.connect() to start WhatsApp session
```

### 3.3 WhatsApp Client (`whatsapp.ts`)

**Purpose**: Wraps the Baileys library for WhatsApp Web protocol interaction.

**Class: `WhatsAppClient`**

```typescript
interface InboundMessage {
    id: string;
    sender: string;       // Full JID (e.g., "1234567890@s.whatsapp.net")
    content: string;
    timestamp: number;
    isGroup: boolean;
}

interface WhatsAppClientOptions {
    authDir: string;                            // Persistent auth state directory
    onMessage: (msg: InboundMessage) => void;   // Callback for incoming messages
    onQR: (qr: string) => void;                 // Callback for QR codes
    onStatus: (status: string) => void;         // Callback for status changes
}
```

**Connection Setup**:
1. Creates a Pino logger at "silent" level
2. Loads multi-file auth state from `authDir`
3. Fetches latest Baileys version
4. Creates socket with `makeWASocket()`:
   - Auth credentials + cacheable signal key store
   - Browser identity: `['nanobot', 'cli', '0.1.0']`
   - `syncFullHistory: false`, `markOnlineOnConnect: false`
   - `printQRInTerminal: false` (handled by the bridge via callback)

**Event Handlers**:

| Event | Behavior |
|---|---|
| `connection.update` | QR → display + callback; close → auto-reconnect (unless logged out); open → callback |
| `creds.update` | Save credentials to disk |
| `messages.upsert` | Process new messages (type === 'notify') |

**Message Extraction (`extractMessageContent`)**:
Handles these WhatsApp message types:
- `conversation` → plain text
- `extendedTextMessage.text` → reply/link preview text
- `imageMessage.caption` → `"[Image] caption"`
- `videoMessage.caption` → `"[Video] caption"`
- `documentMessage.caption` → `"[Document] caption"`
- `audioMessage` → `"[Voice Message]"`
- Returns `null` for unrecognized types (skips message)

**Reconnection**: On connection close, checks `DisconnectReason`. If not `loggedOut`, waits 5 seconds and calls `connect()` again. Uses a `reconnecting` flag to prevent concurrent reconnection attempts.

**Filtering**: Skips `msg.key.fromMe` (own messages) and `status@broadcast` (WhatsApp status updates).

---

## 4. Message Bus

### File Tree
```
nanobot/bus/
  __init__.py     # Exports MessageBus, InboundMessage, OutboundMessage
  events.py       # Message dataclasses
  queue.py        # Async queue implementation
```

### 4.1 Event Types (`events.py`)

**`InboundMessage`** - Message received from a channel:
```python
@dataclass
class InboundMessage:
    channel: str            # "telegram", "discord", "whatsapp", "feishu"
    sender_id: str          # User identifier (format varies by channel)
    chat_id: str            # Chat/channel identifier
    content: str            # Message text
    timestamp: datetime     # Default: datetime.now()
    media: list[str]        # File paths of downloaded media
    metadata: dict[str, Any]  # Channel-specific data

    @property
    def session_key(self) -> str:
        return f"{self.channel}:{self.chat_id}"  # Unique session identifier
```

The `session_key` property is critical for session isolation. It combines the channel name with the chat_id, ensuring that conversations from different channels (or different chats within the same channel) are kept separate. For example:
- `"telegram:12345"` - Telegram chat 12345
- `"whatsapp:1234567890@s.whatsapp.net"` - WhatsApp user
- `"discord:987654321"` - Discord channel

**`OutboundMessage`** - Message to send to a channel:
```python
@dataclass
class OutboundMessage:
    channel: str            # Target channel name
    chat_id: str            # Target chat/channel
    content: str            # Message text
    reply_to: str | None    # Message ID to reply to (Discord)
    media: list[str]        # Attachment paths
    metadata: dict[str, Any]
```

### 4.2 Message Queue (`queue.py`)

**Purpose**: The central message bus that decouples channels from the agent. Uses two `asyncio.Queue` instances for bidirectional communication.

**Class: `MessageBus`**

```python
class MessageBus:
    inbound: asyncio.Queue[InboundMessage]    # Channels → Agent
    outbound: asyncio.Queue[OutboundMessage]   # Agent → Channels
    _outbound_subscribers: dict[str, list[Callable]]  # Channel-specific callbacks
    _running: bool

    async def publish_inbound(msg) -> None      # Channel calls this
    async def consume_inbound() -> InboundMessage  # Agent calls this (blocks)
    async def publish_outbound(msg) -> None     # Agent calls this
    async def consume_outbound() -> OutboundMessage  # ChannelManager calls this (blocks)

    def subscribe_outbound(channel, callback) -> None  # Alternative to polling
    async def dispatch_outbound() -> None              # Subscriber-based dispatch loop
    def stop() -> None
```

**Dual Dispatch Mechanism**:

The bus offers two outbound dispatch strategies:

1. **Polling-based** (used by `ChannelManager._dispatch_outbound`): The manager polls `consume_outbound()` with a 1-second timeout and routes to `channel.send()`.

2. **Subscriber-based** (via `subscribe_outbound` + `dispatch_outbound`): Channels can register callbacks. The bus's own `dispatch_outbound()` loop consumes from the outbound queue and calls all registered callbacks for the matching channel. This is an alternative pattern not actively used in the current codebase (the ChannelManager uses the polling approach instead).

**Queue Properties**:
- `inbound_size`: Number of pending inbound messages
- `outbound_size`: Number of pending outbound messages
- Both queues are unbounded `asyncio.Queue` instances (no backpressure)

**Threading Safety**: `asyncio.Queue` is safe for use within a single event loop. The Feishu channel, which operates from a separate thread, uses `asyncio.run_coroutine_threadsafe()` to safely publish to the bus.

---

## 5. Session Management

### File Tree
```
nanobot/session/
  __init__.py      # Exports SessionManager, Session
  manager.py       # Session persistence and lifecycle
```

### 5.1 Session Dataclass

```python
@dataclass
class Session:
    key: str                              # Format: "channel:chat_id"
    messages: list[dict[str, Any]]        # Conversation history
    created_at: datetime                  # Session creation time
    updated_at: datetime                  # Last activity time
    metadata: dict[str, Any]              # Arbitrary metadata

    def add_message(self, role: str, content: str, **kwargs) -> None
    def get_history(self, max_messages: int = 50) -> list[dict[str, Any]]
    def clear(self) -> None
```

**Message Format**: Each message in the `messages` list is a dict:
```python
{
    "role": "user" | "assistant",
    "content": "message text",
    "timestamp": "2024-01-01T12:00:00.000000"
}
```

**`get_history(max_messages=50)`**: Returns the last N messages with only `role` and `content` fields, stripping timestamps and extra kwargs. This is the format expected by LLM APIs (e.g., OpenAI/Anthropic message format).

### 5.2 Session Manager

```python
class SessionManager:
    workspace: Path                       # Not used for session storage
    sessions_dir: Path                    # ~/.nanobot/sessions/
    _cache: dict[str, Session]            # In-memory session cache

    def get_or_create(self, key: str) -> Session
    def save(self, session: Session) -> None
    def delete(self, key: str) -> bool
    def list_sessions(self) -> list[dict[str, Any]]
```

**Storage Format (JSONL)**:
Each session is stored as a `.jsonl` file in `~/.nanobot/sessions/`. The filename is derived from the session key with `:` replaced by `_` and unsafe characters removed.

File structure:
```jsonl
{"_type": "metadata", "created_at": "...", "updated_at": "...", "metadata": {...}}
{"role": "user", "content": "Hello", "timestamp": "..."}
{"role": "assistant", "content": "Hi there!", "timestamp": "..."}
{"role": "user", "content": "How are you?", "timestamp": "..."}
```

**Session Lifecycle**:

1. **Creation**: `get_or_create(key)` checks the in-memory cache first, then tries to load from disk, and finally creates a new empty `Session` if neither exists.

2. **Persistence**: `save(session)` writes the entire session to disk (overwrite, not append). The first line is always the metadata record. All messages follow. The session is also cached.

3. **Deletion**: `delete(key)` removes from both cache and disk.

4. **Listing**: `list_sessions()` scans the sessions directory, reads only the first line (metadata) of each file for efficiency, and returns sessions sorted by `updated_at` descending (most recent first).

**Session Key Format**: `"{channel}:{chat_id}"` -- generated by `InboundMessage.session_key`. This provides natural isolation:
- Different channels with the same chat_id get different sessions
- Different chats in the same channel get different sessions
- Group chats share a single session per group

**Caching**: The `_cache` dict is a simple in-memory dictionary (not LRU). Sessions are cached on first access and stay cached for the process lifetime. This means:
- Fast repeated access to active sessions
- No eviction policy (memory grows with number of unique sessions)
- Cache is lost on process restart (but sessions persist on disk)

---

## 6. End-to-End Message Flow

### Inbound: User Message → Agent Response

```
[User sends message on Telegram/Discord/WhatsApp/Feishu]
         │
         ▼
┌─────────────────────────┐
│   Channel._on_message() │  Platform-specific handler
│   • Extract sender, text│
│   • Download media      │
│   • Transcribe voice    │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  BaseChannel._handle_   │  Shared logic
│  message()              │
│   • Check allowlist     │
│   • Create InboundMsg   │
│   • bus.publish_inbound │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  MessageBus.inbound     │  asyncio.Queue
│  (FIFO queue)           │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  Agent Core             │  (outside scope of this analysis)
│   • consume_inbound()   │
│   • Session lookup      │
│   • LLM processing      │
│   • publish_outbound()  │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  MessageBus.outbound    │  asyncio.Queue
│  (FIFO queue)           │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  ChannelManager._dispatch_      │
│  outbound()                     │
│   • consume_outbound()          │
│   • Match msg.channel to handler│
│   • channel.send(msg)           │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│  Channel.send()         │  Platform-specific delivery
│   • Format for platform │
│   • Send via API/WS     │
└─────────────────────────┘
         │
         ▼
[User receives response on their platform]
```

### WhatsApp Extended Flow (includes bridge):

```
[WhatsApp User]
      │
      ▼ (WhatsApp Web protocol / Baileys)
[Node.js WhatsAppClient] ──messages.upsert──→ extractMessageContent()
      │
      ▼ (WebSocket JSON)
[BridgeServer] ──broadcast()──→ {"type": "message", ...}
      │
      ▼ (WebSocket)
[Python WhatsAppChannel._handle_bridge_message()]
      │
      ▼
[BaseChannel._handle_message() → MessageBus.inbound]
      │
      ▼
[Agent processes → MessageBus.outbound]
      │
      ▼
[ChannelManager dispatches → WhatsAppChannel.send()]
      │
      ▼ (WebSocket JSON: {"type": "send", "to": ..., "text": ...})
[BridgeServer.handleCommand()]
      │
      ▼
[WhatsAppClient.sendMessage(to, text)]
      │
      ▼ (WhatsApp Web protocol)
[WhatsApp User receives response]
```

---

## 7. Concurrency Model

### Single Event Loop, Multiple Channels

All Python components (channels, bus, agent) run in a single `asyncio` event loop:

```
asyncio.gather(
    telegram.start(),        # Long-polling loop
    whatsapp.start(),        # WebSocket message loop
    discord.start(),         # Gateway WebSocket loop
    feishu.start(),          # Sleep loop (WS on separate thread)
    manager._dispatch_outbound(),  # Outbound routing loop
    agent.run(),             # Agent processing loop
)
```

### Per-Channel Concurrency Details

| Channel | Connection Model | Threading | Reconnection |
|---------|-----------------|-----------|-------------|
| Telegram | `python-telegram-bot` polling | Single asyncio task | Library-managed |
| WhatsApp | `websockets` async client | Single asyncio task | 5-second retry loop |
| Discord | `websockets` raw Gateway | Asyncio task + heartbeat task + typing tasks | 5-second retry + Gateway RECONNECT |
| Feishu | `lark-oapi` blocking WS | Separate daemon thread → `run_coroutine_threadsafe` | SDK-managed |

### Message Processing Order

Messages are processed FIFO within the `MessageBus.inbound` queue. The agent consumes one message at a time via `consume_inbound()`. There is no parallelism in message processing -- if the agent takes a long time to process one message, subsequent messages queue up.

### Potential Bottleneck

The single-consumer pattern on the inbound queue means that if multiple channels receive messages simultaneously, they all queue up and are processed sequentially by the agent. This is a deliberate simplicity-over-throughput tradeoff.

---

## 8. Authentication and Access Control

### Allowlist Model

Access control is implemented at the channel level in `BaseChannel.is_allowed()`:

```
Configuration:
  channels:
    telegram:
      allow_from: ["12345", "johndoe"]
    whatsapp:
      allow_from: ["1234567890"]
    discord:
      allow_from: ["user_id_1"]
    feishu:
      allow_from: ["ou_xxxx"]
```

**Rules**:
1. If `allow_from` is empty or not set → all senders permitted (open mode)
2. If `allow_from` has entries → only listed senders can interact
3. Compound IDs (e.g., Telegram's `"12345|johndoe"`) are split on `|` and each part checked

**When Access is Denied**: The message is silently dropped (not forwarded to the bus). A warning is logged with the denied sender's ID and instructions to add them to the allowlist.

### Per-Channel Identity Formats

| Channel | sender_id Format | Example |
|---------|-----------------|---------|
| Telegram | `"{user_id}\|{username}"` | `"12345\|johndoe"` |
| WhatsApp | Phone number (stripped from JID) | `"1234567890"` |
| Discord | Discord user ID | `"987654321098765"` |
| Feishu | Open ID | `"ou_abc123def456"` |

### WhatsApp Authentication (QR Code)

WhatsApp requires linking the bot as a "Linked Device" via QR code:
1. On first run, Baileys generates a QR code
2. The bridge displays it in terminal AND broadcasts it to Python
3. Python logs "Scan QR code in the bridge terminal"
4. User scans with their phone's WhatsApp → Linked Devices
5. Auth state persists in `~/.nanobot/whatsapp-auth/` (multi-file auth state)
6. Subsequent restarts use the saved state (no QR needed)

---

## 9. Architecture Patterns and Design Decisions

### Pattern: Abstract Base Channel (Template Method)
Every channel extends `BaseChannel`, which provides the shared `_handle_message()` template. Subclasses override `start()`, `stop()`, and `send()`. This ensures consistent allowlist checking and bus publishing across all channels.

### Pattern: Message Bus (Mediator)
The `MessageBus` acts as a mediator between channels and the agent core. Neither side knows about the other directly. This enables:
- Adding new channels without modifying the agent
- Testing the agent without real channel connections
- Swapping the agent implementation without touching channels

### Pattern: Bridge (Adapter across language boundaries)
WhatsApp requires JavaScript (Baileys library), but nanobot's core is Python. The bridge pattern uses WebSocket as a language-neutral transport:
- `BridgeServer` is the WebSocket hub
- `WhatsAppClient` adapts Baileys to a simple message/event interface
- `WhatsAppChannel` on the Python side adapts the bridge events to `InboundMessage/OutboundMessage`

### Pattern: Graceful Degradation
Each channel is optional. If dependencies are missing (e.g., `pip install python-telegram-bot` not run), the `ChannelManager` catches `ImportError` and continues with the remaining channels. Similarly, Feishu wraps its SDK import in try/except.

### Design Choice: Polling over Webhooks
- Telegram uses long polling (no public IP needed)
- Discord uses Gateway WebSocket (bidirectional, real-time)
- Feishu uses WebSocket long connection (no webhook needed)
- WhatsApp uses Baileys WebSocket (peer-to-peer protocol)

None of the channels require a public-facing HTTP server, which simplifies deployment. The tradeoff is that polling may introduce slight latency compared to webhooks.

### Design Choice: JSONL Session Storage
JSONL was chosen over SQLite or a database for session persistence. Benefits:
- Human-readable and debuggable
- Simple implementation (no ORM or schema migrations)
- Efficient partial reading (metadata on first line)

Tradeoffs:
- No concurrent access safety (single-process assumption)
- Full file rewrite on every save
- No indexing for queries

### Design Choice: Unbounded Queues
The `asyncio.Queue` instances in `MessageBus` are unbounded. This means:
- Messages never block the producer (channel)
- If the agent falls behind, memory usage grows
- No backpressure mechanism to slow down channels

---

## 10. Cross-Component Integration Map

```
┌──────────────────────────────────────────────────────────────────┐
│                        PYTHON PROCESS                            │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │  Telegram    │  │  Discord    │  │  Feishu     │             │
│  │  Channel     │  │  Channel    │  │  Channel    │             │
│  │  (polling)   │  │  (gateway)  │  │  (WS thread)│             │
│  └──────┬───┬──┘  └──────┬───┬──┘  └──────┬───┬──┘             │
│         │   ▲            │   ▲            │   ▲                 │
│  inbound│   │outbound    │   │            │   │                 │
│         │   │            │   │            │   │                 │
│         ▼   │            ▼   │            ▼   │                 │
│  ┌──────────────────────────────────────────────────┐           │
│  │              MessageBus                           │           │
│  │  ┌────────────────┐  ┌─────────────────┐         │           │
│  │  │ inbound queue  │  │ outbound queue  │         │           │
│  │  │ (asyncio.Queue)│  │ (asyncio.Queue) │         │           │
│  │  └───────┬────────┘  └────────▲────────┘         │           │
│  └──────────┼────────────────────┼──────────────────┘           │
│             │                    │                               │
│             ▼                    │                               │
│  ┌──────────────────┐  ┌────────┴─────────┐                    │
│  │   Agent Core     │  │  Channel Manager │                    │
│  │  consume_inbound │  │  _dispatch_      │                    │
│  │  → LLM process   │  │  outbound()      │                    │
│  │  → publish_      │  │  routes to       │                    │
│  │    outbound      │  │  channel.send()  │                    │
│  └──────────────────┘  └──────────────────┘                    │
│                                                                  │
│  ┌──────────────┐                                               │
│  │  WhatsApp    │◄──WebSocket──┐                                │
│  │  Channel     │              │                                │
│  └──────────────┘              │                                │
│                                │                                │
└────────────────────────────────┼────────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │   NODE.JS PROCESS       │
                    │                         │
                    │  ┌───────────────────┐  │
                    │  │   BridgeServer    │  │
                    │  │   (WebSocket hub) │  │
                    │  └────────┬──────────┘  │
                    │           │              │
                    │  ┌────────┴──────────┐  │
                    │  │  WhatsAppClient   │  │
                    │  │  (Baileys)        │  │
                    │  └────────┬──────────┘  │
                    │           │              │
                    └───────────┼──────────────┘
                                │
                    ┌───────────┴──────────────┐
                    │   WhatsApp Web Servers    │
                    └──────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                     SESSION PERSISTENCE                          │
│                                                                  │
│  ~/.nanobot/sessions/                                           │
│    telegram_12345.jsonl       ← Session for Telegram chat 12345 │
│    whatsapp_1234567890.jsonl  ← Session for WhatsApp user       │
│    discord_987654321.jsonl    ← Session for Discord channel     │
│    feishu_oc_xxx.jsonl        ← Session for Feishu group        │
│                                                                  │
│  ~/.nanobot/media/            ← Downloaded media files          │
│  ~/.nanobot/whatsapp-auth/    ← WhatsApp Baileys auth state    │
└──────────────────────────────────────────────────────────────────┘
```

### Key Integration Points

| From | To | Mechanism | Data Format |
|------|-----|-----------|-------------|
| Channel → Bus | `bus.publish_inbound()` | `asyncio.Queue.put()` | `InboundMessage` dataclass |
| Bus → Agent | `bus.consume_inbound()` | `asyncio.Queue.get()` | `InboundMessage` dataclass |
| Agent → Bus | `bus.publish_outbound()` | `asyncio.Queue.put()` | `OutboundMessage` dataclass |
| Bus → Channel | `ChannelManager._dispatch_outbound()` | Poll + `channel.send()` | `OutboundMessage` dataclass |
| Python → Bridge | WebSocket | JSON `{"type":"send","to":"...","text":"..."}` | |
| Bridge → Python | WebSocket | JSON `{"type":"message\|status\|qr\|error",...}` | |
| Bridge → WhatsApp | Baileys/WebSocket | WhatsApp Web binary protocol | |
| Session → Disk | `SessionManager.save()` | File write | JSONL format |
| Disk → Session | `SessionManager._load()` | File read + parse | JSONL format |
| Feishu thread → Main loop | `asyncio.run_coroutine_threadsafe()` | Thread-safe coroutine scheduling | `P2ImMessageReceiveV1` |

---

*Analysis generated from nanobot repository (https://github.com/HKUDS/nanobot) -- commit on main branch.*
