// graphql/loaders/userLoader.js
import DataLoader from "dataloader";
import User from "../../models/userModel.js"; // chỉnh path nếu cần

export function createUserLoader() {
  return new DataLoader(async (ids) => {
    const users = await User.find({ _id: { $in: ids } }).lean();
    const map = new Map(users.map((u) => [String(u._id), u]));
    return ids.map((id) => map.get(String(id)) || null);
  });
}
