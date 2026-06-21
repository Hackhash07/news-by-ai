import { db } from './firebase.js';
import { doc, setDoc, onSnapshot, updateDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { joinTeamVoice, toggleMute } from "./voice.js";

/* ═══════════════════════════════════════════════════════════════════════════════
   TRADING IQ BATTLE — game.js (CONTINUOUS MARKET REFACTOR)
   Event-driven trading simulation: per-player question streams, immediate
   trade execution, time-based match duration, real-time stock price updates.
   ═══════════════════════════════════════════════════════════════════════════════ */

(function () {
    "use strict";

    // ── GAME STATE ────────────────────────────────────────────────────────────
    let state = {
        roomId: null,
        isHost: false,
        myPlayerId: null,

        gameActive: false,
        ended: false,
        teams: [
            { id: "a", name: "Alpha", players: [], stocks: 0, cash: 0, totalWorth: 0 },
            { id: "b", name: "Beta",  players: [], stocks: 0, cash: 0, totalWorth: 0 }
        ],
        stockWorth: 100,
        initialStocks: 5,
        initialWorth: 100,

        // ── Time-based match ──
        matchDuration: 300,     // seconds (default 5 min)
        gameStartTime: 0,       // timestamp when game started

        // ── Market pressure tracking ──
        totalBuys: 0,
        totalSells: 0,

        worthHistory: [],
    };

    let countdownInterval = null;
    let isSubmitting = false; // prevents double-submit race

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

        dom.answerForm.addEventListener("submit", handleAnswer);

        dom.playAgainBtn.addEventListener("click", () => {
            window.location.reload();
        });

        window.addEventListener("resize", () => {
            if (!dom.arena.hidden) drawChart(dom.chartCanvas);
            if (!dom.results.hidden) drawChart(dom.resultChart);
        });
    }

    function generateRoomCode() {
        return Math.random().toString(36).substring(2, 8).toUpperCase();
    }

    async function createRoom() {
        const code = generateRoomCode();
        state.roomId = code;
        state.isHost = true;
        state.myPlayerId = Date.now().toString() + Math.random().toString(36).substring(2, 5);

        const initialStocks = clamp(parseInt($("initial-stocks").value) || 5, 1, 50);
        const initialWorth = clamp(parseInt($("initial-worth").value) || 100, 10, 1000);
        const matchDurationMin = clamp(parseInt($("match-duration").value) || 5, 1, 30);
        const matchDuration = matchDurationMin * 60; // convert to seconds

        const playerName = $("host-player-name").value.trim() || "Host";
        const teamId = $("host-team").value;

        const playerObj = createPlayerObject(playerName, state.myPlayerId, initialStocks, initialWorth);

        state.initialStocks = initialStocks;
        state.initialWorth = initialWorth;
        state.matchDuration = matchDuration;
        state.stockWorth = initialWorth;
        state.worthHistory = [initialWorth];

        if (teamId === 'a') state.teams[0].players.push(playerObj);
        else state.teams[1].players.push(playerObj);

        recalcTeamWorths();

        await setDoc(doc(db, "rooms", code), {
            gameActive: false,
            ended: false,
            stockWorth: initialWorth,
            initialStocks,
            initialWorth,
            matchDuration,
            gameStartTime: 0,
            worthHistory: [initialWorth],
            totalBuys: 0,
            totalSells: 0,
            teams: state.teams,
            lastUpdateTime: Date.now()
        });

        listenToRoom(code);

        dom.setup.hidden = true;
        dom.waitingRoom.hidden = false;
        $("waiting-room-code-display").innerHTML = `Room Code: <strong>${code}</strong>`;
        $("start-game-btn").hidden = false;
    }

    async function joinRoom() {
        const btn = $("join-room-btn");
        if (btn.disabled) return;

        const code = $("join-room-code").value.toUpperCase().trim();
        if (!code) return;

        btn.disabled = true;
        const originalText = btn.textContent;
        btn.textContent = "Joining...";

        try {
            const docRef = doc(db, "rooms", code);
            const snap = await getDoc(docRef);
            if (!snap.exists()) {
                $("join-error").textContent = "Room not found!";
                btn.disabled = false;
                btn.textContent = originalText;
                return;
            }

            const roomData = snap.data();
            if (roomData.gameActive || roomData.ended) {
                $("join-error").textContent = "Game already started or ended!";
                btn.disabled = false;
                btn.textContent = originalText;
                return;
            }

            state.roomId = code;
            state.isHost = false;
            if (!state.myPlayerId) {
                state.myPlayerId = Date.now().toString() + Math.random().toString(36).substring(2, 5);
            }

            const isAlreadyInTeamA = roomData.teams[0].players.some(p => p.id === state.myPlayerId);
            const isAlreadyInTeamB = roomData.teams[1].players.some(p => p.id === state.myPlayerId);

            if (isAlreadyInTeamA || isAlreadyInTeamB) {
                finalizeJoinUI(code);
                return;
            }

            const playerName = $("join-player-name").value.trim() || "Player";
            const teamId = $("join-team").value;

            const playerObj = createPlayerObject(playerName, state.myPlayerId, roomData.initialStocks, roomData.initialWorth);

            const updatedTeams = roomData.teams;
            if (teamId === 'a') updatedTeams[0].players.push(playerObj);
            else updatedTeams[1].players.push(playerObj);

            await updateDoc(docRef, { teams: updatedTeams, lastUpdateTime: Date.now() });

            listenToRoom(code);
            finalizeJoinUI(code);
        } catch (err) {
            console.error("Join error:", err);
            $("join-error").textContent = "Failed to join.";
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }

    function finalizeJoinUI(code) {
        dom.join.hidden = true;
        dom.waitingRoom.hidden = false;
        $("waiting-room-code-display").innerHTML = `Room Code: <strong>${code}</strong>`;
    }

    function createPlayerObject(name, id, initialStocks, initialWorth) {
        const initialCash = initialWorth * 2;
        return {
            id,
            name,
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
            // ── Per-player question stream ──
            currentQuestion: null,
            questionNumber: 0,
            lastFeedback: null,
        };
    }

    // ── FIREBASE LISTENER ─────────────────────────────────────────────────────
    function listenToRoom(code) {
        onSnapshot(doc(db, "rooms", code), (docSnapshot) => {
            if (docSnapshot.exists()) {
                const data = docSnapshot.data();
                const wasActive = state.gameActive;

                // Merge remote state into local
                Object.assign(state, data);
                recalcTeamWorths();

                // ── Transition: game just started ──
                if (!wasActive && state.gameActive) {
                    dom.waitingRoom.hidden = true;
                    dom.arena.hidden = false;
                    startCountdown();
                    const myTeamId = state.teams[0].players.some(p => p.id === state.myPlayerId) ? "a" : "b";
                    joinTeamVoice(state.roomId, myTeamId, state.myPlayerId);
                }

                // ── Game ended ──
                if (state.ended) {
                    endGameLocal();
                    return;
                }

                // ── Update UI ──
                if (!dom.waitingRoom.hidden) {
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
                } else if (!dom.arena.hidden) {
                    renderArena();
                }
            }
        });
    }

    function renderWaitingRoom() {
        const teamA = $("lobby-team-a");
        const teamB = $("lobby-team-b");
        teamA.innerHTML = state.teams[0].players.map(p => `<div class="game-roster-row"><span class="game-roster-name">${escapeHtml(p.name)}</span></div>`).join("");
        teamB.innerHTML = state.teams[1].players.map(p => `<div class="game-roster-row"><span class="game-roster-name">${escapeHtml(p.name)}</span></div>`).join("");
    }

    // ── GAME START ────────────────────────────────────────────────────────────
    async function startGame() {
        if (!state.isHost) return;
        if (state.teams[0].players.length === 0 || state.teams[1].players.length === 0) {
            alert("Both teams need at least 1 player to start!");
            return;
        }

        // Generate a unique question for EACH player
        state.teams.forEach(team => {
            team.players.forEach(player => {
                player.currentQuestion = generateQuestion();
                player.questionNumber = 1;
                player.lastFeedback = null;
            });
        });

        state.gameStartTime = Date.now();

        await updateDoc(doc(db, "rooms", state.roomId), {
            gameActive: true,
            ended: false,
            stockWorth: state.stockWorth,
            worthHistory: state.worthHistory,
            totalBuys: 0,
            totalSells: 0,
            teams: state.teams,
            gameStartTime: state.gameStartTime,
            lastUpdateTime: Date.now()
        });
    }

    async function updateRoomState() {
        await updateDoc(doc(db, "rooms", state.roomId), {
            gameActive: state.gameActive,
            ended: state.ended,
            stockWorth: state.stockWorth,
            worthHistory: state.worthHistory,
            totalBuys: state.totalBuys,
            totalSells: state.totalSells,
            teams: state.teams,
            gameStartTime: state.gameStartTime,
            lastUpdateTime: Date.now()
        });
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
     * Core trade execution — runs on the submitting client.
     * 1. Validate answer against player's own question
     * 2. Execute buy/sell/hold trade immediately
     * 3. Update stock price based on single trade pressure
     * 4. Recalculate all worths
     * 5. Generate next question for this player
     * 6. Write everything to Firestore
     */
    async function handleAnswer(e) {
        e.preventDefault();
        if (!state.gameActive || state.ended || isSubmitting) return;

        // Find my player object
        const myPlayer = findMyPlayer();
        if (!myPlayer || !myPlayer.currentQuestion) return;

        // Prevent double-submit
        isSubmitting = true;
        dom.answerInput.disabled = true;

        const inputStr = dom.answerInput.value.trim().toLowerCase();
        const regex = /^([+-]?\d+)(?:\s*([bs\+\-]))?$/i;
        const match = inputStr.match(regex);

        const submittedAnswer = match ? parseInt(match[1]) : NaN;
        const tradeAction = match ? match[2] : null;
        const correctAnswer = myPlayer.currentQuestion.answer;
        const isCorrect = submittedAnswer === correctAnswer;

        // ── Execute trade immediately ──
        if (isCorrect) {
            myPlayer.correct += 1;
            myPlayer.score += 1;

            if (tradeAction === 'b' || tradeAction === '+') {
                // BUY
                if (myPlayer.cash >= state.stockWorth) {
                    myPlayer.cash -= state.stockWorth;
                    myPlayer.stocks += 1;
                    myPlayer.trades += 1;
                    myPlayer.buys += 1;
                    state.totalBuys += 1;
                    // Buy pressure raises price
                    applyTradePressure(1);
                }
                myPlayer.lastFeedback = {
                    text: `✓ Correct! Bought 1 stock at $${state.stockWorth.toFixed(2)}`,
                    className: "game-feedback game-feedback-correct"
                };
            } else if (tradeAction === 's' || tradeAction === '-') {
                // SELL / SHORT
                myPlayer.cash += state.stockWorth;
                myPlayer.stocks -= 1;
                myPlayer.trades += 1;
                myPlayer.shorts += 1;
                state.totalSells += 1;
                // Sell pressure lowers price
                applyTradePressure(-1);
                myPlayer.lastFeedback = {
                    text: `✓ Correct! Sold 1 stock at $${state.stockWorth.toFixed(2)}`,
                    className: "game-feedback game-feedback-correct"
                };
            } else {
                // HOLD — correct answer but no trade action
                myPlayer.lastFeedback = {
                    text: `✓ Correct! Holding position.`,
                    className: "game-feedback game-feedback-correct"
                };
            }
        } else {
            // Wrong answer — penalty
            myPlayer.wrong += 1;
            const penalty = Math.round(state.initialWorth * 0.1) || 10;
            myPlayer.cash -= penalty;
            myPlayer.lastFeedback = {
                text: `✗ Wrong! Answer was ${correctAnswer}. Penalty: -$${penalty}`,
                className: "game-feedback game-feedback-wrong"
            };
        }

        // ── Generate next question for this player ──
        myPlayer.questionNumber += 1;
        myPlayer.currentQuestion = generateQuestion();

        // ── Recalculate all worths ──
        recalcTeamWorths();

        // ── Check if game time expired ──
        checkTimeExpired();

        // ── Write updated state to Firestore ──
        try {
            await updateRoomState();
        } catch (err) {
            console.error("Failed to update room state:", err);
        }

        // ── Reset input for next question ──
        dom.answerInput.value = "";
        dom.answerInput.disabled = false;
        isSubmitting = false;

        if (!state.ended) {
            setTimeout(() => dom.answerInput.focus(), 50);
        }
    }

    /**
     * Apply single-trade price pressure to the stock.
     * direction: +1 for buy, -1 for sell
     */
    function applyTradePressure(direction) {
        const volatility = 1.5 + Math.random() * 2.5;
        state.stockWorth += direction * volatility;
        state.stockWorth += (Math.random() - 0.5) * 1.5; // small drift
        if (state.stockWorth < 1) state.stockWorth = 1;
        state.stockWorth = Math.round(state.stockWorth * 100) / 100;
        state.worthHistory.push(state.stockWorth);
    }

    function recalcTeamWorths() {
        state.teams.forEach((team) => {
            let tStocks = 0, tCash = 0, tWorth = 0;
            team.players.forEach((p) => {
                p.worth = Math.round((p.cash + (p.stocks * state.stockWorth)) * 100) / 100;
                tStocks += p.stocks;
                tCash += p.cash;
                tWorth += p.worth;
            });
            team.stocks = tStocks;
            team.cash = tCash;
            team.totalWorth = Math.round(tWorth * 100) / 100;
        });
    }

    function findMyPlayer() {
        for (const team of state.teams) {
            const player = team.players.find(p => p.id === state.myPlayerId);
            if (player) return player;
        }
        return null;
    }

    // ── TIME-BASED GAME END ───────────────────────────────────────────────────

    function startCountdown() {
        clearInterval(countdownInterval);
        countdownInterval = setInterval(() => {
            if (!state.gameActive || state.ended) {
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
        if (!state.gameStartTime || !state.matchDuration) return 0;
        const elapsed = (Date.now() - state.gameStartTime) / 1000;
        return Math.max(0, state.matchDuration - elapsed);
    }

    function formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    function checkTimeExpired() {
        if (getRemainingTime() <= 0) {
            state.ended = true;
            state.gameActive = false;
        }
    }

    async function endGameByTime() {
        state.ended = true;
        state.gameActive = false;
        recalcTeamWorths();
        try {
            await updateRoomState();
        } catch (err) {
            console.error("Failed to end game:", err);
        }
    }

    // ── RENDERING ─────────────────────────────────────────────────────────────

    function renderArena() {
        const myPlayer = findMyPlayer();

        // Trades count
        if (dom.tradesDisplay) {
            dom.tradesDisplay.textContent = myPlayer ? `${myPlayer.trades}` : "0";
        }

        // Stock worth
        dom.worthDisplay.textContent = state.stockWorth.toFixed(2);

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

        dom.teamAWorth.textContent = state.teams[0].totalWorth.toFixed(2);
        dom.teamBWorth.textContent = state.teams[1].totalWorth.toFixed(2);
        dom.teamAStocks.textContent = state.teams[0].stocks;
        dom.teamBStocks.textContent = state.teams[1].stocks;
        dom.teamACash.textContent = state.teams[0].cash.toFixed(1);
        dom.teamBCash.textContent = state.teams[1].cash.toFixed(1);

        renderRoster(dom.teamARoster, state.teams[0].players);
        renderRoster(dom.teamBRoster, state.teams[1].players);

        // ── Per-player question rendering ──
        if (myPlayer && myPlayer.currentQuestion) {
            dom.questionText.textContent = myPlayer.currentQuestion.text;
            dom.answerInput.disabled = false;
            dom.answerInput.placeholder = "e.g. 7 b (buy) or 7 s (sell)";
            if (document.activeElement !== dom.answerInput && !isSubmitting) {
                // Don't steal focus if user is typing
            }
        } else {
            dom.questionText.textContent = "Waiting for game to start...";
            dom.answerInput.disabled = true;
        }

        // ── Per-player feedback ──
        if (myPlayer && myPlayer.lastFeedback) {
            dom.feedback.textContent = myPlayer.lastFeedback.text;
            dom.feedback.className = myPlayer.lastFeedback.className;
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
                    <span class="game-mono">$${p.cash.toFixed(0)}</span> cash
                    <span class="game-roster-sep">·</span>
                    <span class="game-mono">${p.stocks}</span> stk
                    <span class="game-roster-sep">·</span>
                    <span class="game-mono">$${p.worth.toFixed(1)}</span> val
                    <span class="game-roster-sep">·</span>
                    <span class="game-mono">${p.trades}</span> trades
                </span>
            </div>`;
        }).join("");
    }

    function endGameLocal() {
        clearInterval(countdownInterval);
        recalcTeamWorths();

        let mvp = null;
        let mvpWorth = -Infinity;
        state.teams.forEach((team) => {
            team.players.forEach((p) => {
                if (p.worth > mvpWorth) { mvpWorth = p.worth; mvp = p; }
            });
        });

        const winner = state.teams[0].totalWorth >= state.teams[1].totalWorth ? state.teams[0] : state.teams[1];
        const isTie = state.teams[0].totalWorth === state.teams[1].totalWorth;

        dom.arena.hidden = true;
        dom.results.hidden = false;

        dom.resultMvpName.textContent = mvp ? mvp.name : "—";
        dom.resultMvpWorth.textContent = mvp ? `Worth: ${mvp.worth.toFixed(2)}` : "";
        dom.resultWinnerName.textContent = isTie ? "TIE" : winner.name.toUpperCase();
        dom.resultWinnerWorth.textContent = isTie ? `Both: ${state.teams[0].totalWorth.toFixed(2)}` : `Worth: ${winner.totalWorth.toFixed(2)}`;

        dom.resultTeamAName.textContent = state.teams[0].name.toUpperCase();
        dom.resultTeamBName.textContent = state.teams[1].name.toUpperCase();
        dom.resultTeamAWorth.textContent = state.teams[0].totalWorth.toFixed(2);
        dom.resultTeamBWorth.textContent = state.teams[1].totalWorth.toFixed(2);

        renderResultRoster(dom.resultTeamARoster, state.teams[0].players);
        renderResultRoster(dom.resultTeamBRoster, state.teams[1].players);

        drawChart(dom.resultChart);
    }

    function renderResultRoster(container, players) {
        container.innerHTML = players.map(p => {
            const pnl = p.worth - p.initialWorth;
            const pnlColor = pnl >= 0 ? 'var(--success)' : 'var(--danger)';
            const pnlSign = pnl >= 0 ? '+' : '';
            return `<div class="game-roster-row" style="display:flex; flex-direction:column; align-items:flex-start; padding: 12px; gap: 8px;">
                <div style="width: 100%; display: flex; justify-content: space-between;">
                    <span class="game-roster-name" style="font-size:16px;">${escapeHtml(p.name)}</span>
                    <span class="game-mono" style="font-size:16px; color:${pnlColor}">${pnlSign}$${Math.abs(pnl).toFixed(2)}</span>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; width: 100%; gap: 4px; font-size: 13px; color: var(--muted);">
                    <div>Answers: <span class="game-mono" style="color:var(--text)">${p.correct}✓ ${p.wrong}✗</span></div>
                    <div>Buys/Shorts: <span class="game-mono" style="color:var(--text)">${p.buys || 0} / ${p.shorts || 0}</span></div>
                    <div>Cash: <span class="game-mono" style="color:var(--text)">$${p.cash.toFixed(1)}</span></div>
                    <div>Stocks: <span class="game-mono" style="color:var(--text)">${p.stocks}</span></div>
                    <div>Total Trades: <span class="game-mono" style="color:var(--text)">${p.trades}</span></div>
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
        const data = state.worthHistory;
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
