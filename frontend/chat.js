// ─────────────────────────────────────────────────────────────────────────────
//  Trade Trends – Chat + Google Auth
//  ⚠️  Set your Google OAuth Client ID below.
//  Get one at: https://console.cloud.google.com → APIs & Services → Credentials
//  Add the domains you'll host this on as "Authorised JavaScript origins"
// ─────────────────────────────────────────────────────────────────────────────
const GOOGLE_CLIENT_ID = "748492671481-6o9sbth90jfknjfn2dsiqcu3qs15uoc5.apps.googleusercontent.com";

// ── API Endpoints ─────────────────────────────────────────────────────────────
const API = {
  rooms:    "/api/chat/rooms",
  messages: "/api/chat/messages",
  send:     "/api/chat/messages",
};

// ── Local Storage Keys ────────────────────────────────────────────────────────
const LS = {
  sub:             "tt_google_sub",
  email:           "tt_google_email",
  googleName:      "tt_google_name",
  googlePicture:   "tt_google_picture",
  username:        "tt_username",
  displayName:     "tt_display_name",
  profileComplete: "tt_profile_complete",
};

// ── App State ─────────────────────────────────────────────────────────────────
const state = {
  googleUser: null,          // { sub, email, name, picture }
  profile:    loadProfile(), // { username, display_name }
  rooms:      [],
  currentRoom: new URLSearchParams(window.location.search).get("room") || "global",
  messages:   [],
  chatActive: false,
};

const refs = {};

