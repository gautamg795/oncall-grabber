import { internalMutation, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const ROOTLY_SCHEDULE_ID = process.env.ROOTLY_SCHEDULE_ID;

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
          // Try to find them in Rootly
          const currentRootlyUser = await ctx.runAction(internal.rootly_api.findRootlyUserByEmail, {
            email: currentSlackUser.email
          });

          if (currentRootlyUser) {
            // Set as initial option if found
            initialOption = {
              text: {
                type: "plain_text",
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
      const userSelectElement: any = {
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
              text: "Select a Rootly user and specify the override duration.\n\n*What happens next:* An override will be created in Rootly and a confirmation message will be posted to this channel.",
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

    } catch (error: any) {
      console.error("Error opening modal:", error);

      // Send error message with fallback
      await sendErrorMessage(ctx, args.channelId, args.requestingSlackUserId, `❌ Could not open modal: ${error.message}`);
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
      const rootlyUsers: Array<{
        id: string;
        attributes: {
          name: string;
          email: string;
        };
      }> = await ctx.runAction(internal.rootly_api.listRootlyUsers);

      // Filter users if there's a query
      let filteredUsers: typeof rootlyUsers = rootlyUsers;
      if (args.query && args.query.trim()) {
        const query = args.query.toLowerCase();
        filteredUsers = rootlyUsers.filter((user) =>
          user.attributes.name.toLowerCase().includes(query) ||
          user.attributes.email.toLowerCase().includes(query)
        );
      }

      // Convert to Slack options format
      const options: Array<{
        text: {
          type: string;
          text: string;
        };
        value: string;
      }> = filteredUsers.slice(0, 100).map((user) => ({
        text: {
          type: "plain_text",
          text: `${user.attributes.name} (${user.attributes.email})`
        },
        value: user.id,
      }));

      return { options };

    } catch (error: any) {
      console.error("Error loading user select options:", error);

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
    payload: v.any(), // Slack's view_submission payload
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
  handler: async (ctx, args) => {
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
      const rootlyUsers = await ctx.runAction(internal.rootly_api.listRootlyUsers);
      const selectedUser = rootlyUsers.find((user: any) => user.id === args.rootlyUserId);
      const userName = selectedUser ? selectedUser.attributes.name : args.rootlyUserId;

      // Send success message
      await ctx.runAction(internal.slack_api.sendMessage, {
        channel: args.channelId,
        text: `✅ On-call override created for **${userName}** (${args.durationStr})\n⏰ Start: <!date^${Math.floor(startTime.getTime() / 1000)}^{time} on {date_short}|${startTime.toLocaleString()}>\n⏰ End: <!date^${Math.floor(endTime.getTime() / 1000)}^{time} on {date_short}|${endTime.toLocaleString()}>\nRequested by <@${args.requestingSlackUserId}>`,
      });

    } catch (error: any) {
      console.error("Error in finalizeModalOverride:", error);

      // Send error message with fallback
      await sendErrorMessage(ctx, args.channelId, args.requestingSlackUserId, `❌ Error creating override: ${error.message}`);
    }

    return null;
  },
}); 