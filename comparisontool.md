Add a new tool that compares The Electric Duo YouTube channel against a   
competitor EV YouTube channel to identify what we should change and what   
we should NOT copy. Have an input box to submit the competitor URL. Once a report is generated, make sure to give it a timestamp. I want to be able to browse past reports and update them when requested.

CONTEXT  
\- Our channel: The Electric Duo (\~25,000 subscribers, \~100,000 monthly   
  views, averages 6-7 videos/month)  
\- Data source: YouTube Data API v3 (public endpoints only — we don't have   
  the competitor's private Analytics, so everything must be derivable   
  from public video/channel data: views, likes, comment count, publish   
  date, duration, title, description, tags, thumbnail URL)  
\- Competitors to support-  user inputted by URL

CORE FUNCTIONALITY

1\. Channel input: let me enter a new channel or select a previously entered channel

2\. Pull the last 12 months of uploads for both channels via the YouTube   
   Data API (search.list \+ videos.list for stats), storing: title,   
   published date, duration, view count, like count, comment count,   
   thumbnail URL, tags/description.

3\. OUTLIER DETECTION (not just "top videos"):  
   \- For each channel independently, calculate a rolling baseline   
     (median views of that channel's prior 10 videos at time of   
     publish, or a simple trailing average).  
   \- Flag any video with views \>= 3x its own channel's baseline as an   
     "outlier." Show the multiplier (e.g. "4.2x their normal").  
   \- This must be calculated per-channel, not by comparing raw view   
     counts across channels — a competitor's "normal" video may   
     naturally outperform our outlier due to subscriber count, and   
     that should NOT be flagged as something to copy.

4\. PACKAGING VS SUBSTANCE SPLIT for each competitor outlier:  
   \- Show the outlier next to 2-3 of that channel's non-outlier videos   
     on a similar topic (basic keyword/tag matching is fine).  
   \- Surface a simple diff: title length/structure, presence of   
     numbers/specific model names, thumbnail present, description   
     length. This is meant to prompt human judgment, not auto-conclude —   
     just make it easy for me to visually compare packaging when the   
     topic is similar.

5\. REPLICABILITY FLAGGING — for every competitor outlier, show an   
   estimated "replicable at our scale?" flag based on rules like:  
   \- Views outlier appears within days of a major manufacturer   
     announcement/launch (check if title contains launch-related   
     keywords like "first look," "launch," a specific new model name)   
     → flag as "timing/news-driven, potentially repeatable if we're   
     fast"  
   \- Video is part of a long upload streak (5+ uploads in prior 14   
     days) → flag as "algorithm momentum, not fully replicable from a   
     one-off"  
   \- Video is dramatically shorter or longer than that channel's own   
     average duration → flag as "format deviation, worth testing"  
   \- Subscriber count of competitor is more than 3x ours → add a   
     caveat badge "scale advantage — may not transfer directly"  
   These are heuristics to prompt investigation, not hard conclusions —   
   label them clearly as suggestions.

6\. "DO NOT COPY" section: surface competitor videos/patterns that   
   performed BELOW that channel's own baseline (bottom quartile),   
   especially if they share format/topic similarities with things we   
   were considering. Label this section explicitly as "underperformed   
   for them — deprioritize." Also include things that we shouldn’t copy because of factors like our channel is too small or it wouldn’t be good for our audience, etc.

7\. SIDE-BY-SIDE SUMMARY DASHBOARD:  
   \- Upload cadence comparison (videos/month, trend over 12 months)  
   \- Average video length comparison  
   \- Title pattern comparison (common structures/keywords across their   
     top quartile vs ours)  
   \- Topic/subject distribution (simple keyword clustering from titles   
     — e.g. how many are reviews vs news vs road trips vs comparisons)  
   \- Our CTR is 5.0% average (I can input this manually since it's not   
     public data) — leave a manual-entry field for CTR/AVD benchmarks   
     I pull from YouTube Studio myself, so the tool can flag if a   
     competitor's outlier title style is worth CTR-testing against ours

TECH / OUTPUT  
\- Exportable as CSV so I can dump findings into my revenue plan doc  
\- Cache API responses locally since YouTube API   
  quota is limited — don't re-fetch on every page load

IMPORTANT GUARDRAILS  
\- Never present a heuristic flag as a certainty — always phrase   
  outputs as "worth investigating" not "this is why they won."  
\- Always show the outlier calculation is per-channel-relative, never   
  raw cross-channel view comparison, to avoid me chasing something   
  that's just a subscriber-count effect.  
