/* Trading IQ Battle — full frontend room + game engine */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const STORAGE_KEY = "trading-iq-rooms-v3";
const ROOM_STATE_KEY = "trading-iq-current-room-v3";
const CHANNEL_NAME = "trading-iq-battle-v3";
const clientId = crypto.randomUUID();

const ui = {
  mode: "single",
  roomCode: "",
  myTeam: "A",
  isHost: false,
  phase: "lobby", // lobby | waiting | playing | finished
  room: null,
  timerHandle: null,
  questionHandle: null,
  startedAt: 0,
};

const state = {
  settings: {
    teamAName: "Alpha",
    teamBName: "Beta",
    playerName: "Player 1",
    stocksPerTeam: 10,
    initialWorth: 1000,
    totalRounds: 10,
  },
  room: null,
  game: null,
};

const els = {
  modeCards: $$(".game-mode-card"),
  modeLabel: $("#mode-label"),
  lobbyStatus: $("#lobby-status"),
  roomHelp: $("#room-help"),
  roomCode: $("#room-code"),
  roomNameA: $("#room-name-a"),
  roomNameB: $("#room-name-b"),
  playerName: $("#player-name"),
  stockCount: $("#stock-count"),
  initialWorth: $("#initial-worth"),
  totalRounds: $("#total-rounds"),
  createRoomBtn: $("#create-room-btn"),
  joinRoomBtn: $("#join-room-btn"),
  startMatchBtn: $("#start-match-btn"),
  backLobbyBtn: $("#back-lobby-btn"),
  waitingScreen: $("#waiting-screen"),
  modeScreen: $("#mode-screen"),
  arenaScreen: $("#arena-screen"),
  resultsScreen: $("#results-screen"),
  waitingTitle: $("#waiting-title"),
  waitingChip: $("#waiting-chip"),
  activeRoomCode: $("#active-room-code"),
  activeRoomMode: $("#active-room-mode"),
  joinedList: $("#joined-list"),
  waitingNote: $("#waiting-note"),
  arenaRoomCode: $("#arena-room-code"),
  arenaRound: $("#arena-round"),
  arenaTimer: $("#arena-timer"),
  arenaPrice: $("#arena-price"),
  arenaTurn: $("#arena-turn"),
  teamAName: $("#team-a-name"),
  teamBName: $("#team-b-name"),
  teamAWorth: $("#team-a-worth"),
  teamBWorth: $("#team-b-worth"),
  teamAStocks: $("#team-a-stocks"),
  teamBStocks: $("#team-b-stocks"),
  teamARoster: $("#team-a-roster"),
  teamBRoster: $("#team-b-roster"),
  questionText: $("#question-text"),
  questionTime: $("#question-time"),
  answerInput: $("#answer-input"),
  submitAnswerBtn: $("#submit-answer-btn"),
  feedback: $("#feedback"),
  canvas: $("#market-chart"),
  resultsTitle: $("#results-title"),
  resultsSub: $("#results-sub"),
  mvpName: $("#mvp-name"),
  mvpWorth: $("#mvp-worth"),
  winnerTeam: $("#winner-team"),
  winnerWorth: $("#winner-worth"),
  resTeamAName: $("#res-team-a-name"),
  resTeamBName: $("#res-team-b-name"),
  resTeamAWins: $("#res-team-a-wins"),
  resTeamBWins: $("#res-team-b-wins"),
  resTeamADetail: $("#res-team-a-detail"),
  resTeamBDetail: $("#res-team-b-detail"),
  newMatchBtn: $("#new-match-btn"),
  returnLobbyBtn: $("#return-lobby-btn"),
};

const bc = "BroadcastChannel" in window ? new BroadcastChannel(CHANNEL_NAME) : null;

function readRooms() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeRooms(rooms) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms));
  if (bc) bc.postMessage({ type: "rooms-updated" });
}

function saveCurrentRoom(code) {
  localStorage.setItem(ROOM_STATE_KEY, code);
}

function getCurrentRoom() {
  return localStorage.getItem(ROOM_STATE_KEY) || "";
}

function genRoomCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const n = Math.floor(Math.random() * 900) + 100;
  const prefix = letters[Math.floor(Math.random() * letters.length)] + letters[Math.floor(Math.random() * letters.length)];
  return `${prefix}${n}`;
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function nowIso() {
  return new Date().toISOString();
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function initPlayer(name, team) {
  return {
    id: crypto.randomUUID(),
    name: name.trim() || `Player ${team}`,
    team,
    stocks: 0,
    worth: 0,
    score: 0,
    correct: 0,
    bonus: 0,
  };
}

function generateQuestion() {
  const a = Math.floor(Math.random() * 900) + 100;
  const b = Math.floor(Math.random() * 900) + 100;
  const add = Math.random() > 0.5;

  if (add) {
    return { text: `${a} + ${b}`, answer: a + b, type: "add" };
  }

  const big = Math.max(a, b);
  const small = Math.min(a, b);
  return { text: `${big} - ${small}`, answer: big - small, type: "sub" };
}

function computeTeamWorth(team, marketPrice) {
  return round2(team.stocks * marketPrice);
}

function buildInitialGame(room) {
  const { settings } = room;
  const teamA = {
    key: "A",
    name: settings.teamAName,
    players: [initPlayer(settings.playerName || "Player 1", "A")],
    stocks: settings.stocksPerTeam,
    score: 0,
    worth: round2(settings.stocksPerTeam * settings.initialWorth),
  };

  const teamB = {
    key: "B",
    name: settings.teamBName,
    players: [initPlayer(room.mode === "single" ? "Market Bot" : "Player 2", "B")],
    stocks: settings.stocksPerTeam,
    score: 0,
    worth: round2(settings.stocksPerTeam * settings.initialWorth),
  };

  return {
    phase: room.mode === "single" ? "playing" : "waiting",
    roomCode: room.code,
    mode: room.mode,
    hostId: room.hostId,
    myTeam: room.myTeam,
    totalRounds: settings.totalRounds,
    round: 1,
    turnTeam: "A",
    currentPlayerIndex: 0,
    timerMs: 12000,
    questionStartedAt: Date.now(),
    marketPrice: settings.initialWorth,
    chart: [settings.initialWorth],
    question: generateQuestion(),
    lastMessage: "Match ready.",
    teams: { A: teamA, B: teamB },
    winner: null,
    mvp: null,
  };
}

function loadRoom(code) {
  const rooms = readRooms();
  return rooms[code] || null;
}

function saveRoom(room) {
  const rooms = readRooms();
  rooms[room.code] = room;
  writeRooms(rooms);
}

function setLobbyMode(mode) {
  ui.mode = mode;
  els.modeCards.forEach((card) => card.classList.toggle("active", card.dataset.mode === mode));
  els.modeLabel.textContent = mode === "single" ? "Single Player" : "Multiplayer Room";
  els.roomHelp.textContent =
    mode === "single"
      ? "Single player starts immediately against the market bot."
      : "Create a room, share the code, and wait here until the second trader joins.";
  els.lobbyStatus.textContent = mode === "single" ? "Solo ready" : "Room mode";
  els.joinRoomBtn.disabled = mode !== "multi";
  els.roomCode.disabled = mode === "single";
}

function syncInputsToSettings() {
  state.settings.teamAName = els.roomNameA.value.trim() || "Alpha";
  state.settings.teamBName = els.roomNameB.value.trim() || "Beta";
  state.settings.playerName = els.playerName.value.trim() || "Player 1";
  state.settings.stocksPerTeam = clamp(Number(els.stockCount.value) || 10, 1, 99);
  state.settings.initialWorth = clamp(Number(els.initialWorth.value) || 1000, 100, 999999);
  state.settings.totalRounds = clamp(Number(els.totalRounds.value) || 10, 1, 50);
}

function showPhase(phase) {
  ui.phase = phase;
  els.modeScreen.hidden = phase !== "lobby";
  els.waitingScreen.hidden = phase !== "waiting";
  els.arenaScreen.hidden = phase !== "playing";
  els.resultsScreen.hidden = phase !== "finished";
}

function renderRoomSummary(room) {
  els.activeRoomCode.textContent = room.code;
  els.activeRoomMode.textContent = room.mode === "single" ? "Single player" : "Multiplayer room";
  els.waitingTitle.textContent = room.mode === "single" ? "Solo match" : "Waiting for opponent";
  els.waitingChip.textContent = room.mode === "single" ? "Solo" : room.phase === "waiting" ? "Waiting" : "Ready";
  els.waitingNote.textContent =
    room.mode === "single"
      ? "The match starts instantly with an AI opponent. No room code needed."
      : room.statusText || "The host stays here until another trader joins the room.";
}

function renderJoinedList(room) {
  const items = [];
  const hostName = room.settings.playerName || "Player 1";
  items.push({
    side: "Team A",
    name: hostName,
    role: room.hostId === clientId ? "You / Host" : "Host",
    status: room.participants?.A ? "Connected" : "Waiting",
  });

  if (room.mode === "single") {
    items.push({
      side: "Team B",
      name: "Market Bot",
      role: "AI",
      status: "Ready",
    });
  } else {
    const guest = room.participants?.B;
    items.push({
      side: "Team B",
      name: guest?.name || "Waiting for trader",
      role: guest ? "Joined" : "Open slot",
      status: guest ? "Connected" : "Waiting",
    });
  }

  els.joinedList.innerHTML = items
    .map(
      (item) => `
      <div class="game-join-row">
        <div>
          <strong>${item.side}</strong>
          <div class="game-join-name">${item.name}</div>
        </div>
        <div class="game-join-meta">
          <span>${item.role}</span>
          <span>${item.status}</span>
        </div>
      </div>
    `
    )
    .join("");
}

function updateWaitingUI(room) {
  renderRoomSummary(room);
  renderJoinedList(room);
  const ready = room.mode === "single" || (room.participants?.A && room.participants?.B);
  els.startMatchBtn.disabled = !ready || room.hostId !== clientId;
  els.startMatchBtn.textContent =
    room.mode === "single" ? "Start solo match" : ready ? "Start match" : "Waiting for opponent";
}

function activateWaiting(room) {
  state.room = clone(room);
  showPhase("waiting");
  renderWaiting();
}

function renderWaiting() {
  const room = state.room;
  if (!room) return;
  updateWaitingUI(room);
}

function renderGame() {
  const game = state.room?.game;
  if (!game) return;

  els.arenaRoomCode.textContent = game.roomCode;
  els.arenaRound.textContent = `${game.round} / ${game.totalRounds}`;
  els.arenaPrice.textContent = round2(game.marketPrice).toFixed(2);
  els.arenaTurn.textContent = game.turnTeam === "A" ? `${game.teams.A.name} turn` : `${game.teams.B.name} turn`;

  els.teamAName.textContent = game.teams.A.name.toUpperCase();
  els.teamBName.textContent = game.teams.B.name.toUpperCase();
  els.teamAWorth.textContent = round2(game.teams.A.worth).toFixed(2);
  els.teamBWorth.textContent = round2(game.teams.B.worth).toFixed(2);
  els.teamAStocks.textContent = game.teams.A.stocks;
  els.teamBStocks.textContent = game.teams.B.stocks;
  els.questionText.textContent = game.question?.text || "—";
  els.questionTime.textContent = `${Math.max(0, game.timerMs / 1000).toFixed(1)}s`;

  const currentTeam = game.turnTeam === "A" ? game.teams.A : game.teams.B;
  const currentPlayer = currentTeam.players[game.currentPlayerIndex % currentTeam.players.length];
  const canAnswer = state.room.mode === "single"
    ? game.turnTeam === "A"
    : game.turnTeam === game.myTeam;

  els.feedback.textContent = canAnswer
    ? `Current player: ${currentPlayer.name}`
    : game.mode === "single"
      ? "The bot is thinking..."
      : "Waiting for the other side.";

  els.answerInput.disabled = !canAnswer || game.phase !== "playing";
  els.submitAnswerBtn.disabled = !canAnswer || game.phase !== "playing";

  els.teamARoster.innerHTML = game.teams.A.players
    .map((p, idx) => rosterRow(p, game.turnTeam === "A" && idx === game.currentPlayerIndex))
    .join("");
  els.teamBRoster.innerHTML = game.teams.B.players
    .map((p, idx) => rosterRow(p, game.turnTeam === "B" && idx === game.currentPlayerIndex))
    .join("");

  drawChart(game.chart, game.marketPrice);
}

function rosterRow(player, active) {
  return `
    <div class="game-roster-row ${active ? "game-roster-active" : ""}">
      <span class="game-roster-name">${escapeHtml(player.name)}</span>
      <span class="game-roster-stats">${player.stocks} stk · ${round2(player.worth).toFixed(1)} val</span>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[m]);
}

function drawChart(points, currentPrice) {
  const canvas = els.canvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;

  const box = canvas.parentElement.getBoundingClientRect();
  const w = Math.max(320, Math.floor(box.width));
  const h = Math.max(320, Math.floor(box.height));

  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;

  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, w, h);

  const pad = 26;
  const min = Math.min(...points, currentPrice);
  const max = Math.max(...points, currentPrice);
  const spread = Math.max(1, max - min);
  const top = max + spread * 0.12;
  const bottom = min - spread * 0.12;

  const xFor = (i) => pad + (i * (w - pad * 2)) / Math.max(1, points.length - 1);
  const yFor = (v) => h - pad - ((v - bottom) * (h - pad * 2)) / Math.max(1, top - bottom);

  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const y = pad + ((h - pad * 2) * i) / 3;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(w - pad, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "#d8b15b";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = xFor(i);
    const y = yFor(p);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  const lastX = xFor(points.length - 1);
  const lastY = yFor(points[points.length - 1]);
  ctx.fillStyle = "#d8b15b";
  ctx.beginPath();
  ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(148,163,184,0.95)";
  ctx.font = "12px JetBrains Mono, monospace";
  ctx.fillText(points[0].toFixed(1), 10, 18);
}

function setFeedback(text, kind = "") {
  els.feedback.textContent = text;
  els.feedback.className = `game-feedback ${kind ? `game-feedback-${kind}` : ""}`;
}

function createRoom(mode) {
  syncInputsToSettings();

  const code = mode === "single" ? "SOLO" : (els.roomCode.value.trim().toUpperCase() || genRoomCode());
  const room = {
    code,
    mode,
    hostId: clientId,
    participants: {
      A: { id: clientId, name: state.settings.playerName, joinedAt: nowIso() },
      B: mode === "single" ? { id: "bot", name: "Market Bot", joinedAt: nowIso() } : null,
    },
    settings: clone(state.settings),
    statusText: mode === "single" ? "Solo match ready" : "Waiting for opponent...",
    phase: mode === "single" ? "playing" : "waiting",
    game: mode === "single" ? buildInitialGame({
      code,
      mode,
      hostId: clientId,
      myTeam: "A",
      settings: clone(state.settings),
    }) : null,
    myTeam: "A",
  };

  if (mode === "single") {
    room.game.phase = "playing";
    room.game.myTeam = "A";
  }

  saveRoom(room);
  saveCurrentRoom(code);
  state.room = clone(room);

  ui.roomCode = code;
  ui.isHost = true;
  ui.myTeam = "A";

  if (mode === "single") {
    showPhase("playing");
    setFeedback("Solo match started.", "correct");
    startGameLoop();
  } else {
    showPhase("waiting");
    renderWaiting();
  }
}

function joinRoom() {
  syncInputsToSettings();
  const code = (els.roomCode.value.trim() || "").toUpperCase();
  if (!code) {
    setFeedback("Enter a room code first.", "wrong");
    return;
  }

  const room = loadRoom(code);
  if (!room) {
    setFeedback("Room not found.", "wrong");
    return;
  }

  if (room.mode !== "multi") {
    setFeedback("That room is a solo match.", "wrong");
    return;
  }

  if (!room.participants.B) {
    room.participants.B = { id: clientId, name: state.settings.playerName, joinedAt: nowIso() };
    room.statusText = "Opponent joined.";
    room.myTeam = "B";
  } else if (room.participants.B.id !== clientId) {
    setFeedback("Room already has two sides.", "wrong");
    return;
  }

  room.settings.teamAName = room.settings.teamAName || state.settings.teamAName;
  room.settings.teamBName = room.settings.teamBName || state.settings.teamBName;
  room.statusText = "Ready for host to start.";
  saveRoom(room);
  saveCurrentRoom(code);
  state.room = clone(room);

  ui.roomCode = code;
  ui.isHost = false;
  ui.myTeam = "B";

  showPhase("waiting");
  renderWaiting();
}

function startMatchFromLobby() {
  const room = state.room || loadRoom(getCurrentRoom());
  if (!room) return;

  const ready = room.mode === "single" || (room.participants?.A && room.participants?.B);
  if (!ready) {
    setFeedback("Need a second player in multiplayer mode.", "wrong");
    return;
  }

  room.game = buildInitialGame({
    code: room.code,
    mode: room.mode,
    hostId: room.hostId,
    myTeam: ui.myTeam || "A",
    settings: room.settings,
  });

  room.game.phase = "playing";
  room.phase = "playing";
  room.statusText = "Match live.";
  saveRoom(room);
  state.room = clone(room);

  showPhase("playing");
  startGameLoop();
}

function startGameLoop() {
  clearInterval(ui.timerHandle);
  clearTimeout(ui.questionHandle);

  const tick = () => {
    const room = loadRoom(ui.roomCode || state.room?.code || getCurrentRoom());
    if (!room?.game) return;

    if (room.game.phase !== "playing") {
      state.room = clone(room);
      renderGame();
      return;
    }

    const elapsed = Date.now() - room.game.questionStartedAt;
    room.game.timerMs = Math.max(0, 12000 - elapsed);

    if (room.game.timerMs <= 0) {
      applyRoundResult(room, { correct: false, bonus: false, timedOut: true, answer: null });
      return;
    }

    room.game.phase = "playing";
    saveRoom(room);
    state.room = clone(room);
    renderGame();

    if (room.mode === "single" && room.game.turnTeam === "B") {
      scheduleBotTurn(room.code);
    }
  };

  ui.timerHandle = setInterval(tick, 120);
  tick();
}

function scheduleBotTurn(roomCode) {
  clearTimeout(ui.questionHandle);
  ui.questionHandle = setTimeout(() => {
    const room = loadRoom(roomCode);
    if (!room?.game || room.game.phase !== "playing" || room.game.turnTeam !== "B") return;
    const q = room.game.question;
    const botKnows = Math.random() < 0.7;
    const botAnswer = botKnows ? q.answer : q.answer + (Math.random() < 0.5 ? 1 : -1);
    applyRoundResult(room, {
      correct: botAnswer === q.answer,
      bonus: botKnows && Math.random() < 0.35,
      timedOut: false,
      answer: botAnswer,
    });
  }, 700);
}

function submitAnswer() {
  const room = loadRoom(getCurrentRoom());
  if (!room?.game || room.game.phase !== "playing") return;

  if (room.mode === "single" && room.game.turnTeam !== "A") return;
  if (room.mode === "multi" && room.game.turnTeam !== ui.myTeam) return;

  const value = Number(els.answerInput.value);
  if (!Number.isFinite(value)) {
    setFeedback("Enter a valid number.", "wrong");
    return;
  }

  const elapsed = Date.now() - room.game.questionStartedAt;
  const bonus = elapsed <= 3000;
  applyRoundResult(room, {
    correct: value === room.game.question.answer,
    bonus,
    timedOut: false,
    answer: value,
  });
}

function applyRoundResult(room, result) {
  const game = room.game;
  if (!game || game.phase !== "playing") return;

  const activeTeam = game.turnTeam === "A" ? game.teams.A : game.teams.B;
  const otherTeam = game.turnTeam === "A" ? game.teams.B : game.teams.A;
  const activePlayer = activeTeam.players[game.currentPlayerIndex % activeTeam.players.length];

  if (result.correct) {
    if (otherTeam.stocks > 0) {
      activeTeam.stocks += 1;
      otherTeam.stocks -= 1;
    }

    activeTeam.score += result.bonus ? 3 : 1;
    activePlayer.score += result.bonus ? 3 : 1;
    activePlayer.correct += 1;
    if (result.bonus) activePlayer.bonus += 1;

    game.marketPrice = round2(game.marketPrice * (result.bonus ? 1.018 : 1.008));
    game.lastMessage = result.bonus ? "Correct with bonus." : "Correct trade.";
    setFeedback(result.bonus ? "Correct — bonus move!" : "Correct — stock transferred.", result.bonus ? "bonus" : "correct");
  } else {
    game.marketPrice = round2(Math.max(100, game.marketPrice * 0.993));
    game.lastMessage = result.timedOut ? "Timed out." : "Wrong answer.";
    setFeedback(result.timedOut ? "Time expired — missed trade." : "Wrong answer — no transfer.", "wrong");
  }

  game.marketPrice = Math.max(100, game.marketPrice);
  game.chart.push(game.marketPrice);

  activeTeam.worth = computeTeamWorth(activeTeam, game.marketPrice);
  otherTeam.worth = computeTeamWorth(otherTeam, game.marketPrice);

  activePlayer.worth = round2(activeTeam.worth / Math.max(1, activeTeam.players.length));

  const reachedEnd = game.round >= game.totalRounds || activeTeam.stocks <= 0 || otherTeam.stocks <= 0;

  if (reachedEnd) {
    finishMatch(room);
    return;
  }

  game.turnTeam = game.turnTeam === "A" ? "B" : "A";
  game.currentPlayerIndex = (game.currentPlayerIndex + 1) % (game.turnTeam === "A" ? game.teams.A.players.length : game.teams.B.players.length);
  game.round += 1;
  game.question = generateQuestion();
  game.questionStartedAt = Date.now();
  game.timerMs = 12000;
  room.phase = "playing";

  saveRoom(room);
  state.room = clone(room);
  renderGame();

  if (room.mode === "single" && game.turnTeam === "B") {
    scheduleBotTurn(room.code);
  }
}

function finishMatch(room) {
  const game = room.game;
  if (!game) return;

  game.phase = "finished";

  const allPlayers = [...game.teams.A.players, ...game.teams.B.players];
  let mvp = allPlayers[0];
  for (const p of allPlayers) {
    if ((p.worth || 0) > (mvp.worth || 0)) mvp = p;
  }

  const teamAWorth = computeTeamWorth(game.teams.A, game.marketPrice);
  const teamBWorth = computeTeamWorth(game.teams.B, game.marketPrice);

  game.teams.A.worth = teamAWorth;
  game.teams.B.worth = teamBWorth;
  game.winner = teamAWorth === teamBWorth ? "Draw" : teamAWorth > teamBWorth ? game.teams.A.name : game.teams.B.name;
  game.mvp = mvp;

  room.phase = "finished";
  room.statusText = "Match complete.";
  saveRoom(room);
  state.room = clone(room);
  renderResults();
}

function renderResults() {
  const game = state.room?.game;
  if (!game) return;

  showPhase("finished");
  els.resultsTitle.textContent = game.winner === "Draw" ? "Draw match" : `${game.winner} wins`;
  els.resultsSub.textContent = `Final market price: ${round2(game.marketPrice).toFixed(2)} · Rounds played: ${game.round - 1}`;

  els.mvpName.textContent = game.mvp?.name || "—";
  els.mvpWorth.textContent = `${round2(game.mvp?.worth || 0).toFixed(2)} value`;
  els.winnerTeam.textContent = game.winner || "—";
  els.winnerWorth.textContent = game.winner === "Draw"
    ? "Both teams ended equal."
    : `${game.winner} led the book.`;

  els.resTeamAName.textContent = game.teams.A.name;
  els.resTeamBName.textContent = game.teams.B.name;
  els.resTeamAWins.textContent = `Worth ${round2(game.teams.A.worth).toFixed(2)}`;
  els.resTeamBWins.textContent = `Worth ${round2(game.teams.B.worth).toFixed(2)}`;

  els.resTeamADetail.innerHTML = `
    <div class="game-result-line">Stocks: ${game.teams.A.stocks}</div>
    <div class="game-result-line">Score: ${game.teams.A.score}</div>
    <div class="game-result-line">Players: ${game.teams.A.players.map((p) => escapeHtml(p.name)).join(", ")}</div>
  `;

  els.resTeamBDetail.innerHTML = `
    <div class="game-result-line">Stocks: ${game.teams.B.stocks}</div>
    <div class="game-result-line">Score: ${game.teams.B.score}</div>
    <div class="game-result-line">Players: ${game.teams.B.players.map((p) => escapeHtml(p.name)).join(", ")}</div>
  `;
}

function resetToLobby() {
  clearInterval(ui.timerHandle);
  clearTimeout(ui.questionHandle);

  ui.roomCode = "";
  ui.isHost = false;
  ui.myTeam = "A";
  state.room = null;
  saveCurrentRoom("");
  showPhase("lobby");
  els.feedback.textContent = "";
  els.answerInput.value = "";
}

function restoreCurrentRoom() {
  const code = getCurrentRoom();
  if (!code) return;

  const room = loadRoom(code);
  if (!room) return;

  state.room = clone(room);
  ui.roomCode = code;
  ui.isHost = room.hostId === clientId;
  ui.myTeam = room.myTeam || "A";

  if (room.phase === "playing" && room.game) {
    showPhase("playing");
    renderGame();
    startGameLoop();
    return;
  }

  if (room.phase === "waiting") {
    showPhase("waiting");
    renderWaiting();
    return;
  }

  if (room.phase === "finished") {
    renderResults();
  }
}

function refreshCurrentRoomFromStorage() {
  const code = ui.roomCode || getCurrentRoom();
  if (!code) return;
  const room = loadRoom(code);
  if (!room) return;
  state.room = clone(room);

  if (room.phase === "waiting") {
    showPhase("waiting");
    renderWaiting();
  } else if (room.phase === "playing") {
    showPhase("playing");
    renderGame();
  } else if (room.phase === "finished") {
    renderResults();
  }
}

function bindEvents() {
  els.modeCards.forEach((card) => {
    card.addEventListener("click", () => setLobbyMode(card.dataset.mode));
  });

  ["input", "change"].forEach((evt) => {
    [els.roomNameA, els.roomNameB, els.playerName, els.stockCount, els.initialWorth, els.totalRounds].forEach((el) => {
      el.addEventListener(evt, syncInputsToSettings);
    });
  });

  els.createRoomBtn.addEventListener("click", () => createRoom(ui.mode));
  els.joinRoomBtn.addEventListener("click", joinRoom);
  els.startMatchBtn.addEventListener("click", startMatchFromLobby);
  els.backLobbyBtn.addEventListener("click", resetToLobby);
  els.newMatchBtn.addEventListener("click", resetToLobby);
  els.returnLobbyBtn.addEventListener("click", resetToLobby);
  els.submitAnswerBtn.addEventListener("click", submitAnswer);
  els.answerInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitAnswer();
  });

  window.addEventListener("resize", () => {
    if (state.room?.game && ui.phase === "playing") renderGame();
  });

  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY || e.key === ROOM_STATE_KEY) {
      refreshCurrentRoomFromStorage();
    }
  });

  if (bc) {
    bc.onmessage = () => refreshCurrentRoomFromStorage();
  }
}

function init() {
  syncInputsToSettings();
  setLobbyMode("single");
  bindEvents();
  restoreCurrentRoom();
  if (ui.phase === "lobby") {
    showPhase("lobby");
  }
}

init();
