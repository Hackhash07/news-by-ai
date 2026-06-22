import { db, auth } from "./firebase.js";
import { collection, onSnapshot, doc, setDoc, deleteDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

// ── Use the existing Flask endpoints that already work on Render ──
const API_URL = "/news";
const MARKET_API_URL = "/market-data";

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
    refs.refreshBtn      = document.getElementById("refresh-btn");
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

    if (refs.refreshBtn) {
        refs.refreshBtn.addEventListener("click", loadNews);
    }

    // Listen to Firebase auth for avatar + bookmarks
    onAuthStateChanged(auth, async (user) => {
        state.user = user;
        if (user) {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            if (userDoc.exists() && refs.navAvatar) {
                const data = userDoc.data();
                if (data.photoURL) {
                    refs.navAvatar.innerHTML = `<img src="${data.photoURL}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" referrerpolicy="no-referrer">`;
                } else {
                    refs.navAvatar.textContent = (data.display_name || user.email || "U")[0].toUpperCase();
                }
            }
            // Listen to bookmarks
            onSnapshot(collection(db, `users/${user.uid}/bookmarks`), (snap) => {
                state.savedArticles.clear();
                snap.forEach(d => state.savedArticles.add(d.id));
                if (state.articles.length) renderDashboard();
            });
        } else {
            if (refs.navAvatar) refs.navAvatar.textContent = "?";
            state.savedArticles.clear();
        }
    });

    // Load news from Flask API (the existing working endpoint)
    loadNews();
    setInterval(loadNews, 60000);

    // Load market ticker from Flask API
    loadTicker();
    setInterval(loadTicker, 60000);
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
    const isOpen = day >= 1 && day <= 5 && mins >= (9 * 60 + 15) && mins < (15 * 60 + 30);
    refs.marketDot.className = "market-dot " + (isOpen ? "open" : "closed");
    refs.marketText.textContent = isOpen ? "Markets Open" : "Markets Closed";
}

// ── DATA HELPERS ──────────────────────────────────────────────────────
function safeJsonParse(value, fallback) {
    if (Array.isArray(value) || (value && typeof value === "object")) return value;
    if (typeof value === "string") {
        try { return JSON.parse(value); } catch { return fallback; }
    }
    return fallback;
}

function normalizeArticle(article) {
    const assets = safeJsonParse(article.assets, []);
    const directions = safeJsonParse(article.directions, {});
    const importance = Number(article.importance) || 0;
    const confidence = Number(article.confidence) || 0;
    let category = String(article.category || "General").trim();
    if (category.includes("|")) category = category.split("|")[0].trim();

    return {
        ...article,
        id: String(article.id || Math.random()),
        category: category || "General",
        assets,
        directions,
        importance,
        confidence,
        analysis: article.analysis || "",
        added_at: article.added_at || "",
        ai_score: importance * confidence
    };
}

function getFilteredArticles() {
    const search = state.search.trim().toLowerCase();
    return state.articles.filter((a) => {
        if (state.activeCategory !== "All" && a.category !== state.activeCategory) return false;
        if (!search) return true;
        const hay = [a.title, a.category, a.sentiment, a.market_impact,
            Array.isArray(a.assets) ? a.assets.join(" ") : ""].join(" ").toLowerCase();
        return hay.includes(search);
    });
}

