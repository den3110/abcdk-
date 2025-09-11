import Bracket from "../models/bracketModel.js";
import Tournament from "../models/tournamentModel.js";


async function getEffectiveNoRankDelta(bracketId) {
  const br = await Bracket.findById(bracketId).select('noRankDelta tournament').lean();
  if (!br) return false;
  if (br.noRankDelta) return true;
  const tour = await Tournament.findById(br.tournament).select('noRankDelta').lean();
  return !!tour?.noRankDelta;
}

export default getEffectiveNoRankDelta
