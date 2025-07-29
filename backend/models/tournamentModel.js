import mongoose from 'mongoose';

const tournamentSchema = new mongoose.Schema(
  {
    name:   { type: String, required: true },

    // 🆕 Ảnh đại diện giải
    image:  {
      type: String,
      default:
        'https://vnss.sportconnect.vn/images/giai_dau/TOU-880-1753536611434-811505.jpeg',
    },

    sportType: { type: Number, required: true }, // 1=Pickle Ball, 2=Tennis
    groupId:   { type: Number, default: 0 },

    // Đăng ký
    registrationDeadline: { type: Date, required: true },
    registered:           { type: Number, default: 0 },
    expected:             { type: Number, default: 0 },

    // Match info
    matchesCount: { type: Number, default: 0 },

    // Thời gian diễn ra
    startDate: { type: Date, required: true },
    endDate:   { type: Date, required: true },

    // Trạng thái
    status: {
      type: String,
      enum: ['Sắp diễn ra', 'Đang diễn ra', 'Đã diễn ra'],
      default: 'Sắp diễn ra',
    },

    location:  { type: String, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    contactHtml: { type: String, default: '' },   // 👉  Thông tin liên hệ (HTML)
    contentHtml: { type: String, default: '' },   // 👉  Nội dung giải (HTML)
  },
  { timestamps: true }
);
export default mongoose.model('Tournament', tournamentSchema);