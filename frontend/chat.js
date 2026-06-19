import { auth, db, googleProvider } from "./firebase.js";
import { signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { collection, doc, setDoc, getDoc, onSnapshot, query, orderBy, limit, addDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const state = {
  user: null,          
  profile: null,
  rooms: [
    { slug: "global", name: "Global Markets", description: "Equities, bonds, and macro" },
    { slug: "crypto", name: "Crypto Assets", description: "BTC, ETH, and altcoins" },
    { slug: "nifty", name: "NIFTY 50", description: "Indian markets discussion" }
  ],
  currentRoom: new URLSearchParams(window.location.search).get("room") || "global",
  messages: [],
  chatActive: false,
};

const refs = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheRefs();
  bindEvents();
  updateClock();
  setInterval(updateClock, 1000);

  onAuthStateChanged(auth, async (user) => {
    state.user = user;
    if (user) {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        state.profile = userDoc.data();
        hideAuthGate();
        syncSidebarProfile();
        initChat();
      } else {
        // Needs profile setup
        showProfileStep(user);
      }
    } else {
      showAuthGate();
    }
  });
});

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

function bindEvents() {
  document.getElementById("google-login-btn")?.addEventListener("click", () => {
    signInWithPopup(auth, googleProvider).catch(err => alert(err.message));
  });

  document.getElementById("complete-profile-btn")?.addEventListener("click", async () => {
    const dName = document.getElementById("setup-display-name").value.trim();
    const handle = document.getElementById("setup-username").value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
    
    if (!dName || handle.length < 2) return alert("Valid display name and handle required");

    const profileData = {
      display_name: dName,
      username: handle,
      photoURL: state.user.photoURL,
      email: state.user.email,
      created_at: new Date().toISOString()
    };
    
    await setDoc(doc(db, "users", state.user.uid), profileData);
    state.profile = profileData;
    
    hideAuthGate();
    syncSidebarProfile();
    initChat();
  });

  document.getElementById("signout-btn")?.addEventListener("click", () => {
    if (confirm("Sign out of Trade Trends Live Desk?")) signOut(auth);
  });

  refs.chatForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await sendMessage();
  });

  document.getElementById("setup-username")?.addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();
  });
}

function showAuthGate() { document.getElementById("auth-gate").hidden = false; }
function hideAuthGate() { document.getElementById("auth-gate").hidden = true; }

function showProfileStep(user) {
  document.getElementById("auth-step-1").hidden = true;
  document.getElementById("auth-step-2").hidden = false;
  
  document.getElementById("auth-google-name").textContent = user.displayName || "";
  document.getElementById("auth-google-email").textContent = user.email || "";
  
  const avatarEl = document.getElementById("auth-google-avatar");
  if (user.photoURL) {
    avatarEl.innerHTML = `<img src="${user.photoURL}" style="width:100%;border-radius:50%;" referrerpolicy="no-referrer" />`;
  } else {
    avatarEl.textContent = user.displayName ? user.displayName[0] : "U";
  }

  document.getElementById("setup-display-name").value = user.displayName || "";
  document.getElementById("setup-username").value = (user.email||"").split("@")[0].replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();
}

function syncSidebarProfile() {
  const p = state.profile;
  const user = state.user;
  
  if (refs.navAvatar) {
    if (p.photoURL) {
      refs.navAvatar.innerHTML = `<img src="${p.photoURL}" class="nav-avatar-img" referrerpolicy="no-referrer" />`;
    } else {
      refs.navAvatar.textContent = p.display_name ? p.display_name[0].toUpperCase() : "U";
    }
  }

  const widgetAvatar = document.getElementById("widget-avatar");
  if (widgetAvatar) {
    if (p.photoURL) {
      widgetAvatar.innerHTML = `<img src="${p.photoURL}" style="width:100%;height:100%;border-radius:50%;" referrerpolicy="no-referrer" />`;
    } else {
      widgetAvatar.textContent = p.display_name ? p.display_name[0].toUpperCase() : "U";
    }
  }

  document.getElementById("widget-display-name").textContent = p.display_name;
  document.getElementById("widget-handle").textContent = "@" + p.username;
}

