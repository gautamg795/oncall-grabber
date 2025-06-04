# Grab On-Call Slack Command

A Slack slash command `/grab-oncall` that allows engineers to set on-call overrides in Rootly directly from Slack.

## Features

- **Interactive Modal Interface**: `/grab-oncall` - Opens a modal to select Rootly user and specify duration
- **Dynamic User Search**: External select menu loads Rootly users on-demand with search functionality
- **Rootly Integration**: Automatically creates overrides in your Rootly schedule
- **Instant Response**: Modal appears immediately for responsive UX

## Setup Instructions

### 1. Slack App Configuration

1. **Create a Slack App**:
   - Go to [api.slack.com/apps](https://api.slack.com/apps)
   - Click "Create New App" → "From scratch"
   - Enter app name (e.g., "Grab On-Call") and select your workspace

2. **Configure Slash Command**:
   - Go to "Slash Commands" in your app settings
   - Click "Create New Command"
   - Command: `/grab-oncall`
   - Request URL: `https://your-convex-deployment.convex.cloud/slack/commands`
   - Short Description: "Create on-call overrides in Rootly"
   - Usage Hint: (leave empty)

3. **Enable Interactivity**:
   - Go to "Interactivity & Shortcuts"
   - Enable Interactivity
   - Request URL: `https://your-convex-deployment.convex.cloud/slack/interactions`
   - ⚠️ **Important**: This URL is required for the external select menu to work

4. **Set OAuth Scopes**:
   - Go to "OAuth & Permissions"
   - Add Bot Token Scopes:
     - `commands`
     - `users:read`
     - `users:read.email`
     - `chat:write`

5. **Install App**:
   - Install the app to your workspace
   - Copy the "Bot User OAuth Token" (starts with `xoxb-`)
   - Copy the "Signing Secret" from "Basic Information"

### 2. Rootly API Setup

1. **Get Rootly API Key**:
   - Log in to your Rootly dashboard
   - Go to Settings → API Keys
   - Create a new API key with appropriate permissions
   - Copy the API key

2. **Find Schedule ID**:
   - In Rootly, navigate to your on-call schedule
   - The schedule ID is in the URL: `/schedules/{schedule-id}`
   - Copy this ID

### 3. Convex Deployment

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Initialize Convex** (if not already done):
   ```bash
   npx convex dev
   ```

3. **Set Environment Variables**:
   ```bash
   npx convex env set SLACK_BOT_TOKEN "xoxb-your-bot-token"
   npx convex env set SLACK_SIGNING_SECRET "your-signing-secret"
   npx convex env set ROOTLY_API_KEY "your-rootly-api-key"
   npx convex env set ROOTLY_SCHEDULE_ID "your-schedule-id"
   ```

4. **Deploy**:
   ```bash
   npx convex deploy
   ```

5. **Update Slack URLs**:
   - Go back to your Slack app settings
   - Update the Request URLs with your deployed Convex URL:
     - Commands: `https://your-deployment.convex.site/slack/commands`
     - Interactions: `https://your-deployment.convex.site/slack/interactions`

## Usage

### Interactive Modal
```
/grab-oncall
```
Opens a modal where you can:
- Select a Rootly user from a searchable dropdown (loads users dynamically)
- Specify the duration (e.g., "30m", "2h", "1d")

### Duration Formats
- `30m` - 30 minutes
- `2h` - 2 hours  
- `1d` - 1 day

## How It Works

1. **Command Processing**: `/grab-oncall` immediately opens a modal (no loading delay)
2. **User Selection**: Click dropdown to load Rootly users dynamically with search
3. **Override Creation**: Calls Rootly API to create the schedule override
4. **Confirmation**: Sends success/error message back to Slack channel

## Architecture

```
Slack → Convex HTTP → Modal Display → External Select → Rootly API
                                   ↓
                            Override Creation
```

## File Structure

```
convex/
├── schema.ts           # Database schema for schedule config
├── http.ts            # HTTP endpoints for Slack requests
├── slack_handlers.ts  # Core Slack command processing logic
└── rootly_api.ts      # Rootly API integration
```

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `SLACK_BOT_TOKEN` | Bot User OAuth Token from Slack | `xoxb-123-456-abc` |
| `SLACK_SIGNING_SECRET` | Signing Secret from Slack | `abc123def456` |
| `ROOTLY_API_KEY` | API Key from Rootly | `rootly_api_key_123` |
| `ROOTLY_SCHEDULE_ID` | Schedule ID from Rootly | `schedule_456` |

## Security

- **Signature Verification**: All Slack requests are verified using the signing secret
- **Environment Variables**: Sensitive data stored as Convex environment variables
- **Error Handling**: Comprehensive error handling with user-friendly messages

## Development

1. **Start Development Server**:
   ```bash
   npm run dev
   ```

2. **View Logs**:
   - Check Convex dashboard for function logs
   - Monitor Slack app event logs

3. **Testing**:
   - Test modal flow: `/grab-oncall`
   - Verify external select loads users correctly
   - Verify Rootly overrides are created correctly

## Troubleshooting

### Common Issues

1. **"Signature verification failed"**:
   - Check `SLACK_SIGNING_SECRET` is correct
   - Ensure Slack app URLs point to correct Convex deployment

2. **"No result" in user dropdown**:
   - Verify Interactivity Request URL is set correctly in Slack app
   - Check Convex logs for `block_suggestion` request errors
   - Ensure `ROOTLY_API_KEY` has correct permissions

3. **"Rootly user not found"**:
   - Verify Rootly API key permissions
   - Check if Rootly users have proper email addresses

4. **"Modal not opening"**:
   - Check `trigger_id` is valid (expires after 3 seconds)
   - Verify Interactivity URL is correct

5. **"Environment variable not set"**:
   - Run `npx convex env list` to check variables
   - Redeploy after setting new variables

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details. 