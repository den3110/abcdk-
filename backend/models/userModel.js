import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = mongoose.Schema(
  {
    /* thông tin cơ bản */
    name     : { type: String, required: true },
    nickname : { type: String, required: true, trim: true },
    phone    : { type: String, required: true, unique: true },
    dob      : { type: Date,   required: true },
    email    : { type: String, required: true, unique: true },
    password : { type: String, required: true },

    /* —— các trường mới —— */
    gender   : { type: String, enum: ['Nam', 'Nữ', '--'], default: '--' },              // giới tính
    joinedAt : { type: Date,   default: Date.now },                                     // ngày tham gia
    verified : { type: String, enum: ['Chờ xác thực', 'Xác thực'], default: 'Chờ xác thực' },

    ratingSingle : { type: Number, default: 0 },   // điểm đơn
    ratingDouble : { type: Number, default: 0 },   // điểm đôi
  },
  { timestamps: true }
);

/* bcrypt helpers */
userSchema.methods.matchPassword = async function (entered) {
  return bcrypt.compare(entered, this.password);
};

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, await bcrypt.genSalt(10));
  next();
});

const User = mongoose.model('User', userSchema);
export default User;
