// controllers/drawSettingsController.js
import expressAsyncHandler from "express-async-handler";
import AppSetting from "../models/appSettingModel.js";
import Tournament from "../models/tournamentModel.js";
import Bracket from "../models/bracketModel.js";
import Registration from "../models/registrationModel.js";
import { planGroups } from "../utils/draw/groupPlanner.js";

/* ───────────────── helpers ───────────────── */

const ALLOWED_PATHS = [
  "seed",
  // planner (dạng SỐ, không dùng groupSizes)
  "planner.groupSize",
  "planner.groupCount",
  "planner.autoFit",
  "planner.allowUneven",
  "planner.byePolicy",
  "planner.overflowPolicy",
  "planner.underflowPolicy",
  "planner.minSize",
  "planner.maxSize",
  // scorer
  "scorer.randomness",
  "scorer.lookahead.enabled",
  "scorer.lookahead.width",
  "scorer.constraints.balanceSkillAcrossGroups",
  "scorer.constraints.targetGroupAvgSkill",
  "scorer.constraints.usePots",
  "scorer.constraints.potBy",
  "scorer.constraints.potCount",
  "scorer.constraints.protectTopSeeds",
  "scorer.constraints.avoidRematchWithinDays",
  "scorer.constraints.balanceSkillInPair",
  "scorer.constraints.pairTargetSkillDiff",
  "scorer.constraints.maxRoundsSeedSeparation",
  "scorer.weights.skillAvgVariance",
  "scorer.weights.skillStd",
  "scorer.weights.potClash",
  "scorer.weights.seedClash",
  "scorer.weights.rematch",
  "scorer.weights.koSkillDiff",
  "scorer.recent.days",
];

function getPath(obj, path) {
  return String(path)
    .split(".")
    .reduce((acc, k) => acc?.[k] ?? undefined, obj);
}

function setPath(obj, path, val) {
  const parts = String(path).split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = val;
}

/**
 * Merge CHỈ các key được phép:
 * - copy allowed từ base
 * - override bằng allowed từ patch
 * => field không whitelist sẽ bị loại (lọc sạch rác cũ trong DB)
 */
function mergeAllowed(base = {}, patch = {}) {
  const out = {};
  for (const p of ALLOWED_PATHS) {
    const bv = getPath(base, p);
    if (bv !== undefined) setPath(out, p, bv);
    const pv = getPath(patch, p);
    if (pv !== undefined) setPath(out, p, pv);
  }
  return out;
}

/** Lọc object, chỉ giữ allowed paths */
function keepAllowedOnly(obj = {}) {
  return mergeAllowed({}, obj);
}

function normalize(ds = {}) {
  const o = JSON.parse(JSON.stringify(ds || {}));

  // seed
  o.seed = Number(o.seed || 0);

  // planner (dạng SỐ)
  o.planner = o.planner || {};
  o.planner.minSize = Math.max(2, Number(o.planner.minSize ?? 3));
  o.planner.maxSize = Math.max(
    o.planner.minSize,
    Number(o.planner.maxSize ?? 16)
  );
  o.planner.groupSize = Math.max(0, Number(o.planner.groupSize ?? 0)); // 0 = auto
  o.planner.groupCount = Math.max(0, Number(o.planner.groupCount ?? 0)); // 0 = auto
  o.planner.allowUneven = Boolean(o.planner.allowUneven ?? false);
  o.planner.autoFit = Boolean(o.planner.autoFit ?? false);

  const BYE = ["none", "pad"];
  const OVER = ["grow", "extraGroup"];
  const UNDER = ["shrink", "byes"];
  o.planner.byePolicy = BYE.includes(o.planner.byePolicy)
    ? o.planner.byePolicy
    : "none";
  o.planner.overflowPolicy = OVER.includes(o.planner.overflowPolicy)
    ? o.planner.overflowPolicy
    : "grow";
  o.planner.underflowPolicy = UNDER.includes(o.planner.underflowPolicy)
    ? o.planner.underflowPolicy
    : "shrink";

  // scorer
  o.scorer = o.scorer || {};
  o.scorer.randomness = Math.max(
    0,
    Math.min(0.2, Number(o.scorer.randomness ?? 0.02))
  );
  o.scorer.lookahead = o.scorer.lookahead || {};
  o.scorer.lookahead.enabled = Boolean(o.scorer.lookahead.enabled ?? true);
  o.scorer.lookahead.width = Math.max(
    1,
    Math.min(20, Number(o.scorer.lookahead.width ?? 5))
  );
  o.scorer.constraints = o.scorer.constraints || {};
  o.scorer.weights = o.scorer.weights || {};
  o.scorer.recent = o.scorer.recent || { days: 120 };

  return o;
}

