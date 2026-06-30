import json

with open("frontend/game.js", "r") as f:
    content = f.read()

# 1. startGame() modification
old_start = """      .update({
        phase: "playing",
        match: {
          gameStartTime: Date.now(),
          stockWorth: initialWorth,
          worthHistory: [initialWorth],"""
new_start = """      .update({
        phase: "ready_check",
        match_settings: {
          ...roomData.match_settings,
          ready_players: {}
        },
        match: {
          gameStartTime: 0,
          stockWorth: initialWorth,
          worthHistory: [initialWorth],"""
if old_start in content:
    content = content.replace(old_start, new_start)
    print("1. startGame replaced")
else:
    print("WARNING: startGame old string not found")

# 2. handleData() new phase
old_handle = """    if (roomData.phase === "waiting") {
      renderWaitingRoom();
    } else if (roomData.phase === "playing") {
      if (state.phase !== "playing") {
        state.phase = "playing";
        startCountdown();
        $("waiting-room-screen").hidden = true;
        $("game-screen").hidden = false;
        $("post-game-screen").hidden = true;
      }
      renderArena();"""

new_handle = """    if (roomData.phase === "waiting") {
      renderWaitingRoom();
    } else if (roomData.phase === "ready_check") {
      state.phase = "ready_check";
      renderReadyCheck();
      
      const readyPlayers = roomData.match_settings?.ready_players || {};
      const totalPlayers = roomData.match?.players?.length || 0;
      if (totalPlayers > 0 && Object.keys(readyPlayers).length >= totalPlayers) {
        if (state.isHost) {
          supabase.from("rooms").update({
            phase: "playing",
            "match.gameStartTime": Date.now(),
            last_update_time: Date.now()
          }).eq("id", state.roomId).then();
        }
      }
    } else if (roomData.phase === "playing") {
      if (state.phase !== "playing") {
        state.phase = "playing";
        startCountdown();
        $("waiting-room-screen").hidden = true;
        $("game-screen").hidden = false;
        $("post-game-screen").hidden = true;
        
        let splash = document.getElementById("start-splash");
        if (splash) splash.remove();
        if (dom.answerInput) {
            dom.answerInput.disabled = false;
            dom.answerInput.placeholder = "e.g. 150 b (buy) or 150 s (sell)";
            dom.answerInput.focus();
        }
      }
      renderArena();"""
if old_handle in content:
    content = content.replace(old_handle, new_handle)
    print("2. handleData replaced")
else:
    print("WARNING: handleData old string not found")

# 3. startCountdown() remove renderSplash
old_countdown = """      const remaining = getRemainingTime();
      if (dom.countdownDisplay) {
        dom.countdownDisplay.textContent = formatTime(remaining);
      }
      renderSplash();
      if (remaining <= 0) {"""
new_countdown = """      const remaining = getRemainingTime();
      if (dom.countdownDisplay) {
        dom.countdownDisplay.textContent = formatTime(remaining);
      }
      if (remaining <= 0) {"""
if old_countdown in content:
    content = content.replace(old_countdown, new_countdown)
    print("3. startCountdown replaced")
else:
    print("WARNING: startCountdown old string not found")

with open("frontend/game.js", "w") as f:
    f.write(content)

