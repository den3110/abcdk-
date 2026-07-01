import mongoose from "mongoose";

const BlogHomepageBannerSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false, index: true },
    text: { type: String, default: "" },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    priority: { type: Number, default: 0 },
  },
  { _id: false },
);

const BlogPostSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true },
    summary: String,
    contentHtml: { type: String, required: true },
    contentText: String,
    tags: [String],
    status: {
      type: String,
      enum: ["draft", "published", "hidden"],
      default: "draft",
      index: true,
    },
    heroImageUrl: String,
    publishedAt: Date,
    authorName: { type: String, default: "PickleTour" },
    homepageBanner: {
      type: BlogHomepageBannerSchema,
      default: () => ({}),
    },
  },
  { timestamps: true },
);

BlogPostSchema.index({ status: 1, publishedAt: -1, createdAt: -1 });
BlogPostSchema.index({
  status: 1,
  "homepageBanner.enabled": 1,
  "homepageBanner.startsAt": 1,
  "homepageBanner.endsAt": 1,
  "homepageBanner.priority": -1,
});

export default mongoose.model("BlogPost", BlogPostSchema);
