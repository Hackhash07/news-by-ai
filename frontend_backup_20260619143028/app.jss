async function loadNews() {

    try {

        const response =
            await fetch("http://127.0.0.1:5000/news");

        const data =
            await response.json();

        const container =
            document.getElementById("news-container");

        const signalPanel =
            document.getElementById("signal-panel");

        container.innerHTML = "";
        signalPanel.innerHTML = "";

        data.forEach(article => {

            article.ai_score =
                article.importance *
                article.confidence;

        });

        data.sort(
            (a, b) =>
            b.ai_score - a.ai_score
        );

        const signalCounts = {};

        data.forEach(article => {

            for (const asset in article.directions) {

                const direction =
                    article.directions[asset];

                if (!signalCounts[asset]) {

                    signalCounts[asset] = {
                        Bullish: 0,
                        Bearish: 0,
                        Neutral: 0
                    };
                }

                signalCounts[asset][direction]++;
            }
        });

        let signalHtml =
            `<div class="signal-title">
                Today's Market Signals
             </div>`;

        for (const asset in signalCounts) {

            const stats =
                signalCounts[asset];

            let finalSignal = "Neutral";

            if (
                stats.Bullish >
                stats.Bearish
            ) {
                finalSignal = "Bullish";
            }

            if (
                stats.Bearish >
                stats.Bullish
            ) {
                finalSignal = "Bearish";
            }

            signalHtml += `
                <div class="signal-row">
                    <b>${asset}</b> :
                    <span class="${finalSignal.toLowerCase()}">
                        ${finalSignal}
                    </span>
                </div>
            `;
        }

        signalPanel.innerHTML =
            signalHtml;

        data.forEach(article => {

            const card =
                document.createElement("div");

            card.className = "card";

            let directionsHtml = "";

            for (const asset in article.directions) {

                let color = "gray";

                if (
                    article.directions[asset]
                    === "Bullish"
                ) {
                    color = "green";
                }

                if (
                    article.directions[asset]
                    === "Bearish"
                ) {
                    color = "red";
                }

                directionsHtml += `
                    <p style="color:${color}">
                        <b>${asset}</b>
                        - ${article.directions[asset]}
                    </p>
                `;
            }

            card.innerHTML = `
                <h2>${article.title}</h2>

                <p><b>Category:</b>
                ${article.category}</p>

                <p><b>Sentiment:</b>
                ${article.sentiment}</p>

                <p><b>Importance:</b>
                ${article.importance}</p>

                <p><b>Confidence:</b>
                ${article.confidence}</p>

                <p><b>AI Score:</b>
                ${article.ai_score}</p>

                <p><b>Assets:</b>
                ${article.assets.join(", ")}</p>

                <p><b>Time Horizon:</b>
                ${article.time_horizon}</p>

                <h3>Market Signals</h3>

                ${directionsHtml}

                <p>
                    <a href="${article.link}"
                       target="_blank">
                       Read Article
                    </a>
                </p>
            `;

            container.appendChild(card);

        });

    } catch(error) {

        console.error(error);

    }

}

loadNews();

setInterval(
    loadNews,
    60000
);
