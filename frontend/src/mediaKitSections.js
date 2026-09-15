/**
 * Media Kit Section and Block Registry
 * Defines fine-grained blocks grouped into 3 disclosure tiers:
 * Tier 1: Intro / Executive overview (~1 page)
 * Tier 2: Standard partnership disclosure (~2-3 pages)
 * Tier 3: Full comprehensive catalogue and long-tail reporting
 */

export const MEDIA_KIT_BLOCKS = [
  { section: "survey", id: "survey.stats", label: "In-market qualification stats", tier: 1 },
  { section: "reach", id: "reach.headline", label: "Headline reach stats", tier: 1 },
  { section: "reach", id: "reach.perVideo", label: "Expected 30-day reach / video", tier: 2 },
  { section: "reach", id: "reach.engagement", label: "Engagement & retention", tier: 2 },
  { section: "reach", id: "reach.trailing12m", label: "Trailing 12 complete months", tier: 3 },
  { section: "featuredIn", id: "featuredIn.list", label: "Featured in & media mentions", tier: 2 },
  { section: "whoIsWatching", id: "audience.geo", label: "Top geographic markets", tier: 2 },
  { section: "whoIsWatching", id: "audience.buyingPower", label: "Buying power & demographics", tier: 1 },
  { section: "whoIsWatching", id: "audience.intent", label: "Intent & discovery", tier: 3 },
  { section: "pillars", id: "pillars.bars", label: "Content pillar breakdown", tier: 2 },
  { section: "pillars", id: "pillars.whoWeReach", label: "Primary / secondary audience", tier: 2 },
  { section: "recentWork", id: "recentWork.grid", label: "Recent work video showcase", tier: 2 },
  { section: "duoBios", id: "duoBios.bios", label: "Host bios & credentials", tier: 2 },
  { section: "beyondChannel", id: "beyondChannel.clubs", label: "EV Club network & community", tier: 2 },
  { section: "beyondChannel", id: "beyondChannel.socials", label: "Owned socials & web reach", tier: 3 },
  { section: "events", id: "events.shows", label: "Auto shows & industry events", tier: 3 },
  { section: "partners", id: "partners.chips", label: "Selected brand partners", tier: 2 },
  { section: "partners", id: "partners.caseStudy", label: "Partner case study", tier: 3 },
];

export const MEDIA_KIT_SECTIONS = [
  { id: "survey", label: "Audience In-Market Qualification", defaultOrder: 10, printCols: 3 },
  { id: "reach", label: "Channel Reach & Performance", defaultOrder: 20, printCols: 4 },
  { id: "featuredIn", label: "Featured In & Recognition", defaultOrder: 30, printCols: 2 },
  { id: "whoIsWatching", label: "Who Is Watching", defaultOrder: 40, printCols: 3 },
  { id: "pillars", label: "Where Your Brand Can Sit", defaultOrder: 50, printCols: 2 },
  { id: "recentWork", label: "Recent Work", defaultOrder: 60, printCols: 3 },
  { id: "duoBios", label: "Meet the Duo", defaultOrder: 70, printCols: 2 },
  { id: "beyondChannel", label: "Beyond the Channel", defaultOrder: 80, printCols: 2 },
  { id: "events", label: "Event & Trade Show Coverage", defaultOrder: 90, printCols: 2 },
  { id: "partners", label: "Selected Brand Partners", defaultOrder: 100, printCols: 2 },
];

export const SECTION_DEFAULT_ORDER = MEDIA_KIT_SECTIONS.map((s) => s.id);

export function getTierBlockIds(maxTier = 3) {
  return MEDIA_KIT_BLOCKS.filter((b) => b.tier <= maxTier).map((b) => b.id);
}

export function isBlockAvailable(blockId, guards = {}) {
  const { hasFeaturedIn, hasDuoBios, hasEventCoverage, hasCaseStudy, hasPartners } = guards;

  if (blockId.startsWith("featuredIn.") && !hasFeaturedIn) return false;
  if (blockId.startsWith("duoBios.") && !hasDuoBios) return false;
  if (blockId.startsWith("events.") && !hasEventCoverage) return false;
  if (blockId === "partners.caseStudy" && hasCaseStudy === false) return false;
  if (blockId === "partners.chips" && hasPartners === false) return false;

  return true;
}
