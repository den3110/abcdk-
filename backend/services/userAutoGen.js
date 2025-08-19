import User from "../models/userModel.js";

// Mini RNG có seed (LCG)
function makeRNG(seed = Date.now()) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

const VN_PREFIXES = ["032","033","034","035","036","037","038","039","070","076","077","078","079","081","082","083","084","085","086","088","089","090","091","092","093","094","095","096","097","098","099"];
const PROVINCES = ["Hà Nội","TP.HCM","Đà Nẵng","Hải Phòng","Cần Thơ","Bình Dương","Đồng Nai","Quảng Ninh","Khánh Hòa","Nghệ An","Thanh Hóa","Thái Nguyên","Lâm Đồng","An Giang","Kiên Giang"];

const LAST_NAMES = ["Nguyễn","Trần","Lê","Phạm","Hoàng","Huỳnh","Phan","Vũ","Võ","Đặng","Bùi","Đỗ","Hồ","Ngô"];
const MID_NAMES  = ["Văn","Hữu","Đình","Quốc","Nhật","Ngọc","Thị","Thanh","Minh","Anh","Gia","Tuấn","Duy","Thảo","Thuỳ"];
const FIRST_NAMES = ["Anh","Bảo","Châu","Dung","Dũng","Giang","Hà","Hải","Hạnh","Hiếu","Hương","Khánh","Lan","Linh","Long","Nam","Ngân","Ngọc","Phong","Phúc","Quân","Quang","Quỳnh","Thảo","Thành","Trang","Trung","Tú","Vy","Yến"];

const slug = (s) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/(^\.|\.$)/g, "");

const randPick = (rng, arr) => arr[Math.floor(rng()*arr.length)];

const randInt = (rng, min, max) => Math.floor(rng()*(max-min+1))+min;

function uniqueFactory({ rng, exists }) {
  // exists: async (field, value) => boolean
  return {
    async email(base, domain) {
      let i = 0;
      while (true) {
        const v = i === 0 ? `${base}@${domain}` : `${base}.${i}@${domain}`;
        const used = await exists("email", v);
        if (!used) return v;
        i++;
      }
    },
    async phone() {
      let i = 0;
      while (true) {
        const p = randPick(rng, VN_PREFIXES) + String(randInt(rng, 0, 9999999)).padStart(7, "0");
        const used = await exists("phone", p);
        if (!used) return p;
        if (++i > 20) return p; // fallback
      }
    },
    async nickname(base) {
      let i = 0;
      while (true) {
        const v = i === 0 ? base : `${base}${String(randInt(rng,100,999))}`;
        const used = await exists("nickname", v);
        if (!used) return v;
        i++;
      }
    },
  };
}

const existsInDB = async (field, value) => {
  const q = {}; q[field] = value;
  const c = await User.countDocuments(q).lean();
  return c > 0;
};

export async function buildAutoUsers(opts, { checkUniqueness = true, dryRun = true } = {}) {
  const {
    count = 1,
    role = "user",
    emailDomain = "example.com",
    passwordMode = "random",
    fixedPassword = "P@ssw0rd!",
    randomLength = 10,
    verified = "pending",
    withCCCD = false,
    cccdStatus = "unverified",
    gender = "unspecified",
    province, // optional
    seed,
  } = opts;

  if (count < 1 || count > 1000) throw new Error("count phải trong khoảng 1..1000");
  if (!["user","referee","admin"].includes(role)) throw new Error("role không hợp lệ");
  if (!["pending","verified"].includes(verified)) throw new Error("verified không hợp lệ");
  if (!["random","fixed"].includes(passwordMode)) throw new Error("passwordMode không hợp lệ");
  if (!["unverified","pending","verified","rejected"].includes(cccdStatus)) throw new Error("cccdStatus không hợp lệ");
  if (!["male","female","unspecified","other"].includes(gender)) throw new Error("gender không hợp lệ");

  const rng = makeRNG(seed ?? Date.now());
  const unique = uniqueFactory({ rng, exists: checkUniqueness ? existsInDB : async () => false });

  const genPassword = () => {
    if (passwordMode === "fixed") return fixedPassword;
    const chars = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*";
    let s = "";
    for (let i=0;i<randomLength;i++) s += chars[Math.floor(rng()*chars.length)];
    return s;
  };

  const emailGenerators = [];
  const phoneGenerators = [];
  const nicknameGenerators = [];

  const list = [];
  for (let i=0; i<count; i++) {
    // name
    const last = randPick(rng, LAST_NAMES);
    const mid  = randPick(rng, MID_NAMES);
    const first= randPick(rng, FIRST_NAMES);
    const name = `${last} ${mid} ${first}`;

    // base for email/nickname
    const baseSlug = slug(`${first}.${last}`);

    // email
    const emailBase = `${baseSlug}`;
    const emailGen = async () => unique.email(emailBase, emailDomain);
    emailGenerators.push(emailGen);
    const email = checkUniqueness ? await emailGen() : `${emailBase}@${emailDomain}`;

    // nickname (role=user)
    let nickname, nicknameGen;
    if (role === "user") {
      nicknameGen = async () => unique.nickname(baseSlug);
      nicknameGenerators.push(nicknameGen);
      nickname = checkUniqueness ? await nicknameGen() : baseSlug;
    }

    // phone (role=user)
    let phone, phoneGen;
    if (role === "user") {
      phoneGen = async () => unique.phone();
      phoneGenerators.push(phoneGen);
      phone = checkUniqueness ? await phoneGen() : "090" + String(randInt(rng,0,9999999)).padStart(7,"0");
    }

    // dob (role=user) — 18..40 tuổi
    let dob;
    if (role === "user") {
      const now = new Date();
      const age = randInt(rng, 18, 40);
      const year = now.getFullYear() - age;
      const month = randInt(rng, 1, 12);
      const day = randInt(rng, 1, 28);
      dob = new Date(Date.UTC(year, month-1, day));
    }

    // CCCD
    const cccd = withCCCD ? String(randInt(rng, 0, 999999999999)).padStart(12, "0") : undefined;

    // province
    const pv = province ?? randPick(rng, PROVINCES);

    const plain = genPassword();

    const doc = {
      name,
      email,
      password: plain,                 // sẽ hash bởi pre-save
      role,
      verified,
      gender,
      province: pv,
      avatar: "",
      bio: "",
      cccdStatus: withCCCD ? cccdStatus : "unverified",
      ...(role === "user" ? { nickname, phone, dob } : {}),
      ...(withCCCD ? { cccd, cccdImages: { front: "", back: "" } } : {}),
      // Generators giữ kèm để retry nếu dính duplicate
      emailGenerator: emailGen,
      phoneGenerator: phoneGen,
      nicknameGenerator: nicknameGen,
      __plainPassword: plain,
    };

    list.push(doc);
  }

  if (dryRun) {
    // không lưu DB, chỉ trả về draft (ẩn plainPassword khi preview? -> vẫn giữ để FE có thể test)
    return list;
  }

  return list;
}
