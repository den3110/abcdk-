import mongoose from "mongoose";

const playerSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    phone: { type: String, required: true },
    fullName: { type: String, required: true },
    avatar: { type: String },
    score: { type: Number, required: true, default: 0 }, // Skill score locked at registration time
  },
  { _id: false }
);

const registrationSchema = new mongoose.Schema(
  {
    tournament: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
    },
    player1: { type: playerSchema, required: true },
    player2: { type: playerSchema, required: true },
    message: { type: String },

    payment: {
      status: {
        type: String,
        enum: ["Unpaid", "Paid"],
        default: "Unpaid",
      },
      paidAt: { type: Date },
    },

    checkinAt: { type: Date },
  },
  { timestamps: true }
);

registrationSchema.index({ tournament: 1 });
registrationSchema.index({ "player1.phone": 1 });
registrationSchema.index({ "player2.phone": 1 });


export default mongoose.model("Registration", registrationSchema);
