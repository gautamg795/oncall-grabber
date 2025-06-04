import { internalMutation, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const ROOTLY_SCHEDULE_ID = process.env.ROOTLY_SCHEDULE_ID;

// Helper functions
function parseGrabOncallText(text: string): { durationStr: string; mentionedSlackId: string } | null {
  const match = text.trim().match(/^(\S+)\s+<@(\w+)(?:\|.*?)?>$/);
  if (match) {
    return { durationStr: match[1], mentionedSlackId: match[2] };
  }
  return null;
}

function calculateOverrideTimes(durationStr: string): { startTime: Date; endTime: Date } {
  const now = new Date();
  const endTime = new Date(now);
  const amount = parseInt(durationStr.slice(0, -1));
  const unit = durationStr.slice(-1).toLowerCase();

  if (isNaN(amount) || amount <= 0) {
    throw new Error("Invalid duration amount. Must be a positive number.");
  }

  switch (unit) {
    case 'm':
      endTime.setMinutes(now.getMinutes() + amount);
      break;
    case 'h':
      endTime.setHours(now.getHours() + amount);
      break;
    case 'd':
      endTime.setDate(now.getDate() + amount);
      break;
    default:
      throw new Error("Invalid duration unit. Use m (minutes), h (hours), or d (days).");
  }

  return { startTime: now, endTime };
}

// Helper to safely send error messages
async function sendErrorMessage(ctx: any, channelId: string, userId: string, message: string) {
  try {
    // Try ephemeral message first
    await ctx.runAction(internal.slack_api.sendEphemeralMessage, {
      channel: channelId,
      user: userId,
      text: message,
    });
  } catch (error: any) {
    console.error("Failed to send ephemeral message, trying DM instead:", error);
    try {
      // Fallback to DM if bot isn't in channel
      await ctx.runAction(internal.slack_api.sendDirectMessage, {
        userId: userId,
        text: message,
      });
    } catch (dmError: any) {
      console.error("Failed to send DM as well:", dmError);
      // Last resort: just log the error
      console.error("Original error message that couldn't be delivered:", message);
    }
  }
}

export const processGrabOncallCommand = internalMutation({
  args: {
    text: v.string(),
    slackUserId: v.string(),
    channelId: v.string(),
    triggerId: v.string(),
    responseUrl: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const parsedArgs = parseGrabOncallText(args.text);
    
    if (parsedArgs) {
      // Direct command with arguments
      await ctx.scheduler.runAfter(0, internal.slack_handlers.handleDirectOverride, {
        durationStr: parsedArgs.durationStr,
        mentionedSlackId: parsedArgs.mentionedSlackId,
        requestingSlackUserId: args.slackUserId,
        channelId: args.channelId,
        responseUrl: args.responseUrl,
      });
    } else {
      // No arguments, open modal
      await ctx.scheduler.runAfter(0, internal.slack_handlers.openOncallModal, {
        triggerId: args.triggerId,
        channelId: args.channelId,
        requestingSlackUserId: args.slackUserId,
        responseUrl: args.responseUrl,
      });
    }
    
    return null;
  },
});

export const handleDirectOverride = internalAction({
  args: {
    durationStr: v.string(),
    mentionedSlackId: v.string(),
    requestingSlackUserId: v.string(),
    channelId: v.string(),
    responseUrl: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      if (!ROOTLY_SCHEDULE_ID) {
        throw new Error("ROOTLY_SCHEDULE_ID environment variable is not set");
      }

      // Get Slack user info to find email
      const slackUser = await ctx.runAction(internal.slack_api.getUserInfo, { 
        userId: args.mentionedSlackId 
      });
      
      if (!slackUser) {
        throw new Error(`Could not find email for Slack user <@${args.mentionedSlackId}>.`);
      }

      // Find Rootly user by email
      const rootlyUser = await ctx.runAction(internal.rootly_api.findRootlyUserByEmail, { 
        email: slackUser.email 
      });
      
      if (!rootlyUser) {
        throw new Error(`Rootly user not found for email: ${slackUser.email}.`);
      }

      // Calculate override times
      const { startTime, endTime } = calculateOverrideTimes(args.durationStr);

      // Create Rootly override
      await ctx.runAction(internal.rootly_api.createRootlyOverride, {
        rootlyUserId: rootlyUser.id,
        scheduleId: ROOTLY_SCHEDULE_ID,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
      });

      // Send success message
      await ctx.runAction(internal.slack_api.sendMessage, {
        channel: args.channelId,
        text: `✅ Override created: ${args.durationStr} for <@${args.mentionedSlackId}> (${rootlyUser.attributes.name}). Requested by <@${args.requestingSlackUserId}>.`,
      });

    } catch (error: any) {
      console.error("Error in handleDirectOverride:", error);
      
      // Send error message with fallback
      await sendErrorMessage(ctx, args.channelId, args.requestingSlackUserId, `❌ Error: ${error.message}`);
    }
    
    return null;
  },
});

