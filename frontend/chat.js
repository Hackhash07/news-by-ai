const API = {
  messages: "/api/chat/messages",
  send: "/api/chat/messages",
};

const state = {
  profile: loadProfile(),
  messages: [],
};

const refs = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheRefs();
  bindEvents();
  syncProfileToUI();
  await loadMessages();
  setInterval(loadMessages, 3000);
  setInterval(updateClock, 1000);
}

function cacheRefs() {
  [
    "chat-messages",
    "chat-form",
    "chat-input",
    "chat-username",
    "chat-display-name",
    "save-profile-btn",
    "profile-status",
    "nav-avatar",
    "chat-status",
    "ticker-time",
  ].forEach((id) => {
    refs[id] = document.getElementById(id);
  });
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
  const username = (refs["chat-username"]?.value || "").trim() || "Anonymous";
  const displayName = (refs["chat-display-name"]?.value || "").trim() || username;
  saveProfile({ username, display_name: displayName });
}

function syncProfileToUI() {
  if (refs["chat-username"]) refs["chat-username"].value = state.profile.username;
  if (refs["chat-display-name"]) refs["chat-display-name"].value = state.profile.display_name;
  if (refs.navAvatar) refs.navAvatar.textContent = initials(state.profile.display_name || state.profile.username);
  if (refs.profileStatus) refs.profileStatus.textContent = `Signed in as ${state.profile.display_name}`;
}

async function loadMessages() {
  try {
    const response = await fetch(API.messages, { cache: "no-store" });
    const data = await response.json();
    state.messages = Array.isArray(data.messages) ? data.messages : [];
    renderMessages();
    if (refs.chatStatus) refs.chatStatus.textContent = `Loaded ${state.messages.length} messages`;
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
        <article class="message ${isMine ? "mine" : ""}">
          <div class="message-top">
            <strong>${escapeHtml(msg.display_name || msg.username || "Anonymous")}</strong>
            <span class="message-meta">${formatRelativeTime(msg.created_at)}</span>
          </div>
          <div class="message-body">${escapeHtml(msg.message || "")}</div>
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
