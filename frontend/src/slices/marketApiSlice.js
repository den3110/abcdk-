// src/slices/marketApiSlice.js — RTK Query cho Chợ PickleTour
import { apiSlice } from "./apiSlice";

export const marketApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    listListings: builder.query({
      query: (params = {}) => {
        const p = new URLSearchParams();
        Object.entries(params).forEach(([k, v]) => {
          if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
        });
        const qs = p.toString();
        return { url: `/api/market${qs ? `?${qs}` : ""}`, method: "GET" };
      },
      serializeQueryArgs: ({ queryArgs }) => {
        const { page: _p, ...rest } = queryArgs || {};
        return rest;
      },
      merge: (cache, res, { arg }) => {
        if (!arg?.page || arg.page <= 1) return res;
        const ids = new Set((cache?.items || []).map((i) => String(i._id)));
        const add = (res?.items || []).filter((i) => !ids.has(String(i._id)));
        return { ...res, items: [...(cache?.items || []), ...add] };
      },
      forceRefetch({ currentArg, previousArg }) {
        return currentArg?.page !== previousArg?.page;
      },
      providesTags: ["MarketList"],
    }),

    getListing: builder.query({
      query: (id) => ({ url: `/api/market/${id}`, method: "GET" }),
      providesTags: (r, e, id) => [{ type: "Market", id }],
    }),

    myListings: builder.query({
      query: (status) => ({
        url: `/api/market/mine${status ? `?status=${status}` : ""}`,
        method: "GET",
      }),
      providesTags: ["MarketMine"],
    }),

    savedListings: builder.query({
      query: (page = 1) => ({ url: `/api/market/saved?page=${page}`, method: "GET" }),
      providesTags: ["MarketSaved"],
    }),

    canPost: builder.query({
      query: () => ({ url: `/api/market/me/can-post`, method: "GET" }),
    }),

    uploadMarketMedia: builder.mutation({
      query: (formData) => ({
        url: `/api/market/upload`,
        method: "POST",
        body: formData,
      }),
    }),

    createListing: builder.mutation({
      query: (body) => ({ url: `/api/market`, method: "POST", body }),
      invalidatesTags: ["MarketList", "MarketMine"],
    }),

    updateListing: builder.mutation({
      query: ({ id, ...body }) => ({
        url: `/api/market/${id}`,
        method: "PUT",
        body,
      }),
      invalidatesTags: (r, e, { id }) => [
        { type: "Market", id },
        "MarketList",
        "MarketMine",
      ],
    }),

    updateListingStatus: builder.mutation({
      query: ({ id, status }) => ({
        url: `/api/market/${id}/status`,
        method: "PATCH",
        body: { status },
      }),
      invalidatesTags: (r, e, { id }) => [
        { type: "Market", id },
        "MarketList",
        "MarketMine",
      ],
    }),

    deleteListing: builder.mutation({
      query: (id) => ({ url: `/api/market/${id}`, method: "DELETE" }),
      invalidatesTags: ["MarketList", "MarketMine"],
    }),

    toggleSaveListing: builder.mutation({
      query: (id) => ({ url: `/api/market/${id}/save`, method: "POST" }),
      invalidatesTags: (r, e, id) => [
        { type: "Market", id },
        "MarketSaved",
      ],
    }),

    // Offers
    createOffer: builder.mutation({
      query: ({ id, amount, message, variantName }) => ({
        url: `/api/market/${id}/offers`,
        method: "POST",
        body: { amount, message, variantName },
      }),
      invalidatesTags: (r, e, { id }) => [{ type: "MarketOffers", id }],
    }),
    listListingOffers: builder.query({
      query: (id) => ({ url: `/api/market/${id}/offers`, method: "GET" }),
      providesTags: (r, e, id) => [{ type: "MarketOffers", id }],
    }),
    myOffers: builder.query({
      query: () => ({ url: `/api/market/offers/mine`, method: "GET" }),
      providesTags: ["MarketMyOffers"],
    }),
    respondOffer: builder.mutation({
      query: ({ offerId, action, listingId }) => ({
        url: `/api/market/offers/${offerId}`,
        method: "PATCH",
        body: { action },
      }),
      invalidatesTags: (r, e, { listingId }) => [
        { type: "MarketOffers", id: listingId },
        "MarketMine",
      ],
    }),
    cancelOffer: builder.mutation({
      query: (offerId) => ({
        url: `/api/market/offers/${offerId}`,
        method: "DELETE",
      }),
      invalidatesTags: ["MarketMyOffers"],
    }),

    // Boost (đẩy tin)
    boostListing: builder.mutation({
      query: (id) => ({ url: `/api/market/${id}/boost`, method: "POST" }),
      invalidatesTags: (r, e, id) => [{ type: "Market", id }, "MarketList", "MarketMine"],
    }),

    // Đánh giá người bán
    listSellerReviews: builder.query({
      query: (sellerId) => ({ url: `/api/market/sellers/${sellerId}/reviews`, method: "GET" }),
      providesTags: (r, e, id) => [{ type: "SellerReviews", id }],
    }),
    upsertSellerReview: builder.mutation({
      query: ({ sellerId, rating, comment, listingId }) => ({
        url: `/api/market/sellers/${sellerId}/reviews`,
        method: "POST",
        body: { rating, comment, listingId },
      }),
      invalidatesTags: (r, e, { sellerId }) => [{ type: "SellerReviews", id: sellerId }],
    }),
    deleteSellerReview: builder.mutation({
      query: ({ reviewId }) => ({ url: `/api/market/reviews/${reviewId}`, method: "DELETE" }),
      invalidatesTags: (r, e, { sellerId }) => [{ type: "SellerReviews", id: sellerId }],
    }),
  }),
  overrideExisting: false,
});

export const {
  useListListingsQuery,
  useGetListingQuery,
  useMyListingsQuery,
  useSavedListingsQuery,
  useCanPostQuery,
  useUploadMarketMediaMutation,
  useCreateListingMutation,
  useUpdateListingMutation,
  useUpdateListingStatusMutation,
  useDeleteListingMutation,
  useToggleSaveListingMutation,
  useCreateOfferMutation,
  useListListingOffersQuery,
  useMyOffersQuery,
  useRespondOfferMutation,
  useCancelOfferMutation,
  useBoostListingMutation,
  useListSellerReviewsQuery,
  useUpsertSellerReviewMutation,
  useDeleteSellerReviewMutation,
} = marketApiSlice;
