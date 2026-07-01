import { apiSlice } from "./apiSlice";

const BLOG_URL = "/api/blog";

export const blogApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getBlogHomepageBanner: builder.query({
      query: () => ({
        url: `${BLOG_URL}/homepage-banner`,
      }),
    }),
    getBlogPostBySlug: builder.query({
      query: (slug) => ({
        url: `${BLOG_URL}/${slug}`,
      }),
    }),
  }),
});

export const {
  useGetBlogHomepageBannerQuery,
  useGetBlogPostBySlugQuery,
} = blogApiSlice;
