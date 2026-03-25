Build apps with the Claude API or Anthropic SDK.

Triggered automatically when code imports `anthropic`, `@anthropic-ai/sdk`, or `claude_agent_sdk`, or when asked to use the Claude API / Anthropic SDKs / Agent SDK.

## Quick Start

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

const message = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello!" }],
});

console.log(message.content);
```

## Latest Models

| Alias | Model ID |
|-------|----------|
| Opus 4.6 | `claude-opus-4-6` |
| Sonnet 4.6 | `claude-sonnet-4-6` |
| Haiku 4.5 | `claude-haiku-4-5-20251001` |

Default to `claude-sonnet-4-6` unless the user specifies otherwise.

## Common Patterns

**Streaming:**
```typescript
const stream = await client.messages.stream({
  model: "claude-sonnet-4-6",
  max_tokens: 1024,
  messages: [{ role: "user", content: prompt }],
});
for await (const chunk of stream) { /* handle chunk */ }
```

**Tool use:**
```typescript
const response = await client.messages.create({
  model: "claude-sonnet-4-6",
  tools: [{ name: "my_tool", description: "...", input_schema: { ... } }],
  messages: [...],
});
```

**Agent SDK (multi-step agents):**
```typescript
import Anthropic from "@anthropic-ai/sdk";
// Use claude_agent_sdk for orchestrating multi-step agentic workflows
```

## Environment

Store the API key in env — never hardcode it:
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

Or in `.env` (gitignored):
```
ANTHROPIC_API_KEY=sk-ant-...
```

## Installation

```bash
npm install @anthropic-ai/sdk
# or
pip install anthropic
```
