import { supabase } from "./supabase.js";

// ── Flask API on Render ──
const API_URL = "https://news-by-ai.onrender.com/news";
const MARKET_API_URL = "https://news-by-ai.onrender.com/market-data";

const state = {
  articles: [],
  activeCategory: "All",
  search: "",
  user: null,
  savedArticles: new Set(),
  sortFilter: "default",
};

const refs = {};

// ── INIT ──────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  refs.briefPanel = document.getElementById("brief-panel");
  refs.searchInput = document.getElementById("search-input");
  refs.categoryFilters = document.getElementById("category-filters");
  refs.refreshBtn = document.getElementById("refresh-btn");
  refs.newsContainer = document.getElementById("news-container");
  refs.lastUpdated = document.getElementById("last-updated");
  refs.sortFilter = document.getElementById("news-sort-filter");

  if (refs.sortFilter) {
    refs.sortFilter.addEventListener("change", (e) => {
      state.sortFilter = e.target.value;
      loadNews();
    });
  }
  refs.tickerTime = document.getElementById("ticker-time");
  refs.marketDot = document.getElementById("market-dot");
  refs.marketText = document.getElementById("market-status-text");
  refs.navAvatar = document.getElementById("nav-avatar");

  refs.heroTitle = document.getElementById("hero-title");
  refs.heroSummary = document.getElementById("hero-summary");
  refs.heroCategory = document.getElementById("hero-category");
  refs.heroSentiment = document.getElementById("hero-sentiment");
  refs.heroHorizon = document.getElementById("hero-horizon");
  refs.marketMood = document.getElementById("market-mood");
  refs.topBullish = document.getElementById("top-bullish");
  refs.topBearish = document.getElementById("top-bearish");
  refs.articleCount = document.getElementById("article-count");
  refs.signalStrip = document.getElementById("signal-strip");

  const todayCard = document.getElementById("today-accuracy-card");
  const yesterdayCard = document.getElementById("yesterday-accuracy-card");
  const overallCard = document.getElementById("overall-accuracy-card");
  const accuracyModal = document.getElementById("accuracy-modal");
  const closeAccuracyModal = document.getElementById("close-accuracy-modal");

  function openModalForStats(type) {
    if (!window.accuracyData || !accuracyModal) return;
    const stats = window.accuracyData[type];
    
    document.getElementById("modal-correct-count").textContent = stats.correct || 0;
    document.getElementById("modal-incorrect-count").textContent = stats.incorrect || 0;
    
    let titleStr = "Overall";
    if (type === "today") titleStr = "Today's";
    if (type === "yesterday") titleStr = "Yesterday's";
    const titleEl = document.getElementById("accuracy-modal-title");
    if (titleEl) titleEl.textContent = `How We Measure ${titleStr} Accuracy`;
    
    accuracyModal.style.display = "flex";
  }

  if (todayCard) todayCard.addEventListener("click", () => openModalForStats("today"));
  if (yesterdayCard) yesterdayCard.addEventListener("click", () => openModalForStats("yesterday"));
  if (overallCard) overallCard.addEventListener("click", () => openModalForStats("overall"));

  if (closeAccuracyModal && accuracyModal) {
    closeAccuracyModal.addEventListener("click", () => {
      accuracyModal.style.display = "none";
    });

    accuracyModal.addEventListener("click", (e) => {
      if (e.target === accuracyModal) {
        accuracyModal.style.display = "none";
      }
    });
  }

  // Signal History Modal wiring
  const historyBtn = document.getElementById("view-signal-history-btn");
  const historyModal = document.getElementById("history-modal");
  const closeHistoryModal = document.getElementById("close-history-modal");

  if (historyBtn && historyModal && closeHistoryModal) {
    historyBtn.addEventListener("click", () => {
      historyModal.style.display = "flex";
      fetchSignalHistory();
    });

    closeHistoryModal.addEventListener("click", () => {
      historyModal.style.display = "none";
    });

    historyModal.addEventListener("click", (e) => {
      if (e.target === historyModal) {
        historyModal.style.display = "none";
      }
    });
  }

  if (refs.searchInput) {
    refs.searchInput.addEventListener("input", (e) => {
      state.search = e.target.value || "";
      renderDashboard();
    });
  }

  if (refs.refreshBtn) {
    refs.refreshBtn.addEventListener("click", loadNews);
  }

  // Listen to Supabase auth for avatar + bookmarks
  supabase.auth.onAuthStateChange(async (event, session) => {
    const user = session?.user;
    state.user = user;
    if (user) {
      const { data: userData, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      if (userData && refs.navAvatar) {
        if (userData.photo_url) {
          refs.navAvatar.innerHTML = `<img src="${userData.photo_url}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" referrerpolicy="no-referrer">`;
        } else {
          refs.navAvatar.textContent = (userData.display_name ||
            user.email ||
            "U")[0].toUpperCase();
        }
      }
      // Fetch bookmarks
      const fetchBookmarks = async () => {
        const { data } = await supabase
          .from("bookmarks")
          .select("title")
          .eq("user_id", user.id);
        state.savedArticles.clear();
        if (data) data.forEach((d) => state.savedArticles.add(d.title));
        if (state.articles.length) renderDashboard();
      };
      fetchBookmarks();

      supabase
        .channel("public:bookmarks")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "bookmarks",
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            fetchBookmarks();
          },
        )
        .subscribe();
    } else {
      if (refs.navAvatar) refs.navAvatar.textContent = "?";
      state.savedArticles.clear();
    }
  });

  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session?.user) state.user = session.user;
  });

  // Hydrate from cache immediately
  const cachedNews = localStorage.getItem("trade_trends_cache");
  if (cachedNews) {
    try {
      const data = JSON.parse(cachedNews);
      state.articles = data.map(normalizeArticle);

      if (refs.heroTitle) refs.heroTitle.className = "hero-title";
      if (refs.heroSummary) {
        refs.heroSummary.className = "hero-summary";
        refs.heroSummary.style = "";
      }

      renderFilters();
      renderDashboard();
      if (refs.lastUpdated)
        refs.lastUpdated.textContent = "Showing cached data...";
    } catch (e) {}
  }

  const cachedTicker = localStorage.getItem("trade_trends_ticker_cache");
  if (cachedTicker) {
    try {
      renderTicker(JSON.parse(cachedTicker));
    } catch (e) {}
  }

  // Load news from Flask API on Render
  loadNews();
  setInterval(loadNews, 60000);

  // Load market ticker from new backend endpoint
  updateTickerBar();
  setInterval(updateTickerBar, 60000);

  // Load Daily Brief
  loadDailyBrief();

  // Load Signal Accuracy
  loadSignalAccuracy();
});

