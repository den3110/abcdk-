import Registration from "../models/registrationModel.js";

function buildRegistrationPlayerSnapshot(user) {
  return {
    fullName: String(user?.fullName || user?.name || user?.nickname || "").trim(),
    nickName: String(user?.nickname || user?.nickName || "").trim(),
    avatar: String(user?.avatar || "").trim(),
  };
}

export async function syncRegistrationProfileSnapshot(user) {
  const userId = user?._id;
  if (!userId) return { matched: 0, modified: 0 };

  const snapshot = buildRegistrationPlayerSnapshot(user);

  const [player1Result, player2Result] = await Promise.all([
    Registration.updateMany(
      { "player1.user": userId },
      {
        $set: {
          "player1.fullName": snapshot.fullName,
          "player1.nickName": snapshot.nickName,
          "player1.avatar": snapshot.avatar,
        },
      }
    ),
    Registration.updateMany(
      { "player2.user": userId },
      {
        $set: {
          "player2.fullName": snapshot.fullName,
          "player2.nickName": snapshot.nickName,
          "player2.avatar": snapshot.avatar,
        },
      }
    ),
  ]);

  return {
    matched: (player1Result.matchedCount || 0) + (player2Result.matchedCount || 0),
    modified:
      (player1Result.modifiedCount || 0) + (player2Result.modifiedCount || 0),
  };
}
