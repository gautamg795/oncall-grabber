import { internalMutation, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { ExternalSelect } from "@slack/web-api";
import type { FunctionReference } from "convex/server";

const ROOTLY_SCHEDULE_ID = process.env.ROOTLY_SCHEDULE_ID;
const ONCALL_NOTIFICATION_CHANNEL = process.env.ONCALL_NOTIFICATION_CHANNEL;

// Type definitions for better type safety
interface ConvexActionContext {
  runAction: <T>(
    action: FunctionReference<"action", "internal", any, T>, // eslint-disable-line @typescript-eslint/no-explicit-any 
    args: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  ) => Promise<T>;
}

interface RootlyUser {
  id: string;
  attributes: {
    name: string;
    email: string;
  };
}

interface SlackSelectOption {
  text: {
    type: string;
    text: string;
  };
  value: string;
}

// Helper functions
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
async function sendErrorMessage(
  ctx: ConvexActionContext,
  channelId: string,
  userId: string,
  message: string
) {
  try {
    // Try ephemeral message first
    await ctx.runAction(internal.slack_api.sendEphemeralMessage, {
      channel: channelId,
      user: userId,
      text: message,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error("Failed to send ephemeral message, trying DM instead:", errorMsg);
    try {
      // Fallback to DM if bot isn't in channel
      await ctx.runAction(internal.slack_api.sendDirectMessage, {
        userId: userId,
        text: message,
      });
    } catch (dmError: unknown) {
      const dmErrorMsg = dmError instanceof Error ? dmError.message : 'Unknown error';
      console.error("Failed to send DM as well:", dmErrorMsg);
      // Last resort: just log the error
      console.error("Original error message that couldn't be delivered:", message);
    }
  }
}

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
      // Try to find the current user in Rootly to pre-populate the dropdown
      let initialOption = undefined;

      try {
        // Get current user's Slack info to find their email
        const currentSlackUser = await ctx.runAction(internal.slack_api.getUserInfo, {
          userId: args.requestingSlackUserId
        });

        if (currentSlackUser && currentSlackUser.email) {
          // Get all Rootly users and find the current user by email
          const rootlyUsers: RootlyUser[] = await ctx.runAction(internal.rootly_api.listRootlyUsers);
          const currentRootlyUser = rootlyUsers.find((user: RootlyUser) =>
            user.attributes.email.toLowerCase() === currentSlackUser.email!.toLowerCase()
          );

          if (currentRootlyUser) {
            // Set as initial option if found
            initialOption = {
              text: {
                type: "plain_text" as const,
                text: `${currentRootlyUser.attributes.name} (${currentRootlyUser.attributes.email})`
              },
              value: currentRootlyUser.id,
            };
          }
        }
      } catch (error) {
        // If we can't find the current user, just continue without initial option
        console.log("Could not pre-populate current user, continuing with empty dropdown:", error);
      }

      // Create the external select element
      const userSelectElement: ExternalSelect = {
        type: "external_select",
        action_id: "user_select",
        placeholder: { type: "plain_text", text: "Select a user..." },
        min_query_length: 0,
      };

      // Add initial option if we found the current user
      if (initialOption) {
        userSelectElement.initial_option = initialOption;
      }

      // Create modal with external select
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
              text: `Select a Rootly user and specify the override duration.\n\n*What happens next:* An override will be created in Rootly and a confirmation message will be posted${ONCALL_NOTIFICATION_CHANNEL ? ` to ${ONCALL_NOTIFICATION_CHANNEL}` : ' to this channel'}.`,
            },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `⏰ Current time: <!date^${Math.floor(Date.now() / 1000)}^{time}|${new Date().toLocaleTimeString()}> on <!date^${Math.floor(Date.now() / 1000)}^{date_short}|${new Date().toLocaleDateString()}>`
              }
            ]
          },
          {
            type: "input",
            block_id: "user_block",
            label: { type: "plain_text", text: "Rootly User" },
            element: userSelectElement,
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

    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error("Error opening modal:", errorMsg);

      // Send error message with fallback
      await sendErrorMessage(ctx, args.channelId, args.requestingSlackUserId, `❌ Could not open modal: ${errorMsg}`);
    }

    return null;
  },
});

