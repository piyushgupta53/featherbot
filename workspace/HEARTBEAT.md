# Heartbeat

This file is read by FeatherBot every heartbeat interval (default: 10 minutes).
If it contains actionable content, the agent wakes up and processes it.
If the file is empty or contains only comments, the agent stays silent.

- Add tasks as checklist items in the Tasks section below.
- The Proactive Review section guides the agent's autonomous behavior.
- Respond with SKIP if nothing is actionable.

---

## Tasks

<!-- Add periodic tasks as checklist items. The agent will process them on each heartbeat. -->
<!-- - [ ] Check for new emails and summarize unread -->
<!-- - [ ] Review calendar for upcoming meetings today -->
<!-- - [ ] Check weather and notify if rain is expected -->

## Proactive Review

You are waking up for a periodic self-check.

Current time: {{timestamp}}
Day of week: {{dayOfWeek}}

Review the tasks above and your memory for anything actionable.

Rules for proactive messaging:
- Silence is fine — only reach out if something is genuinely useful.
- Do not repeat information you already sent (check your recent sends above).
- Batch related updates into a single message when possible.
- Match the user's usual communication tone and style.
- If nothing is actionable, respond with SKIP.

Check your memory for:
- Pending follow-ups or reminders you set for yourself.
- Observed patterns that suggest a timely action.
- Any context from recent conversations that warrants a check-in.
