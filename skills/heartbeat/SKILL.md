---
name: heartbeat
description: Periodic self-wake and proactive behavior
metadata:
  nanobot:
    always: false
---

# Heartbeat Skill

The heartbeat is a periodic self-wake system that reads `HEARTBEAT.md` from the workspace and sends it to the agent for processing. It enables autonomous task execution and proactive behavior.

## How It Works

1. Every N minutes (default: 30), the heartbeat timer fires.
2. The service reads `HEARTBEAT.md` from the workspace directory.
3. If the file has content, it builds a prompt with the current timestamp and day of week, then sends it to the agent.
4. If the file is missing or empty, the tick is silently skipped.
5. If the agent determines nothing is actionable, it responds with **SKIP**.

## HEARTBEAT.md Structure

The heartbeat file has two main sections:

### Tasks Section

A checklist of periodic tasks for the agent to process on each heartbeat:

```markdown
## Tasks
- [ ] Check for new emails and summarize unread
- [ ] Review calendar for upcoming meetings today
- [ ] Check weather and notify if rain is expected
```

Add, remove, or edit tasks using the filesystem tools (`read_file`, `write_file`, `edit_file`).

### Proactive Review Section

A prompt template that guides the agent's autonomous behavior. It includes:

- Current time and day of week (injected automatically)
- Rules for proactive messaging (silence is fine, max once per day, match user tone)
- The **SKIP** convention — respond with SKIP if nothing is actionable

## Proactive Behavior

The heartbeat enables proactive behavior through memory integration:

### Observed Patterns

During normal conversations, write observations to memory under an **Observed Patterns** section. The heartbeat can pick these up later for timely actions.

Example memory entry:
```markdown
## Observed Patterns
- User checks weather every morning around 8am
- User asks about calendar on weekday mornings
- User prefers concise summaries over detailed reports
```

### Pending Follow-ups

Track items that need follow-up in a **Pending** section in memory. The heartbeat reviews these on each tick.

Example memory entry:
```markdown
## Pending
- Follow up on package delivery (tracking #12345) — check tomorrow
- Remind user about dentist appointment on Feb 15
```

## Memory Conventions

When writing to memory during normal conversations, use these sections to enable heartbeat-driven proactive behavior:

- **Observed Patterns** — recurring behaviors, preferences, routines
- **Pending** — items that need follow-up at a later time

The heartbeat reads memory on each tick and uses these sections to determine if any proactive action is warranted.

## The SKIP Convention

When the heartbeat fires and nothing is actionable:
- No pending tasks need attention
- No follow-ups are due
- No patterns suggest a timely action

The agent responds with **SKIP**, and no message is sent to the user. This is the expected default — silence is preferred over unnecessary messages.

## Configuration

Heartbeat is configured in `config.json`:

```json
{
  "heartbeat": {
    "enabled": true,
    "intervalMs": 1800000,
    "heartbeatFile": "HEARTBEAT.md"
  }
}
```

- `enabled` — turn heartbeat on/off (default: `true`)
- `intervalMs` — interval between ticks in milliseconds (default: `1800000` = 30 minutes)
- `heartbeatFile` — filename relative to workspace (default: `HEARTBEAT.md`)
