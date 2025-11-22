// graphql/modules/user/resolvers.js
import User from "../../../models/userModel.js";

export const userResolvers = {
  Query: {
    // /graphql → query { me { id name email } }
    me: async (_parent, _args, ctx) => {
      if (!ctx.user) return null;

      // dùng DataLoader nếu có
      const doc = await ctx.loaders.userById.load(String(ctx.user._id));
      if (!doc) return null;

      return toGQLUser(doc);
    },

    user: async (_parent, { id }, ctx) => {
      const doc = await ctx.loaders.userById.load(String(id));
      if (!doc) return null;
      return toGQLUser(doc);
    },

    users: async (_parent, { limit = 20, offset = 0 }, ctx) => {
      // chỉ admin mới xem danh sách
      if (!ctx.user || ctx.user.role !== "admin") {
        throw new Error("FORBIDDEN");
      }

      const docs = await User.find({
        isDeleted: { $ne: true },
      })
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit);

      return docs.map(toGQLUser);
    },
  },

  Mutation: {
    register: async (_parent, { input }, _ctx) => {
      const { name, email, password, nickname, phone, role } = input;

      if (!nickname) {
        throw new Error("NICKNAME_REQUIRED");
      }

      // check trùng email (nếu có)
      if (email) {
        const existedEmail = await User.findOne({ email });
        if (existedEmail) {
          throw new Error("EMAIL_ALREADY_EXISTS");
        }
      }

      // check trùng phone (nếu có)
      if (phone) {
        const existedPhone = await User.findOne({ phone });
        if (existedPhone) {
          throw new Error("PHONE_ALREADY_EXISTS");
        }
      }

      // check trùng nickname
      const existedNickname = await User.findOne({ nickname });
      if (existedNickname) {
        throw new Error("NICKNAME_ALREADY_EXISTS");
      }

      const user = await User.create({
        name,
        email,
        password,
        nickname,
        phone,
        role: role || "user",
      });

      return toGQLUser(user);
    },
  },

  // field-level resolvers
  User: {
    id: (user) => String(user.id || user._id),
    isAdmin: (user) => (user.role || "user") === "admin",
    role: (user) => user.role || "user",
  },
};

function toGQLUser(doc) {
  return {
    id: String(doc._id),
    name: doc.name || null,
    nickname: doc.nickname || null,
    phone: doc.phone || null,
    email: doc.email || null,
    role: doc.role || "user",
    isAdmin: (doc.role || "user") === "admin",
    avatar: doc.avatar || null,
    cover: doc.cover || null,
    province: doc.province || null,
    verified: doc.verified || null,
    cccdStatus: doc.cccdStatus || null,
    createdAt: doc.createdAt ? doc.createdAt.toISOString() : null,
    updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : null,
  };
}