async function loadDailyBrief() {
  try {
    const response = await fetch(
      "https://news-by-ai.onrender.com/api/daily-brief",
    );
    if (!response.ok) return;
    const brief = await response.json();

    const banner = document.getElementById("daily-brief-banner");
    if (banner && !brief.error) {
      let color = "var(--muted)";
      if (brief.overall_sentiment.toLowerCase().includes("bullish"))
        color = "var(--green)";
      else if (brief.overall_sentiment.toLowerCase().includes("bearish"))
        color = "var(--red)";

      const assetsHtml = (brief.top_assets || [])
        .map((a) => `<span class="brief-asset-pill">${escapeHtml(a)}</span>`)
        .join("");

      banner.innerHTML = `
                <div class="brief-banner-content">
                    <div class="brief-banner-header">
                        <span style="color: var(--gold); font-weight: bold; margin-right: 8px;">TODAY'S BRIEF</span> 
                        <span style="color: ${color}; font-size: 12px;">● ${escapeHtml(brief.overall_sentiment)}</span>
                    </div>
                    <div class="brief-banner-headline">${escapeHtml(brief.headline)}</div>
                    <div class="brief-banner-summary">${escapeHtml(brief.summary)}</div>
                    <div class="brief-banner-assets">${assetsHtml}</div>
                </div>
            `;
      banner.style.display = "block";
    }
  } catch (e) {
    console.error("Failed to load daily brief", e);
  }
}

async function loadSignalAccuracy() {
  if (!document.getElementById("overall-accuracy")) return;
  try {
    const response = await fetch(
      "https://news-by-ai.onrender.com/api/signal-accuracy",
    );
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    if (data.error) {
      return;
    }

    function renderAccuracyCard(elementId, stats) {
      const ref = document.getElementById(elementId);
      if (!ref || !stats) return;
      const pct = Math.round(stats.accuracy * 100);
      const evaluated = stats.evaluated_signals || 0;
      let color = "var(--red)";
      if (pct >= 60) color = "var(--green)";
      else if (pct >= 50) color = "#f59e0b";
      ref.innerHTML = `<span style="color:${color}">${pct}%</span> <span style="font-size:11px; color:var(--muted); font-weight:400;">(${evaluated} signals)</span>`;
    }

    window.accuracyData = data;
    renderAccuracyCard("today-accuracy", data.today);
    renderAccuracyCard("yesterday-accuracy", data.yesterday);
    renderAccuracyCard("overall-accuracy", data.overall);
  } catch (e) {
    console.error("Failed to load accuracy", e);
  }
}

function updateClock() {
  if (!refs.tickerTime) return;
  refs.tickerTime.textContent = new Date().toLocaleTimeString("en-IN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function updateMarketStatus() {
  if (!refs.marketDot || !refs.marketText) return;
  
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  
  const parts = formatter.formatToParts(new Date());
  let weekday = "";
  let hour = 0;
  let minute = 0;
  
  for (const part of parts) {
    if (part.type === "weekday") weekday = part.value;
    if (part.type === "hour") hour = parseInt(part.value, 10);
    if (part.type === "minute") minute = parseInt(part.value, 10);
  }
  
  const isWeekend = weekday === "Sat" || weekday === "Sun";
  const mins = hour * 60 + minute;
  
  // NYSE: 9:30 AM (570 mins) to 4:00 PM (960 mins) EST
  const isOpen = !isWeekend && mins >= 570 && mins < 960;
  
  refs.marketDot.className = "market-dot " + (isOpen ? "open" : "closed");
  refs.marketText.textContent = isOpen ? "Markets Open" : "Markets Closed";
}

// ── DATA HELPERS ──────────────────────────────────────────────────────
function safeJsonParse(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === "object"))
    return value;
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
  const structured_analysis = safeJsonParse(article.structured_analysis, null);
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
    structured_analysis: structured_analysis,
    added_at: article.added_at || "",
    ai_score: importance * confidence,
  };
}

