/* Trading IQ Battle — simultaneous real-time room game
   Works across tabs on the same browser using localStorage + BroadcastChannel.
   Replace the sync layer with Firebase later for true internet multiplayer. */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const KEYS = {
  rooms: "tiq_rooms_v6",
  me: "tiq_me_v6",
  activeRoom: "tiq_active_room_v6",
  activeMode: "tiq_active_mode_v6",
};

const CHANNEL_NAME = "tiq_battle_v6";
const bc = "BroadcastChannel" in window ? new BroadcastChannel(CHANNEL_NAME) : null;
const me = getOrCreateMe();

const state = {
  mode: "single",
  roomCode: "",
  team: "A",
  room: null,
  phase: "lobby",
  lastQuestionId: "",
  botTimer: null,
  tickTimer: null,
};

const els = {
  modeCards: $$(".game-mode-card"),
  lobbyStatusChip: $("#lobby-status-chip"),
  modeLabel: $("#mode-label"),
  lobbyStatus: $("#lobby-status"),
  roomHelp: $("#room-help"),
  playerName: $("#player-name"),
  teamChoice: $("#team-choice"),
  roomNameA: $("#room-name-a"),
  roomNameB: $("#room-name-b"),
  stockCount: $("#stock-count"),
  initialPrice: $("#initial-price"),
  questionSeconds: $("#question-seconds"),
  matchSeconds: $("#match-seconds"),
  roomCode: $("#room-code"),
  createRoomBtn: $("#create-room-btn"),
  joinRoomBtn: $("#join-room-btn"),
  copyCodeBtn: $("#copy-code-btn"),

  modeScreen: $("#mode-screen"),
  waitingScreen: $("#waiting-screen"),
  arenaScreen: $("#arena-screen"),
  resultsScreen: $("#results-screen"),

  waitingTitle: $("#waiting-title"),
  waitingChip: $("#waiting-chip"),
  waitingRoomCode: $("#waiting-room-code"),
  waitingRoomMode: $("#waiting-room-mode"),
  waitingNote: $("#waiting-note"),
  waitingTeamAName: $("#waiting-team-a-name"),
  waitingTeamBName: $("#waiting-team-b-name"),
  waitingTeamACount: $("#waiting-team-a-count"),
  waitingTeamBCount: $("#waiting-team-b-count"),
  waitingTeamAList: $("#waiting-team-a-list"),
  waitingTeamBList: $("#waiting-team-b-list"),
  startMatchBtn: $("#start-match-btn"),
  backLobbyBtn: $("#back-lobby-btn"),

  arenaRoomCode: $("#arena-room-code"),
  arenaMatchTimer: $("#arena-match-timer"),
  arenaQuestionTimer: $("#arena-question-timer"),
  arenaPrice: $("#arena-price"),
  arenaNet: $("#arena-net"),
  teamAName: $("#team-a-name"),
  teamBName: $("#team-b-name"),
  teamAWorth: $("#team-a-worth"),
  teamBWorth: $("#team-b-worth"),
  teamAStocks: $("#team-a-stocks"),
  teamBStocks: $("#team-b-stocks"),
  teamAFlow: $("#team-a-flow"),
  teamBFlow: $("#team-b-flow"),
  teamARoster: $("#team-a-roster"),
  teamBRoster: $("#team-b-roster"),
  questionText: $("#question-text"),
  answerInput: $("#answer-input"),
  submitAnswerBtn: $("#submit-answer-btn"),
  marketNote: $("#market-note"),
  feedback: $("#feedback"),
  canvas: $("#market-chart"),

  resultsTitle: $("#results-title"),
  resultsSub: $("#results-sub"),
  mvpName: $("#mvp-name"),
  mvpWorth: $("#mvp-worth"),
  winnerTeam: $("#winner-team"),
  winnerWorth: $("#winner-worth"),
  resTeamAName: $("#res-team-a-name"),
  resTeamAWorth: $("#res-team-a-worth"),
  resTeamADetail: $("#res-team-a-detail"),
  resTeamBName: $("#res-team-b-name"),
  resTeamBWorth: $("#res-team-b-worth"),
  resTeamBDetail: $("#res-team-b-detail"),
  newMatchBtn: $("#new-match-btn"),
  returnLobbyBtn: $("#return-lobby-btn"),
};

