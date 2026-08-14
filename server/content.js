"use strict";
/**
 * Static content for the operating checklist.
 * This is the ONE place to edit when the plan itself changes —
 * add/remove/reword a task here and it's reflected everywhere
 * (server validation + the UI) automatically.
 *
 * Ported verbatim from the original electric-duo-ops-dashboard.html artifact.
 */

const DAILY = [
  { id: "d-beats", t: "Scan the three beats", tag: "15 min",
    d: "Ford EV (Fathom, UEV platform, Mach-E, Lightning, BlueCruise, OTA) · Affordable EVs (Fathom, Slate, Bolt, Leaf) · Battery and energy tech (Donut Lab, Pila, CATL, solid state). Anything outside these three isn't yours — skip it." },
  { id: "d-break", t: "If a beat broke, publish today", tag: "when it applies",
    d: "Story to published in under six hours. Under 15 minutes. Sources on screen, claims labelled as claims. Speed is the whole advantage." },
  { id: "d-outreach", t: "Outreach block: 1 new prospect + 2 follow-ups", tag: "30 min",
    d: "Four days a week at this pace lands the monthly target of 15 new contacts and 30 follow-ups." },
  { id: "d-pipeline", t: "Move every reply through the pipeline", tag: "5 min",
    d: "Contacted → responded → pitched → closed. Record a reason for every loss — that's what tells you whether the media kit or the list is the problem." },
  { id: "d-furniture", t: "Finish yesterday's upload", tag: "10 min",
    d: "End screen pointing to the next video in the series, pinned comment linking the companion video, added to the right Show playlist. Free traffic you're currently leaving on the table." }
];

const WEEKLY = [
  { id: "w-beat", t: "Publish the beat show in its fixed slot", tag: "anchor",
    d: "Same day every week. 30% of your views and 42% of your watch time come from the subscriber feed — habit is the asset. Don't force a second video on a slow week." },
  { id: "w-abtest", t: "Read last week's thumbnail A/B result", tag: "10 min",
    d: "Keep the winner, note which of the four templates it belongs to (new tech / ownership how-to / owner criticism / auto show), and iterate inside that template rather than starting fresh." },
  { id: "w-retro", t: "Retitle and re-thumbnail one back-catalog video", tag: "45 min",
    d: "Work down the top 20 first. Charging 101 at 6% CTR instead of 4% is thousands of extra evergreen views a year, forever." },
  { id: "w-ctr", t: "Check CTR on the last three uploads", tag: "5 min",
    d: "Target is 7% within six months, from 5.0% flat. One idea, one stake, no spoiler — and no exclamation stacking." },
  { id: "w-next", t: "Plan next week's beat installment", tag: "30 min",
    d: "What's the next chapter of the thread, and what's its obvious sequel? Suggested traffic rewards series structure, so every video should have a next one." },
  { id: "w-followup", t: "Publish any follow-up you owe", tag: "when it applies",
    d: "When a story you reported changes, the follow-up is required, not optional. It captures the same search terms and costs almost nothing to make." },
  { id: "w-tally", t: "Tally outreach: 4 new, 8 follow-ups", tag: "2 min",
    d: "Behind pace? Add a block this week rather than trying to catch up at month end." }
];