/* ───────────────── schema metadata để FE render form ───────────────── */

export const getDrawSchema = expressAsyncHandler(async (_req, res) => {
  const schema = {
    sections: [
      {
        key: "planner",
        title: "Planner — Chia bảng",
        fields: [
          {
            path: "planner.groupSize",
            label: "Số đội mỗi bảng (groupSize)",
            help: "Số đội MONG MUỐN trong 1 bảng. 0 = để hệ thống tự tính. Nếu cả groupSize và groupCount đều 0 → hệ thống chọn cách chia đều nhất trong [minSize..maxSize]. Ví dụ: 18 đội, groupSize=4, groupCount=0 → khoảng 5 bảng với 3–4 đội/bảng (nếu bật lệch ±1).",
            type: "number",
            min: 0,
            max: 64,
            step: 1,
          },
          {
            path: "planner.groupCount",
            label: "Số bảng (groupCount)",
            help: "Số bảng MONG MUỐN. 0 = tự tính dựa vào tổng đội và groupSize. Nếu bạn cố định cả groupSize và groupCount mà tổng slot > tổng đội → xem mục Thiếu slot để xử lý.",
            type: "number",
            min: 0,
            max: 64,
            step: 1,
          },
          {
            path: "planner.allowUneven",
            label: "Cho phép bảng lệch ±1",
            help: "Cho phép một vài bảng có nhiều/ít hơn 1 đội so với groupSize để chia đều hơn và giảm BYE. Ví dụ: 20 đội, groupSize=5 → 4 bảng x 5; nếu 18 đội, bật lệch → có thể ra 2 bảng 5 và 2 bảng 4.",
            type: "boolean",
          },
          {
            path: "planner.underflowPolicy",
            label: "Thiếu slot",
            help: "Xảy ra khi slot (groupSize×groupCount) > số đội. 'shrink' = tự co bớt cỡ bảng trong phạm vi [minSize..maxSize]; 'byes' = giữ cỡ bảng và chèn BYE cho slot trống.",
            type: "select",
            options: ["shrink", "byes"],
          },
          {
            path: "planner.byePolicy",
            label: "BYE policy",
            help: "'none' = chỉ tạo BYE khi BẮT BUỘC (do underflow). 'pad' = chủ động chèn BYE để giữ các bảng bằng nhau thay vì co nhóm. Dùng 'pad' khi muốn kích thước bảng đồng nhất.",
            type: "select",
            options: ["none", "pad"],
          },
          {
            path: "planner.overflowPolicy",
            label: "Dư đội",
            help: "Xảy ra khi slot < số đội. 'grow' = tăng thêm 1 người cho một vài bảng (tôn trọng maxSize) để đủ chỗ; 'extraGroup' = tạo thêm 1 bảng mới nếu còn trong giới hạn groupCount=0 (tự tính) hoặc cho phép nở.",
            type: "select",
            options: ["grow", "extraGroup"],
          },
          {
            path: "planner.minSize",
            label: "Kích thước bảng nhỏ nhất",
            help: "Sàn kích thước khi hệ thống cần CO bảng (shrink). Nên đặt ≥3 nếu muốn hạn chế bảng quá nhỏ; tối thiểu 2 để còn đấu lượt về.",
            type: "number",
            min: 2,
            max: 64,
            step: 1,
          },
          {
            path: "planner.maxSize",
            label: "Kích thước bảng lớn nhất",
            help: "Trần kích thước khi hệ thống cần NỞ bảng (grow). Đặt nhỏ lại nếu muốn nhiều bảng hơn và ít trận/bảng hơn.",
            type: "number",
            min: 2,
            max: 128,
            step: 1,
          },
        ],
      },
      {
        key: "scorer",
        title: "Scorer/Drawer — Chọn đội cho từng slot",
        fields: [
          {
            path: "scorer.randomness",
            label: "Randomness",
            help: "Độ ngẫu nhiên thêm vào điểm xếp chỗ (0..0.2). 0 = hoàn toàn theo thuật toán (ổn định); 0.05–0.1 = hợp lý để có nhiều phương án mà vẫn tôn trọng ràng buộc.",
            type: "number",
            min: 0,
            max: 0.2,
            step: 0.01,
          },
          {
            path: "scorer.lookahead.enabled",
            label: "Bật Lookahead",
            help: "Thử trước nhiều bước khi xếp đội để tránh kịch bản ‘hết chỗ hợp lệ’ về cuối. Bật = kết quả chất lượng hơn nhưng chậm hơn.",
            type: "boolean",
          },
          {
            path: "scorer.lookahead.width",
            label: "Lookahead width",
            help: "Số ứng viên tốt nhất giữ lại ở MỖI bước (1..20). Rộng hơn = ít kẹt hơn nhưng tốn thời gian hơn. 5–8 thường đủ.",
            type: "number",
            min: 1,
            max: 20,
            step: 1,
          },

          /* --- RÀNG BUỘC (bật/tắt hoặc đặt mục tiêu) --- */
          {
            path: "scorer.constraints.balanceSkillAcrossGroups",
            label: "Cân bằng skill giữa bảng",
            help: "Khi bật, thuật toán cố làm trung bình skill các bảng gần nhau. Dùng cùng các trọng số skill* bên dưới để kiểm soát độ ‘gắt’.",
            type: "boolean",
          },
          {
            path: "scorer.constraints.targetGroupAvgSkill",
            label: "Mục tiêu avg skill",
            help: "Mức trung bình skill mong muốn cho MỖI bảng (0..1; 0.5 ~ trung tính). Để trống/0.5 nếu chỉ cần các bảng gần nhau chứ không nhắm một mức cố định.",
            type: "number",
            min: 0,
            max: 1,
            step: 0.01,
          },
          {
            path: "scorer.constraints.usePots",
            label: "Bốc theo Pot",
            help: "Chia danh sách đội vào các ‘Pot’ theo tiêu chí (thường là skill) rồi rải mỗi bảng 1–2 đội từ từng Pot để đều trình.",
            type: "boolean",
          },
          {
            path: "scorer.constraints.potBy",
            label: "Tiêu chí Pot",
            help: "Thuộc tính dùng để chia Pot (vd: 'skill', 'elo', 'rank'). Không có cột đó → bỏ qua.",
            type: "text",
          },
          {
            path: "scorer.constraints.potCount",
            label: "Số Pot",
            help: "Số rổ để chia đều trình. 4–8 là phổ biến. Pot quá nhiều với ít đội sẽ kém hiệu quả.",
            type: "number",
            min: 2,
            max: 16,
            step: 1,
          },
          {
            path: "scorer.constraints.protectTopSeeds",
            label: "Bảo vệ top-seed",
            help: "Số đội hạt giống cao cần TÁCH nhau (không cùng bảng / cùng nhánh sớm). Ví dụ: 4 → 4 đội top rải vào các bảng/nhánh khác nhau.",
            type: "number",
            min: 0,
            max: 64,
            step: 1,
          },
          {
            path: "scorer.constraints.avoidRematchWithinDays",
            label: "Tránh tái đấu (ngày)",
            help: "Không ghép lại 2 đội đã gặp trong N ngày gần đây (nếu có dữ liệu lịch sử). 0 = tắt. Dùng hữu ích ở vòng bảng nhiều sự kiện liên tiếp.",
            type: "number",
            min: 0,
            max: 365,
            step: 1,
          },
          {
            path: "scorer.constraints.balanceSkillInPair",
            label: "Cân skill trong cặp KO",
            help: "Ưu tiên ghép đối thủ ngang trình ở VÒNG LOẠI TRỰC TIẾP (knockout). Dùng cùng pairTargetSkillDiff để đặt ngưỡng mong muốn.",
            type: "boolean",
          },
          {
            path: "scorer.constraints.pairTargetSkillDiff",
            label: "Mục tiêu chênh skill KO",
            help: "Chênh lệch skill mong muốn giữa 2 đội trong 1 cặp KO (0..1). Càng nhỏ càng cân bằng (vd 0.1–0.2).",
            type: "number",
            min: 0,
            max: 1,
            step: 0.01,
          },
          {
            path: "scorer.constraints.maxRoundsSeedSeparation",
            label: "Cách vòng cho top-seed",
            help: "Ép các top-seed chỉ có thể gặp nhau từ VÒNG SAU. 0 = tắt; 1 ≈ khác nhánh đến tứ kết; 2 ≈ chỉ gặp từ bán kết; 3–4 ≈ chỉ gặp ở chung kết (tùy quy mô nhánh).",
            type: "number",
            min: 0,
            max: 4,
            step: 1,
          },

          /* --- TRỌNG SỐ (weight = 0 để bỏ qua tiêu chí) --- */
          {
            path: "scorer.weights.skillAvgVariance",
            label: "Trọng số chênh avg skill",
            help: "Phạt khi trung bình skill giữa các bảng chênh nhau. Tăng số này để các bảng ‘đều’ hơn về tổng thể.",
            type: "number",
            min: 0,
            max: 3,
            step: 0.1,
          },
          {
            path: "scorer.weights.skillStd",
            label: "Trọng số độ lệch chuẩn",
            help: "Phạt khi trong CÙNG một bảng có độ phân tán skill quá lớn. Tăng số này để mỗi bảng ít ‘vênh’ trình nội bộ.",
            type: "number",
            min: 0,
            max: 3,
            step: 0.1,
          },
          {
            path: "scorer.weights.potClash",
            label: "Trọng số va chạm Pot",
            help: "Phạt khi rơi vào cấu hình trái mong muốn theo Pot (vd: 2 đội cùng Pot rơi chung bảng). Đặt 0 nếu không dùng Pot.",
            type: "number",
            min: 0,
            max: 3,
            step: 0.1,
          },
          {
            path: "scorer.weights.seedClash",
            label: "Trọng số va chạm seed",
            help: "Phạt khi các top-seed đụng nhau quá sớm. Tăng số này nếu muốn bảo vệ hạt giống mạnh mẽ hơn.",
            type: "number",
            min: 0,
            max: 3,
            step: 0.1,
          },
          {
            path: "scorer.weights.rematch",
            label: "Trọng số tái đấu",
            help: "Phạt cặp từng gặp nhau trong ‘avoidRematchWithinDays’. Tăng số này nếu muốn tránh lặp cặp tuyệt đối.",
            type: "number",
            min: 0,
            max: 3,
            step: 0.1,
          },
          {
            path: "scorer.weights.koSkillDiff",
            label: "Trọng số chênh KO",
            help: "Phạt cặp KO có chênh lệch skill lớn. Dùng cùng 'balanceSkillInPair' và 'pairTargetSkillDiff'.",
            type: "number",
            min: 0,
            max: 3,
            step: 0.1,
          },
        ],
      },
      {
        key: "seed",
        title: "Seed",
        fields: [
          {
            path: "seed",
            label: "Seed ngẫu nhiên",
            help: "0 = sinh theo thời điểm hiện tại (mỗi lần chạy ra kết quả khác). >0 = cố định để tái lập kết quả bốc/chia như cũ.",
            type: "number",
            min: 0,
            max: 2147483647,
            step: 1,
          },
        ],
      },
    ],
  };
  res.json({ ok: true, schema });
});