export const openOncallModal = internalAction({
  args: {
    triggerId: v.string(),
    channelId: v.string(),
    requestingSlackUserId: v.string(),
    responseUrl: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      // Fetch Rootly users for the dropdown
      const rootlyUsers = await ctx.runAction(internal.rootly_api.listRootlyUsers);
      
      const userOptions = rootlyUsers.map((user: any) => ({
        text: { 
          type: "plain_text", 
          text: `${user.attributes.name} (${user.attributes.email})` 
        },
        value: user.id,
      }));

      const modalView = {
        type: "modal",
        callback_id: "oncall_override_modal_submit",
        title: { type: "plain_text", text: "Create On-Call Override" },
        submit: { type: "plain_text", text: "Create Override" },
        private_metadata: JSON.stringify({ 
          channelId: args.channelId, 
          requestingSlackUserId: args.requestingSlackUserId,
          responseUrl: args.responseUrl,
        }),
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "Select a Rootly user and specify the override duration:",
            },
          },
          {
            type: "input",
            block_id: "user_block",
            label: { type: "plain_text", text: "Rootly User" },
            element: {
              type: "static_select",
              action_id: "user_select",
              placeholder: { type: "plain_text", text: "Select a user" },
              options: userOptions,
            },
          },
          {
            type: "input",
            block_id: "duration_block",
            label: { type: "plain_text", text: "Duration" },
            element: {
              type: "plain_text_input",
              action_id: "duration_input",
              placeholder: { type: "plain_text", text: "e.g., 1h, 30m, 2d" },
            },
            hint: {
              type: "plain_text",
              text: "Use format: 30m (minutes), 2h (hours), or 1d (days)",
            },
          },
        ],
      };

      await ctx.runAction(internal.slack_api.openModal, {
        triggerId: args.triggerId,
        view: modalView,
      });

    } catch (error: any) {
      console.error("Error opening modal:", error);
      
      // Send error message with fallback
      await sendErrorMessage(ctx, args.channelId, args.requestingSlackUserId, `❌ Could not open modal: ${error.message}`);
    }
    
    return null;
  },
});

export const handleModalSubmission = internalMutation({
  args: { 
    payload: v.any(), // Slack's view_submission payload
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const view = args.payload.view;
    const values = view.state.values;
    const privateMetadata = JSON.parse(view.private_metadata);

    const selectedRootlyUserId = values.user_block.user_select.selected_option.value;
    const durationStr = values.duration_block.duration_input.value;

    await ctx.scheduler.runAfter(0, internal.slack_handlers.finalizeModalOverride, {
      rootlyUserId: selectedRootlyUserId,
      durationStr,
      channelId: privateMetadata.channelId,
      requestingSlackUserId: privateMetadata.requestingSlackUserId,
      submittingSlackUserId: args.payload.user.id,
      responseUrl: privateMetadata.responseUrl,
    });
    
    return null;
  },
});

export const finalizeModalOverride = internalAction({
  args: {
    rootlyUserId: v.string(),
    durationStr: v.string(),
    channelId: v.string(),
    requestingSlackUserId: v.string(),
    submittingSlackUserId: v.string(),
    responseUrl: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      if (!ROOTLY_SCHEDULE_ID) {
        throw new Error("ROOTLY_SCHEDULE_ID environment variable is not set");
      }

      // Calculate override times
      const { startTime, endTime } = calculateOverrideTimes(args.durationStr);

      // Create Rootly override
      await ctx.runAction(internal.rootly_api.createRootlyOverride, {
        rootlyUserId: args.rootlyUserId,
        scheduleId: ROOTLY_SCHEDULE_ID,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
      });

      // Send success message
      await ctx.runAction(internal.slack_api.sendMessage, {
        channel: args.channelId,
        text: `✅ Override created via modal: ${args.durationStr} for Rootly user ${args.rootlyUserId}.\nRequested by <@${args.requestingSlackUserId}>, submitted by <@${args.submittingSlackUserId}>.`,
      });

    } catch (error: any) {
      console.error("Error in finalizeModalOverride:", error);
      
      // Send error message with fallback
      await sendErrorMessage(ctx, args.channelId, args.requestingSlackUserId, `❌ Error creating override from modal: ${error.message}`);
    }
    
    return null;
  },
}); 