const MONTHLY = [
  { id: "m-t1", t: "4–6 beat videos published", tag: "tier 1",
    d: "The core engine and your highest revenue-per-hour format. Under 15 minutes, no exceptions — if a story needs 40, it's two videos." },
  { id: "m-t2", t: "2–3 product-tagged ownership videos", tag: "tier 2",
    d: "How-to, charging, software, adapters, accessories on the Mach-E, the Equinox and the month's loaner. 10–15 minutes. This is where affiliate lives and it compounds." },
  { id: "m-t3", t: "1 owner-honesty video", tag: "tier 3",
    d: "Things we hate, long-term updates, what broke, what it cost. Only possible on cars you own, which is exactly why press-fleet channels can't copy it." },
  { id: "m-loan", t: "Book the press loan — and use it for tiers 2 and 3", tag: "1/month",
    d: "Ownership content, software and accessibility scoring, comparison footage against your own two cars. Don't race TFL and Out of Spec on first drives." },
  { id: "m-outbound", t: "Hit the outbound numbers", tag: "pipeline",
    d: "15 new prospects, 30 follow-ups, 3–4 live conversations, 1–2 closed. At a 5% close rate that's roughly nine new sponsors a year on top of inbound." },
  { id: "m-tags", t: "Tag another batch of back-catalog videos", tag: "until done",
    d: "Every existing video that mentions a product gets a product tag. Keep going until the catalog is clean." },
  { id: "m-split", t: "Log the month's revenue split", tag: "critical",
    d: "Recurring vs one-time, separately. Recurring is the only number that counts toward the transition gate. Tentpole money is upside, reserve and reinvestment — never the basis for the decision." },
  { id: "m-concentration", t: "Check sponsor concentration", tag: "2 min",
    d: "No single sponsor above roughly a quarter of sponsorship revenue. Two non-renewals in the same quarter shouldn't be able to create a cliff." },
  { id: "m-kpi", t: "Run the KPI review", tag: "30 min",
    d: "All twelve rows on the Reference tab. Subscriber count is deliberately not one of them." }
];

const QUARTERLY = [
  { id: "q-gate", t: "Run the transition gate check", tag: "the rule",
    d: "Recurring revenue alone — no tentpole, no one-offs — must cover the combined target for two consecutive quarters before Liv gives notice. Mark this quarter pass or fail and move on." },
  { id: "q-retainer", t: "Review the retainer pilot at 90 days", tag: "when live",
    d: "Compare it against what that sponsor generated per video before. Less revenue for more obligation means don't renew — you learned it cheaply. One successful renewal before pitching a second." },
  { id: "q-rates", t: "Audit the rate card floor", tag: "10 min",
    d: "Did anything close below the published floor this quarter? If everything closes on the first ask, the floor is too low — raise it." },
  { id: "q-tentpole", t: "Pitch the tentpole package", tag: "1–2×/yr",
    d: "Keep the product fixed — 8 videos, 3 meetups, article and photo package, social distribution — and swap the hook: a charging corridor, a regional series, a seasonal challenge, a manufacturer's route. Model one a year at expected value." },
  { id: "q-pm", t: "Check in with your Partner Manager", tag: "15 min",
    d: "Shopping shelf placement, affiliate hub setup, beta access to product-tagging features. Most channels your size don't have this relationship." },
  { id: "q-kit", t: "Refresh the media kit's trailing-12-month numbers", tag: "30 min",
    d: "Rolling twelve months, never a cherry-picked 28-day window. Stale numbers are how the last kit ended up mispricing everything." },
  { id: "q-cases", t: "Add the newest campaign as a case study", tag: "45 min",
    d: "Outcomes, not view counts. Case studies are what let you hold the floor." }
];

const SEASONAL = [
  { id: "s-oct", t: "October — open CES founder outreach", tag: "3 months ahead",
    d: "Pre-book interviews with battery, charging and home-energy startups. CES 2026 produced your #1 and #4 organic videos; treat CES 2027 as a campaign, not a trip." },
  { id: "s-jan", t: "January — CES", tag: "highest value",
    d: "Your single highest-value production of the year. Publish fast and first; the win is being early, not being thorough." },
  { id: "s-nov", t: "November — LA Auto Show", tag: "day trip",
    d: "Full tour plus per-vehicle cuts plus Liv's accessibility measurements on static cars. One day out, a month of content." }
];

