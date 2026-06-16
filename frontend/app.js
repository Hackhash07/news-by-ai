const API_URL = "http://127.0.0.1:5000/news";

const state = {
    articles: [],
    activeCategory: "All",
    search: ""
};

const refs = {};

document.addEventListener("DOMContentLoaded", () => {
    refs.briefPanel = document.getElementById("brief-panel");
    refs.searchInput = document.getElementById("search-input");
    refs.categoryFilters = document.getElementById("category-filters");
    refs.refreshBtn = document.getElementById("refresh-btn");
    refs.newsContainer = document.getElementById("news-container");
    refs.lastUpdated = document.getElementById("last-updated");

    refs.searchInput.addEventListener("input", (event) => {
        state.search = event.target.value || "";
        renderDashboard();
    });

    refs.refreshBtn.addEventListener("click", () => {
        loadNews();
    });

    loadNews();
    setInterval(loadNews, 60000);
});

function safeJsonParse(value, fallback) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") return value;

    if (typeof value === "string") {
        try {
            return JSON.parse(value);
        } catch {
            return fallback;
        }
    }

    return fallback;
}

function normalizeArticle(article) {
    const assets = safeJsonParse(article.assets, []);
    const directions = safeJsonParse(article.directions, {});

    const importance = Number(article.importance) || 0;
    const confidence = Number(article.confidence) || 0;

    let category = String(article.category || "General").trim();
    if (category.includes("|")) {
        category = category.split("|")[0].trim();
    }

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

    return state.articles.filter((article) => {
        const categoryMatch =
            state.activeCategory === "All" ||
            article.category === state.activeCategory;

        if (!categoryMatch) return false;

        if (!search) return true;

        const haystack = [
            article.title,
            article.category,
            article.sentiment,
            article.time_horizon,
            Array.isArray(article.assets) ? article.assets.join(" ") : "",
            article.link
        ].join(" ").toLowerCase();

        return haystack.includes(search);
    });
}

