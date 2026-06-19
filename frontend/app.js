import { db, auth } from "./firebase.js";
import { collection, onSnapshot, query, orderBy, limit, doc, setDoc, deleteDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const state = {
    articles: [],
    activeCategory: "All",
    search: "",
    user: null,
    savedArticles: new Set()
};

const refs = {};

// ── INIT ──────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    refs.briefPanel      = document.getElementById("brief-panel");
    refs.searchInput     = document.getElementById("search-input");
    refs.categoryFilters = document.getElementById("category-filters");
    refs.newsContainer   = document.getElementById("news-container");
    refs.lastUpdated     = document.getElementById("last-updated");
    refs.tickerTime      = document.getElementById("ticker-time");
    refs.marketDot       = document.getElementById("market-dot");
    refs.marketText      = document.getElementById("market-status-text");
    refs.navAvatar       = document.getElementById("nav-avatar");

    refs.heroTitle       = document.getElementById("hero-title");
    refs.heroSummary     = document.getElementById("hero-summary");
    refs.heroCategory    = document.getElementById("hero-category");
    refs.heroSentiment   = document.getElementById("hero-sentiment");
    refs.heroHorizon     = document.getElementById("hero-horizon");
    refs.marketMood      = document.getElementById("market-mood");
    refs.topBullish      = document.getElementById("top-bullish");
    refs.topBearish      = document.getElementById("top-bearish");
    refs.articleCount    = document.getElementById("article-count");
    refs.signalStrip     = document.getElementById("signal-strip");

    updateClock();
    setInterval(updateClock, 1000);
    updateMarketStatus();

    if (refs.searchInput) {
        refs.searchInput.addEventListener("input", (e) => {
            state.search = e.target.value || "";
            renderDashboard();
        });
    }

    onAuthStateChanged(auth, async (user) => {
        state.user = user;
        if (user) {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            if (userDoc.exists() && refs.navAvatar) {
                const data = userDoc.data();
                if (data.photoURL) {
                    refs.navAvatar.innerHTML = `<img src="${data.photoURL}" alt="avatar" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
                } else {
                    refs.navAvatar.textContent = (data.display_name || user.email || "U")[0].toUpperCase();
                }
            }
            // Load saved articles map
            onSnapshot(collection(db, `users/${user.uid}/bookmarks`), (snap) => {
                state.savedArticles.clear();
                snap.forEach(d => state.savedArticles.add(d.id));
                renderDashboard();
            });
        } else {
            if (refs.navAvatar) refs.navAvatar.textContent = "?";
            state.savedArticles.clear();
            renderDashboard();
        }
    });

    listenToNews();
    listenToMarketTicker();
});

function updateClock() {
    if (!refs.tickerTime) return;
    refs.tickerTime.textContent = new Date().toLocaleTimeString("en-IN", {
        hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
}

function updateMarketStatus() {
    if (!refs.marketDot || !refs.marketText) return;
    const now = new Date();
    const day = now.getDay();
    const mins = now.getHours() * 60 + now.getMinutes();
    const isOpen = day >= 1 && day <= 5 && mins >= (9*60+15) && mins < (15*60+30);
    refs.marketDot.className = "market-dot " + (isOpen ? "open" : "closed");
    refs.marketText.textContent = isOpen ? "Markets Open" : "Markets Closed";
}

// ── FIRESTORE LISTENERS ───────────────────────────────────────────────
function listenToNews() {
    if (refs.lastUpdated) refs.lastUpdated.textContent = "Connecting to live feed…";
    const q = query(collection(db, "articles"), orderBy("added_at", "desc"), limit(100));
    
    onSnapshot(q, (snapshot) => {
        const docs = [];
        snapshot.forEach((doc) => {
            const data = doc.data();
            data.id = doc.id;
            docs.push(normalizeArticle(data));
        });
        state.articles = docs;
        
        if (refs.lastUpdated) {
            refs.lastUpdated.textContent = "Live • Updated " + new Date().toLocaleTimeString("en-IN");
            refs.lastUpdated.style.color = "#10b981";
        }
        
        renderFilters();
        renderDashboard();
    }, (error) => {
        console.error("News listener error:", error);
        if (refs.lastUpdated) {
            refs.lastUpdated.textContent = "Offline";
            refs.lastUpdated.style.color = "#ef4444";
        }
    });
}

function listenToMarketTicker() {
    onSnapshot(doc(db, "marketSnapshots", "current"), (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.BTC) setTickerPair("btc-price", "btc-change", data.BTC.price, data.BTC.change);
            if (data.USDINR) setTickerPair("usdinr-price", "usdinr-change", data.USDINR.price, data.USDINR.change, true);
            if (data.GOLD) setTickerPair("gold-price", "gold-change", data.GOLD.price, data.GOLD.change);
            if (data.NIFTY) setTickerPair("nifty-price", "nifty-change", data.NIFTY.price, data.NIFTY.change, true);
            if (data.BANKNIFTY) setTickerPair("banknifty-price", "banknifty-change", data.BANKNIFTY.price, data.BANKNIFTY.change, true);
        }
    });
}

// ── DATA HELPERS ──────────────────────────────────────────────────────
function normalizeArticle(article) {
    const importance = Number(article.importance) || 0;
    const confidence = Number(article.confidence) || 0;
    let category = String(article.category || "General").trim();
    if (category.includes("|")) category = category.split("|")[0].trim();

    return {
        ...article,
        category: category || "General",
        assets: article.assets || [],
        directions: article.directions || {},
        importance,
        confidence,
        analysis: article.analysis || "",
        added_at: article.added_at || new Date().toISOString(),
        ai_score: importance * confidence
    };
}

function getFilteredArticles() {
    const search = state.search.trim().toLowerCase();
    return state.articles.filter((a) => {
        if (state.activeCategory !== "All" && a.category !== state.activeCategory) return false;
        if (!search) return true;
        const hay = [a.title, a.category, a.sentiment, a.market_impact, (a.assets||[]).join(" ")].join(" ").toLowerCase();
        return hay.includes(search);
    });
}

function getSentimentMood(articles) {
    let pos = 0, neg = 0, neu = 0;
    articles.forEach((a) => {
        const w = a.ai_score || 0;
        const s = String(a.sentiment || "").toLowerCase();
        if (s.includes("positive")) pos += w;
        else if (s.includes("negative")) neg += w;
        else neu += w;
    });
    const total = pos + neg + neu || 1;
    if (pos / total >= 0.55) return "Risk-On";
    if (neg / total >= 0.55) return "Risk-Off";
    return "Mixed";
}

function moodClass(mood) {
    const m = mood.toLowerCase();
    if (m.includes("risk-on")) return "risk-on";
    if (m.includes("risk-off")) return "risk-off";
    return "mixed";
}

function aggregateAssetSignals(articles) {
    const map = {};
    articles.forEach((article) => {
        const dirs = article.directions || {};
        Object.entries(dirs).forEach(([asset, direction]) => {
            if (!map[asset]) map[asset] = { Bullish: 0, Bearish: 0, Neutral: 0 };
            if (map[asset][direction] !== undefined) map[asset][direction] += 1;
        });
    });
    return map;
}

function formatAddedAt(isoString) {
    if (!isoString) return "Recently";
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return "Recently";
    const diffMin = Math.floor((new Date() - date) / 60000);
    if (diffMin < 1) return "Just now";
    if (diffMin < 60) return `${diffMin} min ago`;
    if (diffMin < 1440) return `${Math.floor(diffMin/60)} hr ago`;
    return date.toLocaleDateString("en-IN");
}

window.toggleBookmark = async function(articleId) {
    if (!state.user) {
        alert("Please login via the Live Desk or Profile to save articles.");
        return;
    }
    const docRef = doc(db, `users/${state.user.uid}/bookmarks`, articleId);
    if (state.savedArticles.has(articleId)) {
        await deleteDoc(docRef);
    } else {
        const article = state.articles.find(a => a.id === articleId);
        if(article) await setDoc(docRef, { saved_at: new Date().toISOString(), title: article.title, link: article.link });
    }
};

// ── RENDER FUNCTIONS ──────────────────────────────────────────────────
function renderFilters() {
    const categories = ["All", ...new Set(state.articles.map((a) => a.category))];
    refs.categoryFilters.innerHTML = categories
        .map((c) => `<button class="chip ${c === state.activeCategory ? "active" : ""}" data-cat="${c}" type="button">${c}</button>`)
        .join("");

    refs.categoryFilters.querySelectorAll(".chip").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.activeCategory = btn.dataset.cat;
            renderFilters();
            renderDashboard();
        });
    });
}

function renderHero(articles) {
    const top = [...articles].sort((a, b) => b.ai_score - a.ai_score)[0];
    if (!top) return;

    if (refs.heroTitle) refs.heroTitle.textContent = top.title;
    if (refs.heroSummary) refs.heroSummary.textContent = top.analysis || top.title;
    if (refs.heroCategory) refs.heroCategory.textContent = `Category: ${top.category}`;
    if (refs.heroSentiment) refs.heroSentiment.textContent = `Sentiment: ${top.sentiment}`;
    if (refs.heroHorizon) refs.heroHorizon.textContent = `Added: ${formatAddedAt(top.added_at)}`;
    if (refs.marketMood) refs.marketMood.textContent = getSentimentMood(articles);
    if (refs.articleCount) refs.articleCount.textContent = articles.length;
}

function renderCards(articles) {
    if (!articles.length) {
        refs.newsContainer.innerHTML = `<div class="empty-state">No results found</div>`;
        return;
    }

    refs.newsContainer.innerHTML = articles.map((a) => {
        const sc = a.sentiment?.toLowerCase().includes("positive") ? "positive" : a.sentiment?.toLowerCase().includes("negative") ? "negative" : "neutral";
        const isSaved = state.savedArticles.has(a.id);
        const assetsHtml = (a.assets||[]).map(t => `<span class="asset-tag">${escapeHtml(t)}</span>`).join("");

        return `
            <article class="news-card ${sc}">
                <div class="card-stripe"></div>
                <div class="card-body">
                    <div class="card-cat-row">
                        <span class="card-cat">${escapeHtml(a.category)}</span>
                        <span class="sent-badge ${sc}">${escapeHtml(a.sentiment || "Neutral")}</span>
                    </div>
                    <h2 class="card-headline">${escapeHtml(a.title)}</h2>
                    <div class="score-row">
                        <div class="score-pill ai"><span class="sp-label">AI Score</span><span class="sp-val">${a.ai_score}</span></div>
                    </div>
                    <div class="ai-note"><p class="ai-note-text">${escapeHtml(a.analysis || "")}</p></div>
                    <div class="card-footer">
                        <div class="asset-tags">${assetsHtml}</div>
                        <div style="display:flex; gap:10px;">
                            <button class="bookmark-btn ${isSaved ? 'active' : ''}" onclick="toggleBookmark('${a.id}')" title="Save">
                                ${isSaved ? '★ Saved' : '☆ Save'}
                            </button>
                            <a class="read-link" href="${escapeHtml(a.link)}" target="_blank">Read →</a>
                        </div>
                    </div>
                </div>
            </article>
        `;
    }).join("");
}

function renderDashboard() {
    const filtered = getFilteredArticles().sort((a, b) => b.ai_score - a.ai_score);
    renderHero(filtered);
    renderCards(filtered);
}

function escapeHtml(str) {
    return String(str||"").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function setTickerPair(priceId, changeId, priceValue, changeValue, isLiveLabel = false) {
    const priceEl = document.getElementById(priceId);
    const changeEl = document.getElementById(changeId);
    if (!priceEl || !changeEl) return;
    priceEl.textContent = Number.isFinite(Number(priceValue)) ? Number(priceValue).toLocaleString("en-IN") : "N/A";
    if (isLiveLabel) {
        changeEl.textContent = "LIVE";
        changeEl.style.color = "#10b981";
        return;
    }
    const num = Number(changeValue);
    if (Number.isFinite(num)) {
        changeEl.textContent = (num >= 0 ? "▲ " : "▼ ") + Math.abs(num).toFixed(2) + "%";
        changeEl.style.color = num >= 0 ? "#10b981" : "#ef4444";
    } else {
        changeEl.textContent = "--";
    }
}