function getFilteredArticles() {
  const search = state.search.trim().toLowerCase();
  return state.articles.filter((a) => {
    if (state.activeCategory !== "All" && a.category !== state.activeCategory)
      return false;
    if (!search) return true;
    const hay = [
      a.title,
      a.category,
      a.sentiment,
      a.market_impact,
      Array.isArray(a.assets) ? a.assets.join(" ") : "",
    ]
      .join(" ")
      .toLowerCase();
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
  let pos = 0,
    neg = 0,
    neu = 0;
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
  return (
    [...articles].sort((a, b) => (b.ai_score || 0) - (a.ai_score || 0))[0] ||
    null
  );
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
  return (
    Object.entries(signalMap)
      .map(([asset, counts]) => ({
        asset,
        count: counts[side],
        total: counts.Bullish + counts.Bearish + counts.Neutral,
      }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count || b.total - a.total)[0] || null
  );
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
  const assets =
    Array.isArray(article.assets) && article.assets.length
      ? article.assets.join(", ")
      : "broader markets";
  return `Assets most exposed to this event include ${assets}. The system is currently analyzing the ${article.category || "General"} impact.`;
}

function getCategoryIcon(category) {
  const map = {
    Finance: "💰",
    Geopolitics: "🌐",
    Geopolitical: "🌐",
    Technology: "💻",
    Energy: "⚡",
    Markets: "📈",
    Economy: "🏦",
    Commodities: "🛢️",
    Crypto: "₿",
    Macro: "🏦",
    Equities: "📈",
    Forex: "💱",
    "Fixed Income": "🏛️",
    "Monetary Policy": "🏛️",
    "Politics": "🏛️",
  };
  return map[category] || "📰";
}

function sentimentClass(sentiment) {
  const s = String(sentiment || "").toLowerCase();
  if (s.includes("positive")) return "positive";
  if (s.includes("negative")) return "negative";
  return "neutral";
}

// ── BOOKMARK ──────────────────────────────────────────────────────────
window.toggleBookmark = async function (articleId) {
  if (!requireAuth("save articles")) return;
  const article = state.articles.find(
    (a) => String(a.id) === String(articleId),
  );
  if (!article) return;

  if (state.savedArticles.has(article.title)) {
    await supabase
      .from("bookmarks")
      .delete()
      .eq("user_id", state.user.id)
      .eq("title", article.title);
  } else {
    const { error } = await supabase.from("bookmarks").insert({
      user_id: state.user.id,
      saved_at: new Date().toISOString(),
      title: article.title,
      link: article.link || "#",
      category: article.category || "General",
      article_id: String(article.id),
    });
    if (error) {
      showToast("Failed to save bookmark", "error");
    } else {
    }
  }
};

// ── PREDICTION MARKET ────────────────────────────────────────────────
window.voteOnNews = async function (articleId, voteType) {
  if (!requireAuth("vote on intelligence")) return;

  // Optimistic UI update
  const cardEl = document.getElementById(`news-card-${articleId}`);
  if (cardEl) {
    const marketEl = cardEl.querySelector(".prediction-market");
    if (marketEl) {
      marketEl.innerHTML = `<div style="text-align:center; padding: 10px; color: var(--gold);">Voting...</div>`;
    }
  }

  try {
    const response = await fetch(
      `https://news-by-ai.onrender.com/api/news/${articleId}/vote`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: state.user.id, vote: voteType }),
      },
    );

    const data = await response.json();
    if (response.ok) {
      localStorage.setItem(`voted_${articleId}`, voteType);
      // Update local state
      const article = state.articles.find(
        (a) => String(a.id) === String(articleId),
      );
      if (article) {
        article.bullish_votes = data.bullish_votes;
        article.bearish_votes = data.bearish_votes;
      }
      renderDashboard();
    } else {
      alert(data.error || "Failed to vote");
      renderDashboard(); // Revert
    }
  } catch (e) {
    console.error("Vote error", e);
    alert("Failed to cast vote");
    renderDashboard(); // Revert
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
    if (refs.heroSummary)
      refs.heroSummary.textContent =
        "Run the collector to load fresh headlines.";
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
  if (refs.heroCategory)
    refs.heroCategory.textContent = `Category: ${top.category}`;
  if (refs.heroSentiment)
    refs.heroSentiment.textContent = `Sentiment: ${top.sentiment}`;
  if (refs.heroHorizon)
    refs.heroHorizon.textContent = formatAddedAt(top.added_at);
  if (refs.marketMood) refs.marketMood.textContent = mood;
  if (refs.topBullish)
    refs.topBullish.textContent = bullish
      ? `${bullish.asset} (Exposure: ${bullish.count})`
      : "—";
  if (refs.topBearish)
    refs.topBearish.textContent = bearish
      ? `${bearish.asset} (Mentions: ${bearish.count})`
      : "—";
  if (refs.articleCount)
    refs.articleCount.textContent = String(articles.length);
}

function renderSignalStrip(articles) {
  if (!refs.signalStrip) return;
  const signalMap = aggregateAssetSignals(articles);
  const ranked = Object.entries(signalMap)
    .map(([asset, counts]) => ({
      asset,
      mentions: counts.Bullish + counts.Bearish + counts.Neutral,
    }))
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 6);

  if (!ranked.length) {
    refs.signalStrip.innerHTML = "";
    return;
  }

  refs.signalStrip.innerHTML = ranked
    .map((item) => {
      return `<article class="signal-card flat">
            <div class="signal-head"><span class="signal-asset">${escapeHtml(item.asset)}</span></div>
            <div class="signal-bars"><span>Exposure Score: ${item.mentions}</span></div>
        </article>`;
    })
    .join("");
}

