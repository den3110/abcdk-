import Knowledge from "../../../models/knowledgeModel.js";
import {
  getCuratedKnowledgeOverride,
  normalizeUserFacingData,
} from "../textRepair.js";

export async function search_knowledge({ query, category, limit = 3 }) {
  if (!query) {
    return { error: "Cần nhập câu hỏi" };
  }

  const curatedResult = getCuratedKnowledgeOverride(query);
  if (curatedResult && (!category || category === curatedResult.category)) {
    return {
      results: [curatedResult],
      count: 1,
      curated: true,
    };
  }

  const filter = { isActive: true };
  let docs = [];

  try {
    const textFilter = { ...filter, $text: { $search: query } };
    if (category) textFilter.category = category;

    docs = await Knowledge.find(textFilter, { score: { $meta: "textScore" } })
      .sort({ score: { $meta: "textScore" } })
      .limit(Number(limit))
      .lean();
  } catch (error) {
    console.log("[search_knowledge] Text search failed, falling back to regex");
  }

  if (docs.length === 0) {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regexFilter = {
      ...filter,
      $or: [
        { title: { $regex: escaped, $options: "i" } },
        { content: { $regex: escaped, $options: "i" } },
        { keywords: { $in: query.toLowerCase().split(/\s+/) } },
      ],
    };
    if (category) regexFilter.category = category;

    docs = await Knowledge.find(regexFilter).limit(Number(limit)).lean();
  }

  if (docs.length === 0) {
    return { results: [], message: "Không tìm thấy thông tin phù hợp" };
  }

  return normalizeUserFacingData({
    results: docs.map((doc) => ({
      title: doc.title,
      content: doc.content,
      category: doc.category,
    })),
    count: docs.length,
  });
}