function getOrCreateMe() {
  let id = localStorage.getItem(KEYS.me);
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    localStorage.setItem(KEYS.me, id);
  }
  return id;
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function loadRooms() {
  try {
    return JSON.parse(localStorage.getItem(KEYS.rooms) || "{}");
  } catch {
    return {};
  }
}

function saveRooms(rooms) {
  localStorage.setItem(KEYS.rooms, JSON.stringify(rooms));
  if (bc) bc.postMessage({ type: "rooms-updated" });
}

function loadRoom(code) {
  const rooms = loadRooms();
  return rooms[code] ? clone(rooms[code]) : null;
}

function saveRoom(room) {
  const rooms = loadRooms();
  rooms[room.code] = room;
  saveRooms(rooms);
}

function getActiveRoomCode() {
  return localStorage.getItem(KEYS.activeRoom) || "";
}

function setActiveRoomCode(code) {
  localStorage.setItem(KEYS.activeRoom, code || "");
}

function setActiveMode(mode) {
  localStorage.setItem(KEYS.activeMode, mode);
}

function getActiveMode() {
  return localStorage.getItem(KEYS.activeMode) || "single";
}

function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[m]);
}

function syncSettings() {
  return {
    playerName: (els.playerName.value || "Player 1").trim(),
    team: els.teamChoice.value,
    teamAName: (els.roomNameA.value || "Alpha").trim(),
    teamBName: (els.roomNameB.value || "Beta").trim(),
    stocksPerTeam: clamp(Number(els.stockCount.value) || 10, 1, 99),
    initialPrice: clamp(Number(els.initialPrice.value) || 1000, 100, 999999),
    questionSeconds: clamp(Number(els.questionSeconds.value) || 12, 5, 30),
    matchSeconds: clamp(Number(els.matchSeconds.value) || 60, 30, 600),
  };
}

function question() {
  const a = randInt(100, 999);
  const b = randInt(100, 999);
  if (Math.random() > 0.5) {
    return { id: uid(), text: `${a} + ${b}`, answer: a + b, createdAt: Date.now() };
  }
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return { id: uid(), text: `${hi} - ${lo}`, answer: hi - lo, createdAt: Date.now() };
}

function makePlayer({ id, name, team, bot = false }) {
  return {
    id,
    name,
    team,
    bot,
    score: 0,
    correct: 0,
    wrong: 0,
    bonus: 0,
    worth: 1000,
    joinedAt: Date.now(),
  };
}

function makeTeam(name, stocks) {
  return {
    name,
    stocks,
    buys: 0,
    sells: 0,
    score: 0,
    members: [],
  };
}

function createGame(settings) {
  const q = question();
  const now = Date.now();
  return {
    price: settings.initialPrice,
    priceHistory: [settings.initialPrice],
    startedAt: now,
    endsAt: now + settings.matchSeconds * 1000,
    question: q,
    questionEndsAt: now + settings.questionSeconds * 1000,
    questionIndex: 1,
    submissions: {},
    lastEvent: "Match started.",
  };
}

function initRoom(mode, settings, code) {
  const hostName = settings.playerName || "Player 1";
  const hostTeam = settings.team || "A";
  const botTeam = hostTeam === "A" ? "B" : "A";

  const room = {
    code,
    mode,
    hostId: me,
    phase: mode === "single" ? "playing" : "waiting",
    settings,
    players: {},
    teams: {
      A: makeTeam(settings.teamAName, settings.stocksPerTeam),
      B: makeTeam(settings.teamBName, settings.stocksPerTeam),
    },
    game: null,
  };

  addPlayer(room, {
    id: me,
    name: hostName,
    team: hostTeam,
  });

  if (mode === "single") {
    addPlayer(room, {
      id: "bot",
      name: "Market Bot",
      team: botTeam,
      bot: true,
    });
    room.game = createGame(settings);
  }

  return room;
}

