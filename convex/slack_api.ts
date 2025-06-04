"use node";

import { internalAction } from "./_generated/server";
import { WebClient } from "@slack/web-api";
import { v } from "convex/values";

const getSlackClient = () => new WebClient(process.env.SLACK_BOT_TOKEN);

export const getUserInfo = internalAction({
  args: { userId: v.string() },
  returns: v.union(
    v.object({
      email: v.string(),
      name: v.string(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const slackClient = getSlackClient();
    
    try {
      const slackUserInfo = await slackClient.users.info({ user: args.userId });
      if (!slackUserInfo.ok || !slackUserInfo.user?.profile?.email) {
        return null;
      }
      
      return {
        email: slackUserInfo.user.profile.email,
        name: slackUserInfo.user.profile.display_name || slackUserInfo.user.real_name || "Unknown",
      };
    } catch (error) {
      console.error("Error fetching Slack user info:", error);
      return null;
    }
  },
});

export const sendMessage = internalAction({
  args: {
    channel: v.string(),
    text: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const slackClient = getSlackClient();
    
    try {
      await slackClient.chat.postMessage({
        channel: args.channel,
        text: args.text,
      });
    } catch (error) {
      console.error("Error sending Slack message:", error);
      throw error;
    }
    
    return null;
  },
});

export const sendEphemeralMessage = internalAction({
  args: {
    channel: v.string(),
    user: v.string(),
    text: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const slackClient = getSlackClient();
    
    try {
      await slackClient.chat.postEphemeral({
        channel: args.channel,
        user: args.user,
        text: args.text,
      });
    } catch (error) {
      console.error("Error sending ephemeral Slack message:", error);
      throw error;
    }
    
    return null;
  },
});

export const sendDirectMessage = internalAction({
  args: {
    userId: v.string(),
    text: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const slackClient = getSlackClient();
    
    try {
      // Open a DM channel with the user
      const dmChannel = await slackClient.conversations.open({
        users: args.userId,
      });
      
      if (!dmChannel.ok || !dmChannel.channel?.id) {
        throw new Error("Failed to open DM channel");
      }
      
      // Send the message to the DM channel
      await slackClient.chat.postMessage({
        channel: dmChannel.channel.id,
        text: args.text,
      });
    } catch (error) {
      console.error("Error sending direct message:", error);
      throw error;
    }
    
    return null;
  },
});

export const openModal = internalAction({
  args: {
    triggerId: v.string(),
    view: v.any(), // Slack Block Kit view object
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const slackClient = getSlackClient();
    
    try {
      await slackClient.views.open({
        trigger_id: args.triggerId,
        view: args.view,
      });
    } catch (error) {
      console.error("Error opening Slack modal:", error);
      throw error;
    }
    
    return null;
  },
}); 