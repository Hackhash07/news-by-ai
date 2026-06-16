const API_URL = "http://127.0.0.1:5000/news";

const state = {
    articles: [],
    activeCategory: "All",
    search: ""
};

const refs = {};

// ── INIT ──────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    refs.briefPanel     = document.getElementById("brief-panel");
    refs.searchInput    = document.getElementById("search-input");
    refs.categoryFilters = document.getElementById("category-filters");
    refs.refreshBtn     = document.getElementById("refresh-btn");
    refs.newsContainer  = document.getElementById("news-container");
    refs.lastUpdated    = document.getElementById("last-updated");
    refs.tickerTime     = document.getElementById("ticker-time");
    refs.marketDot      = document.getElementById("market-dot");
    refs.marketText     = document.getElementById("market-status-text");

    // Live clock
    updateClock();
    setInterval(updateClock, 1000);

    // Market open/closed heuristic (Mon–Fri 09:15–15:30 IST)
    updateMarketStatus();

    refs.searchInput.addEventListener("input", (e) => {
        state.search = e.target.value || "";
        renderDashboard();
    });

    refs.refreshBtn.addEventListener("click", loadNews);

    loadNews();
    setInterval(loadNews, 60000);
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
    const day = now.getDay(); // 0=Sun, 6=Sat
    const hour = now.getHours();
    const min  = now.getMinutes();
    const mins = hour * 60 + min;
    const open   = 9 * 60 + 15;   // 09:15
    const close  = 15 * 60 + 30;  // 15:30
    const isOpen = day >= 1 && day <= 5 && mins >= open && mins < close;
    refs.marketDot.className  = "market-dot " + (isOpen ? "open" : "closed");
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
    const assets     = safeJsonParse(article.assets, []);
    const directions = safeJsonParse(article.directions, {});
    const importance = Number(article.importance) || 0;
    const confidence = Number(article.confidence) || 0;
    let category     = String(article.category || "General").trim();
    if (category.includes("|")) category = category.split("|")[0].trim();

    return {
        ...article,
        category: category || "General",
        assets,
        directions,
        importance,
        confidence,
        ai_score: importance * confidence
    };
}

function getFilteredArticles() {
    const search = state.search.trim().toLowerCase();
    return state.articles.filter((a) => {
        if (state.activeCategory !== "All" && a.category !== state.activeCategory) return false;
        if (!search) return true;
        const hay = [
            a.title, a.category, a.sentiment, a.time_horizon,
            Array.isArray(a.assets) ? a.assets.join(" ") : ""
        ].join(" ").toLowerCase();
        return hay.includes(search);
    });
}

function getThemeCounts(articles) {
    const counts = {};
    articles.forEach((a) => {
        const k = a.category || "General";
        counts[k] = (counts[k] || 0) + 1;
    });
    return counts;
}

function getSentimentMood(articles) {
    let pos = 0, neg = 0, neu = 0;
    articles.forEach((a) => {
        const w   = a.ai_score || 0;
        const s   = String(a.sentiment || "").toLowerCase();
        if (s.includes("positive"))      pos += w;
        else if (s.includes("negative")) neg += w;
        else                             neu += w;
    });
    const total = pos + neg + neu || 1;
    if (pos / total >= 0.55) return "Risk-On";
    if (neg / total >= 0.55) return "Risk-Off";
    return "Mixed";
}

function moodClass(mood) {
    const m = mood.toLowerCase();
    if (m.includes("risk-on"))  return "risk-on";
    if (m.includes("risk-off")) return "risk-off";
    return "mixed";
}

