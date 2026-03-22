import { clearCacheGroups } from "./cacheRegistry.service.js";
import { CACHE_GROUP_IDS } from "./cacheGroups.js";

function clearGroups(groupIds = []) {
  return clearCacheGroups(groupIds);
}

export async function clearTournamentPresentationCaches() {
  return clearGroups([
    CACHE_GROUP_IDS.tournamentDetail,
    CACHE_GROUP_IDS.tournamentBrackets,
    CACHE_GROUP_IDS.tournamentBracketMatches,
    CACHE_GROUP_IDS.tournamentScheduleMatches,
    CACHE_GROUP_IDS.liveMatches,
    CACHE_GROUP_IDS.liveAppBootstrap,
    CACHE_GROUP_IDS.overlayMatch,
    CACHE_GROUP_IDS.publicHome,
    CACHE_GROUP_IDS.publicOverlayConfig,
  ]);
}

export async function clearMatchPresentationCaches() {
  return clearGroups([
    CACHE_GROUP_IDS.tournamentBracketMatches,
    CACHE_GROUP_IDS.tournamentScheduleMatches,
    CACHE_GROUP_IDS.tournamentBrackets,
    CACHE_GROUP_IDS.courtDetails,
    CACHE_GROUP_IDS.overlayMatch,
    CACHE_GROUP_IDS.overlayNextCourt,
    CACHE_GROUP_IDS.liveMatches,
    CACHE_GROUP_IDS.liveAppCourtRuntime,
    CACHE_GROUP_IDS.liveAppMatchRuntime,
    CACHE_GROUP_IDS.adminTournamentCourts,
    CACHE_GROUP_IDS.publicHome,
  ]);
}

export async function clearCourtPresentationCaches() {
  return clearGroups([
    CACHE_GROUP_IDS.courtDetails,
    CACHE_GROUP_IDS.tournamentScheduleMatches,
    CACHE_GROUP_IDS.overlayMatch,
    CACHE_GROUP_IDS.overlayNextCourt,
    CACHE_GROUP_IDS.liveMatches,
    CACHE_GROUP_IDS.liveAppCourtRuntime,
    CACHE_GROUP_IDS.liveAppMatchRuntime,
    CACHE_GROUP_IDS.liveAppBootstrap,
    CACHE_GROUP_IDS.adminTournamentCourts,
  ]);
}

export async function clearCmsPresentationCaches() {
  return clearGroups([
    CACHE_GROUP_IDS.cmsHero,
    CACHE_GROUP_IDS.cmsContact,
    CACHE_GROUP_IDS.publicHome,
    CACHE_GROUP_IDS.publicOverlayConfig,
  ]);
}

export async function clearNewsPresentationCaches() {
  return clearGroups([
    CACHE_GROUP_IDS.newsList,
    CACHE_GROUP_IDS.newsDetail,
  ]);
}

export async function clearSponsorPresentationCaches() {
  return clearGroups([
    CACHE_GROUP_IDS.publicOverlayConfig,
    CACHE_GROUP_IDS.overlayMatch,
  ]);
}