function initChat() {
  if (state.chatActive) return;
  state.chatActive = true;
  renderRooms();
  renderRoomHeader();
  listenToMessages();
}

let unsubMessages = null;

function listenToMessages() {
  if (unsubMessages) unsubMessages();
  
  if (refs.chatStatus) refs.chatStatus.textContent = "Connecting...";

  const q = query(
    collection(db, `rooms/${state.currentRoom}/messages`),
    orderBy("created_at", "asc"),
    limit(100)
  );

  unsubMessages = onSnapshot(q, (snap) => {
    state.messages = [];
    snap.forEach(doc => state.messages.push({ id: doc.id, ...doc.data() }));
    renderMessages();
    if (refs.chatStatus) refs.chatStatus.textContent = `${state.messages.length} messages • ${state.currentRoom}`;
  });
}

function renderRooms() {
  if (!refs.chatRooms) return;
  refs.chatRooms.innerHTML = state.rooms.map((room) => {
    const active = room.slug === state.currentRoom ? "active" : "";
    return `
      <button class="room-btn ${active}" data-room="${room.slug}" type="button">
        <span class="room-name">${room.name}</span>
        <span class="room-desc">${room.description}</span>
      </button>`;
  }).join("");

  refs.chatRooms.querySelectorAll("[data-room]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.currentRoom = btn.dataset.room;
      renderRooms();
      renderRoomHeader();
      listenToMessages();
    });
  });
}

function renderRoomHeader() {
  const room = state.rooms.find((r) => r.slug === state.currentRoom) || state.rooms[0];
  if (refs.roomTitle) refs.roomTitle.textContent = room.name;
  if (refs.roomDescription) refs.roomDescription.textContent = room.description;
}

async function sendMessage() {
  const message = refs.chatInput?.value.trim();
  if (!message || !state.profile) return;

  const payload = {
    username: state.profile.username,
    display_name: state.profile.display_name,
    photoURL: state.profile.photoURL || null,
    message,
    created_at: new Date().toISOString(),
    uid: state.user.uid
  };

  try {
    refs.chatInput.value = "";
    await addDoc(collection(db, `rooms/${state.currentRoom}/messages`), payload);
  } catch (err) {
    console.error(err);
    if (refs.chatStatus) refs.chatStatus.textContent = "Send failed";
  }
}

function renderMessages() {
  if (!refs.chatMessages) return;

  if (!state.messages.length) {
    refs.chatMessages.innerHTML = `<div class="empty-state">No messages yet. Start the conversation.</div>`;
    return;
  }

  const myUid = state.user?.uid;

  refs.chatMessages.innerHTML = state.messages.map((msg) => {
    const isMine = msg.uid === myUid;
    const avatarContent = msg.photoURL 
      ? `<img src="${msg.photoURL}" style="width:100%;height:100%;border-radius:50%;" />`
      : (msg.display_name ? msg.display_name[0].toUpperCase() : "U");

    return `
      <article class="chat-row ${isMine ? "mine" : ""}">
        <div class="msg-avatar">${avatarContent}</div>
        <div class="msg-bubble">
          <div class="msg-meta">
            <strong>${msg.display_name} <span style="font-weight:400;color:var(--t3)">@${msg.username}</span></strong>
            <span>${formatRelativeTime(msg.created_at)}</span>
          </div>
          <div class="msg-text">${escapeHtml(msg.message)}</div>
        </div>
      </article>`;
  }).join("");

  refs.chatMessages.scrollTop = refs.chatMessages.scrollHeight;
}

function updateClock() {
  if (refs.tickerTime) refs.tickerTime.textContent = new Date().toLocaleTimeString("en-IN", { hour12: false });
}

function escapeHtml(str) {
  return String(str||"").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatRelativeTime(iso) {
  if (!iso) return "Recently";
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(diffMs / 3600000);
  if (hr < 24) return `${hr}h ago`;
  return date.toLocaleDateString("en-IN");
}