/* ───────────────── Global ───────────────── */

export const getGlobalDrawSettings = expressAsyncHandler(async (_req, res) => {
  const doc = await AppSetting.findOne({ key: "drawSettings" }).lean();
  const clean = keepAllowedOnly(doc?.value || {});
  res.json({ ok: true, scope: "global", drawSettings: normalize(clean) });
});

export const updateGlobalDrawSettings = expressAsyncHandler(
  async (req, res) => {
    const patch = req.body?.drawSettings || req.body || {};
    // console.log("patch", patch);
    const cur =
      (await AppSetting.findOne({ key: "drawSettings" }).lean())?.value || {};
    const merged = normalize(mergeAllowed(cur, patch)); // loại field lạ, chuẩn hoá số
    const saved = await AppSetting.findOneAndUpdate(
      { key: "drawSettings" },
      { $set: { value: merged } },
      { upsert: true, new: true }
    );
    res.json({ ok: true, scope: "global", drawSettings: saved.value });
  }
);

/* ───────────────── Tournament ───────────────── */

export const getTournamentDrawSettings = expressAsyncHandler(
  async (req, res) => {
    const { tournamentId } = req.params;
    const t = await Tournament.findById(tournamentId)
      .select("drawSettings")
      .lean();
    if (!t) {
      res.status(404);
      throw new Error("Tournament not found");
    }
    const clean = keepAllowedOnly(t.drawSettings || {});
    res.json({
      ok: true,
      scope: "tournament",
      tournamentId,
      drawSettings: normalize(clean),
    });
  }
);

