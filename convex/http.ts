import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

// Helper for Slack signature verification using Web Crypto API
async function verifySlackRequest(request: Request, rawBodyText: string): Promise<boolean> {
    const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
    if (!slackSigningSecret) {
        console.error("SLACK_SIGNING_SECRET is not set.");
        return false;
    }

    const timestamp = request.headers.get("X-Slack-Request-Timestamp");
    const slackSignature = request.headers.get("X-Slack-Signature");

    if (!timestamp || !slackSignature) return false;

    // Prevent replay attacks (reject requests older than 5 minutes)
    if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 60 * 5) return false;

    const sigBasestring = `v0:${timestamp}:${rawBodyText}`;

    // Use Web Crypto API instead of Node.js crypto
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(slackSigningSecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );

    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(sigBasestring));
    const signatureArray = new Uint8Array(signature);
    const mySignature = `v0=${Array.from(signatureArray).map(b => b.toString(16).padStart(2, '0')).join('')}`;

    // Simple string comparison (timing-safe comparison not available in Web Crypto)
    return mySignature === slackSignature;
}

http.route({
    path: "/slack/commands",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
        const rawBodyText = await request.text();

        if (!(await verifySlackRequest(request, rawBodyText))) {
            return new Response("Signature verification failed", { status: 401 });
        }

        const params = new URLSearchParams(rawBodyText);
        const command = params.get("command");
        const text = params.get("text") || "";
        const userId = params.get("user_id")!;
        const channelId = params.get("channel_id")!;
        const triggerId = params.get("trigger_id")!;
        const responseUrl = params.get("response_url")!;

        if (command === "/grab-oncall") {
            // Always open modal - no argument processing
            await ctx.scheduler.runAfter(0, internal.slack_handlers.openOncallModal, {
                triggerId,
                channelId,
                requestingSlackUserId: userId,
                responseUrl,
            });

            // Return empty response for modal opening - no message shown
            return new Response(null, { status: 200 });
        }

        return new Response("Unknown command", { status: 400 });
    }),
});

http.route({
    path: "/slack/interactions",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
        const rawBodyText = await request.text();

        if (!(await verifySlackRequest(request, rawBodyText))) {
            return new Response("Signature verification failed", { status: 401 });
        }

        const params = new URLSearchParams(rawBodyText);
        const payloadString = params.get("payload");
        if (!payloadString) {
            return new Response("Missing payload", { status: 400 });
        }

        const payload = JSON.parse(payloadString);

        if (payload.type === "view_submission") {
            // Schedule the modal submission processing
            await ctx.scheduler.runAfter(0, internal.slack_handlers.handleModalSubmission, {
                payload,
            });

            // Acknowledge modal submission
            return new Response(null, { status: 200 });
        }

        if (payload.type === "view_closed") {
            // Handle modal cancellations gracefully
            await ctx.scheduler.runAfter(0, internal.slack_handlers.handleModalClosed, {
                payload,
            });

            // Acknowledge modal closure
            return new Response(null, { status: 200 });
        }

        if (payload.type === "block_suggestion") {
            // Handle external select menu options loading
            const query = payload.value || "";

            const result = await ctx.runAction(internal.slack_handlers.loadUserSelectOptions, {
                query: query || undefined,
            });

            return new Response(JSON.stringify(result), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }

        return new Response("Unhandled interaction type", { status: 400 });
    }),
});

export default http; 