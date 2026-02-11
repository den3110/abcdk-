// services/bot/tools/knowledgeTools.js
// RAG Knowledge Base search tool

import Knowledge from "../../../models/knowledgeModel.js";

/**
 * Tìm kiếm trong knowledge base
 * Hiện tại dùng MongoDB text search
 * Sau này có thể upgrade lên Atlas Vector Search
 */
export async function search_knowledge({ query, category, limit = 3 }) {
  if (!query) return { error: "Cần nhập câu hỏi" };

  const filter = { isActive: true };

  // Thử text search trước
  let docs = [];

  try {
    const textFilter = { ...filter, $text: { $search: query } };
    if (category) textFilter.category = category;

    docs = await Knowledge.find(textFilter, { score: { $meta: "textScore" } })
      .sort({ score: { $meta: "textScore" } })
      .limit(Number(limit))
      .lean();
  } catch (e) {
    // Nếu text search fail, fallback sang regex
    console.log("[search_knowledge] Text search failed, falling back to regex");
  }

  // Fallback: keyword search bằng regex
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

  return {
    results: docs.map((d) => ({
      title: d.title,
      content: d.content,
      category: d.category,
    })),
    count: docs.length,
  };
}
