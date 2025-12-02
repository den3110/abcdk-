// services/skillStore.js
import Skill from "../../models/skillModel.js";

/**
 * Lấy toàn bộ skills (nếu bạn cần debug / quản trị)
 */
export async function getAllSkills() {
  // .lean() cho nhẹ & nhanh
  return Skill.find({}).lean();
}

/**
 * Thêm 1 skill mới
 * @param {Object} skill - object skill đã build sẵn (name, description, action, embedding...)
 */
export async function addSkill(skill) {
  // Có thể validate nhẹ ở đây nếu muốn
  const doc = new Skill(skill);
  await doc.save();
  return doc.toObject();
}

/**
 * Tìm skill gần nhất theo embedding (cosine similarity)
 * NOTE: hiện tại mình làm đơn giản là load tất cả skill có embedding
 * rồi tính similarity trong Node. Sau này nếu skill nhiều quá
 * bạn có thể chuyển sang vector DB hoặc Atlas Search vector.
 *
 * @param {number[]} embedding - embedding của câu hỏi user
 * @param {number} threshold   - ngưỡng similarity
 * @param {Function} cosineSim - hàm tính cosine similarity(a, b)
 */
export async function findBestSkillByEmbedding(embedding, threshold = 0.80, cosineSim) {
  // Lấy tất cả skill có embedding
  const skills = await Skill.find({
    embedding: { $exists: true, $ne: null, $not: { $size: 0 } }
  }).lean();

  let best = null;
  let bestScore = 0;

  for (const s of skills) {
    if (!Array.isArray(s.embedding) || !s.embedding.length) continue;
    const score = cosineSim(embedding, s.embedding);
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }

  if (best && bestScore >= threshold) {
    return { skill: best, score: bestScore };
  }
  return null;
}
