import mongoose from 'mongoose';

const rankingSchema = new mongoose.Schema(
  {
    user   : { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    double : { type: Number, required: true },
    single : { type: Number, required: true },
    games  : { type: Number, default: 0 },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true , strict: true}
);

export default mongoose.model('Ranking', rankingSchema);
