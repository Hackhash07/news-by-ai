import { supabase } from "./supabase.js";

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

    supabase.auth.onAuthStateChange(async (event, session) => {
        const user = session?.user;
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
    
    supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) state.user = session.user;
    });

    bindEvents();
});

function bindEvents() {
    document.getElementById("signout-btn")?.addEventListener("click", async () => {
        if (confirm("Sign out?")) {
            await supabase.auth.signOut();
            window.location.reload();
        }
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
        await supabase.from('profiles').update({ display_name: dName }).eq('id', state.user.id);
        state.profile.display_name = dName;
        renderHeader();
        editModal.hidden = true;
    });

    document.getElementById("new-wl-btn")?.addEventListener("click", async () => {
        const name = prompt("Watchlist Name:");
        if (!name) return;
        const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "-");
        await supabase.from('watchlists').insert({
            id: slug,
            user_id: state.user.id,
            name,
            assets: [],
            created_at: new Date().toISOString()
        });
    });
}

async function loadProfile() {
    let { data, error } = await supabase.from('profiles').select('*').eq('id', state.user.id).single();
    
    if (!data) {
        // Upsert basic profile if missing
        const newProfile = {
            id: state.user.id,
            display_name: state.user.user_metadata?.full_name || state.user.email?.split('@')[0] || 'User',
            username: (state.user.email?.split('@')[0] || 'user').replace(/[^a-zA-Z0-9_]/g, "").toLowerCase() + Math.floor(Math.random() * 1000),
            photo_url: state.user.user_metadata?.avatar_url || '',
            created_at: new Date().toISOString()
        };
        const { data: insertedData, error: insertError } = await supabase.from('profiles').upsert(newProfile).select().single();
        if (insertedData) {
            data = insertedData;
        } else {
            console.error("Profile creation failed:", insertError);
            alert("Profile not found and could not be created. Please log in via Live Desk to complete setup.");
            window.location.href = "chat.html";
            return;
        }
    }

    state.profile = data;
    renderHeader();
}

let unsubWatchlists = null;
function listenToWatchlists() {
    if (unsubWatchlists) supabase.removeChannel(unsubWatchlists);
    
    const fetchW = async () => {
        const { data } = await supabase.from('watchlists').select('*').eq('user_id', state.user.id);
        state.watchlists = data || [];
        renderWatchlists();
    };
    fetchW();
    
    unsubWatchlists = supabase.channel('public:watchlists')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'watchlists', filter: `user_id=eq.${state.user.id}` }, fetchW)
        .subscribe();
}

let unsubBookmarks = null;
function listenToBookmarks() {
    if (unsubBookmarks) supabase.removeChannel(unsubBookmarks);
    
    const fetchB = async () => {
        const { data } = await supabase.from('bookmarks').select('*').eq('user_id', state.user.id);
        state.bookmarks = data || [];
        renderBookmarks();
    };
    fetchB();
    
    unsubBookmarks = supabase.channel('public:bookmarks')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bookmarks', filter: `user_id=eq.${state.user.id}` }, fetchB)
        .subscribe();
}

function renderHeader() {
    const p = state.profile;
    document.getElementById("profile-display-name").textContent = p.display_name;
    document.getElementById("profile-handle").textContent = "@" + p.username;
    
    const avatarContent = p.photo_url 
        ? `<img src="${p.photo_url}" style="width:100%;height:100%;border-radius:50%;" referrerpolicy="no-referrer" />`
        : p.display_name[0].toUpperCase();

    document.getElementById("profile-avatar").innerHTML = avatarContent;
    if (refs.navAvatar) refs.navAvatar.innerHTML = avatarContent;
}

window.deleteWatchlist = async function(id) {
    if(confirm("Delete watchlist?")) {
        await supabase.from('watchlists').delete().eq('id', id);
    }
};

window.removeBookmark = async function(id) {
    await supabase.from('bookmarks').delete().eq('id', id);
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
                ${w.assets && w.assets.length ? w.assets.join(", ") : "No assets added."}
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
