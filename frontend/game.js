import { db } from './firebase.js';
import { doc, onSnapshot, updateDoc, getDoc, runTransaction, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { joinTeamVoice, toggleMute, leaveVoice, isVoiceConnected } from "./voice.js";

/* ═══════════════════════════════════════════════════════════════════════════════
   TRADING IQ BATTLE — game.js (STABILIZED BUILD)
   
   Event-driven trading simulation: per-player question streams, immediate
   trade execution, time-based match duration, real-time stock price updates.
   
   Architecture:
   - Room config (host, teams, settings) persists across matches
   - Match state (playerStates, stockWorth, etc.) resets between matches
   - Phase enum: "waiting" → "playing" → "results" → "waiting"
   - All mutations use Firestore transactions for consistency
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
    let state = {
        roomId: null,
        isHost: false,
        myPlayerId: null,
        myPlayerName: null,

        // Room config (persistent across matches)
        hostId: null,
        initialStocks: 5,
        initialWorth: 100,
        matchDuration: 300,
        maxTeamSize: MAX_TEAM_SIZE,

        // Room lifecycle
        phase: "waiting", // "waiting" | "playing" | "results"

        // Teams (persistent — just id + name per player)
        teams: [
            { id: "a", name: "Alpha", players: [] },
            { id: "b", name: "Beta",  players: [] }
        ],

        // Match state (reset between matches)
        match: {
            gameStartTime: 0,
            stockWorth: 100,
            worthHistory: [100],
            totalBuys: 0,
            totalSells: 0,
            playerStates: {}
        },

        matchNumber: 0,

        // Listener cleanup
        unsubscribeRoom: null,
    };

    let countdownInterval = null;
    let isSubmitting = false;      // prevents double-submit race
    let isCreatingRoom = false;    // prevents double-create
    let isJoiningRoom = false;     // prevents double-join

    // ── DOM REFS ──────────────────────────────────────────────────────────────
    const $ = (id) => document.getElementById(id);
    const dom = {};

    function cacheDom() {
        dom.landing       = $("game-landing");
        dom.setup         = $("game-setup");
        dom.join          = $("game-join");
        dom.waitingRoom   = $("game-waiting-room");
        dom.arena         = $("game-arena");
        dom.results       = $("game-results");

        dom.tradesDisplay = $("game-trades-count");
        dom.worthDisplay  = $("game-stock-worth");
        dom.marketStatus  = $("game-market-status");
        dom.countdownDisplay = $("game-countdown");

        dom.teamADisplay  = $("team-a-display");
        dom.teamBDisplay  = $("team-b-display");
        dom.teamAWorth    = $("team-a-worth");
        dom.teamBWorth    = $("team-b-worth");
        dom.teamACash     = $("team-a-cash");
        dom.teamBCash     = $("team-b-cash");
        dom.teamAStocks   = $("team-a-stocks");
        dom.teamBStocks   = $("team-b-stocks");
        dom.teamARoster   = $("team-a-roster");
        dom.teamBRoster   = $("team-b-roster");

        dom.questionText  = $("game-question-text");
        dom.answerForm    = $("game-answer-form");
        dom.answerInput   = $("game-answer-input");
        dom.feedback      = $("game-feedback");

        dom.switchTeamBtn = $("switch-team-btn");
        dom.leaveRoomBtn  = $("leave-room-btn");

        dom.chartCanvas   = $("game-chart-canvas");

        dom.resultMvpName    = $("result-mvp-name");
        dom.resultMvpWorth   = $("result-mvp-worth");
        dom.resultWinnerName = $("result-winner-name");
        dom.resultWinnerWorth = $("result-winner-worth");
        dom.resultTeamAName  = $("result-team-a-name");
        dom.resultTeamBName  = $("result-team-b-name");
        dom.resultTeamAWorth = $("result-team-a-worth");
        dom.resultTeamBWorth = $("result-team-b-worth");
        dom.resultTeamARoster = $("result-team-a-roster");
        dom.resultTeamBRoster = $("result-team-b-roster");
        dom.resultChart      = $("game-result-chart-canvas");
        dom.playAgainBtn     = $("play-again-btn");
    }

    // ── INITIALIZATION ────────────────────────────────────────────────────────
    function initApp() {
        cacheDom();

        // Navigation bindings
        $("landing-host-btn").addEventListener("click", () => { dom.landing.hidden = true; dom.setup.hidden = false; });
        $("landing-join-btn").addEventListener("click", () => { dom.landing.hidden = true; dom.join.hidden = false; });

        let voiceMuted = false;
        $("voice-mute-btn").addEventListener("click", (e) => {
            voiceMuted = !voiceMuted;
            toggleMute(voiceMuted);
            e.target.textContent = voiceMuted ? "MUTED" : "UNMUTED";
            e.target.style.color = voiceMuted ? "var(--red)" : "inherit";
        });
        $("host-back-btn").addEventListener("click", () => { dom.setup.hidden = true; dom.landing.hidden = false; });
        $("join-back-btn").addEventListener("click", () => { dom.join.hidden = true; dom.landing.hidden = false; });

        $("create-room-btn").addEventListener("click", createRoom);
        $("join-room-btn").addEventListener("click", joinRoom);
        $("start-game-btn").addEventListener("click", startGame);

        if (dom.switchTeamBtn) dom.switchTeamBtn.addEventListener("click", switchTeam);
        if (dom.leaveRoomBtn) dom.leaveRoomBtn.addEventListener("click", leaveRoom);

        window.addEventListener("beforeunload", handleDisconnect);

        dom.answerForm.addEventListener("submit", handleAnswer);

        // Play Again — return to waiting room, NOT reload
        dom.playAgainBtn.addEventListener("click", resetForNextMatch);

        window.addEventListener("resize", () => {
            if (!dom.arena.hidden) drawChart(dom.chartCanvas);
            if (!dom.results.hidden) drawChart(dom.resultChart);
        });

        // ── Auto-rejoin on page load ──
        tryAutoRejoin();
    }

    // ── PLAYER IDENTITY ──────────────────────────────────────────────────────

    function getMyPlayerId() {
        let id = sessionStorage.getItem(SESSION_KEYS.PLAYER_ID);
        if (!id) {
            id = Date.now().toString() + Math.random().toString(36).substring(2, 5);
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
            const docRef = doc(db, "rooms", savedRoomId);
            const snap = await getDoc(docRef);
            if (!snap.exists()) {
                clearSession();
                return;
            }

            const roomData = snap.data();

            // Check if player is still in the room
            const isInRoom = roomData.teams.some(t => t.players.some(p => p.id === savedPlayerId));
            if (!isInRoom) {
                clearSession();
                return;
            }

            // Rejoin
            state.roomId = savedRoomId;
            state.myPlayerId = savedPlayerId;
            state.isHost = savedIsHost && roomData.hostId === savedPlayerId;
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
                // Rejoin voice
                const myTeamId = roomData.teams[0].players.some(p => p.id === state.myPlayerId) ? "a" : "b";
                joinTeamVoice(state.roomId, myTeamId, state.myPlayerId);
            } else if (roomData.phase === "results") {
                dom.waitingRoom.hidden = true;
                dom.arena.hidden = true;
                dom.results.hidden = false;
            } else {
                // waiting
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

    /**
     * Ensure a player only appears in one team. Strips from all teams first,
     * then adds to the target team index.
     * 
     * @param {Array} teams - The teams array
     * @param {string} playerId - Player ID to ensure
     * @param {Object|null} playerObj - Player object to add (null = just remove)
     * @param {number} targetTeamIdx - Target team index (0 or 1), -1 = just remove
     * @returns {Array} Modified teams
     */
    function ensurePlayerInOneTeam(teams, playerId, playerObj, targetTeamIdx) {
        // Strip player from ALL teams
        for (let i = 0; i < teams.length; i++) {
            teams[i].players = teams[i].players.filter(p => p.id !== playerId);
        }

        // Add to target team if provided
        if (playerObj && targetTeamIdx >= 0 && targetTeamIdx < teams.length) {
            teams[targetTeamIdx].players.push(playerObj);
        }

        return teams;
    }

    /**
     * Validate room state: deduplicate players across teams, verify host exists.
     */
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
                    if (p.id === roomData.hostId) {
                        hostExists = true;
                    }
                }
            }
            team.players = uniquePlayers;
        }

        if (!hostExists && roomData.hostId) {
            roomData.invalidBecauseHostLeft = true;
        }

        return roomData;
    }

    // ── CREATE ROOM ──────────────────────────────────────────────────────────

    async function createRoom() {
        // Guard against double-click
        if (isCreatingRoom) return;
        isCreatingRoom = true;

        const btn = $("create-room-btn");
        btn.disabled = true;
        const originalText = btn.textContent;
        btn.textContent = "CREATING...";

        try {
            const code = generateRoomCode();
            const docRef = doc(db, "rooms", code);

            state.myPlayerId = getMyPlayerId();
            const playerName = $("host-player-name").value.trim() || "Host";
            const teamId = $("host-team").value;
            state.myPlayerName = playerName;

            const initialStocks = clamp(parseInt($("initial-stocks").value) || 5, 1, 50);
            const initialWorth = clamp(parseInt($("initial-worth").value) || 100, 10, 1000);
            const matchDurationMin = clamp(parseInt($("match-duration").value) || 5, 1, 30);
            const matchDuration = matchDurationMin * 60;

            const targetTeamIdx = teamId === 'a' ? 0 : 1;
            const playerEntry = { id: state.myPlayerId, name: playerName };

            const initialCash = initialWorth * 2;
            const initialPlayerWorth = initialCash + (initialStocks * initialWorth);

            // Atomic create: transaction ensures no race if same code generated twice
            await runTransaction(db, async (transaction) => {
                const snap = await transaction.get(docRef);
                if (snap.exists()) {
                    throw new Error("Room code collision, please try again.");
                }

                const teams = [
                    { id: "a", name: "Alpha", players: [] },
                    { id: "b", name: "Beta",  players: [] }
                ];
                teams[targetTeamIdx].players.push(playerEntry);

                const playerState = createPlayerState(state.myPlayerId, initialStocks, initialWorth);

                transaction.set(docRef, {
                    hostId: state.myPlayerId,
                    roomCode: code,
                    initialStocks,
                    initialWorth,
                    matchDuration,
                    maxTeamSize: MAX_TEAM_SIZE,
                    createdAt: Date.now(),

                    phase: "waiting",
                    teams,

                    match: {
                        gameStartTime: 0,
                        stockWorth: initialWorth,
                        worthHistory: [initialWorth],
                        totalBuys: 0,
                        totalSells: 0,
                        playerStates: {
                            [state.myPlayerId]: playerState
                        }
                    },

                    matchNumber: 0,
                    lastUpdateTime: Date.now()
                });
            });

            // Success — update local state
            state.roomId = code;
            state.isHost = true;
            state.hostId = state.myPlayerId;
            state.initialStocks = initialStocks;
            state.initialWorth = initialWorth;
            state.matchDuration = matchDuration;
            state.phase = "waiting";
            state.teams = [
                { id: "a", name: "Alpha", players: [] },
                { id: "b", name: "Beta",  players: [] }
            ];
            state.teams[targetTeamIdx].players.push(playerEntry);
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
        // Guard against double-click
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
            const docRef = doc(db, "rooms", code);

            state.myPlayerId = getMyPlayerId();
            const playerName = $("join-player-name").value.trim() || "Player";
            const teamId = $("join-team").value;
            state.myPlayerName = playerName;

            const targetTeamIdx = teamId === 'a' ? 0 : 1;
            const playerEntry = { id: state.myPlayerId, name: playerName };

            await runTransaction(db, async (transaction) => {
                const roomSnap = await transaction.get(docRef);
                if (!roomSnap.exists()) {
                    throw new Error("Room not found!");
                }
                let roomData = roomSnap.data();

                if (roomData.phase === "playing") {
                    throw new Error("Game already in progress!");
                }

                roomData = validateRoomState(roomData);

                // Check if already in room (idempotent join)
                const isAlreadyInRoom = roomData.teams.some(t => t.players.some(p => p.id === state.myPlayerId));
                if (isAlreadyInRoom) {
                    // Already in room, no need to add again
                    return;
                }

                // Check team size limit
                if (roomData.teams[targetTeamIdx].players.length >= (roomData.maxTeamSize || MAX_TEAM_SIZE)) {
                    throw new Error(`Team ${roomData.teams[targetTeamIdx].name} is full! (${roomData.maxTeamSize || MAX_TEAM_SIZE} players max)`);
                }

                // Add player to team (ensurePlayerInOneTeam strips from any team first)
                ensurePlayerInOneTeam(roomData.teams, state.myPlayerId, playerEntry, targetTeamIdx);

                // Initialize player state in match
                if (!roomData.match) {
                    roomData.match = {
                        gameStartTime: 0,
                        stockWorth: roomData.initialWorth || 100,
                        worthHistory: [roomData.initialWorth || 100],
                        totalBuys: 0,
                        totalSells: 0,
                        playerStates: {}
                    };
                }
                if (!roomData.match.playerStates) roomData.match.playerStates = {};
                roomData.match.playerStates[state.myPlayerId] = createPlayerState(
                    state.myPlayerId, roomData.initialStocks, roomData.initialWorth
                );

                roomData = validateRoomState(roomData);

                transaction.update(docRef, {
                    teams: roomData.teams,
                    match: roomData.match,
                    lastUpdateTime: Date.now()
                });
            });

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
        const initialCash = initialWorth * 2;
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

    // ── FIREBASE LISTENER ─────────────────────────────────────────────────────

    function listenToRoom(code) {
        // Clean up any existing listener
        if (state.unsubscribeRoom) {
            state.unsubscribeRoom();
            state.unsubscribeRoom = null;
        }

        state.unsubscribeRoom = onSnapshot(doc(db, "rooms", code), (docSnapshot) => {
            if (!docSnapshot.exists()) {
                cleanupLocalStateAndUI("Room has been closed.");
                return;
            }

            const data = docSnapshot.data();

            // Validate on every snapshot
            const validated = validateRoomState(data);
            if (validated.invalidBecauseHostLeft) {
                cleanupLocalStateAndUI("Host left. Room has been closed.");
                return;
            }

            const prevPhase = state.phase;

            // ── Selective merge (don't blindly Object.assign) ──
            state.hostId = data.hostId;
            state.initialStocks = data.initialStocks;
            state.initialWorth = data.initialWorth;
            state.matchDuration = data.matchDuration;
            state.maxTeamSize = data.maxTeamSize || MAX_TEAM_SIZE;
            state.phase = data.phase || "waiting";
            state.teams = validated.teams;
            state.match = data.match || state.match;
            state.matchNumber = data.matchNumber || 0;

            // Toggle switch team button visibility
            if (dom.switchTeamBtn) {
                dom.switchTeamBtn.hidden = state.phase !== "waiting";
            }

            // ── Phase transitions ──

            // WAITING → PLAYING
            if (prevPhase !== "playing" && state.phase === "playing") {
                dom.waitingRoom.hidden = true;
                dom.results.hidden = true;
                dom.arena.hidden = false;
                startCountdown();
                // Join voice on game start
                const myTeamId = state.teams[0].players.some(p => p.id === state.myPlayerId) ? "a" : "b";
                joinTeamVoice(state.roomId, myTeamId, state.myPlayerId);
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

            // ── Update UI based on current phase ──
            if (state.phase === "waiting" && !dom.waitingRoom.hidden) {
                renderWaitingRoom();
                if (state.isHost) {
                    const ready = state.teams[0].players.length > 0 && state.teams[1].players.length > 0;
                    const btn = $("start-game-btn");
                    btn.disabled = !ready;
                    btn.style.opacity = ready ? "1" : "0.5";
                    btn.style.cursor = ready ? "pointer" : "not-allowed";
                    $("waiting-message").textContent = ready ? "Ready to start!" : "Waiting for players to join both teams...";
                } else {
                    $("waiting-message").textContent = "Waiting for host to start...";
                }
            } else if (state.phase === "playing" && !dom.arena.hidden) {
                renderArena();
            }
        });
    }

    // ── SWITCH TEAM ──────────────────────────────────────────────────────────

    async function switchTeam() {
        if (state.phase !== "waiting" || !state.roomId) return;
        const btn = dom.switchTeamBtn;
        if (btn) btn.disabled = true;

        try {
            const docRef = doc(db, "rooms", state.roomId);
            await runTransaction(db, async (transaction) => {
                const roomSnap = await transaction.get(docRef);
                if (!roomSnap.exists()) return;
                let roomData = roomSnap.data();

                if (roomData.phase !== "waiting") {
                    throw new Error("Cannot switch team after game has started.");
                }

                roomData = validateRoomState(roomData);

                // Find current team
                let fromTeam = -1;
                let playerEntry = null;
                for (let i = 0; i < 2; i++) {
                    const idx = roomData.teams[i].players.findIndex(p => p.id === state.myPlayerId);
                    if (idx !== -1) {
                        playerEntry = roomData.teams[i].players[idx];
                        fromTeam = i;
                        break;
                    }
                }

                if (!playerEntry || fromTeam === -1) return;

                const toTeam = fromTeam === 0 ? 1 : 0;

                // Check target team size
                if (roomData.teams[toTeam].players.length >= (roomData.maxTeamSize || MAX_TEAM_SIZE)) {
                    throw new Error(`Team ${roomData.teams[toTeam].name} is full!`);
                }

                // Atomic move: remove from all, add to target
                ensurePlayerInOneTeam(roomData.teams, state.myPlayerId, playerEntry, toTeam);
                roomData = validateRoomState(roomData);

                transaction.update(docRef, { teams: roomData.teams, lastUpdateTime: Date.now() });
            });
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
            const docRef = doc(db, "rooms", state.roomId);
            if (state.isHost) {
                // Host leaving destroys the room
                await deleteDoc(docRef);
            } else {
                // Player leaving removes themselves
                await runTransaction(db, async (transaction) => {
                    const roomSnap = await transaction.get(docRef);
                    if (!roomSnap.exists()) return;
                    let roomData = roomSnap.data();

                    // Remove from teams
                    for (let i = 0; i < 2; i++) {
                        roomData.teams[i].players = roomData.teams[i].players.filter(p => p.id !== state.myPlayerId);
                    }

                    // Remove from match playerStates
                    if (roomData.match && roomData.match.playerStates) {
                        delete roomData.match.playerStates[state.myPlayerId];
                    }

                    roomData = validateRoomState(roomData);
                    transaction.update(docRef, {
                        teams: roomData.teams,
                        match: roomData.match,
                        lastUpdateTime: Date.now()
                    });
                });
            }
        } catch (err) {
            console.error("[Game] Error leaving room:", err);
        } finally {
            if (btn) btn.disabled = false;
        }
        cleanupLocalStateAndUI();
    }

    function cleanupLocalStateAndUI(msg = "") {
        // Unsubscribe Firestore listener
        if (state.unsubscribeRoom) {
            state.unsubscribeRoom();
            state.unsubscribeRoom = null;
        }

        // Clear countdown
        clearInterval(countdownInterval);
        countdownInterval = null;

        // Leave voice chat
        leaveVoice();

        // Clear session
        clearSession();

        // Reset state
        state.roomId = null;
        state.isHost = false;
        state.phase = "waiting";
        state.hostId = null;

        // Reset UI
        dom.waitingRoom.hidden = true;
        dom.arena.hidden = true;
        dom.results.hidden = true;
        dom.landing.hidden = false;

        $("join-room-btn").disabled = false;
        $("join-room-btn").textContent = "JOIN ROOM";

        // Reset operation flags
        isCreatingRoom = false;
        isJoiningRoom = false;
        isSubmitting = false;

        if (msg) alert(msg);
    }

    function handleDisconnect() {
        if (!state.roomId) return;
        const docRef = doc(db, "rooms", state.roomId);

        if (state.isHost) {
            // Host leaving: delete the room (fire-and-forget during unload)
            deleteDoc(docRef).catch(() => {});
        } else {
            // Player leaving: remove from room
            // For unload reliability, use getDoc + updateDoc instead of transaction
            // (transactions may not complete during page unload)
            getDoc(docRef).then(snap => {
                if (!snap.exists()) return;
                const data = snap.data();
                for (let i = 0; i < 2; i++) {
                    data.teams[i].players = data.teams[i].players.filter(p => p.id !== state.myPlayerId);
                }
                if (data.match && data.match.playerStates) {
                    delete data.match.playerStates[state.myPlayerId];
                }
                updateDoc(docRef, {
                    teams: data.teams,
                    match: data.match
                }).catch(() => {});
            }).catch(() => {});
        }

        // Best-effort voice cleanup
        leaveVoice();
    }

    // ── WAITING ROOM RENDER ──────────────────────────────────────────────────

    function renderWaitingRoom() {
        const maxSize = state.maxTeamSize || MAX_TEAM_SIZE;
        const teamA = $("lobby-team-a");
        const teamB = $("lobby-team-b");

        // Update team count headers
        const teamAHeader = $("lobby-team-a-count");
        const teamBHeader = $("lobby-team-b-count");
        if (teamAHeader) teamAHeader.textContent = `(${state.teams[0].players.length}/${maxSize})`;
        if (teamBHeader) teamBHeader.textContent = `(${state.teams[1].players.length}/${maxSize})`;

        teamA.innerHTML = state.teams[0].players.map(p => {
            const isMe = p.id === state.myPlayerId;
            return `<div class="game-roster-row${isMe ? ' game-roster-active' : ''}"><span class="game-roster-name">${escapeHtml(p.name)}${isMe ? ' (you)' : ''}${p.id === state.hostId ? ' ★' : ''}</span></div>`;
        }).join("") || '<div style="color:var(--muted);padding:12px;text-align:center;font-size:13px;">No players yet</div>';

        teamB.innerHTML = state.teams[1].players.map(p => {
            const isMe = p.id === state.myPlayerId;
            return `<div class="game-roster-row${isMe ? ' game-roster-active' : ''}"><span class="game-roster-name">${escapeHtml(p.name)}${isMe ? ' (you)' : ''}${p.id === state.hostId ? ' ★' : ''}</span></div>`;
        }).join("") || '<div style="color:var(--muted);padding:12px;text-align:center;font-size:13px;">No players yet</div>';
    }

    // ── GAME START ────────────────────────────────────────────────────────────

    async function startGame() {
        if (!state.isHost) return;
        if (state.teams[0].players.length === 0 || state.teams[1].players.length === 0) {
            alert("Both teams need at least 1 player to start!");
            return;
        }

        const btn = $("start-game-btn");
        btn.disabled = true;

        try {
            const docRef = doc(db, "rooms", state.roomId);

            await runTransaction(db, async (transaction) => {
                const snap = await transaction.get(docRef);
                if (!snap.exists()) throw new Error("Room not found");
                const roomData = snap.data();

                if (roomData.phase !== "waiting") {
                    throw new Error("Game already started");
                }

                const initialStocks = roomData.initialStocks;
                const initialWorth = roomData.initialWorth;

                // Build fresh playerStates for all players
                const playerStates = {};
                roomData.teams.forEach(team => {
                    team.players.forEach(player => {
                        const ps = createPlayerState(player.id, initialStocks, initialWorth);
                        // Generate initial question
                        ps.currentQuestion = generateQuestion();
                        ps.questionNumber = 1;
                        playerStates[player.id] = ps;
                    });
                });

                const gameStartTime = Date.now();

                transaction.update(docRef, {
                    phase: "playing",
                    match: {
                        gameStartTime,
                        stockWorth: initialWorth,
                        worthHistory: [initialWorth],
                        totalBuys: 0,
                        totalSells: 0,
                        playerStates
                    },
                    matchNumber: (roomData.matchNumber || 0) + 1,
                    lastUpdateTime: Date.now()
                });
            });
        } catch (err) {
            console.error("[Game] Start game failed:", err);
            alert(err.message || "Failed to start game.");
            btn.disabled = false;
        }
    }

    // ── PLAY AGAIN (RESET FOR NEXT MATCH) ────────────────────────────────────

    async function resetForNextMatch() {
        if (!state.isHost) {
            // Non-host: the host will trigger the reset, we react via listener
            // But if non-host clicks, we just show a message
            alert("Waiting for host to start a new match...");
            return;
        }

        const btn = dom.playAgainBtn;
        if (btn) btn.disabled = true;

        try {
            const docRef = doc(db, "rooms", state.roomId);

            await runTransaction(db, async (transaction) => {
                const snap = await transaction.get(docRef);
                if (!snap.exists()) throw new Error("Room not found");
                const roomData = snap.data();

                const initialStocks = roomData.initialStocks;
                const initialWorth = roomData.initialWorth;

                // Build fresh playerStates (reset stats, keep players)
                const playerStates = {};
                roomData.teams.forEach(team => {
                    team.players.forEach(player => {
                        playerStates[player.id] = createPlayerState(player.id, initialStocks, initialWorth);
                    });
                });

                transaction.update(docRef, {
                    phase: "waiting",
                    match: {
                        gameStartTime: 0,
                        stockWorth: initialWorth,
                        worthHistory: [initialWorth],
                        totalBuys: 0,
                        totalSells: 0,
                        playerStates
                    },
                    lastUpdateTime: Date.now()
                });
            });
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
     * Core trade execution — uses Firestore transaction to prevent overwrites.
     * 
     * 1. Validate answer against player's own question
     * 2. Execute buy/sell/hold trade immediately
     * 3. Update stock price based on single trade pressure
     * 4. Generate next question for this player
     * 5. Atomically write to Firestore
     */
    async function handleAnswer(e) {
        e.preventDefault();
        if (state.phase !== "playing" || isSubmitting) return;

        // Prevent double-submit
        isSubmitting = true;
        dom.answerInput.disabled = true;

        const inputStr = dom.answerInput.value.trim().toLowerCase();
        const regex = /^([+-]?\d+)(?:\s*([bs\+\-]))?$/i;
        const matchResult = inputStr.match(regex);

        if (!matchResult) {
            // Invalid input format
            dom.answerInput.value = "";
            dom.answerInput.disabled = false;
            isSubmitting = false;
            setTimeout(() => dom.answerInput.focus(), 50);
            return;
        }

        const submittedAnswer = parseInt(matchResult[1]);
        const tradeAction = matchResult[2];

        try {
            const docRef = doc(db, "rooms", state.roomId);

            await runTransaction(db, async (transaction) => {
                const snap = await transaction.get(docRef);
                if (!snap.exists()) throw new Error("Room gone");
                const roomData = snap.data();

                if (roomData.phase !== "playing") return;

                const myState = roomData.match.playerStates[state.myPlayerId];
                if (!myState || !myState.currentQuestion) return;

                const correctAnswer = myState.currentQuestion.answer;
                const isCorrect = submittedAnswer === correctAnswer;

                let stockWorth = roomData.match.stockWorth;
                let worthHistory = roomData.match.worthHistory || [];
                let totalBuys = roomData.match.totalBuys || 0;
                let totalSells = roomData.match.totalSells || 0;

                if (isCorrect) {
                    myState.correct += 1;
                    myState.score += 1;

                    if (tradeAction === 'b' || tradeAction === '+') {
                        // BUY
                        if (myState.cash >= stockWorth) {
                            myState.cash -= stockWorth;
                            myState.stocks += 1;
                            myState.trades += 1;
                            myState.buys += 1;
                            totalBuys += 1;
                            // Buy pressure raises price
                            const volatility = 1.5 + Math.random() * 2.5;
                            stockWorth += volatility;
                            stockWorth += (Math.random() - 0.5) * 1.5;
                            if (stockWorth < 1) stockWorth = 1;
                            stockWorth = Math.round(stockWorth * 100) / 100;
                            worthHistory.push(stockWorth);
                        }
                        myState.lastFeedback = {
                            text: `✓ Correct! Bought 1 stock at $${stockWorth.toFixed(2)}`,
                            className: "game-feedback game-feedback-correct"
                        };
                    } else if (tradeAction === 's' || tradeAction === '-') {
                        // SELL / SHORT
                        myState.cash += stockWorth;
                        myState.stocks -= 1;
                        myState.trades += 1;
                        myState.shorts += 1;
                        totalSells += 1;
                        // Sell pressure lowers price
                        const volatility = 1.5 + Math.random() * 2.5;
                        stockWorth -= volatility;
                        stockWorth += (Math.random() - 0.5) * 1.5;
                        if (stockWorth < 1) stockWorth = 1;
                        stockWorth = Math.round(stockWorth * 100) / 100;
                        worthHistory.push(stockWorth);
                        myState.lastFeedback = {
                            text: `✓ Correct! Sold 1 stock at $${stockWorth.toFixed(2)}`,
                            className: "game-feedback game-feedback-correct"
                        };
                    } else {
                        // HOLD
                        myState.lastFeedback = {
                            text: `✓ Correct! Holding position.`,
                            className: "game-feedback game-feedback-correct"
                        };
                    }
                } else {
                    // Wrong answer — penalty
                    myState.wrong += 1;
                    const penalty = Math.round((roomData.initialWorth || 100) * 0.1) || 10;
                    myState.cash -= penalty;
                    myState.lastFeedback = {
                        text: `✗ Wrong! Answer was ${correctAnswer}. Penalty: -$${penalty}`,
                        className: "game-feedback game-feedback-wrong"
                    };
                }

                // Generate next question
                myState.questionNumber += 1;
                myState.currentQuestion = generateQuestion();

                // Recalculate this player's worth
                myState.worth = Math.round((myState.cash + (myState.stocks * stockWorth)) * 100) / 100;

                // Check if game time expired
                let phase = roomData.phase;
                if (roomData.match.gameStartTime && roomData.matchDuration) {
                    const elapsed = (Date.now() - roomData.match.gameStartTime) / 1000;
                    if (elapsed >= roomData.matchDuration) {
                        phase = "results";
                    }
                }

                // Write updated state
                const updatedMatch = {
                    ...roomData.match,
                    stockWorth,
                    worthHistory,
                    totalBuys,
                    totalSells,
                    playerStates: {
                        ...roomData.match.playerStates,
                        [state.myPlayerId]: myState
                    }
                };

                transaction.update(docRef, {
                    phase,
                    match: updatedMatch,
                    lastUpdateTime: Date.now()
                });
            });

        } catch (err) {
            console.error("[Game] Trade failed:", err);
        }

        // Reset input for next question
        dom.answerInput.value = "";
        dom.answerInput.disabled = false;
        isSubmitting = false;

        if (state.phase === "playing") {
            setTimeout(() => dom.answerInput.focus(), 50);
        }
    }

    // ── TEAM WORTH CALCULATION ────────────────────────────────────────────────

    /**
     * Calculate team aggregates from match.playerStates and team membership.
     * Returns computed team data for rendering.
     */
    function getTeamComputedData(teamIdx) {
        const team = state.teams[teamIdx];
        const ps = state.match.playerStates || {};
        const stockWorth = state.match.stockWorth || 0;

        let tStocks = 0, tCash = 0, tWorth = 0;
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
            if (remaining <= 0 && state.isHost) {
                endGameByTime();
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
            const docRef = doc(db, "rooms", state.roomId);
            await runTransaction(db, async (transaction) => {
                const snap = await transaction.get(docRef);
                if (!snap.exists()) return;
                const roomData = snap.data();
                if (roomData.phase !== "playing") return; // Already ended

                transaction.update(docRef, {
                    phase: "results",
                    lastUpdateTime: Date.now()
                });
            });
        } catch (err) {
            console.error("[Game] Failed to end game:", err);
        }
    }

    // ── RENDERING ─────────────────────────────────────────────────────────────

    function renderArena() {
        const myState = findMyPlayerState();
        const teamAData = getTeamComputedData(0);
        const teamBData = getTeamComputedData(1);

        // Trades count
        if (dom.tradesDisplay) {
            dom.tradesDisplay.textContent = myState ? `${myState.trades}` : "0";
        }

        // Stock worth
        dom.worthDisplay.textContent = (state.match.stockWorth || 0).toFixed(2);

        // Market status
        if (dom.marketStatus) {
            dom.marketStatus.innerHTML = `<span class="market-live-dot"></span> LIVE`;
        }

        // Countdown
        if (dom.countdownDisplay) {
            dom.countdownDisplay.textContent = formatTime(getRemainingTime());
        }

        // Team panels
        dom.teamADisplay.textContent = state.teams[0].name.toUpperCase();
        dom.teamBDisplay.textContent = state.teams[1].name.toUpperCase();

        dom.teamAWorth.textContent = teamAData.totalWorth.toFixed(2);
        dom.teamBWorth.textContent = teamBData.totalWorth.toFixed(2);
        dom.teamAStocks.textContent = teamAData.stocks;
        dom.teamBStocks.textContent = teamBData.stocks;
        dom.teamACash.textContent = teamAData.cash.toFixed(1);
        dom.teamBCash.textContent = teamBData.cash.toFixed(1);

        renderRoster(dom.teamARoster, teamAData.players);
        renderRoster(dom.teamBRoster, teamBData.players);

        // Per-player question rendering
        if (myState && myState.currentQuestion) {
            dom.questionText.textContent = myState.currentQuestion.text;
            dom.answerInput.disabled = false;
            dom.answerInput.placeholder = "e.g. 7 b (buy) or 7 s (sell)";
        } else {
            dom.questionText.textContent = "Waiting for game to start...";
            dom.answerInput.disabled = true;
        }

        // Per-player feedback
        if (myState && myState.lastFeedback) {
            dom.feedback.textContent = myState.lastFeedback.text;
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
            return `<div class="game-roster-row ${isMe ? 'game-roster-active' : ''}">
                <span class="game-roster-name">${escapeHtml(p.name)}${isMe ? ' (you)' : ''}</span>
                <span class="game-roster-stats">
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

        // Show/hide play again based on host status
        if (dom.playAgainBtn) {
            dom.playAgainBtn.textContent = state.isHost ? "PLAY AGAIN" : "WAITING FOR HOST...";
            dom.playAgainBtn.disabled = !state.isHost;
        }
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
                    <div>Buys/Shorts: <span class="game-mono" style="color:var(--text)">${p.buys || 0} / ${p.shorts || 0}</span></div>
                    <div>Cash: <span class="game-mono" style="color:var(--text)">$${(p.cash || 0).toFixed(1)}</span></div>
                    <div>Stocks: <span class="game-mono" style="color:var(--text)">${p.stocks || 0}</span></div>
                    <div>Total Trades: <span class="game-mono" style="color:var(--text)">${p.trades || 0}</span></div>
                </div>
            </div>`;
        }).join("");
    }

    // ── CHART ─────────────────────────────────────────────────────────────────
    function drawChart(canvas) {
        if (!canvas) return;
        const parent = canvas.parentElement;
        const dpr = window.devicePixelRatio || 1;
        const w = parent.clientWidth;
        const h = parent.clientHeight || w;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + "px";
        canvas.style.height = h + "px";
        const ctx = canvas.getContext("2d");
        ctx.scale(dpr, dpr);
        const data = state.match.worthHistory || [];
        if (!data || data.length < 2) {
            ctx.fillStyle = "#94a3b8";
            ctx.font = "12px 'JetBrains Mono', monospace";
            ctx.textAlign = "center";
            ctx.fillText("Awaiting data...", w / 2, h / 2);
            return;
        }
        const pad = { top: 24, right: 16, bottom: 32, left: 52 };
        const cw = w - pad.left - pad.right;
        const ch = h - pad.top - pad.bottom;
        const minVal = Math.min(...data) * 0.95;
        const maxVal = Math.max(...data) * 1.05;
        const range = maxVal - minVal || 1;
        ctx.clearRect(0, 0, w, h);
        const gridLines = 5;
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.lineWidth = 1;
        ctx.font = "10px 'JetBrains Mono', monospace";
        ctx.fillStyle = "#64748b";
        ctx.textAlign = "right";
        for (let i = 0; i <= gridLines; i++) {
            const y = pad.top + (ch / gridLines) * i;
            const val = maxVal - (range / gridLines) * i;
            ctx.beginPath();
            ctx.moveTo(pad.left, y);
            ctx.lineTo(w - pad.right, y);
            ctx.stroke();
            ctx.fillText(val.toFixed(1), pad.left - 6, y + 3);
        }
        ctx.textAlign = "center";
        const xStep = Math.max(1, Math.floor(data.length / 8));
        for (let i = 0; i < data.length; i += xStep) {
            const x = pad.left + (i / (data.length - 1)) * cw;
            ctx.fillText(String(i), x, h - pad.bottom + 16);
        }
        ctx.beginPath();
        ctx.strokeStyle = "#d8b15b";
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        for (let i = 0; i < data.length; i++) {
            const x = pad.left + (i / (data.length - 1)) * cw;
            const y = pad.top + ch - ((data[i] - minVal) / range) * ch;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + ch);
        gradient.addColorStop(0, "rgba(216,177,91,0.15)");
        gradient.addColorStop(1, "rgba(216,177,91,0)");
        ctx.lineTo(pad.left + cw, pad.top + ch);
        ctx.lineTo(pad.left, pad.top + ch);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();
        const lastX = pad.left + cw;
        const lastY = pad.top + ch - ((data[data.length - 1] - minVal) / range) * ch;
        ctx.beginPath();
        ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#d8b15b";
        ctx.fill();
        ctx.strokeStyle = "#0b1020";
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // ── UTILITIES ─────────────────────────────────────────────────────────────
    function escapeHtml(str) {
        if (!str) return "";
        return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
    function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

    document.addEventListener("DOMContentLoaded", initApp);
})();