export const updateTournamentDrawSettings = expressAsyncHandler(
  async (req, res) => {
    const { tournamentId } = req.params;
    const patch = req.body?.drawSettings || req.body || {};
    const cur =
      (await Tournament.findById(tournamentId).select("drawSettings").lean())
        ?.drawSettings || {};
    const merged = normalize(mergeAllowed(cur, patch));
    const t = await Tournament.findByIdAndUpdate(
      tournamentId,
      { $set: { drawSettings: merged } },
      { new: true }
    ).select("drawSettings");
    if (!t) {
      res.status(404);
      throw new Error("Tournament not found");
    }
    res.json({
      ok: true,
      scope: "tournament",
      tournamentId,
      drawSettings: t.drawSettings,
    });
  }
);

/* ───────────────── Bracket ───────────────── */

export const getBracketDrawSettings = expressAsyncHandler(async (req, res) => {
  const { bracketId } = req.params;
  const b = await Bracket.findById(bracketId)
    .select("tournament drawSettings")
    .lean();
  if (!b) {
    res.status(404);
    throw new Error("Bracket not found");
  }
  const clean = keepAllowedOnly(b.drawSettings || {});
  res.json({
    ok: true,
    scope: "bracket",
    bracketId,
    tournamentId: String(b.tournament),
    drawSettings: normalize(clean),
  });
});

