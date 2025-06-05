# Grab On-Call Slack Command

Slack slash command that creates Rootly on-call overrides directly from Slack.

## Setup

### 1. Slack App Configuration

Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps):

1. **Slash Command**: `/grab-oncall` → `https://your-deployment.convex.site/slack/commands`
2. **Interactivity**: Enable → `https://your-deployment.convex.site/slack/interactions`
3. **Select Menus**: Set Options Load URL → `https://your-deployment.convex.site/slack/interactions` (same URL)
4. **OAuth Scopes**: `commands`, `users:read`, `users:read.email`, `chat:write`
5. **Install app** and save Bot Token (`xoxb-...`) and Signing Secret

### 2. Rootly Setup

1. Generate API key in Rootly Settings → API Keys
2. Find schedule ID from URL: `/schedules/{schedule-id}`

### 3. Deploy

```bash
npm install
npx convex env set --prod SLACK_BOT_TOKEN "xoxb-..."
npx convex env set --prod SLACK_SIGNING_SECRET "..."
npx convex env set --prod ROOTLY_API_KEY "..."
npx convex env set --prod ROOTLY_SCHEDULE_ID "..."
npx convex deploy
```

Update Slack app URLs to use your deployed `convex.site` domain.

## Usage

```
/grab-oncall
```

Opens modal to:
- Select Rootly user (searchable dropdown)
- Set duration: `30m`, `2h`, `1d`

## Development

```bash
npm run dev          # Start dev server
npm run lint         # Check code
npm run lint:fix     # Auto-fix issues
```

## Environment Variables

| Variable | Source | Example |
|----------|--------|---------|
| `SLACK_BOT_TOKEN` | Slack app OAuth | `xoxb-123-456-abc` |
| `SLACK_SIGNING_SECRET` | Slack app Basic Info | `abc123def456` |
| `ROOTLY_API_KEY` | Rootly Settings | `rootly_api_key_123` |
| `ROOTLY_SCHEDULE_ID` | Rootly schedule URL | `schedule_456` |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Signature verification failed" | Check `SLACK_SIGNING_SECRET`, verify URLs |
| "No result" in dropdown | Verify Interactivity URL, check `ROOTLY_API_KEY` |
| Modal not opening | Check Interactivity URL, `trigger_id` expires in 3s |
| "Environment variable not set" | Run `npx convex env list`, redeploy after changes |

## Architecture

```
convex/
├── http.ts              # Slack webhook endpoints
├── slack_handlers.ts    # Modal and interaction logic
├── rootly_api.ts        # Rootly API calls (cached)
└── schema.ts            # Database schema
``` 