function getThemeCounts(articles) {
    const counts = {};
    articles.forEach((a) => { const k = a.category || "General"; counts[k] = (counts[k] || 0) + 1; });
    return counts;
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

function getTopStory(articles) {
    return [...articles].sort((a, b) => (b.ai_score || 0) - (a.ai_score || 0))[0] || null;
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

function getTopSignal(signalMap, side) {
    return Object.entries(signalMap)
        .map(([asset, counts]) => ({ asset, count: counts[side], total: counts.Bullish + counts.Bearish + counts.Neutral }))
        .filter((item) => item.count > 0)
        .sort((a, b) => b.count - a.count || b.total - a.total)[0] || null;
}

function formatAddedAt(isoString) {
    if (!isoString) return "Recently";
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return "Recently";
    const diffMin = Math.floor((new Date() - date) / 60000);
    if (diffMin < 1) return "Added just now";
    if (diffMin < 60) return `Added ${diffMin} min ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `Added ${diffHour} hr ago`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 7) return `Added ${diffDay} day ago`;
    return `Added ${date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`;
}

function fallbackAnalysis(article) {
    const assets = Array.isArray(article.assets) && article.assets.length
        ? article.assets.join(", ") : "broader markets";
    return `Assets most exposed to this event include ${assets}. The system is currently analyzing the ${article.category || "General"} impact.`;
}

function getCategoryIcon(category) {
    const map = { "Finance": "💰", "Geopolitics": "🌐", "Technology": "💻", "Energy": "⚡", "Markets": "📈", "Economy": "🏦", "Commodities": "🛢️", "Crypto": "₿" };
    return map[category] || "📰";
}

function sentimentClass(sentiment) {
    const s = String(sentiment || "").toLowerCase();
    if (s.includes("positive")) return "positive";
    if (s.includes("negative")) return "negative";
    return "neutral";
}

// ── BOOKMARK ──────────────────────────────────────────────────────────
window.toggleBookmark = async function(articleId) {
    if (!state.user) {
        alert("Please sign in via the Live Desk to save articles.");
        return;
    }
    const docRef = doc(db, `users/${state.user.uid}/bookmarks`, articleId);
    if (state.savedArticles.has(articleId)) {
        await deleteDoc(docRef);
    } else {
        const article = state.articles.find(a => String(a.id) === String(articleId));
        if (article) {
            await setDoc(docRef, {
                saved_at: new Date().toISOString(),
                title: article.title,
                link: article.link || "#",
                category: article.category
            });
        }
    }
};

// ── RENDER: HERO / SIGNALS ───────────────────────────────────────────
function renderHero(articles) {
    const top = getTopStory(articles);
    const mood = getSentimentMood(articles);
    const signalMap = aggregateAssetSignals(articles);
    const bullish = getTopSignal(signalMap, "Bullish");
    const bearish = getTopSignal(signalMap, "Bearish");

    if (!top) {
        if (refs.heroTitle) refs.heroTitle.textContent = "No articles yet";
        if (refs.heroSummary) refs.heroSummary.textContent = "Run the collector to load fresh headlines.";
        if (refs.heroCategory) refs.heroCategory.textContent = "Category —";
        if (refs.heroSentiment) refs.heroSentiment.textContent = "Sentiment —";
        if (refs.heroHorizon) refs.heroHorizon.textContent = "Added —";
        if (refs.marketMood) refs.marketMood.textContent = "—";
        if (refs.topBullish) refs.topBullish.textContent = "—";
        if (refs.topBearish) refs.topBearish.textContent = "—";
        if (refs.articleCount) refs.articleCount.textContent = "0";
        return;
    }

    const summary = top.analysis || fallbackAnalysis(top);
    if (refs.heroTitle) refs.heroTitle.textContent = top.title;
    if (refs.heroSummary) refs.heroSummary.textContent = summary;
    if (refs.heroCategory) refs.heroCategory.textContent = `Category: ${top.category}`;
    if (refs.heroSentiment) refs.heroSentiment.textContent = `Sentiment: ${top.sentiment}`;
    if (refs.heroHorizon) refs.heroHorizon.textContent = formatAddedAt(top.added_at);
    if (refs.marketMood) refs.marketMood.textContent = mood;
    if (refs.topBullish) refs.topBullish.textContent = bullish ? `${bullish.asset} (Exposure: ${bullish.count})` : "—";
    if (refs.topBearish) refs.topBearish.textContent = bearish ? `${bearish.asset} (Mentions: ${bearish.count})` : "—";
    if (refs.articleCount) refs.articleCount.textContent = String(articles.length);
}

function renderSignalStrip(articles) {
    if (!refs.signalStrip) return;
    const signalMap = aggregateAssetSignals(articles);
    const ranked = Object.entries(signalMap)
        .map(([asset, counts]) => ({ asset, mentions: counts.Bullish + counts.Bearish + counts.Neutral }))
        .sort((a, b) => b.mentions - a.mentions).slice(0, 6);

    if (!ranked.length) { refs.signalStrip.innerHTML = ""; return; }

    refs.signalStrip.innerHTML = ranked.map((item) => {
        return `<article class="signal-card flat">
            <div class="signal-head"><span class="signal-asset">${escapeHtml(item.asset)}</span></div>
            <div class="signal-bars"><span>Exposure Score: ${item.mentions}</span></div>
        </article>`;
    }).join("");
}

// ── RENDER: BRIEF ─────────────────────────────────────────────────────
function renderBrief(articles) {
    const total = articles.length;
    const avgConf = total ? Math.round(articles.reduce((s, a) => s + (a.confidence || 0), 0) / total) : 0;
    const topArticle = [...articles].sort((a, b) => b.ai_score - a.ai_score)[0];
    const themeCounts = getThemeCounts(articles);
    const topThemes = Object.entries(themeCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, c]) => `${t} (${c})`).join(", ") || "—";
    const mood = getSentimentMood(articles);

    refs.briefPanel.innerHTML = `
        <div class="brief-card">
            <div class="brief-header-strip">
                <div class="brief-header-left"><div class="brief-icon">📊</div><span class="brief-title">AI Market Brief</span></div>
                <span class="brief-tag">Refreshed live · ${total} article${total !== 1 ? "s" : ""}</span>
            </div>
            <div class="brief-grid">
                <div class="brief-item"><div class="bi-label">Market Mood</div><div class="bi-value ${moodClass(mood)}">${mood}</div></div>
                <div class="brief-item"><div class="bi-label">Top Themes</div><div class="bi-value">${topThemes}</div></div>
                <div class="brief-item"><div class="bi-label">Top Story</div><div class="bi-value">${topArticle ? topArticle.title : "No articles"}</div></div>
                <div class="brief-item"><div class="bi-label">Avg Confidence</div><div class="bi-value mono">${avgConf}%</div></div>
            </div>
        </div>`;
}

// ── RENDER: FILTERS ───────────────────────────────────────────────────
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

// ── RENDER: CARDS ─────────────────────────────────────────────────────
function renderCards(articles) {
    if (!articles.length) {
        refs.newsContainer.innerHTML = `<div class="empty-state"><strong>No results found</strong> Try adjusting your search term or category filter.</div>`;
        return;
    }

    refs.newsContainer.innerHTML = "";

    articles.forEach((a) => {
        const sc = sentimentClass(a.sentiment);
        const assets = Array.isArray(a.assets) ? a.assets : [];
        const aiNote = a.analysis || fallbackAnalysis(a);
        const isSaved = state.savedArticles.has(String(a.id));

        const assetTagsHtml = assets.length
            ? assets.map((t) => `<span class="asset-tag">${escapeHtml(t)}</span>`).join("")
            : `<span style="font-size:11px;color:var(--muted)">No mapped assets</span>`;

        const card = document.createElement("article");
        card.className = `news-card ${sc}`;
        card.innerHTML = `
            <div class="card-stripe"></div>
            <div class="card-body">
                <div class="card-cat-row">
                    <span class="card-cat"><span class="cat-icon" aria-hidden="true">${getCategoryIcon(a.category)}</span>${escapeHtml(a.category)}</span>
                    <span class="sent-badge ${sc}">${escapeHtml(a.sentiment || "Neutral")}</span>
                </div>
                <h2 class="card-headline">${escapeHtml(a.title)}</h2>
                <div class="score-row">
                    <div class="score-pill ai"><span class="sp-label">AI Score</span><span class="sp-val">${a.ai_score}</span></div>
                    <div class="score-pill"><span class="sp-label">Importance</span><span class="sp-val">${a.importance}/10</span></div>
                    <div class="score-pill"><span class="sp-label">Confidence</span><span class="sp-val">${a.confidence}%</span></div>
                </div>
                <div class="card-div"></div>
                <div class="card-data">
                    <div><div class="data-label">Category</div><div class="data-val">${escapeHtml(a.category)}</div></div>
                    <div><div class="data-label">Added</div><div class="data-val">${formatAddedAt(a.added_at)}</div></div>
                    <div><div class="data-label">Assets</div><div class="data-val">${assets.length ? escapeHtml(assets.join(", ")) : "—"}</div></div>
                    <div><div class="data-label">Market Impact</div><div class="data-val">${escapeHtml(a.market_impact || "Neutral")}</div></div>
                </div>
                <div class="ai-note">
                    <div class="ai-note-header"><span class="ai-chip">AI Analysis</span></div>
                    <p class="ai-note-text">${escapeHtml(aiNote)}</p>
                </div>
                <div class="card-footer">
                    <div class="asset-tags">${assetTagsHtml}</div>
                    <div style="display:flex;gap:8px;align-items:center;">
                        <button class="bookmark-btn ${isSaved ? 'saved' : ''}" onclick="toggleBookmark('${a.id}')" title="${isSaved ? 'Remove bookmark' : 'Save article'}">
                            ${isSaved ? '★ Saved' : '☆ Save'}
                        </button>
                        <a class="read-link" href="${escapeHtml(a.link)}" target="_blank" rel="noopener noreferrer">Read →</a>
                    </div>
                </div>
            </div>`;
        refs.newsContainer.appendChild(card);
    });
}

// ── RENDER: DASHBOARD ─────────────────────────────────────────────────
function renderDashboard() {
    const filtered = getFilteredArticles().sort((a, b) => b.ai_score - a.ai_score);
    renderHero(filtered);
    renderSignalStrip(filtered);
    renderBrief(filtered);
    renderCards(filtered);
}

// ── LOAD NEWS (Flask API) ─────────────────────────────────────────────
async function loadNews() {
    try {
        if (refs.lastUpdated) refs.lastUpdated.textContent = "Refreshing…";
        if (refs.refreshBtn) refs.refreshBtn.disabled = true;

        const response = await fetch(API_URL, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        state.articles = data.map(normalizeArticle);

        renderFilters();
        renderDashboard();

        if (refs.lastUpdated) {
            refs.lastUpdated.textContent = "Updated " + new Date().toLocaleTimeString("en-IN", { hour12: true });
        }
    } catch (error) {
        console.error("[TradeTrends]", error);
        if (refs.lastUpdated) refs.lastUpdated.textContent = "Load failed";
        if (refs.newsContainer) {
            refs.newsContainer.innerHTML = `<div class="empty-state"><strong>Unable to load feed</strong> Check that the API is running, then refresh.</div>`;
        }
    } finally {
        if (refs.refreshBtn) refs.refreshBtn.disabled = false;
    }
}

// ── UTIL ──────────────────────────────────────────────────────────────
function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function setTickerPair(priceId, changeId, priceValue, changeValue, isLiveLabel = false) {
    const priceEl = document.getElementById(priceId);
    const changeEl = document.getElementById(changeId);
    if (!priceEl || !changeEl) return;

    if (priceValue === null || priceValue === undefined || priceValue === "N/A") {
        priceEl.textContent = "N/A";
    } else {
        const numericPrice = Number(priceValue);
        priceEl.textContent = Number.isFinite(numericPrice) ? numericPrice.toLocaleString("en-IN") : String(priceValue);
    }

    if (isLiveLabel) {
        changeEl.textContent = "LIVE";
        changeEl.style.color = "#10b981";
        return;
    }

    const numericChange = Number(changeValue);
    if (Number.isFinite(numericChange)) {
        changeEl.textContent = (numericChange >= 0 ? "▲ " : "▼ ") + Math.abs(numericChange).toFixed(2) + "%";
        changeEl.style.color = numericChange >= 0 ? "#10b981" : "#ef4444";
    } else {
        changeEl.textContent = "--";
        changeEl.style.color = "#94a3b8";
    }
}

async function loadTicker() {
    try {
        const response = await fetch(MARKET_API_URL, { cache: "no-store" });
        const data = await response.json();

        if (data.BTC) {
            setTickerPair("btc-price", "btc-change", data.BTC.price, data.BTC.change, false);
        }
        if (data.USDINR) {
            setTickerPair("usdinr-price", "usdinr-change", data.USDINR.price, data.USDINR.change, true);
        }
        if (data.GOLD) {
            setTickerPair("gold-price", "gold-change", data.GOLD.price, data.GOLD.change, false);
        }
        if (data.NIFTY) {
            setTickerPair("nifty-price", "nifty-change", data.NIFTY.price, data.NIFTY.change, true);
        }
        if (data.BANKNIFTY) {
            setTickerPair("banknifty-price", "banknifty-change", data.BANKNIFTY.price, data.BANKNIFTY.change, true);
        }
    } catch (error) {
        console.error("Ticker Error:", error);
    }
}
