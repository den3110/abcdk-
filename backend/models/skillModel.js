// models/skillModel.js
import mongoose from "mongoose";

const { Schema } = mongoose;

const SkillSchema = new Schema(
  {
    name: { type: String, required: true },
    description: { type: String, default: "" },
    examples: [{ type: String }],

    // Lưu schema input mà GPT sinh ra (JSON tùy ý)
    input_schema: { type: Schema.Types.Mixed },

    // Action DSL (mongo/http/internal...)
    action: { type: Schema.Types.Mixed, required: true },

    response_template: { type: String, default: "" },

    // Embedding để search (mảng số)
    embedding: [{ type: Number }],

    // Bạn có thể lưu thêm metadata nếu muốn
    meta: { type: Schema.Types.Mixed }
  },
  {
    timestamps: true
  }
);

const Skill = mongoose.model("Skill", SkillSchema);
export default Skill;