function addPlayer(room, playerData) {
  const existing = room.players[playerData.id];
  const player = existing || makePlayer(playerData);
  player.name = playerData.name;
  player.team = playerData.team;
  player.bot = !!playerData.bot;

  room.players[player.id] = player;

  ["A", "B"].forEach((key) => {
    room.teams[key].members = room.teams[key].members.filter((id) => id !== player.id);
  });
  room.teams[player.team].members.push(player.id);

  return player;
}

function roomReady(room) {
  return room.mode === "single" || (room.teams.A.members.length > 0 && room.teams.B.members.length > 0);
}

function createRoomCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  return `${letters[randInt(0, letters.length - 1)]}${letters[randInt(0, letters.length - 1)]}${randInt(100, 999)}`;
}

function setScreen(phase) {
  state.phase = phase;
  els.modeScreen.hidden = phase !== "lobby";
  els.waitingScreen.hidden = phase !== "waiting";
  els.arenaScreen.hidden = phase !== "playing";
  els.resultsScreen.hidden = phase !== "finished";
}

function setFeedback(text, kind = "") {
  els.feedback.className = `game-feedback ${kind ? `game-feedback-${kind}` : ""}`;
  els.feedback.textContent = text;
}

function setLobbyMode(mode) {
  state.mode = mode;
  setActiveMode(mode);
  els.modeCards.forEach((card) => card.classList.toggle("active", card.dataset.mode === mode));
  els.modeLabel.textContent = mode === "single" ? "Single Player" : "Multiplayer Room";
  els.lobbyStatus.textContent = mode === "single" ? "Solo ready" : "Room mode";
  els.lobbyStatusChip.textContent = mode === "single" ? "Solo" : "Room";
  els.roomHelp.textContent =
    mode === "single"
      ? "Single player starts immediately against the built-in market bot."
      : "Create a room, share the code, and wait for the second trader to join.";
  els.joinRoomBtn.disabled = mode === "single";
  els.roomCode.disabled = mode === "single";
}

function renderWaiting(room) {
  els.waitingRoomCode.textContent = room.code;
  els.waitingRoomMode.textContent = room.mode === "single" ? "Single player" : "Multiplayer room";
  els.waitingTitle.textContent = room.mode === "single" ? "Solo match" : "Waiting for opponent";

  els.waitingTeamAName.textContent = room.teams.A.name;
  els.waitingTeamBName.textContent = room.teams.B.name;

  els.waitingTeamACount.textContent = `${room.teams.A.members.length} player${room.teams.A.members.length === 1 ? "" : "s"}`;
  els.waitingTeamBCount.textContent = `${room.teams.B.members.length} player${room.teams.B.members.length === 1 ? "" : "s"}`;

  els.waitingTeamAList.innerHTML = room.teams.A.members.map((id) => rosterLine(room.players[id], false, true)).join("") || `<div class="game-empty-mini">No players yet</div>`;
  els.waitingTeamBList.innerHTML = room.teams.B.members.map((id) => rosterLine(room.players[id], false, true)).join("") || `<div class="game-empty-mini">No players yet</div>`;

  const ready = roomReady(room);
  const host = room.hostId === me;

  els.waitingChip.textContent = room.mode === "single" ? "Solo" : ready ? "Ready" : "Waiting";
  els.waitingNote.textContent =
    room.mode === "single"
      ? "The match starts instantly in solo mode."
      : ready
        ? "Both sides are present. The host can start the match."
        : "The host stays here until the other side joins the room.";

  els.startMatchBtn.disabled = !(host && ready);
  els.startMatchBtn.textContent = room.mode === "single" ? "Start solo match" : host ? (ready ? "Start match" : "Waiting for opponent") : "Host starts the match";
}

