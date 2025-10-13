import mongoose from "mongoose";

const TIERS = [
  "Platinum",
  "Gold",
  "Silver",
  "Bronze",
  "Partner",
  "Media",
  "Other",
];

function slugify(str) {
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const sponsorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    logoUrl: { type: String, default: "" },
    websiteUrl: { type: String, default: "" },
    refLink: { type: String, default: "" },
    tier: { type: String, enum: TIERS, default: "Other", index: true },
    description: { type: String, default: "" },
    featured: { type: Boolean, default: false, index: true },
    weight: { type: Number, default: 0, index: true }, // số càng lớn càng ưu tiên (sort desc)
  },
  { timestamps: true }
);

sponsorSchema.pre("validate", function (next) {
  if (!this.slug && this.name) this.slug = slugify(this.name);
  next();
});

export const Sponsor = mongoose.model("Sponsor", sponsorSchema);
export const SPONSOR_TIERS = TIERS;