function getThemeCounts(articles) {
    const counts = {};
    articles.forEach((article) => {
        const key = article.category || "General";
        counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
}

function getSentimentMood(articles) {
    let positive = 0;
    let negative = 0;
    let neutral = 0;

    articles.forEach((article) => {
        const weight = article.ai_score || 0;
        const sentiment = String(article.sentiment || "").toLowerCase();

        if (sentiment.includes("positive")) positive += weight;
        else if (sentiment.includes("negative")) negative += weight;
        else neutral += weight;
    });

    const total = positive + negative + neutral || 1;
    const positiveShare = positive / total;
    const negativeShare = negative / total;

    if (positiveShare >= 0.55) return "Risk-On";
    if (negativeShare >= 0.55) return "Risk-Off";
    return "Mixed";
}

function renderBrief(articles) {
    const total = articles.length;
    const avgConfidence = total
        ? Math.round(articles.reduce((sum, a) => sum + (a.confidence || 0), 0) / total)
        : 0;

    const topArticle = [...articles].sort((a, b) => b.ai_score - a.ai_score)[0];
    const themeCounts = getThemeCounts(articles);

    const topThemes = Object.entries(themeCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([theme, count]) => `${theme} (${count})`)
        .join(", ") || "None";

    const marketMood = getSentimentMood(articles);

    refs.briefPanel.innerHTML = `
        <div class="brief-card">
            <div class="brief-title">
                <h2>AI Market Brief</h2>
                <span>Updated for current filter</span>
            </div>

            <div class="brief-grid">
                <div class="brief-item">
                    <div class="brief-label">Market Mood</div>
                    <div class="brief-value">${marketMood}</div>
                </div>
                <div class="brief-item">
                    <div class="brief-label">Top Themes</div>
                    <div class="brief-value">${topThemes}</div>
                </div>
                <div class="brief-item">
                    <div class="brief-label">Most Important Story</div>
                    <div class="brief-value">${topArticle ? topArticle.title : "No articles"}</div>
                </div>
                <div class="brief-item">
                    <div class="brief-label">Average Confidence</div>
                    <div class="brief-value">${avgConfidence}%</div>
                </div>
            </div>
        </div>
    `;
}

function renderFilters() {
    const categories = ["All", ...new Set(state.articles.map((a) => a.category))];

    refs.categoryFilters.innerHTML = categories
        .map((category) => {
            const active = category === state.activeCategory ? "active" : "";
            return `<button class="chip ${active}" data-category="${category}" type="button">${category}</button>`;
        })
        .join("");

    refs.categoryFilters.querySelectorAll(".chip").forEach((button) => {
        button.addEventListener("click", () => {
            state.activeCategory = button.dataset.category;
            renderFilters();
            renderDashboard();
        });
    });
}

function renderCards(articles) {
    if (!articles.length) {
        refs.newsContainer.innerHTML = `
            <div class="empty-state">
                No articles match the current search or filter.
            </div>
        `;
        return;
    }

    refs.newsContainer.innerHTML = "";

    articles.forEach((article) => {
        const card = document.createElement("article");
        card.className = `news-card ${String(article.sentiment || "").toLowerCase().includes("positive") ? "positive" : String(article.sentiment || "").toLowerCase().includes("negative") ? "negative" : "neutral"}`;

        const assets = Array.isArray(article.assets) ? article.assets : [];
        const analysis = article.analysis || article.summary || null;

        const aiNote = analysis
            ? analysis
            : `This headline is tagged as ${article.category} with ${article.confidence}% confidence. It has a ${article.time_horizon.toLowerCase()} time horizon and touches ${assets.length ? assets.join(", ") : "no mapped assets"}.`;

        card.innerHTML = `
            <div class="card-top">
                <h2 class="news-title">${article.title}</h2>
                <span class="badge ${String(article.sentiment || "").toLowerCase().includes("positive") ? "green" : String(article.sentiment || "").toLowerCase().includes("negative") ? "red" : "gray"}">
                    ${article.sentiment}
                </span>
            </div>

            <div class="meta-row">
                <span class="badge gray">AI Score ${article.ai_score}</span>
                <span class="badge gray">Importance ${article.importance}</span>
                <span class="badge gray">Confidence ${article.confidence}</span>
            </div>

            <div class="meta-grid">
                <div class="meta-item">
                    <div class="meta-label">Category</div>
                    <div class="meta-value">${article.category}</div>
                </div>
                <div class="meta-item">
                    <div class="meta-label">Time Horizon</div>
                    <div class="meta-value">${article.time_horizon}</div>
                </div>
                <div class="meta-item">
                    <div class="meta-label">Assets</div>
                    <div class="meta-value">${assets.length ? assets.join(", ") : "No mapped assets"}</div>
                </div>
                <div class="meta-item">
                    <div class="meta-label">Market Impact</div>
                    <div class="meta-value">${article.market_impact || "Unknown"}</div>
                </div>
            </div>

            <div class="section-title">AI Note</div>
            <p style="margin:0;color:var(--muted);line-height:1.7">${aiNote}</p>

            <a class="read-link" href="${article.link}" target="_blank" rel="noreferrer">
                Read Article
            </a>
        `;

        refs.newsContainer.appendChild(card);
    });
}

function renderDashboard() {
    const filtered = getFilteredArticles().sort((a, b) => b.ai_score - a.ai_score);

    renderBrief(filtered);
    renderCards(filtered);
}

async function loadNews() {
    try {
        refs.lastUpdated.textContent = "Refreshing...";

        const response = await fetch(API_URL, { cache: "no-store" });
        const data = await response.json();

        state.articles = data.map(normalizeArticle);

        renderFilters();
        renderDashboard();

        refs.lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    } catch (error) {
        console.error(error);
        refs.lastUpdated.textContent = "Load failed";
        refs.newsContainer.innerHTML = `
            <div class="empty-state">
                Could not load the dashboard. Check the Flask API and refresh.
            </div>
        `;
    }
}
