let rtc = {
  localAudioTrack: null,
  client: null
};

export async function joinTeamVoice(roomId, teamId, playerId) {
    // In production, fetch this from Firebase Remote Config or environment variables
    const appId = "YOUR_AGORA_APP_ID"; // The user needs to replace this
    const channel = `${roomId}_${teamId}`;
    
    try {
        // We use a cloud function to fetch the token.
        // During local testing without the function, we can use a temporary token or null if testing mode is enabled in Agora Console.
        // For production, replace the URL with the actual deployed Firebase function URL.
        const tokenUrl = `https://us-central1-trade-trends-70426.cloudfunctions.net/generateAgoraToken?channel=${channel}&uid=${playerId}`;
        
        // Let's use fetch, but gracefully fallback to no token if it fails (only works if Agora App is set to testing mode)
        let token = null;
        try {
            const response = await fetch(tokenUrl);
            const data = await response.json();
            token = data.token;
        } catch (e) {
            console.warn("Could not fetch token, attempting to join without token (requires App testing mode)", e);
        }

        rtc.client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

        rtc.client.on("user-published", async (user, mediaType) => {
            await rtc.client.subscribe(user, mediaType);
            if (mediaType === "audio") {
                user.audioTrack.play();
            }
        });

        await rtc.client.join(appId, channel, token, playerId);
        rtc.localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
        await rtc.client.publish([rtc.localAudioTrack]);
        
        console.log(`Joined team voice chat on channel ${channel}!`);
    } catch (err) {
        console.error("Failed to join team voice chat", err);
    }
}

export function toggleMute(isMuted) {
    if (rtc.localAudioTrack) {
        rtc.localAudioTrack.setMuted(isMuted);
    }
}
