-- Migration script to copy old articles to Supabase
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('Russia was behind arson attacks targeting PM, BBC reveals', 'https://www.bbc.com/news/articles/c8r2l352z2do?at_medium=RSS&at_campaign=rss', 'Geopolitics', 'Neutral', 7, 'Unknown', '["Crude Oil", "Gold", "Defense Stocks"]'::jsonb, '{"Crude Oil": "Neutral", "Gold": "Neutral", "Defense Stocks": "Neutral"}'::jsonb, 81, '1-2 Days', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('Trump says deal to end war with Iran already signed and details to be released ''pretty soon''', 'https://www.bbc.com/news/articles/ce8mv6l6eezo?at_medium=RSS&at_campaign=rss', 'Geopolitics', 'Neutral', 7, 'Unknown', '["Crude Oil", "Gold", "Defense Stocks"]'::jsonb, '{"Crude Oil": "Neutral", "Gold": "Neutral", "Defense Stocks": "Neutral"}'::jsonb, 81, '1-2 Days', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('Thames Water moves step closer to nationalisation after government objects to rescue deal', 'https://www.bbc.com/news/articles/cly089d0wl7o?at_medium=RSS&at_campaign=rss', 'Finance', 'Negative', 6, 'Unknown', '["NIFTY", "BANKNIFTY", "USDINR"]'::jsonb, '{"NIFTY": "Bearish", "BANKNIFTY": "Bearish"}'::jsonb, 93, 'Same Day', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('Married at First Sight Australia allegations ''disturbing'', says country''s watchdog', 'https://www.bbc.com/news/articles/c4gyp099vl7o?at_medium=RSS&at_campaign=rss', 'General', 'Negative', 6, 'Unknown', '[]'::jsonb, '{}'::jsonb, 78, 'Unknown', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('What one country''s experiment says about attempts to boost birth rates', 'https://www.bbc.com/news/articles/c5yzdr4ygdno?at_medium=RSS&at_campaign=rss', 'General', 'Neutral', 5, 'Unknown', '[]'::jsonb, '{}'::jsonb, 65, 'Unknown', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('Potential End of War Tests Trump’s Promise of Quick Economic Rebound', 'https://www.nytimes.com/2026/06/15/us/politics/iran-war-deal-trump-economic-rebound.html', 'Finance', 'Positive', 6, 'Unknown', '["NIFTY", "BANKNIFTY", "USDINR"]'::jsonb, '{"NIFTY": "Bullish", "BANKNIFTY": "Bullish"}'::jsonb, 93, 'Same Day', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('Netanyahu Says Israel Will Keep Forces in Lebanon, Despite U.S.-Iran Deal', 'https://www.nytimes.com/2026/06/15/world/middleeast/netanyahu-israel-iran.html', 'Geopolitics', 'Neutral', 6, 'Unknown', '["Crude Oil", "Gold", "Defense Stocks"]'::jsonb, '{"Crude Oil": "Neutral", "Gold": "Neutral", "Defense Stocks": "Neutral"}'::jsonb, 78, '1-2 Days', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('In the Dark on U.S.-Iran Deal, Senators Refrain From Praising It', 'https://www.nytimes.com/2026/06/15/world/middleeast/senate-iran-deal-trump.html', 'Geopolitics', 'Neutral', 6, 'Unknown', '["Crude Oil", "Gold", "Defense Stocks"]'::jsonb, '{"Crude Oil": "Neutral", "Gold": "Neutral", "Defense Stocks": "Neutral"}'::jsonb, 78, '1-2 Days', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('Terms of U.S.-Iran Deal Remain Secret', 'https://www.nytimes.com/2026/06/15/briefing/us-iran-deal-cape-verde-world-cup.html', 'Geopolitics', 'Neutral', 5, 'Unknown', '["Crude Oil", "Gold", "Defense Stocks"]'::jsonb, '{"Crude Oil": "Neutral", "Gold": "Neutral", "Defense Stocks": "Neutral"}'::jsonb, 75, '1-2 Days', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('Gov. Gavin Newsom Says Trump Is Investigating Him and His Wife', 'https://www.nytimes.com/2026/06/15/us/newsom-trump-doj-investigation.html', 'Geopolitics', 'Neutral', 6, 'Unknown', '["Crude Oil", "Gold", "Defense Stocks"]'::jsonb, '{"Crude Oil": "Neutral", "Gold": "Neutral", "Defense Stocks": "Neutral"}'::jsonb, 78, '1-2 Days', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('Iranian-Americans protest against Iran team at World Cup', 'https://www.bbc.com/news/videos/cm20yglrgjlo?at_medium=RSS&at_campaign=rss', 'Geopolitics', 'Negative', 6, 'Unknown', '["Crude Oil", "Gold", "Defense Stocks"]'::jsonb, '{"Crude Oil": "Bullish", "Gold": "Bullish", "Defense Stocks": "Bullish"}'::jsonb, 88, '1-2 Days', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('Naval Mines Could Still Stymie Gulf Shipping After War', 'https://www.nytimes.com/2026/06/16/world/middleeast/strait-hormuz-mines-clearing.html', 'Geopolitics', 'Negative', 6, 'Unknown', '["Crude Oil", "Gold", "Defense Stocks"]'::jsonb, '{"Crude Oil": "Bullish", "Gold": "Bullish", "Defense Stocks": "Bullish"}'::jsonb, 88, '1-2 Days', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('Will Commercial Ships Have to Pay to Pass Through the Strait of Hormuz? Maybe.', 'https://www.nytimes.com/2026/06/15/world/middleeast/shipping-fees-tolls-strait-hormuz.html', 'Geopolitics', 'Neutral', 6, 'Unknown', '["Crude Oil", "Gold", "Defense Stocks"]'::jsonb, '{"Crude Oil": "Neutral", "Gold": "Neutral", "Defense Stocks": "Neutral"}'::jsonb, 78, '1-2 Days', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('Japan Raises Rates to 31-Year High to Ward Off War Inflation', 'https://www.nytimes.com/2026/06/16/business/japan-interest-rates-war.html', 'Finance', 'Neutral', 7, 'Unknown', '["NIFTY", "BANKNIFTY", "USDINR"]'::jsonb, '{}'::jsonb, 86, 'Same Day', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('VAR official says hand gesture was ''involuntary, subconscious twitch''', 'https://www.bbc.com/sport/football/articles/c0ryzjl1jlyo?at_medium=RSS&at_campaign=rss', 'General', 'Neutral', 6, 'Unknown', '[]'::jsonb, '{}'::jsonb, 68, 'Unknown', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('UK forces face operational cuts without more cash, defence chief warns', 'https://www.bbc.com/news/articles/c20ydx06ym2o?at_medium=RSS&at_campaign=rss', 'Finance', 'Negative', 6, 'Unknown', '["NIFTY", "BANKNIFTY", "USDINR"]'::jsonb, '{"NIFTY": "Bearish", "BANKNIFTY": "Bearish"}'::jsonb, 93, 'Same Day', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('Three reasons ships are not going through the Strait of Hormuz yet', 'https://www.bbc.com/news/articles/cn4rw784nj2o?at_medium=RSS&at_campaign=rss', 'Geopolitics', 'Neutral', 7, 'Unknown', '["Crude Oil", "Gold", "Defense Stocks"]'::jsonb, '{"Crude Oil": "Neutral", "Gold": "Neutral", "Defense Stocks": "Neutral"}'::jsonb, 81, '1-2 Days', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('What UK social media ban means for gaming and YouTube', 'https://www.bbc.com/news/articles/c9824zvpz9po?at_medium=RSS&at_campaign=rss', 'Technology', 'Neutral', 5, 'Unknown', '["NASDAQ", "Tech Stocks"]'::jsonb, '{}'::jsonb, 65, '1-5 Days', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('Woman left traumatised by swinging says website ''facilitated abuse''', 'https://www.bbc.com/news/articles/c87q7g48y4po?at_medium=RSS&at_campaign=rss', 'General', 'Negative', 7, 'Unknown', '[]'::jsonb, '{}'::jsonb, 81, 'Unknown', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('Prince George to attend Eton College from September', 'https://www.bbc.com/news/articles/clyx4jd9kkdo?at_medium=RSS&at_campaign=rss', 'General', 'Neutral', 6, 'Unknown', '[]'::jsonb, '{}'::jsonb, 68, 'Unknown', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('The Iran War Permanently Altered the Global Economy', 'https://www.nytimes.com/2026/06/16/business/economy/iran-war-oil-trade.html', 'Finance', 'Neutral', 7, 'Unknown', '["NIFTY", "BANKNIFTY", "USDINR"]'::jsonb, '{}'::jsonb, 86, 'Same Day', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('Iran Will Enter Nuclear Talks Feeling Emboldened', 'https://www.nytimes.com/2026/06/16/world/middleeast/iran-us-deal-nuclear-talks.html', 'Geopolitics', 'Positive', 7, 'Unknown', '["Crude Oil", "Gold", "Defense Stocks"]'::jsonb, '{"Crude Oil": "Neutral", "Gold": "Neutral", "Defense Stocks": "Neutral"}'::jsonb, 91, '1-2 Days', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('A Times Investigation Into Epstein’s Death, and Why Gas Prices Might Stay High', 'https://www.nytimes.com/2026/06/16/podcasts/the-headlines/epstein-death-iran-war-gas-prices.html', 'Finance', 'Neutral', 6, 'Unknown', '["NIFTY", "BANKNIFTY", "USDINR"]'::jsonb, '{}'::jsonb, 83, 'Same Day', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('How Our Reporters Got at the Truth of Jeffrey Epstein’s Death', 'https://www.nytimes.com/2026/06/16/insider/jeffrey-epstein-files-suicide.html', 'General', 'Neutral', 6, 'Unknown', '[]'::jsonb, '{}'::jsonb, 68, 'Unknown', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('Why the Iranian Team Is in a Tough Spot at the World Cup', 'https://www.nytimes.com/live/2026/us/fifa-world-cup#world-cup-iran-new-zealand-protests', 'Geopolitics', 'Neutral', 6, 'Unknown', '["Crude Oil", "Gold", "Defense Stocks"]'::jsonb, '{"Crude Oil": "Neutral", "Gold": "Neutral", "Defense Stocks": "Neutral"}'::jsonb, 78, '1-2 Days', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('Russian warship fires warning shots near UK-registered yacht in Channel', 'https://www.bbc.com/news/articles/c20yzm84r7lo?at_medium=RSS&at_campaign=rss', 'Geopolitics', 'Neutral', 6, 'Unknown', '["Crude Oil", "Gold", "Defense Stocks"]'::jsonb, '{"Crude Oil": "Neutral", "Gold": "Neutral", "Defense Stocks": "Neutral"}'::jsonb, 78, '1-2 Days', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('''Daylight robbery but worth it'' - what fans are spending on World Cup', 'https://www.bbc.com/news/articles/cy73xe2006po?at_medium=RSS&at_campaign=rss', 'Finance', 'Positive', 7, 'Unknown', '["NIFTY", "BANKNIFTY", "USDINR"]'::jsonb, '{"NIFTY": "Bullish", "BANKNIFTY": "Bullish"}'::jsonb, 96, 'Same Day', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('After U.S. Strike on Iranian School, Months Pass Without Answers', 'https://www.nytimes.com/2026/06/16/us/politics/us-strike-iranian-school.html', 'Geopolitics', 'Negative', 9, 'Unknown', '["Crude Oil", "Gold", "Defense Stocks"]'::jsonb, '{"Crude Oil": "Bullish", "Gold": "Bullish", "Defense Stocks": "Bullish"}'::jsonb, 97, '1-7 Days', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('War Hangs Over American Farmers as Fertilizer Prices Rise', 'https://www.nytimes.com/2026/06/16/business/fertilizer-farming-iran.html', 'Finance', 'Negative', 6, 'Unknown', '["NIFTY", "BANKNIFTY", "USDINR"]'::jsonb, '{"NIFTY": "Bearish", "BANKNIFTY": "Bearish"}'::jsonb, 93, 'Same Day', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('How Ukraine Uses A.I. to Knock Deadly Russian Drones Out of the Skies', 'https://www.nytimes.com/2026/06/15/world/europe/ukraine-russia-war-ai.html', 'Technology', 'Positive', 9, 'Unknown', '["NASDAQ", "Tech Stocks"]'::jsonb, '{}'::jsonb, 87, '1-5 Days', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('PM sends Burnham and Labour warning over leadership contest', 'https://www.bbc.com/news/articles/cn4dj7n83yqo?at_medium=RSS&at_campaign=rss', 'General', 'Neutral', 6, 'Unknown', '[]'::jsonb, '{}'::jsonb, 68, 'Unknown', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('''It''s very Bond'': Fashion experts on the England squad''s off-pitch look', 'https://www.bbc.com/news/articles/c9v2e8llnkwo?at_medium=RSS&at_campaign=rss', 'General', 'Neutral', 5, 'Unknown', '[]'::jsonb, '{}'::jsonb, 65, 'Unknown', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('Jeremy Clarkson reveals cancer diagnosis on farming show', 'https://www.bbc.com/news/articles/cqj14q700rko?at_medium=RSS&at_campaign=rss', 'General', 'Neutral', 5, 'Unknown', '[]'::jsonb, '{}'::jsonb, 65, 'Unknown', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('Social media has risks but has given us opportunities too, teen influencers say', 'https://www.bbc.com/news/articles/c4gyp16wp6jo?at_medium=RSS&at_campaign=rss', 'General', 'Neutral', 5, 'Unknown', '[]'::jsonb, '{}'::jsonb, 65, 'Unknown', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('After a Bitter Split, European Leaders Play Nice With Trump', 'https://www.nytimes.com/2026/06/16/world/europe/trump-g7-leaders-europe.html', 'Geopolitics', 'Positive', 7, 'Unknown', '["Crude Oil", "Gold", "Defense Stocks"]'::jsonb, '{"Crude Oil": "Neutral", "Gold": "Neutral", "Defense Stocks": "Neutral"}'::jsonb, 91, '1-2 Days', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('Who Are the Leaders at the G7 Summit in France?', 'https://www.nytimes.com/2026/06/16/world/europe/who-are-g7-leaders.html', 'Geopolitics', 'Neutral', 5, 'Unknown', '["Crude Oil", "Gold", "Defense Stocks"]'::jsonb, '{"Crude Oil": "Neutral", "Gold": "Neutral", "Defense Stocks": "Neutral"}'::jsonb, 75, '1-2 Days', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('Can a Trump-Modi Meeting Reset U.S.-India Relations?', 'https://www.nytimes.com/2026/06/16/world/asia/trump-modi-meeting-g7.html', 'Geopolitics', 'Neutral', 7, 'Unknown', '["Crude Oil", "Gold", "Defense Stocks"]'::jsonb, '{"Crude Oil": "Neutral", "Gold": "Neutral", "Defense Stocks": "Neutral"}'::jsonb, 81, '1-2 Days', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('Georgia Vexes Trump Yet Again: 6 Takeaways From Tuesday’s Primaries', 'https://www.nytimes.com/2026/06/17/us/politics/georgia-alabama-elections-trump-takeaways.html', 'General', 'Neutral', 6, 'Unknown', '[]'::jsonb, '{}'::jsonb, 68, 'Unknown', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('Hillary Clinton Says Biden’s Re-election Bid Was a ‘Terrible Mistake’', 'https://www.nytimes.com/2026/06/16/us/politics/clinton-biden-reelection-terrible-mistake.html', 'General', 'Negative', 6, 'Unknown', '[]'::jsonb, '{}'::jsonb, 78, 'Unknown', '', now())
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('Israel launches fresh strikes on Lebanon despite Trump criticism', 'https://www.bbc.com/news/articles/c7vyn17g832o?at_medium=RSS&at_campaign=rss', 'Geopolitics', 'Negative', 9, 'High Volatility', '["Crude Oil", "Gold", "Defense Stocks"]'::jsonb, '{"Crude Oil": "Bullish", "Gold": "Bullish", "Defense Stocks": "Bullish"}'::jsonb, 97, '1-7 Days', 'This geopolitical development could influence global risk sentiment and safe-haven flows. The current sentiment assessment is negative with a confidence score of 97%. Assets most exposed include Crude Oil, Gold, Defense Stocks. Current directional signals suggest Crude Oil: Bullish, Gold: Bullish, Defense Stocks: Bullish. Traders should monitor follow-up headlines and price action for confirmation.', '2026-06-17T10:52:51.638064+00:00')
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('Inflation unexpectedly steady as food price rises slow', 'https://www.bbc.com/news/articles/cyv0qpn9zvjo?at_medium=RSS&at_campaign=rss', 'Finance', 'Neutral', 6, 'Neutral', '["NIFTY", "BANKNIFTY", "USDINR"]'::jsonb, '{}'::jsonb, 83, 'Same Day', 'This financial headline may affect trader positioning and short-term market sentiment. The current sentiment assessment is neutral with a confidence score of 83%. Assets most exposed include NIFTY, BANKNIFTY, USDINR. Current directional signals suggest no strong directional bias. Traders should monitor follow-up headlines and price action for confirmation.', '2026-06-17T10:52:59.263966+00:00')
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('Is Georgia Senator Jon Ossoff Running for President? He Has to Win Re-election First.', 'https://www.nytimes.com/2026/06/17/us/politics/jon-ossoff-georgia-senate-election.html', 'Geopolitics', 'Neutral', 6, 'Neutral', '["Crude Oil", "Gold", "Defense Stocks"]'::jsonb, '{"Crude Oil": "Neutral", "Gold": "Neutral", "Defense Stocks": "Neutral"}'::jsonb, 78, '1-2 Days', 'This geopolitical development could influence global risk sentiment and safe-haven flows. The current sentiment assessment is neutral with a confidence score of 78%. Assets most exposed include Crude Oil, Gold, Defense Stocks. Current directional signals suggest Crude Oil: Neutral, Gold: Neutral, Defense Stocks: Neutral. Traders should monitor follow-up headlines and price action for confirmation.', '2026-06-17T10:53:23.195818+00:00')
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('How Local Police Are Working for ICE, and an Unusual Data Center Dispute', 'https://www.nytimes.com/2026/06/17/podcasts/the-headlines/ice-local-police-data-center-dispute.html', 'General', 'Neutral', 6, 'Neutral', '[]'::jsonb, '{}'::jsonb, 68, 'Unknown', 'This news item may influence markets indirectly through sentiment and expectations. The current sentiment assessment is neutral with a confidence score of 68%. Assets most exposed include broader markets. Current directional signals suggest no strong directional bias. Traders should monitor follow-up headlines and price action for confirmation.', '2026-06-17T10:53:44.478394+00:00')
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('Judge Orders Kennedy Center to Make a Plan for Staying Open', 'https://www.nytimes.com/2026/06/16/arts/music/kennedy-center-closing-plan-judge.html', 'General', 'Neutral', 5, 'Neutral', '[]'::jsonb, '{}'::jsonb, 65, 'Unknown', 'This news item may influence markets indirectly through sentiment and expectations. The current sentiment assessment is neutral with a confidence score of 65%. Assets most exposed include broader markets. Current directional signals suggest no strong directional bias. Traders should monitor follow-up headlines and price action for confirmation.', '2026-06-17T10:53:53.285178+00:00')
ON CONFLICT (link) DO NOTHING;
INSERT INTO public.news (title, link, category, sentiment, importance, market_impact, assets, directions, confidence, time_horizon, analysis, created_at)
VALUES ('Washington’s Reagan Airport Will Ground Flights for July 4 Events', 'https://www.nytimes.com/2026/06/16/us/politics/independence-day-flight-disruptions-washington.html', 'General', 'Neutral', 6, 'Neutral', '[]'::jsonb, '{}'::jsonb, 68, 'Unknown', 'This news item may influence markets indirectly through sentiment and expectations. The current sentiment assessment is neutral with a confidence score of 68%. Assets most exposed include broader markets. Current directional signals suggest no strong directional bias. Traders should monitor follow-up headlines and price action for confirmation.', '2026-06-17T10:54:01.990376+00:00')
ON CONFLICT (link) DO NOTHING;
