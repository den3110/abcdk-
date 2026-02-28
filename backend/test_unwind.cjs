const mongoose = require("mongoose");
const dotenv = require("dotenv");
dotenv.config({ path: "./.env" });
mongoose
  .connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/mern-auth")
  .then(async () => {
    const Ranking = mongoose.model(
      "Ranking",
      new mongoose.Schema(
        { user: mongoose.Schema.Types.ObjectId, isHiddenFromRankings: Boolean },
        { strict: false },
      ),
    );

    const agg = await Ranking.aggregate([
      {
        $match: {
          user: { $type: "objectId" },
          isHiddenFromRankings: { $ne: true },
        },
      },
      { $limit: 12 },
      {
        $lookup: {
          from: "users",
          localField: "user",
          foreignField: "_id",
          as: "user",
        },
      },
    ]);

    console.log("Without unwind, got", agg.length);
    const withMissingUsers = agg.filter((d) => !d.user || d.user.length === 0);
    console.log("Missing user count in top 12:", withMissingUsers.length);
    process.exit(0);
  });
