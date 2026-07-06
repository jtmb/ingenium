---
name: cost-analyzer
description: "Analyze DeepSeek API usage CSVs and compare costs across OpenAI, Anthropic, and OpenCode Go/Zen. Use when the user downloads DeepSeek usage exports or asks 'is Go worth it', 'compare costs', 'which provider is cheapest'."
---

# LLM Cost Analyzer

Compares DeepSeek API usage costs against OpenAI, Anthropic, and OpenCode
Go/Zen pricing.

## When to Use

- User provides `cost-*.csv` and `amount-*.csv` files from DeepSeek platform
- User asks "is OpenCode Go worth it for me?"
- User asks "should I switch to OpenAI / Anthropic?"
- User asks "compare my current costs against other providers"
- User hits rate limits on a free tier and wants to evaluate paid options

## How to Run

```bash
python3 .agents/skills/cost-analyzer/scripts/cost-analyze.py --dir temp
```

### Step 1 — Export from DeepSeek

1. Go to https://platform.deepseek.com/usage
2. Select the month to analyze and click **Export**
3. Download the zip and extract the two CSVs:
   - `cost-YYYY-MM.csv` — daily cost totals per model
   - `amount-YYYY-MM.csv` — token counts and request volume details
4. Place both files in `temp/` at the project root

The script auto-discovers all CSVs matching `cost-*.csv` and `amount-*.csv`.

### Step 2 — Run the Script

```bash
python3 .agents/skills/cost-analyzer/scripts/cost-analyze.py
```

Or with a custom data directory:
```bash
python3 .agents/skills/cost-analyzer/scripts/cost-analyze.py --dir /path/to/data
```

The script outputs a Markdown report to stdout.

## What the Report Shows

### Your DeepSeek Usage
- Daily totals, average, monthly projection
- Spend and request counts broken down by model (Flash vs Pro)
- Cache hit rate (your key cost-savings lever)

### OpenCode Go ($10/mo)
- First $60 of usage included in the subscription
- Overflow charged at Zen PAYG rates
- Shows whether overflow eats the savings

### OpenCode Zen (PAYG)
- Same Flash pricing as deepseek.com, but ~4x markup on Pro
- Useful as emergency overflow for Go subscribers

### OpenAI & Anthropic (Direct API)
- Same token volume at the closest comparable model's pricing
- Models compared: GPT-5.4-mini, GPT-5.3-codex, Claude Haiku 4.5, Sonnet 5
- Shows cost multiplier vs current DeepSeek spend

### Pricing Sources (for manual verification)

| Provider | URL |
|----------|-----|
| DeepSeek | https://api-docs.deepseek.com/quick_start/pricing |
| OpenAI | https://developers.openai.com/api/docs/pricing |
| Anthropic | https://docs.anthropic.com/en/docs/about-claude/pricing |
| OpenCode Zen | https://opencode.ai/docs/zen/ |
| OpenCode Go | https://opencode.ai/docs/go/ |

## 🔴 Important Cautions

- **Token-for-token only**: The script assumes the same number of input,
  output, and cached tokens across providers. Real costs depend on
  provider-specific tokenizers, caching behavior, and model structure.
- **Capability differences**: A DeepSeek V4 Flash token does not equal a
  Claude Sonnet token. Cheaper is not always better for your use case.
- **Cache behavior**: Your 95%+ cache hit rate with DeepSeek is exceptional.
  Other providers offer caching but behavior depends on prompt structure.
- **Pricing changes**: API prices change frequently. Verify current rates
  at each provider's pricing page before making decisions.

## Files

- `scripts/cost-analyze.py` — main analysis script
- `temp/` — put your DeepSeek CSVs here (gitignored)