const BUILD = [
  { phase: "Weeks 1–2", sub: "Highest return of anything here", items: [
    { id: "b-split", t: "Confirm the recurring vs one-time split and set up the monthly log",
      d: "~$25K recurring sponsorship, ~$13.5K AdSense, ~$2K affiliate, ~$3.5K Patreon and merch. Repeatable base ~$44K. That's the planning number." },
    { id: "b-kit", t: "Rebuild the media kit",
      d: "Lead with audience quality, not size. Trailing-12-month figures. The bundle (YouTube + site + newsletter + FordEVClubs + Mach-E chapters + social + events, each with its own number). Credentials: EVA board, MPG VP, press fleet, CES/IAA/OEM access. Case studies. Clean-traffic statement. Address the 96% male figure directly and price Liv's accessibility work as the route to women buyers." },
    { id: "b-ratecard", t: "Publish the rate card",
      d: "Three tiers plus a bundle and a tentpole line. Publish a floor and hold it — discounting in month one destroys it. Price the bundle below the sum of its parts." },
    { id: "b-clauses", t: "Draft the sponsor contract clauses",
      d: "No third-party paid amplification without written approval of platform, targeting and geography. Right to audit and disavow. Geo-targeting limits. Reporting rights. One standard for everyone, Electrify America included." },
    { id: "b-shopping", t: "Turn on YouTube Shopping",
      d: "A 10x on a line item, achievable in weeks, with zero audience growth required." },
    { id: "b-abtest", t: "Enable thumbnail A/B testing",
      d: "Free, built in, and currently unused." }
  ]},
  { phase: "Weeks 3–4", sub: "Retrofit what already earns", items: [
    { id: "b-retrofit", t: "Retrofit product tags across the back catalog",
      d: "Start with Charging 101 — 40K views a year currently monetising through a single description link." },
    { id: "b-top20", t: "Retitle and re-thumbnail the top 20 videos", d: "" },
    { id: "b-end50", t: "Add end screens to the top 50 videos",
      d: "554 end-screen views in a year should be five figures." },
    { id: "b-shows", t: "Rebuild playlists as Shows with series art",
      d: "Sequenced so autoplay carries. Currently 5,333 views a year from playlists." },
    { id: "b-templates", t: "Build the four thumbnail templates",
      d: "New tech, ownership how-to, owner criticism, auto show. Iterate within each rather than starting fresh every time." },
    { id: "b-25", t: "Begin outbound: 25 prospects contacted in month one", d: "" },
    { id: "b-policy", t: "Write the editorial independence and no-scoring policy",
      d: "Must exist before the first retainer and before the first scorecard, not after. A charging or charger-app company on retainer while you score charger software is a live conflict." }
  ]},
  { phase: "Weeks 5–8", sub: "Launch the engines", items: [
    { id: "b-cluster", t: "Launch the tier 2 evergreen cluster: 8 product-anchored videos",
      d: "Adapters, home charging setup, road trip kit, winter kit. Cheap, evergreen, fully taggable. You have one Charging 101. You should have thirty." },
    { id: "b-donut", t: "Publish the Donut Lab follow-up",
      d: "You were first on a claim since disproven. Protects credibility with the 4,579 people who shared it, captures search terms that are still live, and demonstrates the editorial independence sponsors are buying." },
    { id: "b-ces", t: "Begin CES 2027 outreach",
      d: "Founder meetings booked three months ahead." },
    { id: "b-show", t: "Name and launch the weekly beat show in a fixed slot",
      d: "Start with the Fathom thread. Naming it is what feeds playlists, end screens and suggested traffic." },
    { id: "b-shorts", t: "Reframe Shorts as product-tagged affiliate distribution",
      d: "37.6% of views and 2.7% of watch time — not a growth strategy, but a shopping surface. It also gives your Partner Manager the Shorts win they're asking for." }
  ]},
  { phase: "Weeks 9–12", sub: "Establish the rhythm and price it", items: [
    { id: "b-rhythm", t: "Establish the four-tier publishing rhythm", d: "" },
    { id: "b-scorecards", t: "Ship the first scorecard pages",
      d: "Vehicle software and companion apps; home charger software. Publish the methodology and the sponsors-aren't-scored policy before the first score. These are conversion infrastructure and a sponsorship credential, not a video franchise." },
    { id: "b-market", t: "Take the media kit to market at the new rates",
      d: "Expected effect: a 30–50% rate increase with zero new content produced." },
    { id: "b-measure", t: "Measure CTR movement against the 5.0% baseline", d: "" },
    { id: "b-pilot", t: "Pitch the first retainer pilot",
      d: "EV-Vida is the obvious candidate. Three-month term, not twelve. 10–15% below buying the same insertions à la carte. Deliverables as a monthly allowance, not named videos. Both clauses included. Measure at 90 days." }
  ]}
];