function rosterLine(player, active = false, compact = false) {
  if (!player) return "";
  return `
    <div class="game-roster-row ${active ? "game-roster-active" : ""} ${compact ? "game-roster-compact" : ""}">
      <span class="game-roster-name">${escapeHtml(player.name)}${player.bot ? " · Bot" : ""}</span>
      <span class="game-roster-stats">${player.correct}✓ ${player.wrong}✕ · ${round2(player.worth).toFixed(0)}</span>
    </div>
  `;
}

function teamWorth(room, key) {
  const team = room.teams[key];
  return round2(team.stocks * room.game.price + team.score * 10);
}

function playerWorth(player) {
  return round2(player.worth);
}

function netPressure(room) {
  const a = room.teams.A.buys - room.teams.A.sells;
  const b = room.teams.B.buys - room.teams.B.sells;
  return a - b;
}

function drawChart(points) {
  const canvas = els.canvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(320, Math.floor(rect.width));
  const h = Math.max(320, Math.floor(rect.height));

  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const pad = 24;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const spread = Math.max(1, max - min);
  const top = max + spread * 0.15;
  const bottom = min - spread * 0.15;

  const xFor = (i) => pad + (i * (w - pad * 2)) / Math.max(1, points.length - 1);
  const yFor = (v) => h - pad - ((v - bottom) * (h - pad * 2)) / Math.max(1, top - bottom);

  ctx.strokeStyle = "rgba(255,255,255,0.07)";
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

  const x = xFor(points.length - 1);
  const y = yFor(points[points.length - 1]);
  ctx.fillStyle = "#d8b15b";
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fill();
}

function renderArena(room) {
  const g = room.game;
  const mePlayer = room.players[me];
  const canAnswer = room.phase === "playing" && mePlayer && Date.now() < g.questionEndsAt && !g.submissions[mePlayer.id];

  els.arenaRoomCode.textContent = room.code;
  els.arenaMatchTimer.textContent = `${Math.max(0, (g.endsAt - Date.now()) / 1000).toFixed(1)}s`;
  els.arenaQuestionTimer.textContent = `${Math.max(0, (g.questionEndsAt - Date.now()) / 1000).toFixed(1)}s`;
  els.arenaPrice.textContent = round2(g.price).toFixed(2);
  els.arenaNet.textContent = `${netPressure(room) > 0 ? "+" : ""}${netPressure(room)}`;

  els.teamAName.textContent = room.teams.A.name.toUpperCase();
  els.teamBName.textContent = room.teams.B.name.toUpperCase();

  const worthA = teamWorth(room, "A");
  const worthB = teamWorth(room, "B");

  els.teamAWorth.textContent = worthA.toFixed(2);
  els.teamBWorth.textContent = worthB.toFixed(2);
  els.teamAStocks.textContent = room.teams.A.stocks;
  els.teamBStocks.textContent = room.teams.B.stocks;
  els.teamAFlow.textContent = `${room.teams.A.buys} / ${room.teams.A.sells}`;
  els.teamBFlow.textContent = `${room.teams.B.buys} / ${room.teams.B.sells}`;

  els.teamARoster.innerHTML = room.teams.A.members.map((id) => rosterLine(room.players[id])).join("") || `<div class="game-empty-mini">No players yet</div>`;
  els.teamBRoster.innerHTML = room.teams.B.members.map((id) => rosterLine(room.players[id])).join("") || `<div class="game-empty-mini">No players yet</div>`;

  els.questionText.textContent = g.question.text;
  els.marketNote.textContent = g.lastEvent || "All players are trading now.";

  if (canAnswer) {
    els.answerInput.disabled = false;
    els.submitAnswerBtn.disabled = false;
  } else {
    els.answerInput.disabled = true;
    els.submitAnswerBtn.disabled = true;
  }

  const already = mePlayer ? g.submissions[mePlayer.id] : null;
  if (already && room.phase === "playing") {
    setFeedback("You already answered this question.", "correct");
  } else if (canAnswer) {
    setFeedback("Answer fast to push your side’s price.", "");
  } else if (room.phase === "playing") {
    setFeedback("Waiting for the next question window.", "");
  }

  drawChart(g.priceHistory);

  if (room.mode === "single" && g.question.id !== state.lastQuestionId) {
    state.lastQuestionId = g.question.id;
    scheduleBot(room.code, g.question.id);
  }
}

