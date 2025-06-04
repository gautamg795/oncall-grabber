import { internalAction } from "./_generated/server";
import { v } from "convex/values";

const ROOTLY_API_KEY = process.env.ROOTLY_API_KEY;
const ROOTLY_API_BASE_URL = "https://api.rootly.com/v1";

// Simple interface for what we actually need from Rootly users
const RootlyUserValidator = v.object({
    id: v.string(),
    attributes: v.object({
        name: v.string(),
        email: v.string(),
    }),
    // Everything else we don't care about
    type: v.optional(v.any()),
    relationships: v.optional(v.any()),
});

export const findRootlyUserByEmail = internalAction({
    args: { email: v.string() },
    returns: v.union(
        v.object({
            id: v.string(),
            attributes: v.object({
                name: v.string(),
                email: v.string(),
            }),
        }),
        v.null()
    ),
    handler: async (ctx, args) => {
        if (!ROOTLY_API_KEY) {
            throw new Error("ROOTLY_API_KEY environment variable is not set");
        }

        const response = await fetch(
            `${ROOTLY_API_BASE_URL}/users?filter[email]=${encodeURIComponent(args.email)}`,
            {
                headers: {
                    "Authorization": `Bearer ${ROOTLY_API_KEY}`,
                    "Content-Type": "application/json",
                },
            }
        );

        if (!response.ok) {
            throw new Error(`Rootly API error finding user: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();

        if (!result.data || result.data.length === 0) {
            return null;
        }

        // Extract only what we need from the response
        const user = result.data[0];
        return {
            id: user.id,
            attributes: {
                name: user.attributes.name,
                email: user.attributes.email,
            },
        };
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
    handler: async (ctx) => {
        if (!ROOTLY_API_KEY) {
            throw new Error("ROOTLY_API_KEY environment variable is not set");
        }

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

        // Extract only what we need from each user
        return (result.data || []).map((user: any) => ({
            id: user.id,
            attributes: {
                name: user.attributes.name,
                email: user.attributes.email,
            },
        }));
    },
}); 