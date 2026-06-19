import { auth, db, googleProvider } from "./firebase.js";
import { signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { collection, doc, setDoc, getDoc, onSnapshot, query, orderBy, limit, addDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// ── ROOMS ─────────────────────────────────────────────────────────────
const ROOMS = [
    { slug: "global", name: "Global Markets", description: "Equities, bonds, and macro" },
    { slug: "crypto", name: "Crypto Assets", description: "BTC, ETH, and altcoins" },
    { slug: "nifty",  name: "NIFTY 50",       description: "Indian markets discussion" },
    { slug: "gold",   name: "Gold & Commodities", description: "Gold, silver, and safe-haven trades" },
    { slug: "oil",    name: "Oil & Energy",    description: "Crude oil, energy markets" },
];

const state = {
    user: null,
    profile: null,
    currentRoom: new URLSearchParams(window.location.search).get("room") || "global",
    messages: [],
    chatActive: false,
};

const refs = {};

// ── BOOTSTRAP ─────────────────────────────────────────────────────────
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
                // User signed in but no profile yet — show step 2
                showProfileStep(user);
            }
        } else {
            showAuthGate();
        }
    });
});

function cacheRefs() {
    refs.chatRooms       = document.getElementById("chat-rooms");
    refs.chatMessages    = document.getElementById("chat-messages");
    refs.chatForm        = document.getElementById("chat-form");
    refs.chatInput       = document.getElementById("chat-input");
    refs.navAvatar       = document.getElementById("nav-avatar");
    refs.chatStatus      = document.getElementById("chat-status");
    refs.chatStatusBar   = document.getElementById("chat-status-bar");
    refs.tickerTime      = document.getElementById("ticker-time");
    refs.roomTitle       = document.getElementById("room-title");
    refs.roomDescription = document.getElementById("room-description");
}

function bindEvents() {
    document.getElementById("google-login-btn")?.addEventListener("click", () => {
        signInWithPopup(auth, googleProvider).catch(err => {
            console.error("Google Sign-In Error:", err);
            alert("Sign-in failed: " + err.message);
        });
    });

    document.getElementById("complete-profile-btn")?.addEventListener("click", async () => {
        const dName = document.getElementById("setup-display-name").value.trim();
        const handle = document.getElementById("setup-username").value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");

        if (!dName) { alert("Please enter a display name"); return; }
        if (handle.length < 2) { alert("Handle must be at least 2 characters"); return; }

        const profileData = {
            display_name: dName,
            username: handle,
            photoURL: state.user.photoURL || "",
            email: state.user.email || "",
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
        const hint = document.getElementById("handle-hint");
        if (hint) {
            const v = e.target.value;
            if (v.length < 2) { hint.textContent = "Min 2 characters"; hint.className = "auth-field-hint error"; }
            else { hint.textContent = `@${v} looks good`; hint.className = "auth-field-hint ok"; }
        }
    });
}

// ── AUTH GATE ──────────────────────────────────────────────────────────
function showAuthGate() {
    const gate = document.getElementById("auth-gate");
    if (gate) gate.hidden = false;
}

function hideAuthGate() {
    const gate = document.getElementById("auth-gate");
    if (gate) gate.hidden = true;
}

function showProfileStep(user) {
    document.getElementById("auth-step-1").hidden = true;
    document.getElementById("auth-step-2").hidden = false;

    document.getElementById("auth-google-name").textContent = user.displayName || "";
    document.getElementById("auth-google-email").textContent = user.email ? `✓ ${user.email}` : "";

    const avatarEl = document.getElementById("auth-google-avatar");
    if (user.photoURL) {
        avatarEl.innerHTML = `<img src="${user.photoURL}" class="auth-google-avatar-img" referrerpolicy="no-referrer" />`;
    } else {
        avatarEl.textContent = user.displayName ? user.displayName[0].toUpperCase() : "U";
    }

    document.getElementById("setup-display-name").value = user.displayName || "";
    document.getElementById("setup-username").value = (user.email || "").split("@")[0].replace(/[^a-zA-Z0-9_]/g, "").toLowerCase().slice(0, 20);
}

// ── SIDEBAR PROFILE ───────────────────────────────────────────────────
function syncSidebarProfile() {
    const p = state.profile;

    if (refs.navAvatar) {
        if (p.photoURL) {
            refs.navAvatar.innerHTML = `<img src="${p.photoURL}" class="nav-avatar-img" referrerpolicy="no-referrer" />`;
            refs.navAvatar.classList.add("has-img");
        } else {
            refs.navAvatar.textContent = p.display_name ? p.display_name[0].toUpperCase() : "U";
            refs.navAvatar.classList.remove("has-img");
        }
    }

    const widgetAvatar = document.getElementById("widget-avatar");
    if (widgetAvatar) {
        if (p.photoURL) {
            widgetAvatar.innerHTML = `<img src="${p.photoURL}" class="widget-avatar-img" referrerpolicy="no-referrer" />`;
            widgetAvatar.classList.add("has-img");
        } else {
            widgetAvatar.textContent = p.display_name ? p.display_name[0].toUpperCase() : "U";
        }
    }

    const el = (id, text) => { const n = document.getElementById(id); if (n) n.textContent = text; };
    el("widget-display-name", p.display_name || "Trader");
    el("widget-handle", `@${p.username || "user"}`);
}

// ── CHAT ──────────────────────────────────────────────────────────────
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

    if (refs.chatStatus) refs.chatStatus.textContent = "Connecting…";

    const q = query(
        collection(db, `rooms/${state.currentRoom}/messages`),
        orderBy("created_at", "asc"),
        limit(100)
    );

    unsubMessages = onSnapshot(q, (snap) => {
        state.messages = [];
        snap.forEach(d => state.messages.push({ id: d.id, ...d.data() }));
        renderMessages();
        if (refs.chatStatus) refs.chatStatus.textContent = `${state.messages.length} messages`;
        if (refs.chatStatusBar) refs.chatStatusBar.textContent = `${state.messages.length} messages • ${state.currentRoom}`;
    }, (err) => {
        console.error("Messages listener error:", err);
        if (refs.chatStatus) refs.chatStatus.textContent = "Reconnecting…";
    });
}

