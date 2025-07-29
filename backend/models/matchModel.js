import mongoose from 'mongoose';

const matchSchema = new mongoose.Schema({
  tournament:  { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true },

  /** liên kết đến 2 bản đăng ký */
  reg1: { type: mongoose.Schema.Types.ObjectId, ref: 'Registration', required: true },
  reg2: { type: mongoose.Schema.Types.ObjectId, ref: 'Registration', required: true },

  code:   { type: String, required: true },
  date:   { type: Date,   required: true },
  time:   { type: String, required: true },

  score1: { type: Number, default: 0 },
  score2: { type: Number, default: 0 },

  field:   { type: String },
  referee: { type: String },
  status:  { type: String, enum: ['Chưa', 'Đang', 'Hoàn thành'], default: 'Chưa' },
});

matchSchema.index({ tournament: 1, code: 1 }, { unique: true });

export default mongoose.model('Match', matchSchema);