function renderResults(room) {
  const g = room.game;
  const finalA = teamWorth(room, "A");
  const finalB = teamWorth(room, "B");

  const allPlayers = Object.values(room.players);
  const mvp = allPlayers.sort((a, b) => playerWorth(b) - playerWorth(a))[0];

  els.resultsTitle.textContent = finalA === finalB ? "Draw match" : `${finalA > finalB ? room.teams.A.name : room.teams.B.name} wins`;
  els.resultsSub.textContent = `Final price: ${round2(g.price).toFixed(2)} · Match ended after ${room.settings.matchSeconds}s`;
  els.mvpName.textContent = mvp?.name || "—";
  els.mvpWorth.textContent = `${playerWorth(mvp).toFixed(2)} worth`;
  els.winnerTeam.textContent = finalA === finalB ? "Draw" : finalA > finalB ? room.teams.A.name : room.teams.B.name;
  els.winnerWorth.textContent = finalA === finalB ? "Both sides ended equal." : `Team worth decided by live price and stock flow.`;

  els.resTeamAName.textContent = room.teams.A.name;
  els.resTeamAWorth.textContent = `${finalA.toFixed(2)} worth`;
  els.resTeamADetail.innerHTML = teamResultBlock(room, "A");

  els.resTeamBName.textContent = room.teams.B.name;
  els.resTeamBWorth.textContent = `${finalB.toFixed(2)} worth`;
  els.resTeamBDetail.innerHTML = teamResultBlock(room, "B");
}

function teamResultBlock(room, key) {
  const team = room.teams[key];
  const players = team.members.map((id) => room.players[id]).filter(Boolean);
  return `
    <div class="game-result-line">Stocks: ${team.stocks}</div>
    <div class="game-result-line">Buys / Sells: ${team.buys} / ${team.sells}</div>
    <div class="game-result-line">Players: ${players.map((p) => escapeHtml(p.name)).join(", ") || "—"}</div>
    <div class="game-result-line">Team score: ${team.score}</div>
  `;
}

function render(room) {
  state.room = room ? clone(room) : null;
  if (!room) {
    setScreen("lobby");
    return;
  }

  if (room.phase === "waiting") {
    setScreen("waiting");
    renderWaiting(room);
  } else if (room.phase === "playing") {
    setScreen("playing");
    renderArena(room);
  } else if (room.phase === "finished") {
    setScreen("finished");
    renderResults(room);
  }
}

function createMatch(mode) {
  const settings = syncSettings();
  const code = mode === "single" ? "SOLO" : (els.roomCode.value.trim().toUpperCase() || createRoomCode());
  const room = initRoom(mode, settings, code);
  saveRoom(room);
  setActiveRoomCode(code);
  state.roomCode = code;
  render(room);
  if (mode === "single") {
    startTick();
  } else {
    stopTick();
    setScreen("waiting");
    renderWaiting(room);
  }
}

