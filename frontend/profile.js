import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc, updateDoc, collection, onSnapshot, deleteDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const state = {
    user: null,
    profile: null,
    watchlists: [],
    bookmarks: []
};

const refs = {};

document.addEventListener("DOMContentLoaded", () => {
    refs.tickerTime = document.getElementById("ticker-time");
    refs.navAvatar = document.getElementById("nav-avatar");
    updateClock();
    setInterval(updateClock, 1000);

    onAuthStateChanged(auth, async (user) => {
        state.user = user;
        if (user) {
            document.getElementById("auth-warning").hidden = true;
            document.getElementById("profile-content").hidden = false;
            await loadProfile();
            listenToWatchlists();
            listenToBookmarks();
        } else {
            document.getElementById("auth-warning").hidden = false;
            document.getElementById("profile-content").hidden = true;
            if (refs.navAvatar) refs.navAvatar.textContent = "?";
        }
    });

    bindEvents();
});

function bindEvents() {
    document.getElementById("signout-btn")?.addEventListener("click", () => {
        if (confirm("Sign out?")) signOut(auth);
    });

    const editModal = document.getElementById("edit-modal");
    document.getElementById("edit-profile-btn")?.addEventListener("click", () => {
        document.getElementById("edit-dname").value = state.profile.display_name;
        document.getElementById("edit-handle").value = state.profile.username;
        editModal.hidden = false;
    });
    document.getElementById("cancel-edit-btn")?.addEventListener("click", () => {
        editModal.hidden = true;
    });
    document.getElementById("save-edit-btn")?.addEventListener("click", async () => {
        const dName = document.getElementById("edit-dname").value.trim();
        if(!dName) return alert("Display name required");
        await updateDoc(doc(db, "users", state.user.uid), { display_name: dName });
        state.profile.display_name = dName;
        renderHeader();
        editModal.hidden = true;
    });

    document.getElementById("new-wl-btn")?.addEventListener("click", async () => {
        const name = prompt("Watchlist Name:");
        if (!name) return;
        const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "-");
        await setDoc(doc(db, `users/${state.user.uid}/watchlists`, slug), {
            name,
            assets: [],
            created_at: new Date().toISOString()
        });
    });
}

async function loadProfile() {
    const d = await getDoc(doc(db, "users", state.user.uid));
    if (d.exists()) {
        state.profile = d.data();
        renderHeader();
    } else {
        alert("Profile not found. Please log in via Live Desk to complete setup.");
        window.location.href = "chat.html";
    }
}

function listenToWatchlists() {
    onSnapshot(collection(db, `users/${state.user.uid}/watchlists`), (snap) => {
        state.watchlists = [];
        snap.forEach(doc => state.watchlists.push({ id: doc.id, ...doc.data() }));
        renderWatchlists();
    });
}

function listenToBookmarks() {
    onSnapshot(collection(db, `users/${state.user.uid}/bookmarks`), (snap) => {
        state.bookmarks = [];
        snap.forEach(doc => state.bookmarks.push({ id: doc.id, ...doc.data() }));
        renderBookmarks();
    });
}

function renderHeader() {
    const p = state.profile;
    document.getElementById("profile-display-name").textContent = p.display_name;
    document.getElementById("profile-handle").textContent = "@" + p.username;
    
    const avatarContent = p.photoURL 
        ? `<img src="${p.photoURL}" style="width:100%;height:100%;border-radius:50%;" referrerpolicy="no-referrer" />`
        : p.display_name[0].toUpperCase();

    document.getElementById("profile-avatar").innerHTML = avatarContent;
    if (refs.navAvatar) refs.navAvatar.innerHTML = avatarContent;
}

window.deleteWatchlist = async function(id) {
    if(confirm("Delete watchlist?")) {
        await deleteDoc(doc(db, `users/${state.user.uid}/watchlists`, id));
    }
};

window.removeBookmark = async function(id) {
    await deleteDoc(doc(db, `users/${state.user.uid}/bookmarks`, id));
};

function renderWatchlists() {
    const container = document.getElementById("watchlists-container");
    if (!state.watchlists.length) {
        container.innerHTML = `<div class="empty-state">No watchlists yet.</div>`;
        return;
    }
    container.innerHTML = state.watchlists.map(w => `
        <div class="card" style="margin-bottom:10px; padding:15px; border:1px solid var(--border);">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <h3 style="margin:0; font-size:15px; font-weight:600;">${w.name}</h3>
                <button onclick="deleteWatchlist('${w.id}')" style="background:none;border:none;color:var(--ef);cursor:pointer;font-size:12px;">Delete</button>
            </div>
            <p style="margin:10px 0 0 0; font-size:13px; color:var(--t3);">
                ${w.assets.length ? w.assets.join(", ") : "No assets added."}
            </p>
        </div>
    `).join("");
}

function renderBookmarks() {
    const container = document.getElementById("saved-container");
    if (!state.bookmarks.length) {
        container.innerHTML = `<div class="empty-state">No saved articles.</div>`;
        return;
    }
    container.innerHTML = state.bookmarks.map(b => `
        <article class="news-card neutral">
            <div class="card-body">
                <h2 class="card-headline">${b.title}</h2>
                <div class="card-footer" style="margin-top:15px;">
                    <span style="font-size:12px; color:var(--t3)">Saved ${new Date(b.saved_at).toLocaleDateString()}</span>
                    <div style="display:flex; gap:10px;">
                        <button class="bookmark-btn active" onclick="removeBookmark('${b.id}')">Remove</button>
                        <a class="read-link" href="${b.link}" target="_blank">Read →</a>
                    </div>
                </div>
            </div>
        </article>
    `).join("");
}

function updateClock() {
    if (refs.tickerTime) refs.tickerTime.textContent = new Date().toLocaleTimeString("en-IN", { hour12: false });
}
