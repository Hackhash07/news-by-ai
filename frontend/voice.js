/* ═══════════════════════════════════════════════════════════════════════════════
   TRADING IQ BATTLE — voice.js (Agora Voice Chat Module)
   
   Handles team-based voice chat via Agora RTC SDK.
   
   NOTE ON ERR_BLOCKED_BY_CLIENT:
   This console error is caused by ad-blockers (uBlock Origin, etc.) blocking
   requests to Agora's analytics/stats endpoints (statscollector-*.agora.io).
   It does NOT affect voice functionality — audio joining, publishing,
   subscribing, mute/unmute all work independently of stats collection.
   This error is cosmetic and can be safely ignored.
   ═══════════════════════════════════════════════════════════════════════════════ */

let rtc = {
    localAudioTrack: null,
    client: null,
    connected: false,
    joining: false, // guard against double-join
    lastError: null
};

/**
 * Join team voice chat channel via Agora.
 * Includes double-join guard — if already connected, leaves first.
 * 
 * @param {string} roomId - The room code
 * @param {string} teamId - "a" or "b"
 * @param {string} playerId - Unique player identifier
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function joinTeamVoice(roomId, teamId, playerId) {
    // Prevent concurrent join attempts
    if (rtc.joining) {
        console.warn("[Voice] Join already in progress, skipping.");
        return { success: false, error: "Join already in progress" };
    }

    // If already connected, leave first (handles team switch, rejoin scenarios)
    if (rtc.connected || rtc.client) {
        console.log("[Voice] Already connected, leaving before rejoin...");
        await leaveVoice();
    }

    rtc.joining = true;
    rtc.lastError = null;

    // In production, fetch this from Firebase Remote Config or environment variables
    const appId = "YOUR_AGORA_APP_ID"; // The user needs to replace this
    const channel = `${roomId}_${teamId}`;

    try {
        // Validate Agora SDK is loaded
        if (typeof AgoraRTC === "undefined") {
            throw new Error("Agora SDK not loaded");
        }

        // Validate App ID
        if (!appId || appId === "YOUR_AGORA_APP_ID") {
            console.warn("[Voice] Agora App ID not configured. Voice chat unavailable.");
            rtc.lastError = "Voice not configured (missing Agora App ID)";
            rtc.joining = false;
            return { success: false, error: rtc.lastError };
        }

        // Fetch token from cloud function
        const tokenUrl = `https://us-central1-trade-trends-70426.cloudfunctions.net/generateAgoraToken?channel=${channel}&uid=${playerId}`;

        let token = null;
        try {
            const response = await fetch(tokenUrl);
            if (response.ok) {
                const data = await response.json();
                token = data.token;
            } else {
                console.warn("[Voice] Token fetch returned non-OK status, trying without token.");
            }
        } catch (e) {
            console.warn("[Voice] Could not fetch token, attempting without token (requires Agora testing mode).", e);
        }

        // Create Agora client
        rtc.client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

        // Handle remote users publishing audio
        rtc.client.on("user-published", async (user, mediaType) => {
            try {
                await rtc.client.subscribe(user, mediaType);
                if (mediaType === "audio" && user.audioTrack) {
                    user.audioTrack.play();
                }
            } catch (subErr) {
                console.error("[Voice] Failed to subscribe to remote user:", subErr);
            }
        });

        rtc.client.on("user-unpublished", (user, mediaType) => {
            if (mediaType === "audio" && user.audioTrack) {
                user.audioTrack.stop();
            }
        });

        // Join the channel
        await rtc.client.join(appId, channel, token, playerId);

        // Create and publish local audio track
        rtc.localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
        await rtc.client.publish([rtc.localAudioTrack]);

        rtc.connected = true;
        rtc.joining = false;

        console.log(`[Voice] Joined team voice chat on channel ${channel}`);
        return { success: true };
    } catch (err) {
        console.error("[Voice] Failed to join team voice chat:", err);
        rtc.lastError = err.message || "Voice connection failed";
        rtc.joining = false;

        // Clean up any partial state
        await cleanupPartialState();

        return { success: false, error: rtc.lastError };
    }
}

/**
 * Leave voice chat and clean up all resources.
 * Safe to call even if not connected.
 */
export async function leaveVoice() {
    try {
        // Close local audio track
        if (rtc.localAudioTrack) {
            rtc.localAudioTrack.stop();
            rtc.localAudioTrack.close();
            rtc.localAudioTrack = null;
        }

        // Leave the channel
        if (rtc.client) {
            await rtc.client.leave();
            rtc.client = null;
        }

        rtc.connected = false;
        rtc.joining = false;
        console.log("[Voice] Left voice chat and cleaned up.");
    } catch (err) {
        console.error("[Voice] Error during voice cleanup:", err);
        // Force reset state even on error
        rtc.localAudioTrack = null;
        rtc.client = null;
        rtc.connected = false;
        rtc.joining = false;
    }
}

/**
 * Toggle mute state of local audio.
 * @param {boolean} isMuted
 */
export function toggleMute(isMuted) {
    if (rtc.localAudioTrack) {
        rtc.localAudioTrack.setMuted(isMuted);
    }
}

/**
 * Check if voice is currently connected.
 * @returns {boolean}
 */
export function isVoiceConnected() {
    return rtc.connected;
}

/**
 * Get the last voice error message.
 * @returns {string|null}
 */
export function getVoiceError() {
    return rtc.lastError;
}

/**
 * Internal: clean up partial state after a failed join attempt.
 */
async function cleanupPartialState() {
    try {
        if (rtc.localAudioTrack) {
            rtc.localAudioTrack.stop();
            rtc.localAudioTrack.close();
            rtc.localAudioTrack = null;
        }
        if (rtc.client) {
            try { await rtc.client.leave(); } catch (_) { /* ignore */ }
            rtc.client = null;
        }
    } catch (_) {
        rtc.localAudioTrack = null;
        rtc.client = null;
    }
    rtc.connected = false;
}