function joinMatch() {
  const settings = syncSettings();
  const code = els.roomCode.value.trim().toUpperCase();
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

  if (room.phase === "playing") {
    setFeedback("That match already started.", "wrong");
    return;
  }

  addPlayer(room, {
    id: me,
    name: settings.playerName,
    team: settings.team,
  });

  room.settings.playerName = settings.playerName;
  room.settings.teamAName = settings.teamAName;
  room.settings.teamBName = settings.teamBName;
  room.settings.stocksPerTeam = settings.stocksPerTeam;
  room.settings.initialPrice = settings.initialPrice;
  room.settings.questionSeconds = settings.questionSeconds;
  room.settings.matchSeconds = settings.matchSeconds;
  room.phase = "waiting";

  saveRoom(room);
  setActiveRoomCode(room.code);
  state.roomCode = room.code;
  setFeedback("Joined room. Waiting for the host.", "correct");
  render(room);
  startTick();
}

function startMatch() {
  const room = loadRoom(state.roomCode || getActiveRoomCode());
  if (!room) return;
  if (room.hostId !== me) return;
  if (!roomReady(room)) {
    setFeedback("Need at least one player on both sides.", "wrong");
    return;
  }

  room.game = createGame(room.settings);
  room.phase = "playing";
  room.game.lastEvent = "Match live.";
  saveRoom(room);
  render(room);
  startTick();
}

function endMatch(room) {
  room.phase = "finished";
  saveRoom(room);
  render(room);
  stopTick();
}

function nextQuestion(room) {
  const now = Date.now();
  if (now >= room.game.endsAt) {
    endMatch(room);
    return;
  }
  room.game.question = question();
  room.game.questionEndsAt = now + room.settings.questionSeconds * 1000;
  room.game.questionIndex += 1;
  room.game.submissions = {};
  room.game.lastEvent = "New question window opened.";
  saveRoom(room);
  render(room);
  if (room.mode === "single") {
    scheduleBot(room.code, room.game.question.id);
  }
}

function applyAnswer(room, playerId, rawAnswer) {
  if (!room || room.phase !== "playing") return;
  const g = room.game;
  const player = room.players[playerId];
  if (!player) return;

  if (Date.now() >= g.endsAt) {
    endMatch(room);
    return;
  }

  if (g.submissions[playerId] === g.question.id) return;
  if (Date.now() >= g.questionEndsAt) return;

  const answer = Number(rawAnswer);
  if (!Number.isFinite(answer)) return;

  const correct = answer === g.question.answer;
  const elapsed = Date.now() - g.question.createdAt;
  const bonus = correct && elapsed <= 3000;
  const team = room.teams[player.team];

  g.submissions[playerId] = g.question.id;

  if (correct) {
    team.buys += 1 + (bonus ? 1 : 0);
    team.stocks += 1;
    team.score += bonus ? 3 : 1;

    player.correct += 1;
    player.score += bonus ? 3 : 1;
    player.bonus += bonus ? 1 : 0;
    player.worth += bonus ? 60 : 25;

    g.price *= bonus ? 1.018 : 1.009;
    g.lastEvent = `${player.name} hit ${bonus ? "bonus" : "correct"} on ${g.question.text}.`;
    setFeedback(bonus ? "Correct — bonus move!" : "Correct — stock bought.", bonus ? "bonus" : "correct");
  } else {
    team.sells += 1;
    team.stocks = Math.max(0, team.stocks - 1);
    team.score -= 1;

    player.wrong += 1;
    player.score -= 1;
    player.worth -= 10;

    g.price *= 0.992;
    g.lastEvent = `${player.name} missed ${g.question.text}.`;
    setFeedback("Wrong — sell pressure added.", "wrong");
  }

  g.price = Math.max(100, round2(g.price));
  g.priceHistory.push(g.price);

  saveRoom(room);
  render(room);
}

function scheduleBot(roomCode, questionId) {
  clearTimeout(state.botTimer);
  state.botTimer = setTimeout(() => {
    const room = loadRoom(roomCode);
    if (!room || room.phase !== "playing" || room.mode !== "single") return;
    if (!room.game || room.game.question.id !== questionId) return;

    const bot = Object.values(room.players).find((p) => p.bot);
    if (!bot) return;

    const q = room.game.question;
    const correct = Math.random() < 0.72;
    const answer = correct
      ? q.answer
      : q.answer + (Math.random() < 0.5 ? 1 : -1);

    applyAnswer(room, bot.id, answer);
  }, 600 + Math.random() * 2500);
}

