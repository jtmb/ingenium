# HOW-TO: Personality Traits

## What It Does

The personality system tracks the system's learned understanding of the user across 6 developer-specific trait dimensions. Each trait has a confidence score (0.0–1.0) that represents how well-established the pattern is.

## The 6 Trait Dimensions

| Dimension | Source Observations | What It Captures |
|-----------|-------------------|------------------|
| `communication_style` | correction, preference | Whether the user prefers direct, detailed, or concise communication |
| `code_preference` | preference, correction | Code style, formatting, language, and tooling preferences |
| `workflow_pattern` | pattern, workflow | Recurring multi-step processes and sequencing habits |
| `feedback_style` | correction, feedback | How the user gives feedback (detailed vs terse, confirmatory vs directive) |
| `interaction_pattern` | behavior | How the user interacts with agents (frequent checks, batch operations, etc.) |
| `priority_signal` | error, goal | What the user prioritizes: correctness, performance, speed, completeness |

## Confidence Model

| Parameter | Value | Description |
|-----------|-------|-------------|
| Starting confidence | 0.05–0.15 | First observation starts very low |
| Requirement | 2+ confirming observations | Must see multiple signals to build confidence |
| Display threshold | 0.30 | Traits ≥ 0.30 appear by default |
| Confidence cap | 0.95 | Maximum achievable confidence |
| Decay rate | -0.05 after 7+ days | Traits unused for a week lose confidence |
| Daily decay | -0.01 per day | Gradual decay even before 7 days |

### How Confidence Works

1. A single observation creates a trait at very low confidence (0.05–0.15)
2. Repeated observations of the same type boost confidence by +0.1 each
3. High importance observations (≥8) add a +0.2 bonus
4. Multiple sources agreeing add a +0.15 bonus
5. Traits need 2+ confirming observations to reach the display threshold (0.30)
6. Confidence is capped at 0.95 to prevent overcommitment

## Viewing Traits

Navigate to **Personality** (`/personality`) in the dashboard:
- Traits are displayed as cards grouped by type by default
- Each card shows: icon, trait name, type label, confidence bar, last updated time
- The confidence bar fills proportionally (0% → 100%)

### Sort Options

| Option | Description |
|--------|-------------|
| **Grouped by type** | Traits organized by the 6 dimensions (default) |
| **Newest first** | Chronological order, most recent first |

### Hidden Traits

- Traits with confidence below 0.30 are hidden by default
- Click the **"N hidden"** link at the top to toggle hidden traits
- Hidden count updates automatically as confidence changes

## Dismissing Traits

To dismiss a trait:
1. Hover over the trait card
2. Click the **×** (dismiss) button
3. The trait is marked `is_active = false` but NOT deleted
4. Dismissed traits can be re-enabled via the API

### Re-enabling a Trait

```bash
curl -X POST http://localhost:4097/api/v1/personality/:id/enable
```

## MCP Tools

| Tool | Purpose |
|------|---------|
| `ingenium_personality` | Get the full aggregated personality profile |
| `ingenium_personality_traits` | List all traits, optionally filtered by type |

### Example Usage

```typescript
// Get full personality profile
const profile = await ingenium_personality();

// List traits filtered by type
const traits = await ingenium_personality_traits({ trait_type: "code_preference" });
```

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/personality` | GET | List all traits |
| `/api/v1/personality` | POST | Upsert a trait |
| `/api/v1/personality/profile` | GET | Get aggregated profile |
| `/api/v1/personality/:id/disable` | POST | Dismiss a trait |
| `/api/v1/personality/:id/enable` | POST | Re-enable a trait |

## Related Docs
- [docs/self-learning-pipeline.md](../self-learning-pipeline.md) — Full pipeline reference
- [docs/HOW-TO/synthesis.md](synthesis.md) — Synthesis pipeline configuration
- [docs/HOW-TO/self-learning.md](self-learning.md) — Self-learning overview