const KPIS = [
  { id: "k-ctr", label: "Average CTR", now: "5.0%", m6: "6.0%", m12: "7.0%" },
  { id: "k-sugg", label: "Suggested share of views", now: "9.5%", m6: "15%", m12: "20%" },
  { id: "k-bot", label: "Ad / bot traffic share", now: "17.4%", m6: "<2%", m12: "~0%" },
  { id: "k-aff", label: "Affiliate revenue", now: "$1.2K/yr", m6: "$6K", m12: "$15–20K" },
  { id: "k-rate", label: "Rate per integration", now: "current", m6: "+30%", m12: "+50%" },
  { id: "k-end", label: "End-screen views", now: "554/yr", m6: "10K/yr", m12: "25K/yr" },
  { id: "k-beat", label: "Beat videos per month", now: "~2", m6: "4", m12: "5–6" },
  { id: "k-len", label: "Median news video length", now: "30+ min", m6: "<15 min", m12: "<15 min" },
  { id: "k-pros", label: "Prospects contacted", now: "0", m6: "90 cum.", m12: "200 cum." },
  { id: "k-ret", label: "Retainers live", now: "0", m6: "1", m12: "3" },
  { id: "k-rec", label: "Recurring run rate", now: "~$44K", m6: "$70K", m12: "$100K" },
  { id: "k-share", label: "Recurring share of total", now: "~60%", m6: "75%", m12: "85%" }
];

const COUNTERS = [
  { id: "c-new", label: "New prospects", target: 15 },
  { id: "c-follow", label: "Follow-ups sent", target: 30 },
  { id: "c-convo", label: "Live conversations", target: 4 },
  { id: "c-closed", label: "Deals closed", target: 2 }
];

const RATES = [
  ["Integrated mid-roll, 60–90 sec", "$1,500–2,500"],
  ["Dedicated segment, 3–5 min", "$2,500–4,000"],
  ["Dedicated / full sponsored video", "$4,000–6,500"],
  ["Bundle: 3 videos + 3 Shorts + newsletter", "$9,000–13,000"],
  ["Tentpole series (Route 66 scale)", "$18,000–30,000"]
];

const STOP = [
  "Paid amplification of any kind, yours or a sponsor's, without geo and quality controls.",
  "Commodity vehicle first-looks where 200 outlets have the same access.",
  "Dead-weight event VODs on the main channel — the hour-plus walkarounds pulling under 2K, not auto show tours, which work.",
  "Reviving the 700-subscriber second channel. Leave it dormant.",
  "News outside the three beats: Tesla earnings, China, policy, sales figures.",
  "News and analysis over 20 minutes. If it genuinely needs 40, it's two videos."
];

// Flat map of every task id -> which period type it belongs to, for server-side validation
const PERIOD_TASKS = {
  daily: DAILY,
  weekly: WEEKLY,
  monthly: MONTHLY,
  quarterly: QUARTERLY,
  seasonal: SEASONAL
};

const TASK_INDEX = {};
Object.keys(PERIOD_TASKS).forEach((period) => {
  PERIOD_TASKS[period].forEach((task) => { TASK_INDEX[task.id] = period; });
});
BUILD.forEach((phase) => {
  phase.items.forEach((item) => { TASK_INDEX[item.id] = "build"; });
});

const COUNTER_IDS = new Set(COUNTERS.map((c) => c.id));
const KPI_IDS = new Set(KPIS.map((k) => k.id));

module.exports = {
  DAILY, WEEKLY, MONTHLY, QUARTERLY, SEASONAL, BUILD,
  KPIS, COUNTERS, RATES, STOP,
  PERIOD_TASKS, TASK_INDEX, COUNTER_IDS, KPI_IDS
};
