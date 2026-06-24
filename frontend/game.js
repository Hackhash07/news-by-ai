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
    }

    // ── INITIALIZATION ────────────────────────────────────────────────────────
    function initApp() {
        cacheDom();

        // Navigation bindings
        $("landing-host-btn").addEventListener("click", () => { dom.landing.hidden = true; dom.setup.hidden = false; });
        $("landing-join-btn").addEventListener("click", () => { dom.landing.hidden = true; dom.join.hidden = false; });

        $("host-back-btn").addEventListener("click", () => { dom.setup.hidden = true; dom.landing.hidden = false; });
        $("join-back-btn").addEventListener("click", () => { dom.join.hidden = true; dom.landing.hidden = false; });

        $("create-room-btn").addEventListener("click", createRoom);
        $("join-room-btn").addEventListener("click", joinRoom);
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

            const targetTeamIdx = teamId === 'a' ? 0 : 1;
            const playerEntry = { id: state.myPlayerId, name: playerName };

            const initialCash = initialWorth * 2;

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
                max_team_size: MAX_TEAM_SIZE,
                created_at: new Date().toISOString(),
                phase: "waiting",
                teams: teams,
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

            const prevPhase = state.phase;

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
                    onlinePlayerIds.add(id);
                }
                syncPresenceUI();
            })
            .on('presence', { event: 'join' }, ({ key }) => {
                onlinePlayerIds.add(key);
                syncPresenceUI();
            })
            .on('presence', { event: 'leave' }, ({ key }) => {
                const presenceState = presenceChannel.presenceState();
                if (!presenceState[key]) {
                    onlinePlayerIds.delete(key);
                }
                syncPresenceUI();
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await presenceChannel.track({ online_at: new Date().toISOString() });
                }
            });

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
            if (btn) btn.disabled = false;
        }
        cleanupLocalStateAndUI();
    }

    function cleanupLocalStateAndUI(msg = "") {
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

        // If I am host, check if all online players voted agree
        if (state.isHost) {
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
            return `<div class="game-roster-row${isMe ? ' game-roster-active' : ''}"><span class="game-roster-name">${escapeHtml(p.name)}${isMe ? ' (you)' : ''}${p.id === state.hostId ? ' ★' : ''}${statusIndicator}</span></div>`;
        }).join("") || '<div style="color:var(--muted);padding:12px;text-align:center;font-size:13px;">No players yet</div>';

        teamB.innerHTML = state.teams[1].players.map(p => {
            const isMe = p.id === state.myPlayerId;
            const isOnline = onlinePlayerIds.has(p.id);
            const statusIndicator = isOnline ? '' : '<span style="color:var(--red);font-size:10px;margin-left:6px;">(Offline)</span>';
            return `<div class="game-roster-row${isMe ? ' game-roster-active' : ''}"><span class="game-roster-name">${escapeHtml(p.name)}${isMe ? ' (you)' : ''}${p.id === state.hostId ? ' ★' : ''}${statusIndicator}</span></div>`;
        }).join("") || '<div style="color:var(--muted);padding:12px;text-align:center;font-size:13px;">No players yet</div>';
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

            const { error: updateErr } = await supabase.from('rooms').update({
                phase: "playing",
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
                        const volatility = 1.5 + Math.random() * 2.5;
                        stockWorth += volatility;
                        stockWorth += (Math.random() - 0.5) * 1.5;
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
                    myState.cash += stockWorth;
                    myState.stocks -= 1;
                    myState.trades += 1;
                    myState.shorts += 1;
                    totalSells += 1;
                    const volatility = 1.5 + Math.random() * 2.5;
                    stockWorth -= volatility;
                    stockWorth += (Math.random() - 0.5) * 1.5;
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
        ctx.lineWidth = 2.5;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.shadowColor = "#d8b15b";
        ctx.shadowBlur = 12;

        for (let i = 0; i < data.length; i++) {
            const x = pad.left + (i / (data.length - 1)) * cw;
            const y = pad.top + ch - ((data[i] - minVal) / range) * ch;
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                const prevX = pad.left + ((i - 1) / (data.length - 1)) * cw;
                const prevY = pad.top + ch - ((data[i - 1] - minVal) / range) * ch;
                const cpX = prevX + (x - prevX) / 2;
                ctx.quadraticCurveTo(cpX, prevY, x, y);
            }
        }
        ctx.stroke();

        ctx.shadowBlur = 0; // Disable glow for fill

        const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + ch);
        gradient.addColorStop(0, "rgba(216,177,91,0.2)");
        gradient.addColorStop(1, "rgba(216,177,91,0.0)");
        ctx.lineTo(pad.left + cw, pad.top + ch);
        ctx.lineTo(pad.left, pad.top + ch);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();

        const lastX = pad.left + cw;
        const lastY = pad.top + ch - ((data[data.length - 1] - minVal) / range) * ch;
        ctx.beginPath();
        ctx.arc(lastX, lastY, 5, 0, Math.PI * 2);
        ctx.fillStyle = "#d8b15b";
        ctx.fill();
        ctx.strokeStyle = "#0b1020";
        ctx.lineWidth = 2;
        ctx.stroke();

        // Latest Price Marker
        ctx.shadowColor = "#d8b15b";
        ctx.shadowBlur = 6;
        ctx.fillStyle = "#0b1020";
        ctx.strokeStyle = "#d8b15b";
        ctx.lineWidth = 1;
        
        const priceText = `$${data[data.length - 1].toFixed(2)}`;
        ctx.font = "11px 'JetBrains Mono', monospace";
        const textWidth = ctx.measureText(priceText).width;
        
        const boxW = textWidth + 12;
        const boxH = 20;
        let boxX = lastX - boxW - 8;
        let boxY = lastY - boxH / 2;
        if (boxX < pad.left) boxX = lastX + 8; // flip to right if goes offscreen

        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxW, boxH, 4);
        ctx.fill();
        ctx.stroke();
        
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(priceText, boxX + boxW / 2, boxY + boxH / 2);
    }

    // ── UTILITIES ─────────────────────────────────────────────────────────────
    function escapeHtml(str) {
        if (!str) return "";
        return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
    function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

    document.addEventListener("DOMContentLoaded", initApp);
})();
