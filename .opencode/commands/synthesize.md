# synthesize

Trigger the synthesis pipeline to process pending observations into personality traits and skill updates.

## Usage

```
/synthesize
```

## What it does

1. Reads all unprocessed observations from the Ingenium DB
2. Runs the synthesis pipeline (classifies observations → upserts personality traits → updates skills)
3. Marks observations as processed
4. Returns a summary of what was done

## When to use

- When you notice the agent repeating the same pattern
- When you want the system to learn from recent interactions
- After making corrections to the agent's output
- After the agent has been interacting for a while

## Related

- `ingenium_synthesis_status` — Check current pipeline stats
- `ingenium_observation_stats` — Get observation counts
- `ingenium_personality` — View learned personality profile