// ─────────────────────────────────────────────────────────────────────────────
//  BOOTSTRAP
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  cacheRefs();
  bindAuthEvents();
  updateClock();
  setInterval(updateClock, 1000);

  if (isProfileComplete()) {
    // Returning user — skip auth gate
    hideAuthGate();
    syncSidebarProfile();
    initChat();
  } else {
    // New / signed-out user — show auth gate
    showAuthGate();
    initGoogleSignIn();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  GOOGLE SIGN-IN
// ─────────────────────────────────────────────────────────────────────────────
function initGoogleSignIn() {
  // Wait for the GSI library to load
  if (typeof google === "undefined") {
    setTimeout(initGoogleSignIn, 200);
    return;
  }

  google.accounts.id.initialize({
    client_id:          GOOGLE_CLIENT_ID,
    callback:           handleGoogleCredential,
    auto_select:        false,
    cancel_on_tap_outside: false,
  });

  // Render Google's official button (filled_black fits the dark theme)
  google.accounts.id.renderButton(
    document.getElementById("g-signin-container"),
    {
      type:           "standard",
      theme:          "filled_black",
      size:           "large",
      shape:          "pill",
      text:           "continue_with",
      logo_alignment: "left",
      width:          300,
    }
  );
}

// Called by GSI with the signed-in credential JWT
function handleGoogleCredential(response) {
  const payload = decodeJwt(response.credential);

  state.googleUser = {
    sub:     payload.sub,
    email:   payload.email,
    name:    payload.name,
    picture: payload.picture,
  };

  // Persist google info
  localStorage.setItem(LS.sub,          payload.sub      || "");
  localStorage.setItem(LS.email,        payload.email    || "");
  localStorage.setItem(LS.googleName,   payload.name     || "");
  localStorage.setItem(LS.googlePicture, payload.picture || "");

  // Transition to Step 2
  showProfileStep(state.googleUser);
}

// Decode a JWT payload without verifying signature (client-side display only)
function decodeJwt(token) {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64));
  } catch {
    return {};
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  AUTH GATE UI
// ─────────────────────────────────────────────────────────────────────────────
function showAuthGate() {
  const gate = document.getElementById("auth-gate");
  if (gate) gate.hidden = false;
}

function hideAuthGate() {
  const gate = document.getElementById("auth-gate");
  if (gate) gate.hidden = true;
}

function showProfileStep(googleUser) {
  document.getElementById("auth-step-1").hidden = true;
  const step2 = document.getElementById("auth-step-2");
  step2.hidden = false;

  // Pre-fill Google info
  const el = (id) => document.getElementById(id);
  el("auth-google-email").textContent = googleUser.email || "";
  el("auth-google-name").textContent  = googleUser.name  || "";

  // Avatar: picture URL or initial
  const avatarEl = el("auth-google-avatar");
  if (googleUser.picture) {
    avatarEl.innerHTML = `<img src="${googleUser.picture}" alt="" class="auth-google-avatar-img" referrerpolicy="no-referrer" />`;
  } else {
    avatarEl.textContent = initials(googleUser.name || googleUser.email || "U");
  }

  // Pre-fill display name from Google
  el("setup-display-name").value = googleUser.name || "";

  // Suggest a handle from email prefix
  const suggested = (googleUser.email || "")
    .split("@")[0]
    .replace(/[^a-zA-Z0-9_]/g, "")
    .toLowerCase()
    .slice(0, 20);
  el("setup-username").value = suggested;

  el("setup-display-name").focus();
}

function bindAuthEvents() {
  // Step 2: complete profile
  const completeBtn = document.getElementById("complete-profile-btn");
  if (completeBtn) completeBtn.addEventListener("click", onCompleteProfile);

  // Handle-input live validation
  const handleInput = document.getElementById("setup-username");
  if (handleInput) handleInput.addEventListener("input", () => {
    sanitizeHandleInput(handleInput);
    validateHandle(handleInput.value, "handle-hint");
  });

  // Edit profile modal
  const editBtn  = document.getElementById("edit-profile-btn");
  const closeBtn = document.getElementById("edit-modal-close");
  const saveBtn  = document.getElementById("save-edit-btn");

  if (editBtn)  editBtn.addEventListener("click",  openEditModal);
  if (closeBtn) closeBtn.addEventListener("click", closeEditModal);
  if (saveBtn)  saveBtn.addEventListener("click",  onSaveEdit);

  // Close edit modal on overlay click
  const editModal = document.getElementById("edit-modal");
  if (editModal) editModal.addEventListener("click", (e) => {
    if (e.target === editModal) closeEditModal();
  });

  // Sign out
  const signoutBtn = document.getElementById("signout-btn");
  if (signoutBtn) signoutBtn.addEventListener("click", onSignOut);

  // Chat form
  const chatForm = document.getElementById("chat-form");
  if (chatForm) chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    await sendMessage();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  PROFILE COMPLETE (Step 2 submit)
// ─────────────────────────────────────────────────────────────────────────────
function onCompleteProfile() {
  const displayNameEl = document.getElementById("setup-display-name");
  const usernameEl    = document.getElementById("setup-username");

  const displayName = (displayNameEl?.value || "").trim();
  const username    = (usernameEl?.value || "").trim().replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();

  if (!displayName) {
    displayNameEl?.focus();
    showFieldError(displayNameEl, "Please enter a display name.");
    return;
  }
  if (!username || username.length < 2) {
    usernameEl?.focus();
    showFieldError(usernameEl, "Handle must be at least 2 characters.");
    return;
  }

  // Save profile to localStorage
  localStorage.setItem(LS.username,        username);
  localStorage.setItem(LS.displayName,     displayName);
  localStorage.setItem(LS.profileComplete, "true");

  // Update state
  state.profile = { username, display_name: displayName };

  // Launch
  hideAuthGate();
  syncSidebarProfile();
  if (!state.chatActive) initChat();
}

// ─────────────────────────────────────────────────────────────────────────────
//  SIGN OUT
// ─────────────────────────────────────────────────────────────────────────────
function onSignOut() {
  if (!confirm("Sign out of Trade Trends Chat?")) return;

  Object.values(LS).forEach((key) => localStorage.removeItem(key));

  if (typeof google !== "undefined") {
    google.accounts.id.disableAutoSelect();
  }

  location.reload();
}

// ─────────────────────────────────────────────────────────────────────────────
//  EDIT PROFILE MODAL
// ─────────────────────────────────────────────────────────────────────────────
function openEditModal() {
  const modal = document.getElementById("edit-modal");
  document.getElementById("edit-display-name").value = state.profile.display_name || "";
  document.getElementById("edit-username").value     = state.profile.username      || "";
  modal.hidden = false;
}

function closeEditModal() {
  document.getElementById("edit-modal").hidden = true;
}

function onSaveEdit() {
  const displayName = (document.getElementById("edit-display-name")?.value || "").trim();
  const username    = (document.getElementById("edit-username")?.value     || "")
    .trim().replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();

  if (!displayName || !username || username.length < 2) return;

  localStorage.setItem(LS.username,    username);
  localStorage.setItem(LS.displayName, displayName);
  state.profile = { username, display_name: displayName };

  syncSidebarProfile();
  closeEditModal();
}

// ─────────────────────────────────────────────────────────────────────────────
//  SIDEBAR PROFILE WIDGET
// ─────────────────────────────────────────────────────────────────────────────
function syncSidebarProfile() {
  const p = state.profile;
  const googlePicture = localStorage.getItem(LS.googlePicture) || "";
  const googleEmail   = localStorage.getItem(LS.email)          || "";

  // Nav avatar
  const navAvatar = document.getElementById("nav-avatar");
  if (navAvatar) {
    if (googlePicture) {
      navAvatar.innerHTML = `<img src="${googlePicture}" alt="" class="nav-avatar-img" referrerpolicy="no-referrer" />`;
      navAvatar.classList.add("has-img");
    } else {
      navAvatar.textContent = initials(p.display_name || p.username || "U");
      navAvatar.classList.remove("has-img");
    }
  }

  // Widget avatar
  const widgetAvatar = document.getElementById("widget-avatar");
  if (widgetAvatar) {
    if (googlePicture) {
      widgetAvatar.innerHTML = `<img src="${googlePicture}" alt="" class="widget-avatar-img" referrerpolicy="no-referrer" />`;
      widgetAvatar.classList.add("has-img");
    } else {
      widgetAvatar.textContent = initials(p.display_name || p.username || "U");
      widgetAvatar.classList.remove("has-img");
    }
  }

  const el = (id, text) => {
    const node = document.getElementById(id);
    if (node) node.textContent = text;
  };

  el("widget-display-name", p.display_name || "Trader");
  el("widget-handle",       `@${p.username || "user"}`);
  el("widget-email",        maskEmail(googleEmail));
}

function maskEmail(email) {
  if (!email) return "";
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  return `${local[0]}${"•".repeat(Math.min(local.length - 1, 5))}@${domain}`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  CHAT INIT & CORE
// ─────────────────────────────────────────────────────────────────────────────
async function initChat() {
  state.chatActive = true;
  cacheRefs();

  await loadRooms();
  await loadMessages();

  setInterval(loadMessages, 3000);
}

function cacheRefs() {
  refs.chatRooms    = document.getElementById("chat-rooms");
  refs.chatMessages = document.getElementById("chat-messages");
  refs.chatForm     = document.getElementById("chat-form");
  refs.chatInput    = document.getElementById("chat-input");
  refs.navAvatar    = document.getElementById("nav-avatar");
  refs.chatStatus   = document.getElementById("chat-status");
  refs.tickerTime   = document.getElementById("ticker-time");
  refs.roomTitle    = document.getElementById("room-title");
  refs.roomDescription = document.getElementById("room-description");
}

async function loadRooms() {
  try {
    const response = await fetch(API.rooms, { cache: "no-store" });
    const data = await response.json();
    state.rooms = Array.isArray(data.rooms) ? data.rooms : [];

    if (!state.rooms.some((r) => r.slug === state.currentRoom)) {
      state.currentRoom = "global";
    }
    renderRooms();
    renderRoomHeader();
  } catch (err) {
    console.error("loadRooms:", err);
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
        </button>`;
    })
    .join("");

  refs.chatRooms.querySelectorAll("[data-room]").forEach((btn) => {
    btn.addEventListener("click", () => setActiveRoom(btn.dataset.room));
  });
}

function setActiveRoom(slug) {
  state.currentRoom = slug;
  renderRooms();
  renderRoomHeader();
  loadMessages();
}

function renderRoomHeader() {
  const room = state.rooms.find((r) => r.slug === state.currentRoom) || state.rooms[0];
  if (refs.roomTitle)       refs.roomTitle.textContent = room ? room.name : "Global";
  if (refs.roomDescription) refs.roomDescription.textContent = room
    ? room.description
    : "Open finance discussion for markets, macro, and trades.";
}

async function loadMessages() {
  try {
    const url = new URL(API.messages, window.location.origin);
    url.searchParams.set("room",  state.currentRoom);
    url.searchParams.set("limit", "100");

    const response = await fetch(url, { cache: "no-store" });
    const data     = await response.json();

    state.messages = Array.isArray(data.messages) ? data.messages : [];
    renderMessages();

    if (refs.chatStatus) {
      refs.chatStatus.textContent = `${state.messages.length} messages • ${state.currentRoom}`;
    }
  } catch (err) {
    console.error("loadMessages:", err);
    if (refs.chatStatus) refs.chatStatus.textContent = "Chat unavailable — reconnecting…";
  }
}

async function sendMessage() {
  const input = refs.chatInput;
  if (!input) return;

  const message = input.value.trim();
  if (!message) return;

  const payload = {
    room:         state.currentRoom,
    username:     state.profile.username,
    display_name: state.profile.display_name,
    message,
  };

  try {
    const response = await fetch(API.send, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (refs.chatStatus) refs.chatStatus.textContent = data.error || "Message rejected";
      return;
    }

    input.value = "";
    if (refs.chatStatus) refs.chatStatus.textContent = "Sent ✓";
    await loadMessages();
  } catch (err) {
    console.error("sendMessage:", err);
    if (refs.chatStatus) refs.chatStatus.textContent = "Send failed — try again";
  }
}

function renderMessages() {
  if (!refs.chatMessages) return;

  if (!state.messages.length) {
    refs.chatMessages.innerHTML =
      `<div class="empty-state">No messages yet. Start the conversation.</div>`;
    return;
  }

  const myHandle = (state.profile.username || "").toLowerCase();
  const googlePictures = {}; // future: could store per-user pictures via DB

  refs.chatMessages.innerHTML = state.messages
    .map((msg) => {
      const isMine = (msg.username || "").toLowerCase() === myHandle;
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
        </article>`;
    })
    .join("");

  refs.chatMessages.scrollTop = refs.chatMessages.scrollHeight;
}

// ─────────────────────────────────────────────────────────────────────────────
//  PERSISTENCE HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function loadProfile() {
  return {
    username:     localStorage.getItem(LS.username)    || "",
    display_name: localStorage.getItem(LS.displayName) || "",
  };
}

function isProfileComplete() {
  return localStorage.getItem(LS.profileComplete) === "true"
    && !!localStorage.getItem(LS.username)
    && !!localStorage.getItem(LS.displayName);
}

// ─────────────────────────────────────────────────────────────────────────────
//  VALIDATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function sanitizeHandleInput(input) {
  input.value = input.value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();
}

