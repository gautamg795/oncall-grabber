import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { ActionCache } from "@convex-dev/action-cache";
import { components } from "./_generated/api";

const ROOTLY_API_KEY = process.env.ROOTLY_API_KEY;
const ROOTLY_API_BASE_URL = "https://api.rootly.com/v1";
const ROOTLY_CACHE_TTL = 60 * 60 * 1000;

// Uncached version - this does the actual API call to Rootly
export const listRootlyUsersUncached = internalAction({
    args: {},
    returns: v.array(
        v.object({
            id: v.string(),
            attributes: v.object({
                name: v.string(),
                email: v.string(),
            }),
        })
    ),
    handler: async (ctx, _args) => {
        if (!ROOTLY_API_KEY) {
            throw new Error("ROOTLY_API_KEY environment variable is not set");
        }

        console.log("Fetching Rootly users from API (cache miss)");

        const response = await fetch(`${ROOTLY_API_BASE_URL}/users`, {
            headers: {
                "Authorization": `Bearer ${ROOTLY_API_KEY}`,
                "Content-Type": "application/json",
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch Rootly users: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();

        // Schedule a refresh of the cache right after it would expire
        await ctx.scheduler.runAfter(ROOTLY_CACHE_TTL + 1000, internal.rootly_api.listRootlyUsers, {});
        // Extract only what we need from each user
        return (result.data || []).map((user: { id: string; attributes: { name: string; email: string } }) => ({
            id: user.id,
            attributes: {
                name: user.attributes.name,
                email: user.attributes.email,
            },
        }));
    },
});

// Create a cache for Rootly users 
const rootlyUsersCache = new ActionCache(components.actionCache, {
    action: internal.rootly_api.listRootlyUsersUncached,
    name: "rootly-users-v1",
    ttl: ROOTLY_CACHE_TTL,
}) as ActionCache<typeof internal.rootly_api.listRootlyUsersUncached>;

// Cached version - this is what we'll use everywhere
export const listRootlyUsers = internalAction({
    args: {},
    returns: v.array(
        v.object({
            id: v.string(),
            attributes: v.object({
                name: v.string(),
                email: v.string(),
            }),
        })
    ),
    handler: async (ctx, _args): Promise<Array<{
        id: string;
        attributes: {
            name: string;
            email: string;
        };
    }>> => {
        // Use cache with 1 hour TTL
        return await rootlyUsersCache.fetch(ctx, {});
    },
});

export const createRootlyOverride = internalAction({
    args: {
        rootlyUserId: v.string(),
        scheduleId: v.string(),
        startTime: v.string(), // ISO string
        endTime: v.string(),   // ISO string
    },
    returns: v.object({
        id: v.string(),
        success: v.boolean(),
    }),
    handler: async (ctx, args) => {
        if (!ROOTLY_API_KEY) {
            throw new Error("ROOTLY_API_KEY environment variable is not set");
        }

        const response = await fetch(
            `${ROOTLY_API_BASE_URL}/schedules/${args.scheduleId}/override_shifts`,
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${ROOTLY_API_KEY}`,
                    "Content-Type": "application/vnd.api+json",
                },
                body: JSON.stringify({
                    data: {
                        type: "shifts",
                        attributes: {
                            user_id: parseInt(args.rootlyUserId),
                            starts_at: args.startTime,
                            ends_at: args.endTime,
                        },
                    },
                }),
            }
        );

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Rootly API error creating override: ${response.status} ${response.statusText} - ${errorBody}`);
        }

        const result = await response.json();

        // Return simple success response
        return {
            id: result.data?.id || "unknown",
            success: true,
        };
    },
}); 