// New function to handle external select options loading
export const loadUserSelectOptions = internalAction({
  args: {
    query: v.optional(v.string()),
  },
  returns: v.object({
    options: v.array(v.object({
      text: v.object({
        type: v.string(),
        text: v.string(),
      }),
      value: v.string(),
    })),
  }),
  handler: async (ctx, args): Promise<{
    options: Array<{
      text: {
        type: string;
        text: string;
      };
      value: string;
    }>;
  }> => {
    try {
      // Fetch Rootly users
      const rootlyUsers: RootlyUser[] = await ctx.runAction(internal.rootly_api.listRootlyUsers);

      // Filter users if there's a query
      let filteredUsers: RootlyUser[] = rootlyUsers;
      if (args.query && args.query.trim()) {
        const query = args.query.toLowerCase();
        filteredUsers = rootlyUsers.filter((user) =>
          user.attributes.name.toLowerCase().includes(query) ||
          user.attributes.email.toLowerCase().includes(query)
        );
      }

      // Convert to Slack options format
      const options: SlackSelectOption[] = filteredUsers.slice(0, 100).map((user) => ({
        text: {
          type: "plain_text",
          text: `${user.attributes.name} (${user.attributes.email})`
        },
        value: user.id,
      }));

      return { options };

    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error("Error loading user select options:", errorMsg);

      // Return empty options on error
      return {
        options: [{
          text: {
            type: "plain_text",
            text: "Error loading users - please try again"
          },
          value: "error",
        }]
      };
    }
  },
});

export const handleModalSubmission = internalMutation({
  args: {
    payload: v.any(), // Slack's view_submission payload - complex structure we access with known paths
  },
  returns: v.union(
    v.object({
      response_action: v.literal("errors"),
      errors: v.record(v.string(), v.string()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const view = args.payload.view;
    const values = view.state.values;
    const privateMetadata = JSON.parse(view.private_metadata);

    const selectedRootlyUserId = values.user_block.user_select.selected_option?.value;
    const durationStr = values.duration_block.duration_input.value;

    // Validate inputs and show errors in modal if needed
    const errors: Record<string, string> = {};

    if (!selectedRootlyUserId || selectedRootlyUserId === "error") {
      errors.user_block = "Please select a valid Rootly user";
    }

    if (!durationStr || !durationStr.trim()) {
      errors.duration_block = "Please enter a duration";
    } else {
      // Validate duration format
      const durationMatch = durationStr.trim().match(/^(\d+)([mhd])$/);
      if (!durationMatch) {
        errors.duration_block = "Invalid format. Use: 30m, 2h, or 1d";
      } else {
        const amount = parseInt(durationMatch[1]);
        if (amount <= 0) {
          errors.duration_block = "Duration must be a positive number";
        }
      }
    }

    // If there are validation errors, show them in the modal
    if (Object.keys(errors).length > 0) {
      return {
        response_action: "errors" as const,
        errors,
      };
    }

    // Schedule the override creation
    await ctx.scheduler.runAfter(0, internal.slack_handlers.finalizeModalOverride, {
      rootlyUserId: selectedRootlyUserId,
      durationStr: durationStr.trim(),
      channelId: privateMetadata.channelId,
      requestingSlackUserId: privateMetadata.requestingSlackUserId,
      submittingSlackUserId: args.payload.user.id,
      responseUrl: privateMetadata.responseUrl,
    });

    return null;
  },
});

// Handle modal cancellations gracefully
export const handleModalClosed = internalMutation({
  args: {
    payload: v.any(), // Slack's view_closed payload
  },
  returns: v.null(),
  handler: async (_ctx, args) => {
    // Log that user cancelled (optional - helps with analytics)
    console.log(`Modal cancelled by user ${args.payload.user.id}`);

    // Don't send any messages or take action - user intentionally cancelled
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

      // Get the Rootly user info for a nicer success message
      const rootlyUsers: RootlyUser[] = await ctx.runAction(internal.rootly_api.listRootlyUsers);
      const selectedUser = rootlyUsers.find((user: RootlyUser) => user.id === args.rootlyUserId);
      const userName = selectedUser ? selectedUser.attributes.name : args.rootlyUserId;

      // Send success message to configured notification channel (or fallback to original channel)
      const notificationChannel = ONCALL_NOTIFICATION_CHANNEL || args.channelId;
      await ctx.runAction(internal.slack_api.sendMessage, {
        channel: notificationChannel,
        text: `✅ On-call override created for **${userName}** (${args.durationStr})\n⏰ Start: <!date^${Math.floor(startTime.getTime() / 1000)}^{time} on {date_short}|${startTime.toLocaleString()}>\n⏰ End: <!date^${Math.floor(endTime.getTime() / 1000)}^{time} on {date_short}|${endTime.toLocaleString()}>\nRequested by <@${args.requestingSlackUserId}>`,
      });

    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error("Error in finalizeModalOverride:", errorMsg);

      // Send error message with fallback
      await sendErrorMessage(ctx, args.channelId, args.requestingSlackUserId, `❌ Error creating override: ${errorMsg}`);
    }

    return null;
  },
}); 