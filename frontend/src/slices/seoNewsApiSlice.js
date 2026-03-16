import { apiSlice } from "./apiSlice";

const SEO_NEWS_URL = "/api/seo-news";

export const seoNewsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getSeoNewsList: builder.query({
      query: ({ page = 1, limit = 12 } = {}) => ({
        url: SEO_NEWS_URL,
        params: { page, limit },
      }),
    }),
    getSeoNewsBySlug: builder.query({
      query: (slug) => ({
        url: `${SEO_NEWS_URL}/${slug}`,
      }),
    }),
  }),
});

export const { useGetSeoNewsListQuery, useGetSeoNewsBySlugQuery } =
  seoNewsApiSlice;