function startTick() {
  if (state.tickTimer) return;
  state.tickTimer = setInterval(() => {
    const code = state.roomCode || getActiveRoomCode();
    if (!code) return;

    const room = loadRoom(code);
    if (!room) return;

    if (room.phase === "playing") {
      if (room.hostId === me && Date.now() >= room.game.endsAt) {
        endMatch(room);
        return;
      }
      if (room.hostId === me && Date.now() >= room.game.questionEndsAt) {
        nextQuestion(room);
        return;
      }
      render(room);
    } else if (room.phase === "waiting") {
      render(room);
    } else if (room.phase === "finished") {
      render(room);
    }
  }, 120);
}

function stopTick() {
  if (state.tickTimer) {
    clearInterval(state.tickTimer);
    state.tickTimer = null;
  }
}

function restore() {
  const code = getActiveRoomCode();
  const mode = getActiveMode();
  setLobbyMode(mode);

  if (!code) {
    setScreen("lobby");
    return;
  }

  const room = loadRoom(code);
  if (!room) {
    setActiveRoomCode("");
    setScreen("lobby");
    return;
  }

  state.roomCode = code;
  render(room);
  startTick();
}

function copyRoomCode() {
  const code = els.roomCode.value.trim().toUpperCase() || state.roomCode || getActiveRoomCode();
  if (!code) return;
  navigator.clipboard?.writeText(code);
  els.roomHelp.textContent = `Room code copied: ${code}`;
}

function backToLobby() {
  setActiveRoomCode("");
  state.roomCode = "";
  state.lastQuestionId = "";
  state.room = null;
  stopTick();
  clearTimeout(state.botTimer);
  setScreen("lobby");
}

function bindEvents() {
  els.modeCards.forEach((card) => {
    card.addEventListener("click", () => setLobbyMode(card.dataset.mode));
  });

  [
    els.playerName,
    els.roomNameA,
    els.roomNameB,
    els.stockCount,
    els.initialPrice,
    els.questionSeconds,
    els.matchSeconds,
    els.teamChoice,
  ].forEach((el) => el.addEventListener("input", syncSettings));

  els.createRoomBtn.addEventListener("click", () => {
    const mode = state.mode;
    createMatch(mode);
  });

  els.joinRoomBtn.addEventListener("click", joinMatch);
  els.copyCodeBtn.addEventListener("click", copyRoomCode);
  els.startMatchBtn.addEventListener("click", startMatch);

  els.backLobbyBtn.addEventListener("click", backToLobby);
  els.newMatchBtn.addEventListener("click", backToLobby);
  els.returnLobbyBtn.addEventListener("click", backToLobby);

  els.submitAnswerBtn.addEventListener("click", () => {
    const room = loadRoom(state.roomCode || getActiveRoomCode());
    if (!room || room.phase !== "playing") return;
    const player = room.players[me];
    if (!player) return;
    if (room.game.submissions[player.id] === room.game.question.id) return;

    applyAnswer(room, player.id, els.answerInput.value);
    els.answerInput.value = "";
    els.answerInput.focus();
  });

  els.answerInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      els.submitAnswerBtn.click();
    }
  });

  window.addEventListener("resize", () => {
    if (state.room && state.room.phase === "playing") render(state.room);
  });

  window.addEventListener("storage", (e) => {
    if (e.key === KEYS.rooms || e.key === KEYS.activeRoom) {
      restore();
    }
  });

  if (bc) {
    bc.onmessage = () => restore();
  }
}

function init() {
  setLobbyMode(getActiveMode());
  bindEvents();
  syncSettings();
  restore();
}

init();