export const updateBracketDrawSettings = expressAsyncHandler(
  async (req, res) => {
    const { bracketId } = req.params;
    const patch = req.body?.drawSettings || req.body || {};
    // console.log("patch", patch);
    const cur =
      (await Bracket.findById(bracketId).select("drawSettings").lean())
        ?.drawSettings || {};
    const merged = normalize(mergeAllowed(cur, patch));
    const b = await Bracket.findByIdAndUpdate(
      bracketId,
      { $set: { drawSettings: merged } },
      { new: true }
    )
      .select("tournament drawSettings")
      .lean();
    if (!b) {
      res.status(404);
      throw new Error("Bracket not found");
    }
    res.json({
      ok: true,
      scope: "bracket",
      bracketId,
      tournamentId: String(b.tournament),
      drawSettings: b.drawSettings,
    });
  }
);

/* ───────────────── Effective & Preview ───────────────── */

async function loadEffective({ tournamentId, bracketId }) {
  const g = keepAllowedOnly(
    (await AppSetting.findOne({ key: "drawSettings" }).lean())?.value || {}
  );
  let t = {};
  let b = {};
  if (tournamentId) {
    t = keepAllowedOnly(
      (await Tournament.findById(tournamentId).select("drawSettings").lean())
        ?.drawSettings || {}
    );
  }
  if (bracketId) {
    const br = await Bracket.findById(bracketId)
      .select("tournament drawSettings")
      .lean();
    if (!br) throw new Error("Bracket not found");
    b = keepAllowedOnly(br.drawSettings || {});
    if (!tournamentId) {
      t = keepAllowedOnly(
        (await Tournament.findById(br.tournament).select("drawSettings").lean())
          ?.drawSettings || {}
      );
    }
  }
  // g -> t -> b (b override t override g)
  return normalize(mergeAllowed(mergeAllowed(g, t), b));
}

export const getEffectiveDrawSettings = expressAsyncHandler(
  async (req, res) => {
    const { tournamentId, bracketId } = req.query;
    if (!tournamentId && !bracketId) {
      return res.json({
        ok: true,
        effective: await loadEffective({}),
        scope: {},
      });
    }
    const eff = await loadEffective({ tournamentId, bracketId });
    res.json({
      ok: true,
      effective: eff,
      scope: {
        tournamentId: tournamentId || null,
        bracketId: bracketId || null,
      },
    });
  }
);

export const previewPlan = expressAsyncHandler(async (req, res) => {
  const {
    tournamentId,
    bracketId,
    override = {},
    groupSize,
    groupCount,
  } = req.body || {};

  // resolve tId
  let tId = tournamentId;
  if (!tId && bracketId) {
    const br = await Bracket.findById(bracketId).select("tournament").lean();
    if (!br) {
      res.status(404);
      throw new Error("Bracket not found");
    }
    tId = String(br.tournament);
  }
  if (!tId && !bracketId) {
    res.status(400);
    throw new Error("tournamentId or bracketId is required");
  }

  // effective (chuẩn hoá số), cộng override hợp lệ
  const eff = await loadEffective({ tournamentId: tId, bracketId });
  const merged = normalize(mergeAllowed(eff, override || {}));

  // nếu body có groupSize/groupCount (số), ép đè vào planner
  if (Number.isFinite(groupSize))
    merged.planner.groupSize = Math.max(0, Number(groupSize));
  if (Number.isFinite(groupCount))
    merged.planner.groupCount = Math.max(0, Number(groupCount));

  const regCount = await Registration.countDocuments({ tournament: tId });
  const { groupSizes, byes } = planGroups(regCount, merged.planner);

  res.json({
    ok: true,
    tournamentId: tId,
    bracketId: bracketId || null,
    regCount,
    planned: { groupSizes, byes }, // KẾT QUẢ tính toán (mảng), không phải cấu hình lưu trữ
    effective: merged, // cấu hình sau khi merge+normalize (giữ groupSize/groupCount dạng số)
  });
});
