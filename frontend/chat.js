const API = {
  rooms: "/api/chat/rooms",
  messages: "/api/chat/messages",
  send: "/api/chat/messages",
};

const state = {
  profile: loadProfile(),
  rooms: [],
  currentRoom: new URLSearchParams(window.location.search).get("room") || "global",
  messages: [],
};

const refs = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheRefs();
  bindEvents();
  syncProfileToUI();
  updateClock();

  await loadRooms();
  await loadMessages();

  setInterval(loadMessages, 3000);
  setInterval(updateClock, 1000);
}

function cacheRefs() {
  refs.chatRooms = document.getElementById("chat-rooms");
  refs.chatMessages = document.getElementById("chat-messages");
  refs.chatForm = document.getElementById("chat-form");
  refs.chatInput = document.getElementById("chat-input");

  refs.chatUsername = document.getElementById("chat-username");
  refs.chatDisplayName = document.getElementById("chat-display-name");

  refs.saveProfileBtn = document.getElementById("save-profile-btn");
  refs.profileStatus = document.getElementById("profile-status");

  refs.navAvatar = document.getElementById("nav-avatar");
  refs.chatStatus = document.getElementById("chat-status");
  refs.tickerTime = document.getElementById("ticker-time");

  refs.roomTitle = document.getElementById("room-title");
  refs.roomDescription = document.getElementById("room-description");
}
function bindEvents() {
  if (refs.saveProfileBtn) {
    refs.saveProfileBtn.addEventListener("click", () => {
      saveProfileFromInputs();
      syncProfileToUI();
      if (refs.chatStatus) refs.chatStatus.textContent = "Profile saved";
    });
  }

  if (refs.chatForm) {
    refs.chatForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      await sendMessage();
    });
  }
}

function loadProfile() {
  return {
    username: localStorage.getItem("tt_username") || "Anonymous",
    display_name: localStorage.getItem("tt_display_name") || "Anonymous",
  };
}

function saveProfile(profile) {
  state.profile.username = (profile.username || "Anonymous").trim() || "Anonymous";
  state.profile.display_name = (profile.display_name || state.profile.username).trim() || state.profile.username;
  localStorage.setItem("tt_username", state.profile.username);
  localStorage.setItem("tt_display_name", state.profile.display_name);
}

function saveProfileFromInputs() {
  const username = (refs.chatUsername?.value || "").trim() || "Anonymous";
  const displayName = (refs.chatDisplayName?.value || "").trim() || username;
  saveProfile({ username, display_name: displayName });
}

function syncProfileToUI() {
  if (refs.chatUsername) refs.chatUsername.value = state.profile.username;
  if (refs.chatDisplayName) refs.chatDisplayName.value = state.profile.display_name;
  if (refs.navAvatar) refs.navAvatar.textContent = initials(state.profile.display_name || state.profile.username);
  if (refs.profileStatus) refs.profileStatus.textContent = `Signed in as ${state.profile.display_name}`;
}

async function loadRooms() {
  try {
    const response = await fetch(API.rooms, { cache: "no-store" });
    const data = await response.json();
    state.rooms = Array.isArray(data.rooms) ? data.rooms : [];

    if (!state.rooms.some((room) => room.slug === state.currentRoom)) {
      state.currentRoom = "global";
    }

    renderRooms();
    renderRoomHeader();
  } catch (error) {
    console.error(error);
  }
}

function renderRooms() {
  if (!refs.chatRooms) return;

  refs.chatRooms.innerHTML = state.rooms
    .map((room) => {
      const active = room.slug === state.currentRoom ? "active" : "";
      return `
        <button class="room-btn ${active}" data-room="${escapeHtml(room.slug)}" type="button">
          <span class="room-name">${escapeHtml(room.name)}</span>
          <span class="room-desc">${escapeHtml(room.description || "")}</span>
        </button>
      `;
    })
    .join("");

  refs.chatRooms.querySelectorAll("[data-room]").forEach((button) => {
    button.addEventListener("click", () => {
      setActiveRoom(button.dataset.room);
    });
  });
}

