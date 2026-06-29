import { supabase } from './supabase.js';

/* ═══════════════════════════════════════════════════════════════════════════════
   TRADING IQ BATTLE — game.js (SUPABASE BUILD)
   
   Event-driven trading simulation: per-player question streams, immediate
   trade execution, time-based match duration, real-time stock price updates.
   
   Architecture:
   - Room config (host, teams, settings) persists across matches
   - Match state (playerStates, stockWorth, etc.) resets between matches
   - Phase enum: "waiting" → "playing" → "results" → "waiting"
   - Uses Supabase Realtime for sync and atomic updates for consistency
   ═══════════════════════════════════════════════════════════════════════════════ */

(function () {
    "use strict";

    // ── CONSTANTS ────────────────────────────────────────────────────────────
    const MAX_TEAM_SIZE = 10;
    const SESSION_KEYS = {
        PLAYER_ID: "tt_player_id",
        ROOM_ID: "tt_room_id",
        IS_HOST: "tt_is_host",
        PLAYER_NAME: "tt_player_name"
    };

    // ── GAME STATE ────────────────────────────────────────────────────────────
    const state = {
        roomId: null,
        myPlayerId: null,
        myPlayerName: null,
        isHost: false,
        phase: "waiting",
        hostId: null,
        teams: [
            { id: "a", name: "Alpha", players: [] },
            { id: "b", name: "Beta",  players: [] }
        ],
        match: {
            gameStartTime: 0,
            stockWorth: 100,
            worthHistory: [100],
            totalBuys: 0,
            totalSells: 0,
            playerStates: {}
        },
        initialStocks: 5,
        initialWorth: 100,
        matchDuration: 300,
        maxTeamSize: MAX_TEAM_SIZE,
        matchNumber: 0,
        unsubscribeRoom: null
    };

    let isCreatingRoom = false;
    let isJoiningRoom = false;
    let isSubmitting = false;
    let countdownInterval = null;

    let presenceChannel = null;
    let onlinePlayerIds = new Set();

    const dom = {};
    const $ = (id) => document.getElementById(id);

    // ── DOM CACHE ────────────────────────────────────────────────────────────
    function cacheDom() {
        dom.landing      = $("game-landing");
        dom.setup         = $("game-setup");
        dom.join          = $("game-join");
        dom.waitingRoom   = $("game-waiting-room");
        dom.arena         = $("game-arena");
        dom.results       = $("game-results");
        dom.answerForm    = $("game-answer-form");
        dom.answerInput   = $("game-answer-input");
        dom.feedback      = $("game-feedback");
        dom.questionText  = $("game-question-text");
        dom.countdownDisplay = $("game-countdown");
        dom.worthDisplay  = $("game-stock-worth");
        dom.tradesDisplay = $("game-trades-count");
        dom.marketStatus  = $("game-market-status");
        dom.chartCanvas   = $("game-chart-canvas");
        dom.switchTeamBtn = $("switch-team-btn");
        dom.leaveRoomBtn  = $("leave-room-btn");
        dom.teamADisplay  = $("team-a-display");
        dom.teamBDisplay  = $("team-b-display");
        dom.teamAWorth    = $("team-a-worth");
        dom.teamBWorth    = $("team-b-worth");
        dom.teamAStocks   = $("team-a-stocks");
        dom.teamBStocks   = $("team-b-stocks");
        dom.teamACash     = $("team-a-cash");
        dom.teamBCash     = $("team-b-cash");
        dom.teamARoster   = $("team-a-roster");
        dom.teamBRoster   = $("team-b-roster");
        dom.resultMvpName      = $("result-mvp-name");
        dom.resultMvpWorth     = $("result-mvp-worth");
        dom.resultWinnerName   = $("result-winner-name");
        dom.resultWinnerWorth  = $("result-winner-worth");
        dom.resultTeamAName    = $("result-team-a-name");
        dom.resultTeamBName    = $("result-team-b-name");
        dom.resultTeamAWorth   = $("result-team-a-worth");
        dom.resultTeamBWorth   = $("result-team-b-worth");
        dom.resultTeamARoster  = $("result-team-a-roster");
        dom.resultTeamBRoster  = $("result-team-b-roster");
        dom.resultChart        = $("game-result-chart-canvas");
        dom.playAgainBtn       = $("play-again-btn");
        dom.shareVictoryBtn    = $("share-victory-btn");
    }

    // ── WEBRTC VOICE CHAT ─────────────────────────────────────────────────────

    const webrtc = {
        signalingChannel: null,
        localStream: null,
        peers: {}, // map of targetId -> RTCPeerConnection
        candidateQueues: {}, // map of targetId -> array of RTCIceCandidate
        isMuted: true
    };

    // Update these servers in production for a dedicated, paid TURN service.
    const rtcConfig = {
        iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
            { 
                urls: "turn:global.relay.metered.ca:80",
                username: "1eebe9c7dcaa092b84cb0a2b",
                credential: "B8aHlW4dFGQIQ7//"
            },
            { 
                urls: "turn:global.relay.metered.ca:80?transport=tcp",
                username: "1eebe9c7dcaa092b84cb0a2b",
                credential: "B8aHlW4dFGQIQ7//"
            },
            { 
                urls: "turn:global.relay.metered.ca:443",
                username: "1eebe9c7dcaa092b84cb0a2b",
                credential: "B8aHlW4dFGQIQ7//"
            },
            { 
                urls: "turns:global.relay.metered.ca:443?transport=tcp",
                username: "1eebe9c7dcaa092b84cb0a2b",
                credential: "B8aHlW4dFGQIQ7//"
            }
        ]
    };

    function getMyTeamId() {
        if (!state.teams || !state.teams.length) return null;
        if (state.teams[0].players.some(p => p.id === state.myPlayerId)) return "a";
        if (state.teams[1].players.some(p => p.id === state.myPlayerId)) return "b";
        return null;
    }

    function initVoiceSignaling() {
        if (webrtc.signalingChannel) {
            supabase.removeChannel(webrtc.signalingChannel);
        }
        webrtc.signalingChannel = supabase.channel(`webrtc-${state.roomId}`);
        webrtc.signalingChannel
            .on("broadcast", { event: "signal" }, (payload) => handleSignalingMessage(payload.payload))
            .subscribe((status) => {
                if (status === "SUBSCRIBED") {
                    console.log("[VOICE] signaling connected");
                    if (!webrtc.isMuted && webrtc.localStream) {
                        broadcastSignal({ type: "join" });
                    }
                }
            });
    }

    function broadcastSignal(payload) {
        if (!webrtc.signalingChannel) return;
        payload.senderId = state.myPlayerId;
        payload.teamId = getMyTeamId();
        if (!payload.teamId) return;
        webrtc.signalingChannel.send({
            type: "broadcast",
            event: "signal",
            payload: payload
        });
    }

    async function handleSignalingMessage(payload) {
        if (!payload || payload.senderId === state.myPlayerId) return;
        
        const voiceMode = (state.match_settings && state.match_settings.voice_mode) || "team";
        
        let isGlobal = false;
        if (state.phase === "waiting") {
            isGlobal = true; // Lobby is always global
        } else if (voiceMode === "global") {
            isGlobal = true; // Match is global
        } else if (voiceMode === "off") {
            return; // Voice disabled during match
        }

        if (!isGlobal) {
            const myTeam = getMyTeamId();
            if (!myTeam || payload.teamId !== myTeam) return;
        }

        if (payload.targetId && payload.targetId !== state.myPlayerId) return;

        if (webrtc.isMuted || !webrtc.localStream) return;

        try {
            if (payload.type === "join") {
                // To prevent offer collision (glare), only the peer with the larger ID initiates the offer
                const shouldInitiate = state.myPlayerId > payload.senderId;
                console.log(`[VOICE] join received from ${payload.senderId}. Am I initiator? ${shouldInitiate}`);
                
                const pcExists = !!webrtc.peers[payload.senderId];
                if (shouldInitiate) {
                    createPeerConnection(payload.senderId, true);
                } else {
                    createPeerConnection(payload.senderId, false);
                    
                    // If we just created the PC and we are not the initiator, 
                    // we MUST tell the initiator that we are ready so they can send the offer.
                    if (!pcExists) {
                        console.log(`[VOICE] I am non-initiator. Sending join reply to ${payload.senderId}`);
                        broadcastSignal({ type: "join", targetId: payload.senderId });
                    }
                }
            } else if (payload.type === "leave") {
                closePeerConnection(payload.senderId);
            } else if (payload.type === "offer") {
                console.log("[VOICE] offer received");
                const pc = createPeerConnection(payload.senderId, false);
                await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                console.log("[VOICE] answer sent");
                broadcastSignal({
                    type: "answer",
                    targetId: payload.senderId,
                    sdp: pc.localDescription
                });
                
                // Process queued candidates
                if (webrtc.candidateQueues[payload.senderId]) {
                    for (const candidate of webrtc.candidateQueues[payload.senderId]) {
                        await pc.addIceCandidate(candidate).catch(e => console.error("Ice error", e));
                    }
                    webrtc.candidateQueues[payload.senderId] = [];
                }
            } else if (payload.type === "answer") {
                console.log("[VOICE] answer received");
                const pc = webrtc.peers[payload.senderId];
                if (pc) {
                    await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
                    
                    // Process queued candidates
                    if (webrtc.candidateQueues[payload.senderId]) {
                        for (const candidate of webrtc.candidateQueues[payload.senderId]) {
                            await pc.addIceCandidate(candidate).catch(e => console.error("Ice error", e));
                        }
                        webrtc.candidateQueues[payload.senderId] = [];
                    }
                }
            } else if (payload.type === "candidate") {
                console.log("[VOICE] candidate received");
                const pc = webrtc.peers[payload.senderId];
                if (pc) {
                    if (pc.remoteDescription) {
                        await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(e => console.error("Ice error", e));
                    } else {
                        if (!webrtc.candidateQueues[payload.senderId]) webrtc.candidateQueues[payload.senderId] = [];
                        webrtc.candidateQueues[payload.senderId].push(new RTCIceCandidate(payload.candidate));
                    }
                } else {
                    if (!webrtc.candidateQueues[payload.senderId]) webrtc.candidateQueues[payload.senderId] = [];
                    webrtc.candidateQueues[payload.senderId].push(new RTCIceCandidate(payload.candidate));
                }
            }
        } catch (err) {
            console.error("[VOICE] error handling signal:", err);
        }
    }

    function createPeerConnection(targetId, isInitiator) {
        if (webrtc.peers[targetId]) {
            const existing = webrtc.peers[targetId];
            const iceState = existing.iceConnectionState;
            if (iceState !== 'failed' && iceState !== 'closed') {
                console.log(`[VOICE] peer already exists for ${targetId} (${iceState})`);
                return existing;
            }
            // Dead peer — replace it
            console.log(`[VOICE] replacing dead peer for ${targetId} (was: ${iceState})`);
            existing.close();
            delete webrtc.peers[targetId];
            if (webrtc.candidateQueues[targetId]) delete webrtc.candidateQueues[targetId];
        }

        console.log("[VOICE] peer created");
        const pc = new RTCPeerConnection(rtcConfig);
        webrtc.peers[targetId] = pc;

        if (webrtc.localStream) {
            webrtc.localStream.getTracks().forEach(track => {
                pc.addTrack(track, webrtc.localStream);
            });
        }

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                // Determine the protocol from the candidate string if available
                let protocol = "unknown";
                if (event.candidate.protocol) {
                    protocol = event.candidate.protocol;
                } else if (event.candidate.candidate && typeof event.candidate.candidate === 'string') {
                    const parts = event.candidate.candidate.split(' ');
                    if (parts.length > 2) protocol = parts[2].toLowerCase();
                }
                console.log(`[VOICE] Gathered candidate type: ${event.candidate.type} (${protocol})`);
                broadcastSignal({
                    type: "candidate",
                    targetId: targetId,
                    candidate: event.candidate
                });
            }
        };

        pc.ontrack = (event) => {
            console.log(`[VOICE] remote stream attached for ${targetId}`);
            let audioEl = document.getElementById(`audio-${targetId}`);
            if (!audioEl) {
                audioEl = document.createElement("audio");
                audioEl.id = `audio-${targetId}`;
                audioEl.autoplay = true;
                audioEl.playsInline = true; // Essential for mobile browsers
                audioEl.style.display = "none";
                document.body.appendChild(audioEl);
            }
            audioEl.srcObject = event.streams[0];
            
            // Explicitly call play to handle strict autoplay policies
            audioEl.play().then(() => {
                console.log(`[VOICE] Audio playback started for ${targetId}`);
            }).catch(e => {
                console.error(`[VOICE] Audio autoplay blocked for ${targetId}:`, e);
            });
        };

        pc.oniceconnectionstatechange = async () => {
            // Ignore events from superseded peers (prevents closing a fresh replacement peer)
            if (webrtc.peers[targetId] !== pc) return;
            console.log(`[VOICE] ICE connection state change for ${targetId}: ${pc.iceConnectionState}`);
            
            if (pc.iceConnectionState === "closed") {
                console.log(`[VOICE] peer permanently closed: ${targetId}`);
                closePeerConnection(targetId);
                return;
            }

            // Only the initiator restarts ICE to prevent glare
            const amIInitiator = state.myPlayerId > targetId;

            if (pc.iceConnectionState === "disconnected") {
                if (amIInitiator) {
                    setTimeout(async () => {
                        // Safety: only restart if this is still the active peer
                        if (webrtc.peers[targetId] === pc && pc.iceConnectionState === "disconnected") {
                            console.log(`[VOICE] ICE still disconnected for ${targetId}, restarting...`);
                            await restartIce(pc, targetId);
                        }
                    }, 3000);
                }
            } else if (pc.iceConnectionState === "failed") {
                if (amIInitiator) {
                    // "failed" is terminal — iceRestart won't help on a dead PC; close and reconnect fresh
                    console.log(`[VOICE] ICE failed for ${targetId}, closing and reconnecting...`);
                    closePeerConnection(targetId);
                    setTimeout(() => {
                        if (!webrtc.peers[targetId] && !webrtc.isMuted && webrtc.localStream) {
                            console.log(`[VOICE] Initiating fresh connection to ${targetId}`);
                            createPeerConnection(targetId, true);
                        }
                    }, 1500);
                } else {
                    console.log(`[VOICE] ICE failed for ${targetId}. Waiting for initiator to reconnect.`);
                }
            }

            // Log the selected candidate pair once connected or completed
            if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
                try {
                    const stats = await pc.getStats();
                    let activeCandidatePair = null;
                    stats.forEach(report => {
                        if (report.type === 'transport' && report.selectedCandidatePairId) {
                            activeCandidatePair = stats.get(report.selectedCandidatePairId);
                        } else if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) {
                            activeCandidatePair = report;
                        }
                    });

                    if (activeCandidatePair) {
                        const local = stats.get(activeCandidatePair.localCandidateId);
                        const remote = stats.get(activeCandidatePair.remoteCandidateId);
                        if (local && remote) {
                            console.log(`[VOICE] Selected candidate pair for ${targetId}: Local(${local.candidateType}) <-> Remote(${remote.candidateType}) via ${local.relayProtocol || 'direct/stun'}`);
                        }
                    }
                } catch (e) {
                    console.error("[VOICE] Error fetching RTC stats:", e);
                }
            }
        };

        pc.onsignalingstatechange = () => {
            console.log(`[VOICE] Signaling state change for ${targetId}: ${pc.signalingState}`);
        };

        if (isInitiator) {
            pc.createOffer().then(offer => {
                return pc.setLocalDescription(offer);
            }).then(() => {
                console.log("[VOICE] offer sent");
                broadcastSignal({
                    type: "offer",
                    targetId: targetId,
                    sdp: pc.localDescription
                });
            }).catch(e => console.error("[VOICE] offer error", e));
        }

        return pc;
    }

    async function restartIce(pc, targetId) {
        try {
            console.log(`[VOICE] Performing ICE restart for ${targetId}`);
            const offer = await pc.createOffer({ iceRestart: true });
            await pc.setLocalDescription(offer);
            broadcastSignal({
                type: "offer",
                targetId: targetId,
                sdp: pc.localDescription
            });
        } catch (err) {
            console.error(`[VOICE] ICE restart failed for ${targetId}:`, err);
        }
    }

    function closePeerConnection(targetId) {
        if (webrtc.peers[targetId]) {
            webrtc.peers[targetId].close();
            delete webrtc.peers[targetId];
        }
        if (webrtc.candidateQueues[targetId]) {
            delete webrtc.candidateQueues[targetId];
        }
        const audioEl = document.getElementById(`audio-${targetId}`);
        if (audioEl) audioEl.remove();
    }

    async function toggleMic() {
        const btn = $("voice-toggle-btn");
        const slash = $("mic-slash");
        
        if (webrtc.isMuted) {
            try {
                if (!webrtc.localStream) {
                    webrtc.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    console.log("[VOICE] mic granted");
                }
                webrtc.isMuted = false;
                if (slash) slash.style.display = "none";
                if (btn) btn.style.color = "#4ade80"; 
                
                broadcastSignal({ type: "join" });
            } catch (err) {
                console.log("[VOICE] mic denied");
                console.error(err);
                alert("Microphone access denied. Please allow microphone access to use voice chat.");
                webrtc.isMuted = true;
            }
        } else {
            webrtc.isMuted = true;
            if (slash) slash.style.display = "block";
            if (btn) btn.style.color = "inherit";
            
            broadcastSignal({ type: "leave" });
            Object.keys(webrtc.peers).forEach(closePeerConnection);
        }
    }

    function cleanupVoice(fullCleanup = false) {
        if (!webrtc.isMuted) {
            broadcastSignal({ type: "leave" });
        }
        
        Object.keys(webrtc.peers).forEach(closePeerConnection);
        
        if (fullCleanup) {
            if (webrtc.localStream) {
                webrtc.localStream.getTracks().forEach(t => t.stop());
                webrtc.localStream = null;
            }
            if (webrtc.signalingChannel) {
                supabase.removeChannel(webrtc.signalingChannel);
                webrtc.signalingChannel = null;
            }
            webrtc.isMuted = true;
            const btn = $("voice-toggle-btn");
            const slash = $("mic-slash");
            if (slash) slash.style.display = "block";
            if (btn) btn.style.color = "inherit";
        }
        console.log("[VOICE] cleanup complete");
    }

    // ── INITIALIZATION ────────────────────────────────────────────────────────
    function initApp() {
        cacheDom();

        // Navigation bindings
        $("landing-host-btn").addEventListener("click", () => { 
            dom.landing.hidden = true; 
            dom.setup.hidden = false; 
            if ($("quick-match-preset-btn")) $("quick-match-preset-btn").click();
        });
        $("landing-join-btn").addEventListener("click", () => { dom.landing.hidden = true; dom.join.hidden = false; });

        $("host-back-btn").addEventListener("click", () => { dom.setup.hidden = true; dom.landing.hidden = false; });
        $("join-back-btn").addEventListener("click", () => { dom.join.hidden = true; dom.landing.hidden = false; });

        $("create-room-btn").addEventListener("click", createRoom);
        $("join-room-btn").addEventListener("click", joinRoom);
        if ($("quick-match-preset-btn")) {
            $("quick-match-preset-btn").addEventListener("click", () => {
                $("initial-stocks").value = "5";
                $("initial-worth").value = "100";
                $("max-team-size").value = "8";
                $("match-duration").value = "5";
                $("market-volatility").value = "medium";
            });
        }
        $("start-game-btn").addEventListener("click", startGame);

        if (dom.switchTeamBtn) dom.switchTeamBtn.addEventListener("click", switchTeam);
        if (dom.leaveRoomBtn) dom.leaveRoomBtn.addEventListener("click", leaveRoom);
        
        const disbandRoomBtn = $("disband-room-btn");
        const arenaDisbandBtn = $("arena-disband-btn");
        if (disbandRoomBtn) disbandRoomBtn.addEventListener("click", initiateDisbandVote);
        if (arenaDisbandBtn) arenaDisbandBtn.addEventListener("click", initiateDisbandVote);

        const disbandAgreeBtn = $("disband-agree-btn");
        const disbandDisagreeBtn = $("disband-disagree-btn");
        if (disbandAgreeBtn) disbandAgreeBtn.addEventListener("click", () => castDisbandVote("agree"));
        if (disbandDisagreeBtn) disbandDisagreeBtn.addEventListener("click", () => castDisbandVote("disagree"));

        dom.answerForm.addEventListener("submit", handleAnswer);

        // Play Again — return to waiting room, NOT reload
        dom.playAgainBtn.addEventListener("click", () => {
            if (state.isHost) {
                broadcastSignal({ type: "playAgain" });
                resetForNextMatch();
            }
        });

        window.addEventListener("resize", () => {
            if (!dom.arena.hidden) drawChart(dom.chartCanvas);
            if (!dom.results.hidden) drawChart(dom.resultChart);
        });

        const voiceToggleBtn = $("voice-toggle-btn");
        if (voiceToggleBtn) voiceToggleBtn.addEventListener("click", toggleMic);

        window.addEventListener("beforeunload", () => {
            cleanupVoice(true);
        });

        // ── Auto-rejoin on page load ──
        tryAutoRejoin();
        
        // ── Deep Link Challenge Parsing ──
        const urlParams = new URLSearchParams(window.location.search);
        const challengeCode = urlParams.get('challenge');
        const challengeHost = urlParams.get('host');
        if (challengeCode && !sessionStorage.getItem(SESSION_KEYS.ROOM_ID)) {
            dom.landing.hidden = true;
            dom.join.hidden = false;
            $("join-room-code").value = challengeCode.toUpperCase();
            if (challengeHost) {
                const banner = document.createElement("div");
                banner.style = "background: rgba(216,177,91,0.15); border: 1px solid var(--accent); padding: 12px; border-radius: 12px; color: var(--accent); text-align: center; margin-bottom: 18px; font-weight: 700; font-size: 14px;";
                banner.innerHTML = `⚡ @${challengeHost.replace(/</g, "&lt;")} challenged you!`;
                $("join-room-code").closest(".game-setup-card-wide").insertBefore(banner, $("join-room-code").closest(".game-settings-row"));
            }
            setTimeout(() => $("join-player-name").focus(), 100);
        }

        // Ensure presence drops cleanly on unload
        window.addEventListener("beforeunload", () => {
            if (presenceChannel) {
                presenceChannel.untrack();
                supabase.removeChannel(presenceChannel);
            }
        });

        // If host navigates away via logo, delete the room
        const brandLink = document.querySelector('.brand a');
        if (brandLink) {
            brandLink.addEventListener('click', async (e) => {
                if (state.roomId && state.isHost) {
                    e.preventDefault();
                    if (confirm("Leaving will close the room. Are you sure?")) {
                        await supabase.from('rooms').delete().eq('id', state.roomId);
                        window.location.href = brandLink.href;
                    }
                }
            });
        }
    }

    // ── PLAYER IDENTITY ──────────────────────────────────────────────────────

    function getMyPlayerId() {
        let id = sessionStorage.getItem(SESSION_KEYS.PLAYER_ID);
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!id || !uuidRegex.test(id)) {
            id = crypto.randomUUID();
            sessionStorage.setItem(SESSION_KEYS.PLAYER_ID, id);
        }
        return id;
    }

    function persistSession() {
        if (state.roomId) sessionStorage.setItem(SESSION_KEYS.ROOM_ID, state.roomId);
        if (state.isHost) sessionStorage.setItem(SESSION_KEYS.IS_HOST, "true");
        if (state.myPlayerName) sessionStorage.setItem(SESSION_KEYS.PLAYER_NAME, state.myPlayerName);
    }

    function clearSession() {
        sessionStorage.removeItem(SESSION_KEYS.ROOM_ID);
        sessionStorage.removeItem(SESSION_KEYS.IS_HOST);
        sessionStorage.removeItem(SESSION_KEYS.PLAYER_NAME);
    }

    /**
     * Auto-rejoin: If the user refreshed, try to reconnect to their room.
     */
    async function tryAutoRejoin() {
        const savedRoomId = sessionStorage.getItem(SESSION_KEYS.ROOM_ID);
        const savedPlayerId = sessionStorage.getItem(SESSION_KEYS.PLAYER_ID);
        const savedIsHost = sessionStorage.getItem(SESSION_KEYS.IS_HOST) === "true";

        if (!savedRoomId || !savedPlayerId) return;

        try {
            const { data: roomData, error } = await supabase.from('rooms').select('*').eq('id', savedRoomId).single();
            if (error || !roomData) {
                clearSession();
                return;
            }

            // Check if player is still in the room
            const isInRoom = roomData.teams.some(t => t.players.some(p => p.id === savedPlayerId));
            if (!isInRoom) {
                clearSession();
                return;
            }

            // Rejoin
            state.roomId = savedRoomId;
            state.myPlayerId = savedPlayerId;
            state.isHost = savedIsHost && roomData.host_id === savedPlayerId;
            state.myPlayerName = sessionStorage.getItem(SESSION_KEYS.PLAYER_NAME) || "Player";

            listenToRoom(savedRoomId);

            // Show appropriate screen based on phase
            dom.landing.hidden = true;
            dom.setup.hidden = true;
            dom.join.hidden = true;

            if (roomData.phase === "playing") {
                dom.waitingRoom.hidden = true;
                dom.arena.hidden = false;
                dom.results.hidden = true;
                startCountdown();
                const myTeamId = roomData.teams[0].players.some(p => p.id === state.myPlayerId) ? "a" : "b";
            } else if (roomData.phase === "results") {
                dom.waitingRoom.hidden = true;
                dom.arena.hidden = true;
                dom.results.hidden = false;
            } else {
                dom.waitingRoom.hidden = false;
                dom.arena.hidden = true;
                dom.results.hidden = true;
            }

            $("waiting-room-code-display").innerHTML = `Room Code: <strong>${savedRoomId}</strong>`;
            if (state.isHost) {
                $("start-game-btn").hidden = false;
            }
            if (dom.switchTeamBtn && !state.isHost) dom.switchTeamBtn.hidden = false;

            console.log(`[Game] Auto-rejoined room ${savedRoomId}`);
        } catch (err) {
            console.error("[Game] Auto-rejoin failed:", err);
            clearSession();
        }
    }

    // ── ROOM CODE GENERATION ─────────────────────────────────────────────────

    function generateRoomCode() {
        return Math.random().toString(36).substring(2, 8).toUpperCase();
    }

    // ── VALIDATION UTILITIES ─────────────────────────────────────────────────

    function ensurePlayerInOneTeam(teams, playerId, playerObj, targetTeamIdx) {
        for (let i = 0; i < teams.length; i++) {
            teams[i].players = teams[i].players.filter(p => p.id !== playerId);
        }
        if (playerObj && targetTeamIdx >= 0 && targetTeamIdx < teams.length) {
            teams[targetTeamIdx].players.push(playerObj);
        }
        return teams;
    }

    function validateRoomState(roomData) {
        if (!roomData) return roomData;

        const seenIds = new Set();
        let hostExists = false;

        for (const team of roomData.teams) {
            const uniquePlayers = [];
            for (const p of team.players) {
                if (!seenIds.has(p.id)) {
                    seenIds.add(p.id);
                    uniquePlayers.push(p);
                    if (p.id === roomData.host_id) {
                        hostExists = true;
                    }
                }
            }
            team.players = uniquePlayers;
        }

        if (!hostExists && roomData.host_id) {
            roomData.invalidBecauseHostLeft = true;
        }

        return roomData;
    }

    // ── CREATE ROOM ──────────────────────────────────────────────────────────

    async function createRoom() {
        if (isCreatingRoom) return;
        isCreatingRoom = true;

        const btn = $("create-room-btn");
        btn.disabled = true;
        const originalText = btn.textContent;
        btn.textContent = "CREATING...";

        try {
            const code = generateRoomCode();

            state.myPlayerId = getMyPlayerId();
            const playerName = ($("host-player-name").value.trim() || "Host").substring(0, 30);
            const teamId = $("host-team").value;
            state.myPlayerName = playerName;

            const initialStocks = clamp(parseInt($("initial-stocks").value) || 5, 1, 50);
            const initialWorth = clamp(parseInt($("initial-worth").value) || 100, 10, 1000);
            const matchDurationMin = clamp(parseInt($("match-duration").value) || 5, 1, 30);
            const matchDuration = matchDurationMin * 60;
            const maxTeamSize = clamp(parseInt($("max-team-size").value) || 8, 1, 50);
            const marketVolatility = $("market-volatility").value || "medium";

            const targetTeamIdx = teamId === 'a' ? 0 : 1;
            const playerEntry = { id: state.myPlayerId, name: playerName };

            const initialCash = initialWorth * initialStocks;

            const teams = [
                { id: "a", name: "Alpha", players: [] },
                { id: "b", name: "Beta",  players: [] }
            ];
            teams[targetTeamIdx].players.push(playerEntry);

            const playerState = createPlayerState(state.myPlayerId, initialStocks, initialWorth);

            const roomRow = {
                id: code,
                host_id: state.myPlayerId,
                initial_stocks: initialStocks,
                initial_worth: initialWorth,
                match_duration: matchDuration,
                max_team_size: maxTeamSize,
                created_at: new Date().toISOString(),
                phase: "waiting",
                teams: teams,
                match_settings: { voice_mode: "team", market_volatility: marketVolatility },
                match: {
                    gameStartTime: 0,
                    stockWorth: initialWorth,
                    availableShares: 5000,
                    worthHistory: [initialWorth],
                    totalBuys: 0,
                    totalSells: 0,
                    playerStates: {
                        [state.myPlayerId]: playerState
                    }
                },
                match_number: 0,
                last_update_time: Date.now()
            };

            const { error } = await supabase.from('rooms').insert(roomRow);
            if (error) throw new Error(error.message || "Failed to create room.");

            // Success — update local state
            state.roomId = code;
            state.isHost = true;
            state.hostId = state.myPlayerId;
            state.initialStocks = initialStocks;
            state.initialWorth = initialWorth;
            state.matchDuration = matchDuration;
            state.phase = "waiting";
            state.teams = JSON.parse(JSON.stringify(teams));
            state.match = {
                gameStartTime: 0,
                stockWorth: initialWorth,
                worthHistory: [initialWorth],
                totalBuys: 0,
                totalSells: 0,
                playerStates: {
                    [state.myPlayerId]: createPlayerState(state.myPlayerId, initialStocks, initialWorth)
                }
            };

            persistSession();
            listenToRoom(code);

            dom.setup.hidden = true;
            dom.waitingRoom.hidden = false;
            $("waiting-room-code-display").innerHTML = `Room Code: <strong>${code}</strong>`;
            
            const hostControls = $("waiting-room-host-controls");
            if (hostControls) {
                hostControls.style.display = state.isHost ? "flex" : "none";
            }
            
            const shareControls = $("waiting-room-share-controls");
            if (shareControls) {
                shareControls.style.display = state.isHost ? "flex" : "none";
                
                const shareUrl = `${window.location.origin}${window.location.pathname}?challenge=${code}&host=${encodeURIComponent(state.myPlayerName)}`;
                
                $("copy-challenge-btn").onclick = () => {
                    navigator.clipboard.writeText(shareUrl);
                    const btn = $("copy-challenge-btn");
                    btn.textContent = "COPIED ✓";
                    setTimeout(() => btn.innerHTML = "📋 COPY CHALLENGE LINK", 3000);
                };
                
                const waText = `I challenged you to a Trading IQ Battle! Join my room here: ${shareUrl}`;
                $("wa-challenge-btn").href = `https://wa.me/?text=${encodeURIComponent(waText)}`;
            }
            
            $("start-game-btn").hidden = false;

        } catch (err) {
            console.error("[Game] Create room failed:", err);
            alert(err.message || "Failed to create room. Try again.");
        } finally {
            isCreatingRoom = false;
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }

    // ── JOIN ROOM ────────────────────────────────────────────────────────────

    async function joinRoom() {
        if (isJoiningRoom) return;

        const btn = $("join-room-btn");
        if (btn.disabled) return;

        const code = $("join-room-code").value.toUpperCase().trim();
        if (!code) return;

        isJoiningRoom = true;
        btn.disabled = true;
        const originalText = btn.textContent;
        btn.textContent = "Joining...";
        $("join-error").textContent = "";

        try {
            state.myPlayerId = getMyPlayerId();
            const playerName = ($("join-player-name").value.trim() || "Player").substring(0, 30);
            const teamId = $("join-team").value;
            state.myPlayerName = playerName;

            const targetTeamIdx = teamId === 'a' ? 0 : 1;
            const playerEntry = { id: state.myPlayerId, name: playerName };

            // Fetch current room data
            const { data: roomData, error: fetchErr } = await supabase.from('rooms').select('*').eq('id', code).single();
            if (fetchErr || !roomData) {
                throw new Error("Room not found!");
            }

            if (roomData.phase === "playing" || roomData.phase === "results") {
                throw new Error("Game already in progress!");
            }

            const validated = validateRoomState(roomData);

            // Check if already in room
            const isAlreadyInRoom = validated.teams.some(t => t.players.some(p => p.id === state.myPlayerId));
            if (!isAlreadyInRoom) {
                // Check team size limit
                if (validated.teams[targetTeamIdx].players.length >= (validated.max_team_size || MAX_TEAM_SIZE)) {
                    throw new Error(`Team ${validated.teams[targetTeamIdx].name} is full! (${validated.max_team_size || MAX_TEAM_SIZE} players max)`);
                }

                ensurePlayerInOneTeam(validated.teams, state.myPlayerId, playerEntry, targetTeamIdx);

                // Initialize player state in match
                if (!validated.match) {
                    validated.match = {
                        gameStartTime: 0,
                        stockWorth: validated.initial_worth || 100,
                        worthHistory: [validated.initial_worth || 100],
                        totalBuys: 0,
                        totalSells: 0,
                        playerStates: {}
                    };
                }
                if (!validated.match.playerStates) validated.match.playerStates = {};
                validated.match.playerStates[state.myPlayerId] = createPlayerState(
                    state.myPlayerId, validated.initial_stocks, validated.initial_worth
                );

                const { error: updateErr } = await supabase.from('rooms').update({
                    teams: validated.teams,
                    match: validated.match,
                    last_update_time: Date.now()
                }).eq('id', code);

                if (updateErr) throw new Error(updateErr.message);
            }

            // Success
            state.roomId = code;
            state.isHost = false;

            persistSession();
            listenToRoom(code);
            finalizeJoinUI(code);

        } catch (err) {
            console.error("[Game] Join error:", err);
            $("join-error").textContent = err.message || "Failed to join.";
            state.roomId = null;
        } finally {
            isJoiningRoom = false;
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }

    function finalizeJoinUI(code) {
        dom.join.hidden = true;
        dom.waitingRoom.hidden = false;
        $("waiting-room-code-display").innerHTML = `Room Code: <strong>${code}</strong>`;
        if (dom.switchTeamBtn) dom.switchTeamBtn.hidden = false;
    }

    // ── PLAYER STATE FACTORY ─────────────────────────────────────────────────

    function createPlayerState(playerId, initialStocks, initialWorth) {
        const initialCash = initialStocks * initialWorth;
        return {
            id: playerId,
            cash: initialCash,
            stocks: initialStocks,
            worth: initialCash + (initialStocks * initialWorth),
            score: 0,
            correct: 0,
            wrong: 0,
            trades: 0,
            buys: 0,
            shorts: 0,
            initialWorth: initialCash + (initialStocks * initialWorth),
            currentQuestion: null,
            questionNumber: 0,
            lastFeedback: null,
        };
    }

    // ── SUPABASE REALTIME LISTENER ───────────────────────────────────────────

    function listenToRoom(code) {
        if (state.unsubscribeRoom) {
            supabase.removeChannel(state.unsubscribeRoom);
            state.unsubscribeRoom = null;
        }

        const handleData = (data) => {
            if (!data) {
                cleanupLocalStateAndUI("Host left. Room has been closed.");
                return;
            }

            const validated = validateRoomState(data);
            if (validated.invalidBecauseHostLeft) {
                cleanupLocalStateAndUI("Host left. Room has been closed.");
                return;
            }

            // Check if I was removed
            const amIStillInRoom = validated.teams.some(t => t.players.some(p => p.id === state.myPlayerId));
            if (!amIStillInRoom && state.myPlayerId) {
                cleanupLocalStateAndUI("You have been removed from the room by the host.");
                return;
            }

            const prevPhase = state.phase;
            const prevTeamId = getMyTeamId();

            // ── Selective merge ──
            state.hostId = data.host_id;
            state.initialStocks = data.initial_stocks;
            state.initialWorth = data.initial_worth;
            state.matchDuration = data.match_duration;
            state.maxTeamSize = data.max_team_size || MAX_TEAM_SIZE;
            state.phase = data.phase || "waiting";
            state.teams = validated.teams;
            state.match = data.match || state.match;
            state.matchNumber = data.match_number || 0;
            state.match_settings = data.match_settings || {};

            // Force phase to results if time is up locally (avoids flicker if host update is delayed)
            if (state.phase === "playing" && getRemainingTime() <= 0) {
                state.phase = "results";
            }

            if (dom.switchTeamBtn) {
                dom.switchTeamBtn.hidden = state.phase !== "waiting";
            }

            // WAITING → PLAYING
            if (prevPhase !== "playing" && state.phase === "playing") {
                dom.waitingRoom.hidden = true;
                dom.results.hidden = true;
                dom.arena.hidden = false;
                startCountdown();
                const myTeamId = state.teams[0].players.some(p => p.id === state.myPlayerId) ? "a" : "b";

                // --- Voice Mode Enforcer ---
                const voiceMode = (state.match_settings && state.match_settings.voice_mode) || "team";
                if (voiceMode === "off") {
                    cleanupVoice(true);
                } else if (voiceMode === "team") {
                    cleanupVoice(false);
                    if (!webrtc.isMuted && webrtc.localStream) {
                        setTimeout(() => broadcastSignal({ type: "join" }), 200);
                    }
                }
                // If "global", lobby connections seamlessly persist.
            }

            // ANY → RESULTS
            if (prevPhase !== "results" && state.phase === "results") {
                endGameLocal();
                return;
            }

            // RESULTS/PLAYING → WAITING (play again)
            if ((prevPhase === "results" || prevPhase === "playing") && state.phase === "waiting") {
                clearInterval(countdownInterval);
                dom.arena.hidden = true;
                dom.results.hidden = true;
                dom.waitingRoom.hidden = false;
                $("waiting-room-code-display").innerHTML = `Room Code: <strong>${state.roomId}</strong>`;
                if (state.isHost) {
                    $("start-game-btn").hidden = false;
                }
            }

            if (state.phase === "waiting" && !dom.waitingRoom.hidden) {
                renderWaitingRoom();
                if (state.isHost) {
                    const tA = state.teams[0].players.length;
                    const tB = state.teams[1].players.length;
                    const ready = tA > 0 && tB > 0 && tA === tB;
                    const btn = $("start-game-btn");
                    btn.disabled = !ready;
                    btn.style.opacity = ready ? "1" : "0.5";
                    btn.style.cursor = ready ? "pointer" : "not-allowed";
                    if (tA > 0 && tB > 0 && tA !== tB) {
                        $("waiting-message").textContent = "Teams must have an equal number of players to start.";
                    } else if (!ready) {
                        $("waiting-message").textContent = "Waiting for players to join both teams...";
                    } else {
                        $("waiting-message").textContent = "Ready to start!";
                    }
                } else {
                    $("waiting-message").textContent = "Waiting for host to start...";
                }
            } else if (state.phase === "playing" && !dom.arena.hidden) {
                renderArena();
            }

            checkDisbandVoteStatus();

            // Detect Team Switch for Voice
            const newTeamId = getMyTeamId();
            if (prevTeamId && newTeamId && prevTeamId !== newTeamId) {
                cleanupVoice(false);
                if (!webrtc.isMuted && webrtc.localStream) {
                    setTimeout(() => broadcastSignal({ type: "join" }), 200);
                }
            }
        };

        // Presence subscription
        if (presenceChannel) supabase.removeChannel(presenceChannel);
        presenceChannel = supabase.channel(`presence-${code}`, {
            config: { presence: { key: state.myPlayerId } }
        });
        const syncPresenceUI = () => {
            if (state.phase === "waiting" && !dom.waitingRoom.hidden) renderWaitingRoom();
            else if (state.phase === "playing" && !dom.arena.hidden) renderArena();
            checkDisbandVoteStatus(); // Re-check if someone dropped offline
        };

        presenceChannel
            .on('presence', { event: 'sync' }, () => {
                const presenceState = presenceChannel.presenceState();
                onlinePlayerIds.clear();
                for (const id in presenceState) {
                    if (presenceState[id].length > 0) {
                        onlinePlayerIds.add(id);
                    }
                }
                syncPresenceUI();
            })
            .on('presence', { event: 'join' }, ({ key }) => {
                onlinePlayerIds.add(key);
                syncPresenceUI();
            })
            .on('presence', { event: 'leave' }, ({ key }) => {
                onlinePlayerIds.delete(key);
                syncPresenceUI();
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await presenceChannel.track({ online_at: new Date().toISOString() });
                }
            });

        initVoiceSignaling();

        // Initial fetch
        const fetchRoom = async () => {
            const { data, error } = await supabase.from('rooms').select('*').eq('id', code).single();
            if (data) handleData(data);
            else if (error) console.error("[Game] Error fetching room:", error);
        };
        fetchRoom();

        // Realtime subscription
        state.unsubscribeRoom = supabase.channel(`room-${code}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${code}` }, (payload) => {
                if (payload.eventType === 'DELETE') {
                    handleData(null);
                } else if (payload.new && payload.new.phase === 'disbanded') {
                    handleData(null);
                } else {
                    handleData(payload.new);
                }
            })
            .subscribe();
    }

    // ── SWITCH TEAM ──────────────────────────────────────────────────────────

    async function switchTeam() {
        if (state.phase !== "waiting" || !state.roomId) {
            console.error("[SwitchTeam] Invalid state:", state);
            return;
        }
        const btn = dom.switchTeamBtn;
        if (btn) btn.disabled = true;

        try {
            const { data: roomData, error: fetchErr } = await supabase.from('rooms').select('*').eq('id', state.roomId).single();
            if (fetchErr) {
                console.error("[SwitchTeam] Fetch error:", fetchErr);
                throw new Error("Failed to fetch room: " + fetchErr.message);
            }
            if (!roomData) throw new Error("Room data is empty.");
            if (roomData.phase !== "waiting") throw new Error("Cannot switch team after game has started.");

            const validated = validateRoomState(roomData);

            let fromTeam = -1;
            let playerEntry = null;
            for (let i = 0; i < 2; i++) {
                const idx = validated.teams[i].players.findIndex(p => p.id === state.myPlayerId);
                if (idx !== -1) {
                    playerEntry = validated.teams[i].players[idx];
                    fromTeam = i;
                    break;
                }
            }

            if (!playerEntry || fromTeam === -1) {
                console.error("[SwitchTeam] Player not found in teams. myPlayerId:", state.myPlayerId, "Teams:", validated.teams);
                throw new Error("You are not assigned to a team.");
            }

            const toTeam = fromTeam === 0 ? 1 : 0;

            if (validated.teams[toTeam].players.length >= (validated.max_team_size || MAX_TEAM_SIZE)) {
                throw new Error(`Team ${validated.teams[toTeam].name} is full!`);
            }

            ensurePlayerInOneTeam(validated.teams, state.myPlayerId, playerEntry, toTeam);

            const { error: updateErr } = await supabase.from('rooms').update({
                teams: validated.teams,
                last_update_time: Date.now()
            }).eq('id', state.roomId);

            if (updateErr) throw new Error(updateErr.message);
        } catch (err) {
            console.error("[Game] Switch team failed:", err);
            alert(err.message);
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // ── LEAVE ROOM ───────────────────────────────────────────────────────────

    async function leaveRoom() {
        if (!state.roomId) return;
        const btn = dom.leaveRoomBtn;
        if (btn) btn.disabled = true;

        try {
            if (state.isHost) {
                // Host leaving destroys the room
                await supabase.from('rooms').delete().eq('id', state.roomId);
            } else {
                // Player leaving removes themselves
                const { data: roomData } = await supabase.from('rooms').select('*').eq('id', state.roomId).single();
                if (roomData) {
                    for (let i = 0; i < 2; i++) {
                        roomData.teams[i].players = roomData.teams[i].players.filter(p => p.id !== state.myPlayerId);
                    }
                    if (roomData.match && roomData.match.playerStates) {
                        delete roomData.match.playerStates[state.myPlayerId];
                    }
                    await supabase.from('rooms').update({
                        teams: roomData.teams,
                        match: roomData.match,
                        last_update_time: Date.now()
                    }).eq('id', state.roomId);
                }
            }
        } catch (err) {
            console.error("[Game] Error leaving room:", err);
        } finally {
            cleanupVoice(true);
            cleanupLocalStateAndUI();
            if (btn) btn.disabled = false;
        }
    }

    function cleanupLocalStateAndUI(msg = "") {
        cleanupVoice(true);
        if (state.unsubscribeRoom) {
            supabase.removeChannel(state.unsubscribeRoom);
            state.unsubscribeRoom = null;
        }

        if (presenceChannel) {
            supabase.removeChannel(presenceChannel);
            presenceChannel = null;
        }

        clearInterval(countdownInterval);
        countdownInterval = null;
        clearSession();

        state.roomId = null;
        state.isHost = false;
        state.phase = "waiting";
        state.hostId = null;

        dom.waitingRoom.hidden = true;
        dom.arena.hidden = true;
        dom.results.hidden = true;
        dom.landing.hidden = false;

        const hostControls = $("waiting-room-host-controls");
        if (hostControls) hostControls.style.display = "none";

        $("join-room-btn").disabled = false;
        $("join-room-btn").textContent = "JOIN ROOM";

        isCreatingRoom = false;
        isJoiningRoom = false;
        isSubmitting = false;

        if (msg) alert(msg);
    }

    // ── DISBAND VOTE ──────────────────────────────────────────────────────────

    async function initiateDisbandVote() {
        if (!state.roomId) return;
        if (!confirm("Are you sure you want to start a vote to disband this room?")) return;

        const { data: roomData } = await supabase.from('rooms').select('*').eq('id', state.roomId).single();
        if (!roomData) return;

        const match_settings = roomData.match_settings || {};
        match_settings.disband_vote = {
            active: true,
            votes: { [state.myPlayerId]: 'agree' }
        };

        await supabase.from('rooms').update({
            match_settings,
            last_update_time: Date.now()
        }).eq('id', state.roomId);
    }

    async function castDisbandVote(voteType) {
        if (!state.roomId) return;
        $("disband-vote-modal").hidden = true;

        const { data: roomData } = await supabase.from('rooms').select('*').eq('id', state.roomId).single();
        if (!roomData || !roomData.match_settings || !roomData.match_settings.disband_vote) return;

        const disband_vote = roomData.match_settings.disband_vote;
        if (!disband_vote.active) return;

        disband_vote.votes[state.myPlayerId] = voteType;

        if (voteType === 'disagree') {
            disband_vote.active = false;
        }

        await supabase.from('rooms').update({
            match_settings: roomData.match_settings,
            last_update_time: Date.now()
        }).eq('id', state.roomId);
    }

    async function checkDisbandVoteStatus() {
        const modal = $("disband-vote-modal");
        if (!modal) return;
        const disband_vote = state.match_settings?.disband_vote;

        if (!disband_vote || !disband_vote.active) {
            modal.hidden = true;
            return;
        }

        // Check if I have voted
        if (disband_vote.votes[state.myPlayerId]) {
            modal.hidden = true;
        } else {
            modal.hidden = false;
        }

        // If I am host, or if the host is offline, check if all online players voted agree
        const hostIsOffline = state.hostId && !onlinePlayerIds.has(state.hostId);
        if (state.isHost || hostIsOffline) {
            let allAgreed = true;
            let onlineCount = 0;
            
            for (const team of state.teams) {
                for (const p of team.players) {
                    if (onlinePlayerIds.has(p.id)) {
                        onlineCount++;
                        if (disband_vote.votes[p.id] !== 'agree') {
                            allAgreed = false;
                        }
                    }
                }
            }

            // Only disband if we have players online and they ALL agreed
            if (onlineCount > 0 && allAgreed) {
                try {
                    const { data: roomData } = await supabase.from('rooms').select('*').eq('id', state.roomId).single();
                    if (roomData) {
                        const match_settings = roomData.match_settings || {};
                        match_settings.disband_vote = { active: false, votes: {} };
                        
                        await supabase.from('rooms').update({
                            phase: 'waiting',
                            match_settings: match_settings,
                            last_update_time: Date.now()
                        }).eq('id', state.roomId);
                    }
                } catch(e) {
                    console.error("Failed to disband:", e);
                }
            }
        }
    }

    // Removed handleDisconnect since presence handles online/offline and we want to allow reconnects on refresh.

    // ── WAITING ROOM RENDER ──────────────────────────────────────────────────

    function renderWaitingRoom() {
        const hostControls = $("waiting-room-host-controls");
        if (hostControls) {
            hostControls.style.display = state.isHost ? "flex" : "none";
        }

        const maxSize = state.maxTeamSize || MAX_TEAM_SIZE;
        const teamA = $("lobby-team-a");
        const teamB = $("lobby-team-b");

        const teamAHeader = $("lobby-team-a-count");
        const teamBHeader = $("lobby-team-b-count");
        if (teamAHeader) teamAHeader.textContent = `(${state.teams[0].players.length}/${maxSize})`;
        if (teamBHeader) teamBHeader.textContent = `(${state.teams[1].players.length}/${maxSize})`;

        teamA.innerHTML = state.teams[0].players.map(p => {
            const isMe = p.id === state.myPlayerId;
            const isOnline = onlinePlayerIds.has(p.id);
            const statusIndicator = isOnline ? '' : '<span style="color:var(--red);font-size:10px;margin-left:6px;">(Offline)</span>';
            const removeBtn = (state.isHost && !isMe) ? `<button class="remove-player-btn" data-id="${p.id}" style="background:transparent; border:none; color:var(--red); cursor:pointer; font-size:12px; margin-left:auto;" title="Remove Player">✖</button>` : '';
            return `<div class="game-roster-row${isMe ? ' game-roster-active' : ''}" style="display:flex; justify-content:space-between; align-items:center;">
                        <span class="game-roster-name" style="flex:1;">${escapeHtml(p.name)}${isMe ? ' (you)' : ''}${p.id === state.hostId ? ' ★' : ''}${statusIndicator}</span>
                        ${removeBtn}
                    </div>`;
        }).join("") || '<div style="color:var(--muted);padding:12px;text-align:center;font-size:13px;">No players yet</div>';

        teamB.innerHTML = state.teams[1].players.map(p => {
            const isMe = p.id === state.myPlayerId;
            const isOnline = onlinePlayerIds.has(p.id);
            const statusIndicator = isOnline ? '' : '<span style="color:var(--red);font-size:10px;margin-left:6px;">(Offline)</span>';
            const removeBtn = (state.isHost && !isMe) ? `<button class="remove-player-btn" data-id="${p.id}" style="background:transparent; border:none; color:var(--red); cursor:pointer; font-size:12px; margin-left:auto;" title="Remove Player">✖</button>` : '';
            return `<div class="game-roster-row${isMe ? ' game-roster-active' : ''}" style="display:flex; justify-content:space-between; align-items:center;">
                        <span class="game-roster-name" style="flex:1;">${escapeHtml(p.name)}${isMe ? ' (you)' : ''}${p.id === state.hostId ? ' ★' : ''}${statusIndicator}</span>
                        ${removeBtn}
                    </div>`;
        }).join("") || '<div style="color:var(--muted);padding:12px;text-align:center;font-size:13px;">No players yet</div>';
    }

    // Attach global click listener for dynamic remove buttons
    document.addEventListener("click", async (e) => {
        const btn = e.target.closest(".remove-player-btn");
        if (btn && state.isHost) {
            const playerId = btn.dataset.id;
            await removePlayerFromRoom(playerId);
        }
    });

    async function removePlayerFromRoom(playerId) {
        if (!state.isHost || !state.roomId) return;
        try {
            const { data: roomData, error: fetchErr } = await supabase.from('rooms').select('*').eq('id', state.roomId).single();
            if (fetchErr || !roomData) return;

            let modified = false;
            roomData.teams.forEach(team => {
                const initLength = team.players.length;
                team.players = team.players.filter(p => p.id !== playerId);
                if (team.players.length !== initLength) modified = true;
            });

            if (modified) {
                await supabase.from('rooms').update({
                    teams: roomData.teams,
                    last_update_time: Date.now()
                }).eq('id', state.roomId);
            }
        } catch (err) {
            console.error("Error removing player:", err);
        }
    }

    // ── GAME START ────────────────────────────────────────────────────────────

    async function startGame() {
        if (!state.isHost) return;
        if (state.teams[0].players.length === 0 || state.teams[1].players.length === 0) {
            alert("Both teams need at least 1 player to start!");
            return;
        }
        if (state.teams[0].players.length !== state.teams[1].players.length) {
            alert("Teams must have an equal number of players to start the match!");
            return;
        }

        const btn = $("start-game-btn");
        btn.disabled = true;

        try {
            const { data: roomData, error: fetchErr } = await supabase.from('rooms').select('*').eq('id', state.roomId).single();
            if (fetchErr || !roomData) throw new Error("Room not found");
            if (roomData.phase !== "waiting") throw new Error("Game already started");

            const initialStocks = roomData.initial_stocks;
            const initialWorth = roomData.initial_worth;

            const playerStates = {};
            roomData.teams.forEach(team => {
                team.players.forEach(player => {
                    const ps = createPlayerState(player.id, initialStocks, initialWorth);
                    ps.currentQuestion = generateQuestion();
                    ps.questionNumber = 1;
                    playerStates[player.id] = ps;
                });
            });

            const gameStartTime = Date.now();

            const voiceMode = $("waiting-room-voice-mode") ? $("waiting-room-voice-mode").value : "team";
            if (!roomData.match_settings) roomData.match_settings = {};
            roomData.match_settings.voice_mode = voiceMode;

            const { error: updateErr } = await supabase.from('rooms').update({
                phase: "playing",
                match_settings: roomData.match_settings,
                match: {
                    gameStartTime,
                    stockWorth: initialWorth,
                    worthHistory: [initialWorth],
                    totalBuys: 0,
                    totalSells: 0,
                    playerStates
                },
                match_number: (roomData.match_number || 0) + 1,
                last_update_time: Date.now()
            }).eq('id', state.roomId);

            if (updateErr) throw new Error(updateErr.message);
        } catch (err) {
            console.error("[Game] Start game failed:", err);
            alert(err.message || "Failed to start game.");
            btn.disabled = false;
        }
    }

    // ── PLAY AGAIN (RESET FOR NEXT MATCH) ────────────────────────────────────

    async function resetForNextMatch() {
        if (!state.isHost) {
            alert("Waiting for host to start a new match...");
            return;
        }

        const btn = dom.playAgainBtn;
        if (btn) btn.disabled = true;

        try {
            const { data: roomData, error: fetchErr } = await supabase.from('rooms').select('*').eq('id', state.roomId).single();
            if (fetchErr || !roomData) throw new Error("Room not found");

            const initialStocks = roomData.initial_stocks;
            const initialWorth = roomData.initial_worth;

            const playerStates = {};
            roomData.teams.forEach(team => {
                team.players.forEach(player => {
                    playerStates[player.id] = createPlayerState(player.id, initialStocks, initialWorth);
                });
            });

            const { error: updateErr } = await supabase.from('rooms').update({
                phase: "waiting",
                match: {
                    gameStartTime: 0,
                    stockWorth: initialWorth,
                    worthHistory: [initialWorth],
                    totalBuys: 0,
                    totalSells: 0,
                    playerStates
                },
                last_update_time: Date.now()
            }).eq('id', state.roomId);

            if (updateErr) throw new Error(updateErr.message);
        } catch (err) {
            console.error("[Game] Reset for next match failed:", err);
            alert("Failed to reset. Try again.");
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // ── GAMEPLAY — CONTINUOUS TRADING ─────────────────────────────────────────

    function generateQuestion() {
        const ops = ["+", "-"];
        const op = ops[Math.floor(Math.random() * ops.length)];
        let a, b, answer;

        if (op === "+") {
            a = randInt(1, 9);
            b = randInt(1, 9);
            answer = a + b;
        } else {
            a = randInt(2, 9);
            b = randInt(1, a - 1);
            answer = a - b;
        }

        return { text: `${a} ${op} ${b}`, answer: answer };
    }

    function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

    /**
     * Core trade execution — uses Supabase atomic updates to prevent overwrites.
     * 
     * 1. Validate answer against player's own question
     * 2. Execute buy/sell/hold trade immediately
     * 3. Update stock price based on single trade pressure
     * 4. Generate next question for this player
     * 5. Atomically write to Supabase
     */
    async function handleAnswer(e) {
        e.preventDefault();
        if (state.phase !== "playing" || isSubmitting) return;

        isSubmitting = true;
        dom.answerInput.disabled = true;

        const inputStr = dom.answerInput.value.trim().toLowerCase();
        const regex = /^([+-]?\d+)(?:\s*([bs\+\-]))?$/i;
        const matchResult = inputStr.match(regex);

        if (!matchResult) {
            dom.answerInput.value = "";
            dom.answerInput.disabled = false;
            isSubmitting = false;
            setTimeout(() => dom.answerInput.focus(), 50);
            return;
        }

        const submittedAnswer = parseInt(matchResult[1]);
        const tradeAction = matchResult[2];

        try {
            // Fetch latest room state
            const { data: roomData, error: fetchErr } = await supabase.from('rooms').select('*').eq('id', state.roomId).single();
            if (fetchErr || !roomData) throw new Error("Room gone");
            if (roomData.phase !== "playing") return;

            const myState = JSON.parse(JSON.stringify(roomData.match.playerStates[state.myPlayerId]));
            if (!myState || !myState.currentQuestion) return;

            const correctAnswer = myState.currentQuestion.answer;
            const isCorrect = submittedAnswer === correctAnswer;

            let stockWorth = roomData.match.stockWorth;
            let worthHistory = [...(roomData.match.worthHistory || [])];
            let totalBuys = roomData.match.totalBuys || 0;
            let totalSells = roomData.match.totalSells || 0;
            let availableShares = roomData.match.availableShares !== undefined ? roomData.match.availableShares : 5000;
            
            const volatilitySetting = (roomData.match_settings && roomData.match_settings.market_volatility) || 'medium';
            let volMultiplier = 1.0;
            if (volatilitySetting === 'low') volMultiplier = 0.5;
            else if (volatilitySetting === 'high') volMultiplier = 2.0;

            if (isCorrect) {
                myState.correct += 1;
                myState.score += 1;

                if (tradeAction === 'b' || tradeAction === '+') {
                    if (myState.cash >= stockWorth) {
                        myState.cash -= stockWorth;
                        myState.stocks += 1;
                        myState.trades += 1;
                        myState.buys += 1;
                        totalBuys += 1;
                        availableShares = Math.max(0, availableShares - 1);
                        const volatilityPercent = (0.015 + Math.random() * 0.025) * volMultiplier;
                        const noisePercent = ((Math.random() - 0.5) * 0.015) * volMultiplier;
                        stockWorth = stockWorth * (1 + volatilityPercent + noisePercent);
                        if (stockWorth < 1) stockWorth = 1;
                        stockWorth = Math.round(stockWorth * 100) / 100;
                        worthHistory.push(stockWorth);
                        myState.lastFeedback = {
                            text: `<div class="dopamine-tag">+1 STOCK ACQUIRED</div><div class="dopamine-sub">Price: $${stockWorth.toFixed(2)}</div>`,
                            className: "game-feedback feedback-flash-green",
                            isHtml: true
                        };
                    } else {
                        myState.lastFeedback = {
                            text: `<div class="dopamine-tag">INSUFFICIENT FUNDS</div><div class="dopamine-sub">Cannot buy stock at $${stockWorth.toFixed(2)}</div>`,
                            className: "game-feedback feedback-flash-red",
                            isHtml: true
                        };
                    }
                } else if (tradeAction === 's' || tradeAction === '-') {
                    if (myState.stocks > 0) {
                        myState.cash += stockWorth;
                        myState.stocks -= 1;
                        myState.trades += 1;
                        myState.shorts += 1;
                        totalSells += 1;
                        availableShares += 1;
                        const volatilityPercent = (0.015 + Math.random() * 0.025) * volMultiplier;
                        const noisePercent = ((Math.random() - 0.5) * 0.015) * volMultiplier;
                        stockWorth = stockWorth * (1 - volatilityPercent + noisePercent);
                        if (stockWorth < 1) stockWorth = 1;
                        stockWorth = Math.round(stockWorth * 100) / 100;
                        worthHistory.push(stockWorth);
                        myState.lastFeedback = {
                            text: `<div class="dopamine-tag">STOCK SOLD</div><div class="dopamine-sub">+$${stockWorth.toFixed(2)} CASH</div>`,
                            className: "game-feedback feedback-flash-green",
                            isHtml: true
                        };
                    } else {
                        myState.lastFeedback = {
                            text: `<div class="dopamine-tag">NO STOCKS TO SELL</div><div class="dopamine-sub">You must buy stocks first</div>`,
                            className: "game-feedback feedback-flash-red",
                            isHtml: true
                        };
                    }
                } else {
                    myState.lastFeedback = {
                        text: `<div class="dopamine-tag">POSITION HELD</div><div class="dopamine-sub">Waiting for better price</div>`,
                        className: "game-feedback feedback-flash-green",
                        isHtml: true
                    };
                }
            } else {
                myState.wrong += 1;
                const penalty = Math.round((roomData.initial_worth || 100) * 0.1) || 10;
                myState.cash -= penalty;
                myState.lastFeedback = {
                    text: `<div class="dopamine-tag">INCORRECT</div><div class="dopamine-sub">Answer was ${correctAnswer} | Penalty: -$${penalty}</div>`,
                    className: "game-feedback feedback-flash-red",
                    isHtml: true
                };
            }

            myState.questionNumber += 1;
            myState.currentQuestion = generateQuestion();
            myState.worth = Math.round((myState.cash + (myState.stocks * stockWorth)) * 100) / 100;

            let phase = roomData.phase;
            if (roomData.match.gameStartTime && roomData.match_duration) {
                const elapsed = (Date.now() - roomData.match.gameStartTime) / 1000;
                if (elapsed >= roomData.match_duration) {
                    phase = "results";
                }
            }

            const updatedMatch = {
                ...roomData.match,
                stockWorth,
                worthHistory,
                availableShares,
                totalBuys,
                totalSells,
                playerStates: {
                    ...roomData.match.playerStates,
                    [state.myPlayerId]: myState
                }
            };

            // ── OPTIMISTIC UI UPDATE (Instant Feedback) ──
            state.phase = phase;
            state.match = updatedMatch;
            if (phase === "playing") {
                renderArena();
            } else if (phase === "results") {
                renderResults();
            }

            const { data: updateData, error: updateErr } = await supabase.from('rooms').update({
                phase,
                match: updatedMatch,
                last_update_time: Date.now()
            })
            .eq('id', state.roomId)
            .eq('last_update_time', roomData.last_update_time)
            .select();

            if (updateErr) {
                console.error("[Trade] Update error:", updateErr);
                throw new Error(updateErr.message);
            }
            if (!updateData || updateData.length === 0) {
                // Revert optimistic UI if failed due to collision
                state.match = roomData.match;
                myState.lastFeedback = {
                    text: `✗ Market moved too fast. Trade dropped. Please retry.`,
                    className: "game-feedback game-feedback-wrong"
                };
                renderArena();
                throw new Error("Trade collision. Market moved too fast.");
            }

        } catch (err) {
            console.error("[Game] Trade failed:", err);
        }

        dom.answerInput.value = "";
        dom.answerInput.disabled = false;
        isSubmitting = false;

        if (state.phase === "playing") {
            setTimeout(() => dom.answerInput.focus(), 50);
        }
    }

    // ── TEAM WORTH CALCULATION ────────────────────────────────────────────────

    function getTeamComputedData(teamIdx) {
        const team = state.teams[teamIdx];
        const ps = state.match.playerStates || {};
        const stockWorth = state.match.stockWorth || 0;

        let tStocks = 0, tCash = 0, tWorth = 0, tInitialWorth = 0, tTrades = 0;
        const playersWithStats = [];

        team.players.forEach(p => {
            const playerState = ps[p.id];
            if (playerState) {
                const worth = Math.round((playerState.cash + (playerState.stocks * stockWorth)) * 100) / 100;
                playersWithStats.push({
                    ...p,
                    ...playerState,
                    worth
                });
                tStocks += playerState.stocks;
                tCash += playerState.cash;
                tWorth += worth;
                tInitialWorth += playerState.initialWorth;
                tTrades += playerState.trades;
            } else {
                playersWithStats.push({
                    ...p,
                    cash: 0, stocks: 0, worth: 0, trades: 0,
                    correct: 0, wrong: 0, buys: 0, shorts: 0,
                    initialWorth: 0
                });
            }
        });

        return {
            stocks: tStocks,
            cash: tCash,
            totalWorth: Math.round(tWorth * 100) / 100,
            initialTotalWorth: tInitialWorth,
            trades: tTrades,
            players: playersWithStats
        };
    }

    function findMyPlayerState() {
        return state.match.playerStates ? state.match.playerStates[state.myPlayerId] : null;
    }

    // ── TIME-BASED GAME END ───────────────────────────────────────────────────

    function startCountdown() {
        clearInterval(countdownInterval);
        countdownInterval = setInterval(() => {
            if (state.phase !== "playing") {
                clearInterval(countdownInterval);
                return;
            }
            const remaining = getRemainingTime();
            if (dom.countdownDisplay) {
                dom.countdownDisplay.textContent = formatTime(remaining);
            }
            if (remaining <= 0) {
                if (state.isHost) {
                    endGameByTime();
                } else if (state.phase !== "results") {
                    state.phase = "results";
                    endGameLocal();
                }
            }
        }, 250);
    }

    function getRemainingTime() {
        if (!state.match.gameStartTime || !state.matchDuration) return 0;
        const elapsed = (Date.now() - state.match.gameStartTime) / 1000;
        return Math.max(0, state.matchDuration - elapsed);
    }

    function formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    async function endGameByTime() {
        clearInterval(countdownInterval);
        try {
            const { error } = await supabase.from('rooms').update({
                phase: "results",
                last_update_time: Date.now()
            }).eq('id', state.roomId);

            if (error) throw new Error(error.message);
        } catch (err) {
            console.error("[Game] Failed to end game:", err);
        }
    }

    // ── RENDERING ─────────────────────────────────────────────────────────────

    function renderArena() {
        const myState = findMyPlayerState();
        const teamAData = getTeamComputedData(0);
        const teamBData = getTeamComputedData(1);

        if (dom.tradesDisplay) {
            dom.tradesDisplay.textContent = myState ? `${myState.trades}` : "0";
        }

        const availableSharesSpan = $("game-available-shares");
        if (availableSharesSpan && state.match) {
            availableSharesSpan.textContent = state.match.availableShares !== undefined ? state.match.availableShares : 5000;
        }

        dom.worthDisplay.textContent = (state.match.stockWorth || 0).toFixed(2);

        if (dom.marketStatus) {
            dom.marketStatus.innerHTML = `<span class="market-live-dot"></span> LIVE`;
        }

        if (dom.countdownDisplay) {
            dom.countdownDisplay.textContent = formatTime(getRemainingTime());
        }

        dom.teamADisplay.textContent = state.teams[0].name.toUpperCase();
        dom.teamBDisplay.textContent = state.teams[1].name.toUpperCase();

        dom.teamAWorth.textContent = teamAData.totalWorth.toFixed(2);
        dom.teamBWorth.textContent = teamBData.totalWorth.toFixed(2);
        dom.teamAStocks.textContent = teamAData.stocks;
        dom.teamBStocks.textContent = teamBData.stocks;
        dom.teamACash.textContent = teamAData.cash.toFixed(1);
        dom.teamBCash.textContent = teamBData.cash.toFixed(1);

        if ($("team-a-trades")) $("team-a-trades").textContent = teamAData.trades;
        if ($("team-b-trades")) $("team-b-trades").textContent = teamBData.trades;

        const calcPL = (team) => team.initialTotalWorth ? ((team.totalWorth - team.initialTotalWorth) / team.initialTotalWorth * 100) : 0;
        const plA = calcPL(teamAData);
        const plB = calcPL(teamBData);
        
        if ($("team-a-pl")) {
            $("team-a-pl").textContent = (plA >= 0 ? "+" : "") + plA.toFixed(1) + "%";
            $("team-a-pl").style.color = plA >= 0 ? "var(--success)" : "var(--danger)";
        }
        if ($("team-b-pl")) {
            $("team-b-pl").textContent = (plB >= 0 ? "+" : "") + plB.toFixed(1) + "%";
            $("team-b-pl").style.color = plB >= 0 ? "var(--success)" : "var(--danger)";
        }

        renderRoster(dom.teamARoster, teamAData.players);
        renderRoster(dom.teamBRoster, teamBData.players);

        if (myState && myState.currentQuestion) {
            dom.questionText.textContent = myState.currentQuestion.text;
            dom.answerInput.disabled = false;
            dom.answerInput.placeholder = "e.g. 7 b (buy) or 7 s (sell)";

            const qNumEl = $("game-question-num");
            const qBox = $("game-question-container");
            const expectedNum = (myState.questionNumber || 0) + 1;
            if (qNumEl && qNumEl.textContent != expectedNum) {
                qNumEl.textContent = expectedNum;
                if (qBox) {
                    qBox.classList.remove("question-pulse");
                    void qBox.offsetWidth; // trigger reflow
                    qBox.classList.add("question-pulse");
                }
            }
        } else {
            dom.questionText.textContent = "Waiting for game to start...";
            dom.answerInput.disabled = true;
        }

        if (myState && myState.lastFeedback) {
            if (myState.lastFeedback.isHtml) {
                dom.feedback.innerHTML = myState.lastFeedback.text;
            } else {
                dom.feedback.textContent = myState.lastFeedback.text;
            }
            dom.feedback.className = myState.lastFeedback.className;
        } else {
            dom.feedback.textContent = "";
            dom.feedback.className = "game-feedback";
        }

        drawChart(dom.chartCanvas);
    }

    function renderRoster(container, players) {
        container.innerHTML = players.map((p) => {
            const isMe = p.id === state.myPlayerId;
            const isOnline = onlinePlayerIds.has(p.id);
            const statusIndicator = isOnline ? '' : '<span style="color:var(--red);font-size:10px;margin-left:6px;">(Offline)</span>';
            return `<div class="game-roster-row ${isMe ? 'game-roster-active' : ''}" style="flex-direction: column; align-items: flex-start; gap: 4px;">
                <span class="game-roster-name">${escapeHtml(p.name)}${isMe ? ' (you)' : ''}${statusIndicator}</span>
                <span class="game-roster-stats" style="white-space: normal; line-height: 1.4;">
                    <span class="game-mono">$${(p.cash || 0).toFixed(0)}</span> cash
                    <span class="game-roster-sep">·</span>
                    <span class="game-mono">${p.stocks || 0}</span> stk
                    <span class="game-roster-sep">·</span>
                    <span class="game-mono">$${(p.worth || 0).toFixed(1)}</span> val
                    <span class="game-roster-sep">·</span>
                    <span class="game-mono">${p.trades || 0}</span> trades
                </span>
            </div>`;
        }).join("");
    }

    function endGameLocal() {
        clearInterval(countdownInterval);

        const teamAData = getTeamComputedData(0);
        const teamBData = getTeamComputedData(1);

        let mvp = null;
        let mvpWorth = -Infinity;
        [teamAData, teamBData].forEach(teamData => {
            teamData.players.forEach(p => {
                if ((p.worth || 0) > mvpWorth) { mvpWorth = p.worth; mvp = p; }
            });
        });

        const winner = teamAData.totalWorth >= teamBData.totalWorth ? teamAData : teamBData;
        const winnerName = teamAData.totalWorth >= teamBData.totalWorth ? state.teams[0].name : state.teams[1].name;
        const isTie = teamAData.totalWorth === teamBData.totalWorth;

        dom.arena.hidden = true;
        dom.results.hidden = false;

        dom.resultMvpName.textContent = mvp ? mvp.name : "—";
        dom.resultMvpWorth.textContent = mvp ? `Worth: ${mvp.worth.toFixed(2)}` : "";
        dom.resultWinnerName.textContent = isTie ? "TIE" : winnerName.toUpperCase();
        dom.resultWinnerWorth.textContent = isTie ? `Both: ${teamAData.totalWorth.toFixed(2)}` : `Worth: ${winner.totalWorth.toFixed(2)}`;

        dom.resultTeamAName.textContent = state.teams[0].name.toUpperCase();
        dom.resultTeamBName.textContent = state.teams[1].name.toUpperCase();
        dom.resultTeamAWorth.textContent = teamAData.totalWorth.toFixed(2);
        dom.resultTeamBWorth.textContent = teamBData.totalWorth.toFixed(2);

        renderResultRoster(dom.resultTeamARoster, teamAData.players);
        renderResultRoster(dom.resultTeamBRoster, teamBData.players);

        drawChart(dom.resultChart);

        if (dom.playAgainBtn) {
            dom.playAgainBtn.textContent = state.isHost ? "PLAY AGAIN" : "WAITING FOR HOST...";
            dom.playAgainBtn.disabled = !state.isHost;
        }

        // Cache stats for Victory Card
        const initialWorthA = teamAData.players.length * 10000;
        const initialWorthB = teamBData.players.length * 10000;
        const winnerInitial = isTie ? initialWorthA : (teamAData.totalWorth >= teamBData.totalWorth ? initialWorthA : initialWorthB);
        const loserInitial = isTie ? initialWorthB : (teamAData.totalWorth >= teamBData.totalWorth ? initialWorthB : initialWorthA);
        const loserData = isTie ? teamBData : (teamAData.totalWorth >= teamBData.totalWorth ? teamBData : teamAData);

        const matchData = {
            date: new Date().toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }),
            winner_team: isTie ? "TIE" : winnerName,
            loser_team: isTie ? "TIE" : state.teams[teamAData.totalWorth >= teamBData.totalWorth ? 1 : 0].name,
            winner_worth: formatINR(winner.totalWorth),
            loser_worth: formatINR(loserData.totalWorth),
            margin: formatINR(winner.totalWorth - loserData.totalWorth),
            loser_loss: formatINR(Math.abs(loserInitial - loserData.totalWorth)),
            mvp: mvp ? mvp.name.replace(/\s+/g, '_').toLowerCase() : "none",
            total_trades: teamAData.players.reduce((sum, p) => sum + (p.trades || 0), 0) + teamBData.players.reduce((sum, p) => sum + (p.trades || 0), 0),
            duration: state.settings ? (state.settings.duration || 5) : 5,
            players: teamAData.players.length + teamBData.players.length
        };
        
        if (dom.shareVictoryBtn) {
            dom.shareVictoryBtn.onclick = () => showShareCard(matchData);
        }

        // Update ELO stats
        supabase.auth.getSession().then(async ({ data: { session } }) => {
            if (session && session.user) {
                try {
                    const userId = session.user.id;
                    const { data: profile } = await supabase.from('profiles').select('elo_score, peak_elo, matches_played, matches_won').eq('id', userId).single();
                    
                    if (profile) {
                        let currentElo = profile.elo_score || 1000;
                        let currentPeak = profile.peak_elo || 1000;
                        let played = (profile.matches_played || 0) + 1;
                        let won = profile.matches_won || 0;
                        
                        const myTeamData = teamAData.players.some(p => p.id === state.myPlayerId) ? teamAData : teamBData;
                        
                        let eloChange = 0;
                        let wonParam = false;
                        if (!isTie) {
                            wonParam = (winner === myTeamData);
                            eloChange = wonParam ? 25 : -15;
                            if (wonParam) won += 1;
                        }
                        const newElo = Math.max(0, currentElo + eloChange);
                        const newPeak = Math.max(newElo, currentPeak);
                        
                        const { error: updateError } = await supabase.from('profiles').update({
                            elo_score: newElo,
                            peak_elo: newPeak,
                            matches_played: played,
                            matches_won: won
                        }).eq('id', userId);
                        
                        if (updateError) {
                            console.error(`Failed to update ELO: ${updateError.message}`);
                        } else {
                            console.log(`Updated ELO for ${userId}: ${currentElo} -> ${newElo}`);
                        }
                    }
                } catch (e) {
                    console.error("Failed to update ELO", e);
                }
            }
        });
    }

    function renderResultRoster(container, players) {
        container.innerHTML = players.map(p => {
            const pnl = (p.worth || 0) - (p.initialWorth || 0);
            const pnlColor = pnl >= 0 ? 'var(--success)' : 'var(--danger)';
            const pnlSign = pnl >= 0 ? '+' : '';
            return `<div class="game-roster-row" style="display:flex; flex-direction:column; align-items:flex-start; padding: 12px; gap: 8px;">
                <div style="width: 100%; display: flex; justify-content: space-between;">
                    <span class="game-roster-name" style="font-size:16px;">${escapeHtml(p.name)}</span>
                    <span class="game-mono" style="font-size:16px; color:${pnlColor}">${pnlSign}$${Math.abs(pnl).toFixed(2)}</span>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; width: 100%; gap: 4px; font-size: 13px; color: var(--muted);">
                    <div>Answers: <span class="game-mono" style="color:var(--text)">${p.correct || 0}✓ ${p.wrong || 0}✗</span></div>
                    <div>Buys/Sells: <span class="game-mono" style="color:var(--text)">${p.buys || 0} / ${p.shorts || 0}</span></div>
                    <div>Cash: <span class="game-mono" style="color:var(--text)">$${(p.cash || 0).toFixed(1)}</span></div>
                    <div>Stocks: <span class="game-mono" style="color:var(--text)">${p.stocks || 0}</span></div>
                    <div>Total Trades: <span class="game-mono" style="color:var(--text)">${p.trades || 0}</span></div>
                </div>
            </div>`;
        }).join("");
    }

    // ── CHART ─────────────────────────────────────────────────────────────────
    // ── CHART ANIMATION STATE ─────────────────────────────────────────────────
    const chartAnimState = new WeakMap();

    function drawChart(canvas) {
        if (!canvas) return;
        const data = state.match.worthHistory || [];
        
        let anim = chartAnimState.get(canvas);
        if (!anim) {
            anim = {
                displayData: [...data],
                targetData: data,
                pulse: 0,
                pulseSize: 0,
                frameId: null
            };
            chartAnimState.set(canvas, anim);
        } else {
            anim.targetData = data;
        }

        // Trigger pulse on new data or significant change
        const targetLast = data[data.length - 1] || 0;
        const currentLast = anim.displayData[anim.displayData.length - 1] || 0;
        if (data.length > anim.displayData.length || Math.abs(targetLast - currentLast) > 0.05) {
            anim.pulse = 1.0;
            anim.pulseSize = Math.min(25, 10 + Math.abs(targetLast - currentLast) * 2);
        }

        // Sync array lengths for smooth transitions
        while(anim.displayData.length < data.length) {
            anim.displayData.push(anim.displayData[anim.displayData.length - 1] || data[data.length - 1]);
        }
        while(anim.displayData.length > data.length) {
            anim.displayData.pop();
        }

        if (!anim.frameId) {
            const loop = () => {
                // Pause if canvas is hidden
                if (canvas.offsetParent === null) {
                    anim.frameId = null;
                    return;
                }
                
                let needsUpdate = false;
                
                // Smooth easing towards actual data
                for (let i = 0; i < anim.targetData.length; i++) {
                    const diff = anim.targetData[i] - anim.displayData[i];
                    if (Math.abs(diff) > 0.005) {
                        anim.displayData[i] += diff * 0.12; // Easing speed
                        needsUpdate = true;
                    } else {
                        anim.displayData[i] = anim.targetData[i];
                    }
                }

                if (anim.pulse > 0) {
                    anim.pulse -= 0.03; // Pulse fade speed
                    needsUpdate = true;
                } else {
                    anim.pulse = 0;
                }

                // Subtle organic market noise (only when playing)
                const time = Date.now() * 0.001;
                const noise = state.phase === "playing" ? (Math.sin(time * 2.5) * 0.08 + Math.cos(time * 1.8) * 0.05) : 0;
                
                renderChartFrame(canvas, anim.displayData, anim.pulse, anim.pulseSize, noise, anim.targetData);

                if (needsUpdate || state.phase === "playing") {
                    anim.frameId = requestAnimationFrame(loop);
                } else {
                    anim.frameId = null;
                }
            };
            anim.frameId = requestAnimationFrame(loop);
        }
    }

    function renderChartFrame(canvas, displayData, pulseProgress, pulseSize, noise, realData) {
        const parent = canvas.parentElement;
        const dpr = window.devicePixelRatio || 1;
        const w = parent.clientWidth;
        const h = parent.clientHeight || w;
        
        // Responsive resize
        if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            canvas.style.width = w + "px";
            canvas.style.height = h + "px";
        }
        
        const ctx = canvas.getContext("2d");
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);

        if (!displayData || displayData.length < 2) {
            ctx.fillStyle = "#94a3b8";
            ctx.font = "12px 'Inter', sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("Awaiting data...", w / 2, h / 2);
            ctx.restore();
            return;
        }

        const pad = { top: 32, right: 24, bottom: 40, left: 56 };
        const cw = w - pad.left - pad.right;
        const ch = h - pad.top - pad.bottom;
        
        // Scale based on real data to prevent jitter during easing
        const minVal = Math.min(...realData) * 0.95;
        const maxVal = Math.max(...realData) * 1.05;
        const range = maxVal - minVal || 1;

        // ── Grid ──
        const gridLines = 5;
        ctx.strokeStyle = "rgba(255,255,255,0.03)";
        ctx.lineWidth = 1;
        ctx.font = "10px 'JetBrains Mono', monospace";
        ctx.fillStyle = "#475569";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        
        for (let i = 0; i <= gridLines; i++) {
            const y = pad.top + (ch / gridLines) * i;
            const val = maxVal - (range / gridLines) * i;
            ctx.beginPath();
            ctx.moveTo(pad.left, y);
            ctx.lineTo(w - pad.right, y);
            ctx.stroke();
            ctx.fillText(val.toFixed(1), pad.left - 10, y);
        }

        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const xStep = Math.max(1, Math.floor(displayData.length / 8));
        for (let i = 0; i < displayData.length; i += xStep) {
            const x = pad.left + (i / (displayData.length - 1)) * cw;
            ctx.fillText(String(i), x, h - pad.bottom + 12);
        }

        // Apply noise to the final rendering point
        const renderData = [...displayData];
        renderData[renderData.length - 1] += noise;

        // ── Catmull-Rom Spline Points ──
        const pts = [];
        for (let i = 0; i < renderData.length; i++) {
            const x = pad.left + (i / (renderData.length - 1)) * cw;
            const y = pad.top + ch - ((renderData[i] - minVal) / range) * ch;
            pts.push({x, y});
        }

        // Helper to draw smooth path
        const drawSmoothPath = () => {
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 0; i < pts.length - 1; i++) {
                const p0 = i > 0 ? pts[i - 1] : pts[0];
                const p1 = pts[i];
                const p2 = pts[i + 1];
                const p3 = i !== pts.length - 2 ? pts[i + 2] : p2;

                const tension = 0.25;
                const cp1x = p1.x + (p2.x - p0.x) * tension / 3;
                const cp1y = p1.y + (p2.y - p0.y) * tension / 3;
                const cp2x = p2.x - (p3.x - p1.x) * tension / 3;
                const cp2y = p2.y - (p3.y - p1.y) * tension / 3;

                ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
            }
        };

        // ── Glowing Line ──
        ctx.beginPath();
        drawSmoothPath();
        
        const gradientLine = ctx.createLinearGradient(pad.left, 0, w - pad.right, 0);
        gradientLine.addColorStop(0, "rgba(216,177,91,0.4)");
        gradientLine.addColorStop(1, "rgba(255,204,51,1)");

        ctx.strokeStyle = gradientLine;
        ctx.lineWidth = 3;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.shadowColor = "rgba(255,204,51,0.5)";
        ctx.shadowBlur = 12;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // ── Fill Area ──
        ctx.beginPath();
        drawSmoothPath();
        ctx.lineTo(pts[pts.length - 1].x, pad.top + ch);
        ctx.lineTo(pts[0].x, pad.top + ch);
        ctx.closePath();

        const gradientFill = ctx.createLinearGradient(0, pad.top, 0, pad.top + ch);
        gradientFill.addColorStop(0, "rgba(255,204,51,0.2)");
        gradientFill.addColorStop(0.4, "rgba(216,177,91,0.05)");
        gradientFill.addColorStop(1, "rgba(216,177,91,0.0)");
        
        ctx.fillStyle = gradientFill;
        ctx.fill();

        // ── Latest Point Marker & Pulse ──
        const lastPt = pts[pts.length - 1];
        
        if (pulseProgress > 0) {
            ctx.beginPath();
            ctx.arc(lastPt.x, lastPt.y, 4 + (1 - pulseProgress) * pulseSize, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,204,51, ${pulseProgress * 0.4})`;
            ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(lastPt.x, lastPt.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = "#0b1020";
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = "#ffcc33";
        ctx.shadowColor = "#ffcc33";
        ctx.shadowBlur = 8;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // ── Price Badge ──
        const latestRealValue = realData[realData.length - 1];
        const priceText = `$${latestRealValue.toFixed(2)}`;
        ctx.font = "bold 11px 'JetBrains Mono', monospace";
        const textWidth = ctx.measureText(priceText).width;
        
        const boxW = textWidth + 14;
        const boxH = 22;
        let boxX = lastPt.x - boxW - 12;
        let boxY = lastPt.y - boxH / 2;
        if (boxX < pad.left) boxX = lastPt.x + 12; // Flip to right if cramped

        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxW, boxH, 6);
        ctx.fillStyle = "rgba(11, 16, 32, 0.9)";
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(255,204,51,0.3)";
        ctx.stroke();

        ctx.fillStyle = "#ffcc33";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(priceText, boxX + boxW / 2, boxY + boxH / 2);

        ctx.restore();
    }

    // ── UTILITIES ─────────────────────────────────────────────────────────────
    function escapeHtml(str) {
        if (!str) return "";
        return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
    function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

    function formatINR(number) {
        return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(number);
    }
    
    function showShareCard(matchData) {
        // Build card HTML with real data
        const card = document.createElement('div');
        card.id = 'share-overlay';
        card.innerHTML = `
          <div id="share-modal" style="position:fixed;inset:0;background:rgba(0,0,0,0.85);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;gap:16px;">
            <div id="victory-card" style="width:480px;min-height:400px;height:auto;background:#07101E;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;font-family:monospace;">
              <!-- top bar -->
              <div style="display:flex;justify-content:space-between;padding:13px 18px;border-bottom:1px solid rgba(255,255,255,0.05);">
                <span style="font-size:11px;font-weight:700;letter-spacing:2px;color:#C9913A;text-transform:uppercase;">⚡ Trading IQ Battle</span>
                <span style="font-size:10px;color:rgba(255,255,255,0.3);">${matchData.date}</span>
              </div>
              <!-- winner -->
              <div style="text-align:center;padding:16px 20px 10px;">
                <div style="font-size:9px;letter-spacing:3px;color:rgba(255,255,255,0.3);text-transform:uppercase;margin-bottom:6px;">Match Winner</div>
                <div style="font-size:34px;font-weight:800;color:#C9913A;letter-spacing:2px;text-transform:uppercase;">${matchData.winner_team}</div>
                <div style="font-size:9px;color:rgba(255,255,255,0.22);letter-spacing:3px;margin-top:7px;text-transform:uppercase;">OutThought · OutTraded</div>
              </div>
              <!-- teams -->
              <div style="display:flex;margin:6px 18px 0;border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);">
                <div style="flex:1;background:rgba(201,145,58,0.1);border-right:1px solid rgba(201,145,58,0.18);padding:13px 15px;">
                  <div style="font-size:9px;letter-spacing:2px;color:#C9913A;text-transform:uppercase;margin-bottom:9px;">🏆 Winner</div>
                  <div style="font-size:10px;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:3px;">${matchData.winner_team}</div>
                  <div style="font-size:28px;font-weight:700;color:#fff;line-height:1;margin-bottom:4px;">₹${matchData.winner_worth}</div>
                  <div style="font-size:12px;color:#27C47A;font-weight:600;">Better by ₹${matchData.margin}</div>
                </div>
                <div style="flex:1;background:rgba(0,0,0,0.2);padding:13px 15px;opacity:0.5;">
                  <div style="font-size:9px;letter-spacing:2px;color:rgba(255,255,255,0.3);text-transform:uppercase;margin-bottom:9px;">Defeated</div>
                  <div style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:3px;">${matchData.loser_team}</div>
                  <div style="font-size:28px;font-weight:700;color:rgba(255,255,255,0.4);line-height:1;margin-bottom:4px;">₹${matchData.loser_worth}</div>
                  <div style="font-size:12px;color:rgba(255,255,255,0.35);">Final standing</div>
                </div>
              </div>
              <!-- mvp row -->
              <div style="display:flex;gap:8px;margin:10px 18px 0;">
                <div style="flex:2;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:6px;padding:9px 13px;">
                  <div style="font-size:9px;letter-spacing:2px;color:rgba(255,255,255,0.28);text-transform:uppercase;margin-bottom:3px;">MVP</div>
                  <div style="font-size:14px;font-weight:600;color:#fff;">@${matchData.mvp}</div>
                </div>
                <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:6px;padding:9px 13px;">
                  <div style="font-size:9px;letter-spacing:2px;color:rgba(255,255,255,0.28);text-transform:uppercase;margin-bottom:3px;">Margin</div>
                  <div style="font-size:14px;font-weight:600;color:#27C47A;">+₹${matchData.margin}</div>
                </div>
              </div>
              <!-- match stats -->
              <div style="margin:10px 18px 0;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:6px;padding:9px 13px;">
                <div style="font-size:9px;letter-spacing:2px;color:rgba(255,255,255,0.28);text-transform:uppercase;margin-bottom:6px;">Match Stats</div>
                <div style="font-size:12px;color:rgba(255,255,255,0.5);">${matchData.total_trades} total trades · ${matchData.duration} min · ${matchData.players} players</div>
              </div>
              <!-- footer -->
              <div style="display:flex;justify-content:space-between;padding:11px 18px;border-top:1px solid rgba(255,255,255,0.05);margin-top:auto;">
                <span style="font-size:10px;color:rgba(255,255,255,0.2);">news-by-ai-pi.vercel.app</span>
                <span style="font-size:10px;color:rgba(255,255,255,0.2);">#TradingIQBattle</span>
              </div>
            </div>
            <!-- buttons -->
            <div style="display:flex;gap:10px;">
              <button id="btn-download" style="padding:10px 20px;background:#C9913A;color:#000;border:none;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;letter-spacing:1px;">DOWNLOAD CARD</button>
              <button id="btn-tweet" style="padding:10px 20px;background:#fff;color:#000;border:none;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;letter-spacing:1px;">SHARE TO X</button>
              <button id="btn-close" style="padding:10px 20px;background:rgba(255,255,255,0.1);color:#fff;border:1px solid rgba(255,255,255,0.2);border-radius:8px;font-size:13px;cursor:pointer;">CLOSE</button>
            </div>
          </div>
        `;
        document.body.appendChild(card);
      
        document.getElementById('btn-download').onclick = () => {
          html2canvas(document.getElementById('victory-card'), { scale: 2 }).then(canvas => {
            const a = document.createElement('a');
            a.download = 'trading-iq-victory.png';
            a.href = canvas.toDataURL();
            a.click();
          });
        };
      
        document.getElementById('btn-tweet').onclick = () => {
          const text = encodeURIComponent(
            `Just crushed Trading IQ Battle 🏆\n\n${matchData.winner_team}: ₹${matchData.winner_worth}\n${matchData.loser_team}: ₹${matchData.loser_worth}\nMargin: +₹${matchData.margin}\nMVP: @${matchData.mvp}\n\nThink you can beat this? 👇\nnews-by-ai-pi.vercel.app\n\n#TradingIQBattle #TradeSmarter`
          );
          window.open('https://twitter.com/intent/tweet?text=' + text, '_blank');
          
          const tweetBtn = document.getElementById('btn-tweet');
          tweetBtn.textContent = 'SHARED ✓';
          tweetBtn.style.background = '#27C47A';
          tweetBtn.style.color = '#000';
        };
      
        document.getElementById('btn-close').onclick = () => card.remove();
    }

    document.addEventListener("DOMContentLoaded", initApp);
})();
