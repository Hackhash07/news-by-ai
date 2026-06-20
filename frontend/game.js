import { db } from './firebase.js';
import { doc, setDoc, onSnapshot, updateDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

/* ═══════════════════════════════════════════════════════════════════════════════
   TRADING IQ BATTLE — game.js (MULTIPLAYER REFACTOR)
   Complete game engine: firebase sync, question generation, stock market simulation,
   dynamic canvas chart, winner calculation.
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
        totalRounds: 10,
        currentRound: 1,
        turnIndex: 0,
        turnOrder: [],
        turnsPerRound: 0,
        totalTurnsPlayed: 0,
        worthHistory: [],
        roundBuys: 0,
        roundSells: 0,
        currentQuestion: null,
        questionStartTime: 0,
        lastFeedback: null,
    };

    let timerInterval = null;

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

        dom.roundDisplay  = $("game-round");
        dom.worthDisplay  = $("game-stock-worth");
        dom.currentPlayer = $("game-current-player");
        dom.timerDisplay  = $("game-timer");

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
        dom.questionTimer = $("game-question-timer");
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
        const totalRounds = clamp(parseInt($("total-rounds").value) || 10, 3, 30);
        
        const playerName = $("host-player-name").value.trim() || "Host";
        const teamId = $("host-team").value;
        
        const playerObj = createPlayerObject(playerName, state.myPlayerId, initialStocks, initialWorth);
        
        state.initialStocks = initialStocks;
        state.initialWorth = initialWorth;
        state.totalRounds = totalRounds;
        state.stockWorth = initialWorth;
        state.worthHistory = [initialWorth];
        
        if (teamId === 'a') state.teams[0].players.push(playerObj);
        else state.teams[1].players.push(playerObj);
        
        recalcTeamWorths();
        
        await setDoc(doc(db, "rooms", code), {
            gameActive: false,
            ended: false,
            currentRound: 1,
            totalRounds,
            stockWorth: initialWorth,
            initialStocks,
            initialWorth,
            turnIndex: 0,
            totalTurnsPlayed: 0,
            worthHistory: [initialWorth],
            roundBuys: 0,
            roundSells: 0,
            teams: state.teams,
            turnOrder: [],
            turnsPerRound: 0,
            currentQuestion: null,
            questionStartTime: 0,
            lastFeedback: null,
            lastUpdateTime: Date.now()
        });
        
        listenToRoom(code);
        
        dom.setup.hidden = true;
        dom.waitingRoom.hidden = false;
        $("waiting-room-code-display").innerHTML = `Room Code: <strong>${code}</strong>`;
        $("start-game-btn").hidden = false;
    }

    async function joinRoom() {
        const code = $("join-room-code").value.toUpperCase().trim();
        if (!code) return;
        
        const docRef = doc(db, "rooms", code);
        const snap = await getDoc(docRef);
        if (!snap.exists()) {
            $("join-error").textContent = "Room not found!";
            return;
        }
        
        const roomData = snap.data();
        if (roomData.gameActive || roomData.ended) {
            $("join-error").textContent = "Game already started or ended!";
            return;
        }
        
        state.roomId = code;
        state.isHost = false;
        state.myPlayerId = Date.now().toString() + Math.random().toString(36).substring(2, 5);
        
        const playerName = $("join-player-name").value.trim() || "Player";
        const teamId = $("join-team").value;
        
        const playerObj = createPlayerObject(playerName, state.myPlayerId, roomData.initialStocks, roomData.initialWorth);
        
        const updatedTeams = roomData.teams;
        if (teamId === 'a') updatedTeams[0].players.push(playerObj);
        else updatedTeams[1].players.push(playerObj);
        
        await updateDoc(docRef, { teams: updatedTeams, lastUpdateTime: Date.now() });
        
        listenToRoom(code);
        
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
            initialWorth: initialCash + (initialStocks * initialWorth)
        };
    }

    function listenToRoom(code) {
        onSnapshot(doc(db, "rooms", code), (docSnapshot) => {
            if (docSnapshot.exists()) {
                const data = docSnapshot.data();
                const wasActive = state.gameActive;
                
                Object.assign(state, data);
                recalcTeamWorths();
                
                if (!wasActive && state.gameActive) {
                    dom.waitingRoom.hidden = true;
                    dom.arena.hidden = false;
                    startLocalTimer();
                }
                
                if (state.ended) {
                    endGameLocal();
                    return;
                }
                
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
                    
                    if (state.lastFeedback) {
                        dom.feedback.textContent = state.lastFeedback.text;
                        dom.feedback.className = state.lastFeedback.className;
                    }

                    if (state.currentQuestion) {
                        dom.questionText.textContent = state.currentQuestion.text;
                        const turn = getCurrentTurn();
                        const isMyTurn = turn && state.teams[turn.teamIdx].players[turn.playerIdx].id === state.myPlayerId;
                        
                        dom.answerInput.disabled = !isMyTurn;
                        if (isMyTurn) {
                            dom.answerInput.placeholder = "e.g. 150 b (buy) or 150 s (short)";
                            if (document.activeElement !== dom.answerInput) {
                                setTimeout(() => dom.answerInput.focus(), 50);
                            }
                        } else {
                            const pName = state.teams[turn.teamIdx].players[turn.playerIdx].name;
                            dom.answerInput.placeholder = `Waiting for ${pName}...`;
                            dom.answerInput.value = "";
                        }
                    }
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

    async function startGame() {
        if (!state.isHost) return;
        if (state.teams[0].players.length === 0 || state.teams[1].players.length === 0) {
            alert("Both teams need at least 1 player to start!");
            return;
        }

        buildTurnOrder();
        state.gameActive = true;
        state.currentQuestion = generateQuestion();
        state.questionStartTime = Date.now();
        state.lastFeedback = null;
        
        await updateRoomState();
    }

    async function updateRoomState() {
        await updateDoc(doc(db, "rooms", state.roomId), {
            gameActive: state.gameActive,
            ended: state.ended,
            currentRound: state.currentRound,
            stockWorth: state.stockWorth,
            turnIndex: state.turnIndex,
            totalTurnsPlayed: state.totalTurnsPlayed,
            worthHistory: state.worthHistory,
            roundBuys: state.roundBuys,
            roundSells: state.roundSells,
            teams: state.teams,
            turnOrder: state.turnOrder,
            turnsPerRound: state.turnsPerRound,
            currentQuestion: state.currentQuestion,
            questionStartTime: state.questionStartTime,
            lastFeedback: state.lastFeedback,
            lastUpdateTime: Date.now()
        });
    }

    // ── GAMEPLAY LOGIC ────────────────────────────────────────────────────────
    function buildTurnOrder() {
        const maxLen = Math.max(state.teams[0].players.length, state.teams[1].players.length);
        const order = [];
        for (let i = 0; i < maxLen; i++) {
            if (i < state.teams[0].players.length) order.push({ teamIdx: 0, playerIdx: i });
            if (i < state.teams[1].players.length) order.push({ teamIdx: 1, playerIdx: i });
        }
        state.turnOrder = order;
        state.turnsPerRound = order.length;
    }

    function getCurrentTurn() {
        if (!state.turnOrder || state.turnOrder.length === 0) return null;
        const idx = state.turnIndex % state.turnOrder.length;
        return state.turnOrder[idx];
    }

    function generateQuestion() {
        const ops = ["+", "-"];
        const op = ops[Math.floor(Math.random() * ops.length)];
        let a, b, answer;

        if (op === "+") {
            a = randInt(100, 999);
            b = randInt(100, 999);
            answer = a + b;
        } else {
            a = randInt(200, 999);
            b = randInt(100, a - 1);
            answer = a - b;
        }

        return { text: `${a} ${op} ${b}`, answer: answer };
    }

    function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

    function updateStockWorth() {
        const volatility = 2 + Math.random() * 3;
        const netPressure = state.roundBuys - state.roundSells;
        state.stockWorth += netPressure * volatility;
        state.stockWorth += (Math.random() - 0.5) * 2; // drift
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

    async function handleAnswer(e) {
        e.preventDefault();
        if (!state.gameActive || !state.currentQuestion) return;

        const turn = getCurrentTurn();
        const currentPlayer = state.teams[turn.teamIdx].players[turn.playerIdx];
        if (currentPlayer.id !== state.myPlayerId) return; // Only active player processes

        const inputStr = dom.answerInput.value.trim().toLowerCase();
        dom.answerInput.disabled = true;
        
        const regex = /^([+-]?\d+)(?:\s*([bs\+\-]))?$/i;
        const match = inputStr.match(regex);
        
        let userAnswer = null;
        let action = null;
        
        if (match) {
            userAnswer = parseInt(match[1]);
            action = match[2];
        } else {
            // fallback if weird format, treat as wrong
            userAnswer = NaN;
        }

        const correctAnswer = state.currentQuestion.answer;
        const isCorrect = userAnswer === correctAnswer;
        const elapsed = (Date.now() - state.questionStartTime) / 1000;

        let feedbackText = "";
        let feedbackClass = "";

        if (isCorrect) {
            currentPlayer.correct += 1;
            currentPlayer.score += 1;
            
            if (action === 'b' || action === '+') {
                if (currentPlayer.cash >= state.stockWorth) {
                    currentPlayer.cash -= state.stockWorth;
                    currentPlayer.stocks += 1;
                    currentPlayer.trades += 1;
                    currentPlayer.buys += 1;
                    state.roundBuys += 1;
                    feedbackText = `✓ CORRECT — BOUGHT 1 STOCK`;
                    feedbackClass = "game-feedback game-feedback-correct";
                } else {
                    feedbackText = `✓ CORRECT — (FAILED TO BUY: NOT ENOUGH CASH)`;
                    feedbackClass = "game-feedback game-feedback-bonus";
                }
            } else if (action === 's' || action === '-') {
                currentPlayer.cash += state.stockWorth;
                currentPlayer.stocks -= 1;
                currentPlayer.trades += 1;
                currentPlayer.shorts += 1;
                state.roundSells += 1;
                feedbackText = `✓ CORRECT — SHORTED/SOLD 1 STOCK`;
                feedbackClass = "game-feedback game-feedback-correct";
            } else {
                feedbackText = `✓ CORRECT — (NO TRADE EXECUTED)`;
                feedbackClass = "game-feedback game-feedback-correct";
            }
        } else {
            currentPlayer.wrong += 1;
            const penalty = Math.round(state.initialWorth * 0.1) || 10;
            currentPlayer.cash -= penalty;
            feedbackText = `✗ WRONG — Penalty: -${penalty} Cash. Answer was ${correctAnswer}`;
            feedbackClass = "game-feedback game-feedback-wrong";
        }

        state.lastFeedback = { text: feedbackText, className: feedbackClass };
        
        updateStockWorth();
        state.roundBuys = 0;
        state.roundSells = 0;

        state.turnIndex++;
        state.totalTurnsPlayed++;

        if (state.totalTurnsPlayed > 0 && state.totalTurnsPlayed % state.turnsPerRound === 0) {
            state.currentRound++;
        }

        if (state.currentRound > state.totalRounds) {
            state.ended = true;
            state.gameActive = false;
        }

        recalcTeamWorths();
        
        // Wait brief moment before next question to allow reading feedback
        setTimeout(async () => {
            if (state.gameActive && !state.ended) {
                state.currentQuestion = generateQuestion();
                state.questionStartTime = Date.now();
                state.lastFeedback = null;
            }
            await updateRoomState();
        }, 1500);
        
        // Push intermediate state so everyone sees the feedback immediately
        await updateRoomState();
    }

    // ── RENDERING ─────────────────────────────────────────────────────────────
    function startLocalTimer() {
        clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            if (state.questionStartTime > 0 && !state.ended) {
                const elapsed = ((Date.now() - state.questionStartTime) / 1000).toFixed(1);
                dom.timerDisplay.textContent = `${elapsed}s`;
                if (dom.questionTimer) dom.questionTimer.textContent = `${elapsed}s`;
            }
        }, 100);
    }

    function renderArena() {
        dom.roundDisplay.textContent = `${state.currentRound} / ${state.totalRounds}`;
        dom.worthDisplay.textContent = state.stockWorth.toFixed(2);

        const turn = getCurrentTurn();
        if (turn) {
            const player = state.teams[turn.teamIdx].players[turn.playerIdx];
            const teamName = state.teams[turn.teamIdx].name;
            dom.currentPlayer.textContent = `${player.name} (${teamName})`;
            dom.currentPlayer.className = `game-status-value ${turn.teamIdx === 0 ? "game-color-a" : "game-color-b"}`;
        }

        dom.teamADisplay.textContent = state.teams[0].name.toUpperCase();
        dom.teamBDisplay.textContent = state.teams[1].name.toUpperCase();
        
        dom.teamAWorth.textContent = state.teams[0].totalWorth.toFixed(2);
        dom.teamBWorth.textContent = state.teams[1].totalWorth.toFixed(2);
        dom.teamAStocks.textContent = state.teams[0].stocks;
        dom.teamBStocks.textContent = state.teams[1].stocks;
        dom.teamACash.textContent = state.teams[0].cash.toFixed(1);
        dom.teamBCash.textContent = state.teams[1].cash.toFixed(1);

        renderRoster(dom.teamARoster, state.teams[0].players, 0);
        renderRoster(dom.teamBRoster, state.teams[1].players, 1);

        drawChart(dom.chartCanvas);
    }

    function renderRoster(container, players, teamIdx) {
        const turn = getCurrentTurn();
        container.innerHTML = players.map((p, i) => {
            const isActive = state.gameActive && turn && turn.teamIdx === teamIdx && turn.playerIdx === i;
            return `<div class="game-roster-row ${isActive ? 'game-roster-active' : ''}">
                <span class="game-roster-name">${escapeHtml(p.name)}</span>
                <span class="game-roster-stats">
                    <span class="game-mono">${p.cash.toFixed(0)}</span> cash
                    <span class="game-roster-sep">·</span>
                    <span class="game-mono">${p.stocks}</span> stk
                    <span class="game-roster-sep">·</span>
                    <span class="game-mono">${p.worth.toFixed(1)}</span> val
                </span>
            </div>`;
        }).join("");
    }

    function endGameLocal() {
        clearInterval(timerInterval);
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
                    <span class="game-mono" style="font-size:16px; color:${pnlColor}">${pnlSign}${pnl.toFixed(2)}</span>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; width: 100%; gap: 4px; font-size: 13px; color: var(--muted);">
                    <div>Answers: <span class="game-mono" style="color:var(--text)">${p.correct}✓ ${p.wrong}✗</span></div>
                    <div>Buys/Shorts: <span class="game-mono" style="color:var(--text)">${p.buys || 0} / ${p.shorts || 0}</span></div>
                    <div>Cash: <span class="game-mono" style="color:var(--text)">${p.cash.toFixed(1)}</span></div>
                    <div>Stocks: <span class="game-mono" style="color:var(--text)">${p.stocks}</span></div>
                </div>
            </div>`;
        }).join("");
    }

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

    function escapeHtml(str) {
        if (!str) return "";
        return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
    function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

    document.addEventListener("DOMContentLoaded", initApp);
})();