function setActiveRoom(roomSlug) {
  state.currentRoom = roomSlug;
  renderRooms();
  renderRoomHeader();
  loadMessages();
}

function renderRoomHeader() {
  const room = state.rooms.find((r) => r.slug === state.currentRoom) || state.rooms[0];

  if (refs.roomTitle) refs.roomTitle.textContent = room ? room.name : "Global";
  if (refs.roomDescription) refs.roomDescription.textContent = room ? room.description : "Open finance discussion for markets, macro, and trades.";
}

async function loadMessages() {
  try {
    const url = new URL(API.messages, window.location.origin);
    url.searchParams.set("room", state.currentRoom);
    url.searchParams.set("limit", "100");

    const response = await fetch(url, { cache: "no-store" });
    const data = await response.json();

    state.messages = Array.isArray(data.messages) ? data.messages : [];
    renderMessages();

    if (refs.chatStatus) {
      refs.chatStatus.textContent = `Loaded ${state.messages.length} messages in ${state.currentRoom}`;
    }
  } catch (error) {
    console.error(error);
    if (refs.chatStatus) refs.chatStatus.textContent = "Chat unavailable";
  }
}

async function sendMessage() {
  const input = refs.chatInput;
  if (!input) return;

  const message = input.value.trim();
  if (!message) return;

  saveProfileFromInputs();

  const payload = {
    room: state.currentRoom,
    username: state.profile.username,
    display_name: state.profile.display_name,
    message,
  };

  try {
    const response = await fetch(API.send, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (refs.chatStatus) refs.chatStatus.textContent = data.error || "Message rejected";
      return;
    }

    input.value = "";
    if (refs.chatStatus) refs.chatStatus.textContent = "Message sent";
    await loadMessages();
  } catch (error) {
    console.error(error);
    if (refs.chatStatus) refs.chatStatus.textContent = "Message send failed";
  }
}

function renderMessages() {
  if (!refs.chatMessages) return;

  if (!state.messages.length) {
    refs.chatMessages.innerHTML = `<div class="empty-state">No messages yet. Start the conversation.</div>`;
    return;
  }

  const myName = (state.profile.username || "Anonymous").toLowerCase();

  refs.chatMessages.innerHTML = state.messages
    .map((msg) => {
      const isMine = (msg.username || "").toLowerCase() === myName;
      return `
        <article class="chat-row ${isMine ? "mine" : ""}">
          <div class="msg-avatar">${initials(msg.display_name || msg.username || "A")}</div>
          <div class="msg-bubble">
            <div class="msg-meta">
              <strong>${escapeHtml(msg.display_name || msg.username || "Anonymous")}</strong>
              <span>${formatRelativeTime(msg.created_at)}</span>
            </div>
            <div class="msg-text">${escapeHtml(msg.message || "")}</div>
          </div>
        </article>
      `;
    })
    .join("");

  refs.chatMessages.scrollTop = refs.chatMessages.scrollHeight;
}

function formatRelativeTime(value) {
  if (!value) return "Recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";

  const diffMs = Date.now() - date.getTime();
  const min = Math.floor(diffMs / 60000);
  const hr = Math.floor(diffMs / 3600000);
  const day = Math.floor(diffMs / 86400000);

  if (min < 1) return "Just now";
  if (min < 60) return `${min} min ago`;
  if (hr < 24) return `${hr} hr ago`;
  if (day < 7) return `${day} day ago`;

  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function initials(name) {
  const parts = (name || "Anonymous").trim().split(/\s+/);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "A";
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function updateClock() {
  if (refs.tickerTime) {
    refs.tickerTime.textContent = new Date().toLocaleTimeString("en-IN", {
      hour12: false,
    });
  }
}