// ── RENDER: BRIEF ─────────────────────────────────────────────────────
function renderBrief(articles) {
  const total = articles.length;
  const avgConf = total
    ? Math.round(articles.reduce((s, a) => s + (a.confidence || 0), 0) / total)
    : 0;
  const topArticle = [...articles].sort((a, b) => b.ai_score - a.ai_score)[0];
  const themeCounts = getThemeCounts(articles);
  const topThemes =
    Object.entries(themeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([t, c]) => `${t} (${c})`)
      .join(", ") || "—";
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
    .map(
      (c) =>
        `<button class="chip ${c === state.activeCategory ? "active" : ""}" data-cat="${c}" type="button">${c}</button>`,
    )
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
    const isSaved = state.savedArticles.has(a.title);

    const assetTagsHtml = assets.length
      ? assets
          .map((t) => `<span class="asset-tag">${escapeHtml(t)}</span>`)
          .join("")
      : `<span style="font-size:11px;color:var(--muted)">No mapped assets</span>`;

    const card = document.createElement("article");
    card.id = `news-card-${a.id}`;
    card.className = `news-card ${sc}`;
    card.innerHTML = `
            <div class="card-stripe"></div>
            <div class="card-body">
                <div class="card-cat-row">
                    <span class="card-cat"><span class="cat-icon" aria-hidden="true">${getCategoryIcon(a.category)}</span>${escapeHtml(a.category)}</span>
                    <span class="sent-badge ${sc}">${escapeHtml(a.sentiment || "Neutral")}</span>
                    ${(() => {
                      const sa = a.structured_analysis;
                      if (!sa || !sa.affected_assets) return '';
                      const evaluated = sa.affected_assets.filter(ast => ast.outcome_1h && ast.outcome_1h !== 'Neutral');
                      if (!evaluated.length) return '';
                      const correct = evaluated.filter(ast => ast.outcome_1h === 'Correct').length;
                      const incorrect = evaluated.filter(ast => ast.outcome_1h === 'Incorrect').length;
                      if (correct > 0 && incorrect === 0) return `<span style="margin-left:6px;padding:2px 8px;background:rgba(39,196,122,0.15);border:1px solid var(--green);border-radius:4px;font-size:10px;color:var(--green);font-weight:700;text-transform:uppercase;">✓ Signal Correct</span>`;
                      if (incorrect > 0 && correct === 0) return `<span style="margin-left:6px;padding:2px 8px;background:rgba(255,82,82,0.15);border:1px solid var(--red);border-radius:4px;font-size:10px;color:var(--red);font-weight:700;text-transform:uppercase;">✗ Signal Incorrect</span>`;
                      return `<span style="margin-left:6px;padding:2px 8px;background:rgba(255,255,255,0.08);border:1px solid var(--border);border-radius:4px;font-size:10px;color:var(--muted);font-weight:700;text-transform:uppercase;">${correct}✓ ${incorrect}✗</span>`;
                    })()}
                </div>
                <h2 class="card-headline">${escapeHtml(a.title)}</h2>
                <div class="score-row">
                    <div class="score-pill ai"><span class="sp-label">AI Score</span><span class="sp-val">${a.ai_score}</span></div>
                    <div class="score-pill"><span class="sp-label">Importance</span><span class="sp-val">${a.importance}/10</span></div>
                    ${(() => {
                      const c = a.structured_analysis?.confidence ?? a.confidence;
                      const cf = parseFloat(c);
                      if (!Number.isFinite(cf) || cf < 0 || cf > 1) {
                        return `<div class="score-pill"><span class="sp-label">Confidence</span><span class="sp-val">—</span></div>`;
                      }
                      let confStyle = '';
                      if (cf < 0.5) confStyle = 'background:rgba(245,158,11,0.15); border-color:rgba(245,158,11,0.4); color:#f59e0b;';
                      else if (cf < 0.75) confStyle = 'background:rgba(148,163,184,0.15); border-color:rgba(148,163,184,0.4); color:#94a3b8;';
                      else if (cf < 0.9) confStyle = '';
                      else confStyle = 'background:rgba(16,185,129,0.15); border-color:rgba(16,185,129,0.4); color:#10b981;';
                      return `<div class="score-pill" style="${confStyle}"><span class="sp-label">Confidence</span><span class="sp-val">${Math.round(cf * 100)}%</span></div>`;
                    })()}
                </div>
                <div class="card-div"></div>
                <div class="card-data">
                    <div><div class="data-label">Category</div><div class="data-val">${escapeHtml(a.category)}</div></div>
                    <div><div class="data-label">Added</div><div class="data-val">${formatAddedAt(a.added_at)}</div></div>
                    <div><div class="data-label">Assets</div><div class="data-val">${assets.length ? escapeHtml(assets.join(", ")) : "—"}</div></div>
                    <div><div class="data-label">Market Impact</div><div class="data-val">${escapeHtml(a.market_impact || "Neutral")}</div></div>
                </div>
                <div class="ai-note">
                    ${(() => {
                      if (
                        a.structured_analysis &&
                        Object.keys(a.structured_analysis).length > 0
                      ) {
                        const sa = a.structured_analysis;

                        const assetTags = (sa.affected_assets || [])
                          .map((ast) => {
                            const color =
                              ast.direction === "Bullish"
                                ? "var(--green)"
                                : ast.direction === "Bearish"
                                  ? "var(--red)"
                                  : "var(--muted)";
                            let outcomeBadge = "";
                            if (ast.outcome_1h) {
                                if (ast.outcome_1h === "Correct") {
                                    outcomeBadge = `<span style="display:inline-block; margin-left: 8px; padding: 2px 6px; background: rgba(39, 196, 122, 0.15); border: 1px solid var(--green); border-radius: 4px; font-size: 10px; color: var(--green); text-transform: uppercase; font-weight: 700;">✓ Correct</span>`;
                                } else if (ast.outcome_1h === "Incorrect") {
                                    outcomeBadge = `<span style="display:inline-block; margin-left: 8px; padding: 2px 6px; background: rgba(255, 82, 82, 0.15); border: 1px solid var(--red); border-radius: 4px; font-size: 10px; color: var(--red); text-transform: uppercase; font-weight: 700;">✗ Incorrect</span>`;
                                } else if (ast.outcome_1h === "Neutral") {
                                    outcomeBadge = `<span style="display:inline-block; margin-left: 8px; padding: 2px 6px; background: rgba(255, 255, 255, 0.1); border: 1px solid var(--border); border-radius: 4px; font-size: 10px; color: var(--muted); text-transform: uppercase; font-weight: 700;">− Neutral</span>`;
                                }
                            }
                            return `<div style="border-left: 2px solid ${color}; padding-left: 8px; margin-bottom: 8px;">
                                    <strong>${escapeHtml(ast.asset)}</strong> <span style="color:${color}">(${escapeHtml(ast.direction)} ${ast.confidence || 50}%)</span>${outcomeBadge}<br>
                                    <span style="font-size:12px; color:var(--muted);">${escapeHtml(ast.reason || "")}</span>
                                </div>`;
                          })
                          .join("");

                        const renderList = (arr) =>
                          arr && arr.length
                            ? `<ul style="margin:0; padding-left: 15px; color:var(--muted); font-size:13px;">${arr.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`
                            : "";
                        const renderTags = (arr) =>
                          arr && arr.length
                            ? arr
                                .map(
                                  (i) =>
                                    `<span style="display:inline-block; padding:2px 6px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:4px; font-size:11px; margin:2px 4px 2px 0;">${escapeHtml(i)}</span>`,
                                )
                                .join("")
                            : "";

                        return `
                                <div class="ai-note-header"><span class="ai-chip">Institutional Research</span></div>
                                
                                <details class="ai-accordion" open>
                                    <summary>Summary</summary>
                                    <div class="ai-note-text">
                                      <p style="margin:0 0 4px 0; font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px;">What happened — factual record</p>
                                      <p style="margin-top:0;">${escapeHtml(sa.executive_summary || "")}</p>
                                    </div>
                                </details>
                                
                                <details class="ai-accordion" open>
                                    <summary>Market Thesis</summary>
                                    <div class="ai-note-text">
                                      <p style="margin:0 0 4px 0; font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px;">Analytical interpretation</p>
                                      <p style="margin-top:0;">${escapeHtml(sa.market_thesis || "")}</p>
                                    </div>
                                </details>
                                
                                <details class="ai-accordion"${(() => { const aa = sa.affected_assets || []; return aa.some(ast => ast.outcome_1h) ? ' open' : ''; })()}>
                                    <summary>Affected Assets & Sectors</summary>
                                    <div class="ai-note-text">
                                      ${assetTags || "No specific assets targeted."}
                                      ${sa.affected_sectors && sa.affected_sectors.length ? `<div style="margin-top:8px;"><strong>Sectors:</strong><br>${renderTags(sa.affected_sectors)}</div>` : ""}
                                    </div>
                                </details>

                                ${
                                  sa.first_order_effects &&
                                  sa.first_order_effects.length
                                    ? `
                                <details class="ai-accordion">
                                    <summary>Impact Chain</summary>
                                    <div class="ai-note-text">
                                        <strong>First Order Effects:</strong>
                                        ${renderList(sa.first_order_effects)}
                                        <strong style="display:block; margin-top:8px;">Second Order Effects:</strong>
                                        ${renderList(sa.second_order_effects)}
                                    </div>
                                </details>`
                                    : ""
                                }

                                ${
                                  sa.bull_case || sa.bear_case
                                    ? `
                                <details class="ai-accordion">
                                    <summary>Scenarios & Risks</summary>
                                    <div class="ai-note-text">
                                        ${sa.bull_case ? `<div style="margin-bottom:8px;"><strong style="color:var(--green)">Bull Case:</strong> ${escapeHtml(sa.bull_case)}</div>` : ""}
                                        ${sa.bear_case ? `<div style="margin-bottom:8px;"><strong style="color:var(--red)">Bear Case:</strong> ${escapeHtml(sa.bear_case)}</div>` : ""}
                                        ${sa.key_risks && sa.key_risks.length ? `<strong>Key Risks:</strong> ${renderList(sa.key_risks)}` : ""}
                                    </div>
                                </details>`
                                    : ""
                                }
                                
                                ${
                                  sa.time_horizon
                                    ? `
                                <details class="ai-accordion">
                                    <summary>Time Horizon</summary>
                                    <div class="ai-note-text" style="display:grid; grid-template-columns:1fr; gap:6px;">
                                        ${sa.time_horizon.intraday ? `<div><span style="color:var(--gold); font-size:11px;">INTRADAY:</span> ${escapeHtml(sa.time_horizon.intraday)}</div>` : ""}
                                        ${sa.time_horizon.short_term ? `<div><span style="color:var(--gold); font-size:11px;">SHORT TERM:</span> ${escapeHtml(sa.time_horizon.short_term)}</div>` : ""}
                                        ${sa.time_horizon.medium_term ? `<div><span style="color:var(--gold); font-size:11px;">MEDIUM TERM:</span> ${escapeHtml(sa.time_horizon.medium_term)}</div>` : ""}
                                    </div>
                                </details>`
                                    : ""
                                }

                                <div style="margin-top:12px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.05);">
                                  ${sa.watch_next && sa.watch_next.length ? `<div><strong style="font-size:11px; color:var(--muted); text-transform:uppercase;">Watch Next:</strong><br>${renderTags(sa.watch_next)}</div>` : ""}
                                  ${sa.portfolio_tags && sa.portfolio_tags.length ? `<div style="margin-top:6px;"><strong style="font-size:11px; color:var(--muted); text-transform:uppercase;">Tags:</strong><br>${renderTags(sa.portfolio_tags)}</div>` : ""}
                                </div>
                            `;
                      } else {
                        // Keep fallback for older articles
                        return `
                                <div class="ai-note-header"><span class="ai-chip">Summary</span></div>
                                <p class="ai-note-text">${escapeHtml(a.analysis || "Analysis unavailable.")}</p>
                            `;
                      }
                    })()}
                </div>
                ${(() => {
                  const bullish = a.bullish_votes || 0;
                  const bearish = a.bearish_votes || 0;
                  const total = bullish + bearish;
                  const hasVoted = localStorage.getItem(`voted_${a.id}`);

                  if (total < 50) {
                    if (hasVoted) {
                      return `
                            <div class="prediction-market">
                                <div style="text-align:center; padding: 10px; color: var(--gold); font-size: 14px;">
                                    Vote recorded! Waiting for ${50 - total} more vote${50 - total === 1 ? "" : "s"} to reveal consensus.
                                </div>
                            </div>`;
                    } else {
                      return `
                            <div class="prediction-market">
                                <div class="pm-title">What's your read?</div>
                                <div class="pm-actions">
                                    <button class="pm-btn bullish" onclick="voteOnNews('${a.id}', 'bullish')">🐂 BULLISH</button>
                                    <button class="pm-btn bearish" onclick="voteOnNews('${a.id}', 'bearish')">🐻 BEARISH</button>
                                </div>
                            </div>`;
                    }
                  } else {
                    const bullPct =
                      total > 0 ? Math.round((bullish / total) * 100) : 50;
                    const bearPct = 100 - bullPct;
                    const isAiBullish =
                      a.structured_analysis?.market_interpretation
                        ?.toLowerCase()
                        .includes("bullish") ||
                      a.sentiment?.toLowerCase().includes("positive");

                    const dominantPct = bullPct >= 50 ? bullPct : bearPct;
                    const dominantLabel = bullPct >= 50 ? "Bullish" : "Bearish";

                    return `
                        <div class="prediction-market revealed">
                            <div class="pm-reveal-text">
                                <span class="ai-side">AI: ${isAiBullish ? "Bullish" : "Bearish"}</span>
                                <span class="crowd-side">· Crowd: ${dominantPct}% ${dominantLabel}</span>
                            </div>
                            <div class="pm-bar-container">
                                <div class="pm-bar bullish" style="width: ${bullPct}%"></div>
                                <div class="pm-bar bearish" style="width: ${bearPct}%"></div>
                            </div>
                        </div>`;
                  }
                })()}
                <div class="card-footer">
                    <div class="asset-tags">${assetTagsHtml}</div>
                    <div style="display:flex;gap:8px;align-items:center;">
                        <button class="bookmark-btn ${isSaved ? "saved" : ""}" onclick="toggleBookmark('${a.id}')" title="${isSaved ? "Remove bookmark" : "Save article"}">
                            ${isSaved ? "★ Saved" : "☆ Save"}
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
  let filtered = getFilteredArticles();
  
  // Only override the sort if we are on the default filter.
  // Otherwise, we respect the sorting/filtering order returned by the backend.
  if (state.sortFilter === "default") {
    filtered = filtered.sort(
      (a, b) => new Date(b.added_at).getTime() - new Date(a.added_at).getTime()
    );
  }
  
  renderHero(filtered);
  renderSignalStrip(filtered);
  renderBrief(filtered);
  renderCards(filtered);
}

// ── LOAD NEWS (Flask API on Render) ───────────────────────────────────
async function loadNews() {
  try {
    if (refs.lastUpdated) refs.lastUpdated.textContent = "Refreshing…";
    if (refs.refreshBtn) {
      refs.refreshBtn.disabled = true;
      refs.refreshBtn.classList.add("refreshing");
    }

    let isFetching = true;
    setTimeout(() => {
      if (isFetching && refs.heroTitle && state.articles.length === 0) {
        refs.heroTitle.textContent = "Market Intelligence Pending";
        refs.heroTitle.className = "hero-title";
        if (refs.heroSummary) {
          refs.heroSummary.textContent =
            "Waking up the analysis engine to fetch fresh signals. Please hold on...";
          refs.heroSummary.className = "hero-summary";
          refs.heroSummary.style = "";
        }
      }
    }, 3000);

    const targetUrl = new URL(API_URL);
    targetUrl.searchParams.set("filter", state.sortFilter);
    const response = await fetch(targetUrl.toString(), { cache: "no-store" });
    isFetching = false;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    localStorage.setItem("trade_trends_cache", JSON.stringify(data));
    state.articles = data.map(normalizeArticle);

    if (refs.heroTitle) refs.heroTitle.className = "hero-title";
    if (refs.heroSummary) {
      refs.heroSummary.className = "hero-summary";
      refs.heroSummary.style = "";
    }

    renderFilters();
    renderDashboard();

    if (state.articles.length === 0) {
      if (refs.heroTitle)
        refs.heroTitle.textContent = "No intelligence available";
      if (refs.heroSummary)
        refs.heroSummary.textContent = "Check back later for fresh signals.";
    }

    if (refs.lastUpdated) {
      refs.lastUpdated.textContent =
        "Updated " + new Date().toLocaleTimeString("en-IN", { hour12: true });
    }
  } catch (error) {
    if (state.articles.length === 0) {
      if (refs.lastUpdated) refs.lastUpdated.textContent = "Load failed";
      if (refs.newsContainer) {
        refs.newsContainer.innerHTML = `<div class="empty-state"><strong>Unable to load feed</strong> Check that the API is running, then refresh.</div>`;
      }
    }
  } finally {
    if (refs.refreshBtn) {
      refs.refreshBtn.disabled = false;
      refs.refreshBtn.classList.remove("refreshing");
    }
  }
}

// ── UTIL ──────────────────────────────────────────────────────────────
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setTickerPair(
  priceId,
  changeId,
  priceValue,
  changeValue,
  isLiveLabel = false,
) {
  const priceEl = document.getElementById(priceId);
  const changeEl = document.getElementById(changeId);
  if (!priceEl || !changeEl) return;

  if (priceValue === null || priceValue === undefined || priceValue === "N/A") {
    priceEl.textContent = "N/A";
  } else {
    const numericPrice = Number(priceValue);
    priceEl.textContent = Number.isFinite(numericPrice)
      ? numericPrice.toLocaleString("en-IN")
      : String(priceValue);
  }

  if (isLiveLabel) {
    changeEl.textContent = "LIVE";
    changeEl.style.color = "#10b981";
    return;
  }

  const numericChange = Number(changeValue);
  if (Number.isFinite(numericChange)) {
    changeEl.textContent =
      (numericChange >= 0 ? "▲ " : "▼ ") +
      Math.abs(numericChange).toFixed(2) +
      "%";
    changeEl.style.color = numericChange >= 0 ? "#10b981" : "#ef4444";
  } else {
    changeEl.textContent = "--";
    changeEl.style.color = "#94a3b8";
  }
}

let prevTicker = {};

async function updateTickerBar() {
  try {
    const res = await fetch('https://news-by-ai.onrender.com/api/market-ticker');
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();
    
    const formats = {
      USDINR: { prefix: "₹", suffix: "" },
      GOLD: { prefix: "$", suffix: "/oz" },
      NIFTY: { prefix: "", suffix: "" },
      BANKNIFTY: { prefix: "", suffix: "" },
      SPX: { prefix: "", suffix: "" },
      NASDAQ: { prefix: "", suffix: "" },
      BTC: { prefix: "$", suffix: "" }
    };
    
    // Process each supported ticker element
    ["USDINR", "GOLD", "NIFTY", "BANKNIFTY", "SPX", "NASDAQ", "BTC"].forEach(key => {
      const priceEls = document.querySelectorAll(`.${key.toLowerCase()}-price`);
      const changeEls = document.querySelectorAll(`.${key.toLowerCase()}-change`);
      
      if (!priceEls.length || !changeEls.length) return;
      
      const val = data[key];
      if (val === null || val === undefined) {
        priceEls.forEach(el => el.textContent = "--");
        changeEls.forEach(el => el.textContent = "");
        return;
      }
      
      const numVal = Number(val);
      // Format number with commas and exactly 2 decimal places
      const formattedVal = numVal.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
      
      priceEls.forEach(el => {
        el.textContent = `${formats[key].prefix}${formattedVal}${formats[key].suffix || ""}`;
      });
      
      if (prevTicker[key] !== undefined) {
        if (numVal > prevTicker[key]) {
          changeEls.forEach(el => {
            el.textContent = "▲";
            el.style.color = "#10b981"; // green
          });
        } else if (numVal < prevTicker[key]) {
          changeEls.forEach(el => {
            el.textContent = "▼";
            el.style.color = "#ef4444"; // red
          });
        } else {
          changeEls.forEach(el => el.textContent = "");
        }
      } else {
        changeEls.forEach(el => el.textContent = "");
      }
      
      prevTicker[key] = numVal;
    });
    
  } catch (err) {
    console.warn('Ticker update failed:', err);
  }
}

// ── AUTHENTICATION ──────────────────────────────────────────────────
function requireAuth(actionText) {
  if (state.user) return true;

  if (document.getElementById("auth-req-modal")) return false;

  const modal = document.createElement("div");
  modal.id = "auth-req-modal";
  modal.innerHTML = `
        <div style="position:fixed;inset:0;background:rgba(0,0,0,0.85);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:99999;">
            <div style="background:var(--card-bg);border:1px solid var(--border);padding:32px;border-radius:12px;text-align:center;max-width:360px;width:90%;">
                <div style="width:48px;height:48px;background:rgba(216,177,91,0.1);color:var(--gold);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:24px;">🔒</div>
                <h2 style="margin-top:0;font-size:18px;margin-bottom:8px;">Sign in Required</h2>
                <p style="color:var(--t3);font-size:14px;margin-bottom:24px;line-height:1.5;">You need to sign in to ${actionText}. Join Trade Trends to participate in the market.</p>
                <button id="quick-google-btn" style="width:100%;padding:12px;background:#fff;color:#000;border:none;border-radius:8px;font-weight:600;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:12px;">
                    <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                    Continue with Google
                </button>
                <button id="quick-close-btn" style="background:none;border:none;color:var(--t3);font-size:13px;cursor:pointer;padding:8px;">Maybe later</button>
            </div>
        </div>
    `;
  document.body.appendChild(modal);

  document.getElementById("quick-google-btn").onclick = async () => {
    document.getElementById("quick-google-btn").innerHTML = "Signing in...";
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.href },
    });
    if (error) alert("Sign-in failed: " + error.message);
  };

  document.getElementById("quick-close-btn").onclick = () => modal.remove();
  return false;
}

async function fetchSignalHistory() {
  const tbody = document.getElementById("history-table-body");
  const loading = document.getElementById("history-loading");
  
  if (!tbody || !loading) return;
  
  loading.style.display = "block";
  tbody.innerHTML = "";
  
  try {
    const response = await fetch("https://news-by-ai.onrender.com/api/signal-history");
    const data = await response.json();
    
    loading.style.display = "none";
    
    if (data.history && data.history.length > 0) {
      data.history.forEach((signal, index) => {
        const row = document.createElement("tr");
        row.style.borderBottom = "1px solid var(--border)";
        
        let expectancy = "No";
        if (signal.signal_direction === "Bullish") expectancy = "+";
        else if (signal.signal_direction === "Bearish") expectancy = "-";
        
        let realMomentStr = "N/A";
        let realMomentColor = "var(--text)";
        if (signal.percentage_change !== null && signal.percentage_change !== undefined) {
          const pct = signal.percentage_change * 100;
          realMomentStr = (pct > 0 ? "+" : "") + pct.toFixed(2) + "%";
          if (pct > 0.1) realMomentColor = "var(--green)";
          else if (pct < -0.1) realMomentColor = "var(--red)";
        }
        
        row.innerHTML = `
          <td style="padding: 12px 8px;">${index + 1}</td>
          <td style="padding: 12px 8px; font-weight: bold;">${signal.ticker}</td>
          <td style="padding: 12px 8px;">${expectancy}</td>
          <td style="padding: 12px 8px; color: ${realMomentColor};">${realMomentStr}</td>
        `;
        tbody.appendChild(row);
      });
    } else {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 20px; color: var(--muted);">No signals evaluated yet.</td></tr>`;
    }
  } catch (error) {
    console.error("Error fetching signal history:", error);
    loading.textContent = "Failed to load history.";
  }
}
