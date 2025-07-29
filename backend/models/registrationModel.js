import mongoose from 'mongoose';

const PROVINCES = [/* đủ 63 tỉnh thành */];

const playerSchema = new mongoose.Schema(
  {
    phone:     { type: String, required: true },
    fullName:  { type: String, required: true },
    avatar:    { type: String },
    selfScore: { type: Number, min: 0, max: 10 },
    province:  { type: String, enum: PROVINCES, required: true },
    note:      { type: String },
  },
  { _id: false }
);

const registrationSchema = new mongoose.Schema(
  {
    tournament: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true },
    player1:    { type: playerSchema, required: true },
    player2:    { type: playerSchema, required: true },
    message:    { type: String },

    payment: {
      status: { type: String, enum: ['Chưa nộp', 'Đã nộp'], default: 'Chưa nộp' },
      paidAt: { type: Date },
    },

    checkinAt: { type: Date },
  },
  { timestamps: true }
);

export default mongoose.model('Registration', registrationSchema);
