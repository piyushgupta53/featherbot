---
name: cron
description: Schedule reminders and recurring tasks
metadata:
  nanobot:
    always: false
---

# Cron Scheduling Skill

You can schedule reminders and recurring tasks using the `cron` tool.

## Actions

### Add a job

Use `action: "add"` with a `name`, `message`, and exactly ONE schedule type:

- `cronExpr` — standard 5-field cron expression
- `everySeconds` — fixed interval in seconds
- `at` — ISO 8601 timestamp for a one-time reminder

### List jobs

Use `action: "list"` to show all scheduled jobs.

### Remove a job

Use `action: "remove"` with the `jobId`.

### Enable/Disable

Use `action: "enable"` or `action: "disable"` with the `jobId`.

## Schedule Type Guide

**Use `cronExpr`** for time-of-day or calendar-based schedules:
- `"0 9 * * *"` — every day at 9:00 AM
- `"0 9 * * 1-5"` — weekdays at 9:00 AM
- `"0 9 * * 0,6"` — weekends at 9:00 AM
- `"30 8 * * *"` — every day at 8:30 AM
- `"0 */2 * * *"` — every 2 hours
- `"0 0 1 * *"` — first day of every month at midnight
- `"0 18 * * 5"` — every Friday at 6:00 PM

**Use `everySeconds`** for simple fixed intervals:
- Every 5 minutes: `everySeconds: 300`
- Every 30 minutes: `everySeconds: 1800`
- Every hour: `everySeconds: 3600`
- Every 6 hours: `everySeconds: 21600`

**Use `at`** for one-time reminders:
- `at: "2026-02-09T15:00:00"` — once at Feb 9, 3:00 PM

## Natural Language Mapping

| User says | Schedule |
|-----------|----------|
| "every morning at 9am" | `cronExpr: "0 9 * * *"` |
| "every weekday at 8:30am" | `cronExpr: "30 8 * * 1-5"` |
| "every hour" | `everySeconds: 3600` |
| "every 20 minutes" | `everySeconds: 1200` |
| "every Sunday at noon" | `cronExpr: "0 12 * * 0"` |
| "tomorrow at 3pm" | `at: "<tomorrow-ISO>"` |
| "in 2 hours" | `at: "<now+2h-ISO>"` |
| "first of every month" | `cronExpr: "0 9 1 * *"` |

## Cron Expression Format

```
┌───────── minute (0-59)
│ ┌─────── hour (0-23)
│ │ ┌───── day of month (1-31)
│ │ │ ┌─── month (1-12)
│ │ │ │ ┌─ day of week (0-6, 0=Sunday)
│ │ │ │ │
* * * * *
```

## Timezone

Add `timezone` when the user specifies a timezone:
- `timezone: "America/New_York"`
- `timezone: "Asia/Kolkata"`
- `timezone: "Europe/London"`

If no timezone is specified, the server's local timezone is used.

## Tips

- The `message` field is what the agent will process when the job fires. Write it as a task instruction (e.g., "Check the weather in Delhi and send me a summary") not just a label.
- One-time jobs (`at`) are automatically deleted after they fire.
- Use `list` to show the user their active jobs before adding duplicates.