// ── RENDER: BRIEF ─────────────────────────────────────────────────────
function renderBrief(articles) {
    const total        = articles.length;
    const avgConf      = total
        ? Math.round(articles.reduce((s, a) => s + (a.confidence || 0), 0) / total)
        : 0;
    const topArticle   = [...articles].sort((a, b) => b.ai_score - a.ai_score)[0];
    const themeCounts  = getThemeCounts(articles);
    const topThemes    = Object.entries(themeCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([t, c]) => `${t} (${c})`)
        .join(", ") || "—";
    const mood = getSentimentMood(articles);

    refs.briefPanel.innerHTML = `
        <div class="brief-card">
            <div class="brief-header-strip">
                <div class="brief-header-left">
                    <div class="brief-icon">📊</div>
                    <span class="brief-title">AI Market Brief</span>
                </div>
                <span class="brief-tag">Refreshed live · ${total} article${total !== 1 ? "s" : ""}</span>
            </div>
            <div class="brief-grid">
                <div class="brief-item">
                    <div class="bi-label">Market Mood</div>
                    <div class="bi-value ${moodClass(mood)}">${mood}</div>
                </div>
                <div class="brief-item">
                    <div class="bi-label">Top Themes</div>
                    <div class="bi-value">${topThemes}</div>
                </div>
                <div class="brief-item">
                    <div class="bi-label">Top Story</div>
                    <div class="bi-value">${topArticle ? topArticle.title : "No articles"}</div>
                </div>
                <div class="brief-item">
                    <div class="bi-label">Avg Confidence</div>
                    <div class="bi-value mono">${avgConf}%</div>
                </div>
            </div>
        </div>
    `;
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
function getCategoryIcon(category) {
    const map = {
        "Finance":    "💰",
        "Geopolitics": "🌐",
        "Technology": "💻",
        "Energy":     "⚡",
        "Markets":    "📈",
        "Economy":    "🏦",
        "Commodities":"🛢️",
        "Crypto":     "₿"
    };
    return map[category] || "📰";
}

function sentimentClass(sentiment) {
    const s = String(sentiment || "").toLowerCase();
    if (s.includes("positive")) return "positive";
    if (s.includes("negative")) return "negative";
    return "neutral";
}

function renderCards(articles) {
    if (!articles.length) {
        refs.newsContainer.innerHTML = `
            <div class="empty-state">
                <strong>No results found</strong>
                Try adjusting your search term or category filter.
            </div>
        `;
        return;
    }

    refs.newsContainer.innerHTML = "";

    articles.forEach((a) => {
        const sc    = sentimentClass(a.sentiment);
        const assets = Array.isArray(a.assets) ? a.assets : [];
        const aiNote = a.analysis || a.summary ||
            `Tagged as ${a.category} with ${a.confidence}% confidence. ` +
            `${a.time_horizon ? a.time_horizon + " time horizon. " : ""}` +
            `${assets.length ? "Affects: " + assets.join(", ") + "." : "No specific assets mapped."}`;

        const assetTagsHtml = assets.length
            ? assets.map((t) => `<span class="asset-tag">${t}</span>`).join("")
            : `<span style="font-size:11px;color:var(--t3)">No mapped assets</span>`;

        const card = document.createElement("article");
        card.className = `news-card ${sc}`;
        card.innerHTML = `
            <div class="card-stripe"></div>
            <div class="card-body">
                <div class="card-cat-row">
                    <span class="card-cat">
                        <span class="cat-icon" aria-hidden="true">${getCategoryIcon(a.category)}</span>
                        ${escapeHtml(a.category)}
                    </span>
                    <span class="sent-badge ${sc}">${escapeHtml(a.sentiment || "Neutral")}</span>
                </div>

                <h2 class="card-headline">${escapeHtml(a.title)}</h2>

                <div class="score-row">
                    <div class="score-pill ai">
                        <span class="sp-label">AI Score</span>
                        <span class="sp-val">${a.ai_score}</span>
                    </div>
                    <div class="score-pill">
                        <span class="sp-label">Importance</span>
                        <span class="sp-val">${a.importance}/10</span>
                    </div>
                    <div class="score-pill">
                        <span class="sp-label">Confidence</span>
                        <span class="sp-val">${a.confidence}%</span>
                    </div>
                </div>

                <div class="card-div"></div>

                <div class="card-data">
                    <div>
                        <div class="data-label">Category</div>
                        <div class="data-val">${escapeHtml(a.category)}</div>
                    </div>
                    <div>
                        <div class="data-label">Time Horizon</div>
                        <div class="data-val">${escapeHtml(a.time_horizon || "Unknown")}</div>
                    </div>
                    <div>
                        <div class="data-label">Assets</div>
                        <div class="data-val">${assets.length ? escapeHtml(assets.join(", ")) : "—"}</div>
                    </div>
                    <div>
                        <div class="data-label">Market Impact</div>
                        <div class="data-val">${escapeHtml(a.market_impact || "Unknown")}</div>
                    </div>
                </div>

                <div class="ai-note">
                    <div class="ai-note-header">
                        <span class="ai-chip">AI Analysis</span>
                    </div>
                    <p class="ai-note-text">${escapeHtml(aiNote)}</p>
                </div>

                <div class="card-footer">
                    <div class="asset-tags">${assetTagsHtml}</div>
                    <a class="read-link" href="${escapeHtml(a.link)}" target="_blank" rel="noopener noreferrer">
                        Read →
                    </a>
                </div>
            </div>
        `;
        refs.newsContainer.appendChild(card);
    });
}

// ── RENDER: DASHBOARD ─────────────────────────────────────────────────
function renderDashboard() {
    const filtered = getFilteredArticles().sort((a, b) => b.ai_score - a.ai_score);
    renderBrief(filtered);
    renderCards(filtered);
}

// ── LOAD NEWS ─────────────────────────────────────────────────────────
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
            refs.newsContainer.innerHTML = `
                <div class="empty-state">
                    <strong>Unable to load feed</strong>
                    Check that the Flask API is running on port 5000, then refresh.
                </div>
            `;
        }
    } finally {
        if (refs.refreshBtn) refs.refreshBtn.disabled = false;
    }
}

// ── UTIL ──────────────────────────────────────────────────────────────
function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