function renderRooms() {
    if (!refs.chatRooms) return;
    refs.chatRooms.innerHTML = ROOMS.map((room) => {
        const active = room.slug === state.currentRoom ? "active" : "";
        return `<button class="room-btn ${active}" data-room="${escapeHtml(room.slug)}" type="button">
            <span class="room-name">${escapeHtml(room.name)}</span>
            <span class="room-desc">${escapeHtml(room.description)}</span>
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
    const room = ROOMS.find((r) => r.slug === state.currentRoom) || ROOMS[0];
    if (refs.roomTitle) refs.roomTitle.textContent = room.name;
    if (refs.roomDescription) refs.roomDescription.textContent = room.description;
}

async function sendMessage() {
    const message = refs.chatInput?.value.trim();
    if (!message || !state.profile) return;

    const payload = {
        username: state.profile.username,
        display_name: state.profile.display_name,
        photoURL: state.profile.photoURL || "",
        message,
        created_at: new Date().toISOString(),
        uid: state.user.uid
    };

    try {
        refs.chatInput.value = "";
        await addDoc(collection(db, `rooms/${state.currentRoom}/messages`), payload);
    } catch (err) {
        console.error("Send error:", err);
        if (refs.chatStatusBar) refs.chatStatusBar.textContent = "Send failed — try again";
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
            ? `<img src="${msg.photoURL}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" referrerpolicy="no-referrer" />`
            : initials(msg.display_name || msg.username || "A");

        return `<article class="chat-row ${isMine ? "mine" : ""}">
            <div class="msg-avatar">${avatarContent}</div>
            <div class="msg-bubble">
                <div class="msg-meta">
                    <strong>${escapeHtml(msg.display_name || msg.username || "Anonymous")} <span style="font-weight:400;color:var(--muted)">@${escapeHtml(msg.username || "user")}</span></strong>
                    <span>${formatRelativeTime(msg.created_at)}</span>
                </div>
                <div class="msg-text">${escapeHtml(msg.message || "")}</div>
            </div>
        </article>`;
    }).join("");

    refs.chatMessages.scrollTop = refs.chatMessages.scrollHeight;
}

// ── UTILITIES ─────────────────────────────────────────────────────────
function updateClock() {
    if (refs.tickerTime) refs.tickerTime.textContent = new Date().toLocaleTimeString("en-IN", { hour12: false });
}

function escapeHtml(str) {
    return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function initials(name) {
    const parts = (name || "U").trim().split(/\s+/);
    return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() || "").join("") || "U";
}

function formatRelativeTime(value) {
    if (!value) return "Recently";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Recently";
    const diffMs = Date.now() - date.getTime();
    const min = Math.floor(diffMs / 60000);
    if (min < 1) return "Just now";
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(diffMs / 3600000);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(diffMs / 86400000);
    if (day < 7) return `${day}d ago`;
    return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}