function validateHandle(value, hintId) {
  const hint = document.getElementById(hintId);
  if (!hint) return;
  if (value.length < 2)  { hint.textContent = "Min 2 characters"; hint.className = "auth-field-hint error"; return; }
  if (value.length > 20) { hint.textContent = "Max 20 characters"; hint.className = "auth-field-hint error"; return; }
  hint.textContent = `@${value} looks good`;
  hint.className = "auth-field-hint ok";
}

function showFieldError(input, message) {
  if (!input) return;
  input.classList.add("input-error");
  const existing = input.parentNode?.querySelector(".field-err");
  if (!existing) {
    const span = document.createElement("span");
    span.className = "field-err";
    span.textContent = message;
    input.after(span);
  }
  setTimeout(() => {
    input.classList.remove("input-error");
    input.parentNode?.querySelector(".field-err")?.remove();
  }, 3000);
}

// ─────────────────────────────────────────────────────────────────────────────
//  GENERAL UTILITIES
// ─────────────────────────────────────────────────────────────────────────────
function formatRelativeTime(value) {
  if (!value) return "Recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";

  const diffMs = Date.now() - date.getTime();
  const min = Math.floor(diffMs / 60000);
  const hr  = Math.floor(diffMs / 3600000);
  const day = Math.floor(diffMs / 86400000);

  if (min < 1)  return "Just now";
  if (min < 60) return `${min}m ago`;
  if (hr  < 24) return `${hr}h ago`;
  if (day < 7)  return `${day}d ago`;
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function initials(name) {
  const parts = (name || "U").trim().split(/\s+/);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() || "").join("") || "U";
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
    refs.tickerTime.textContent = new Date().toLocaleTimeString("en-IN", { hour12: false });
  }
}
