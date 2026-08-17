# Grok Bot inbox

Point a watching bot at **`handoff/grok-bot/WATCH.md`**.

That file is the job ticket. The first lines between `<!-- grok-bot-watch -->` and `<!-- /grok-bot-watch -->` are the machine header:

| `status` | Meaning |
| --- | --- |
| `OPEN` | New work. Claim it. |
| `CLAIMED` | Bot is working. |
| `DONE` | Reply block filled. |
| `BLOCKED` | Could not finish; `blocked_reason` set. |

Do not invent a second inbox. Cursor agents write jobs here; Grok Bot (or any watcher) updates the same file.
