import { apiSlice } from "./apiSlice";

export const venuesApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    /* -------- Công khai -------- */
    listVenues: builder.query({
      query: ({ province = "", keyword = "", page = 1, limit = 20 } = {}) => {
        const p = new URLSearchParams();
        if (province) p.set("province", province);
        if (keyword) p.set("keyword", keyword);
        p.set("page", String(page));
        p.set("limit", String(limit));
        return `/api/venues?${p.toString()}`;
      },
      providesTags: [{ type: "Venue", id: "LIST" }],
    }),
    getVenue: builder.query({
      query: (id) => `/api/venues/${id}`,
      providesTags: (res, err, id) => [{ type: "Venue", id }],
    }),
    getVenueAvailability: builder.query({
      query: ({ id, date }) => `/api/venues/${id}/availability?date=${date}`,
      // Không cache theo thời gian thực
      keepUnusedDataFor: 5,
      providesTags: (res, err, arg) => [
        { type: "Booking", id: `AVAIL-${arg.id}-${arg.date}` },
      ],
    }),

    /* -------- Chủ sân / admin -------- */
    listMyVenues: builder.query({
      query: () => `/api/venues/mine`,
      providesTags: [{ type: "Venue", id: "MINE" }],
    }),
    createVenue: builder.mutation({
      query: (body) => ({ url: `/api/venues`, method: "POST", body }),
      invalidatesTags: [
        { type: "Venue", id: "MINE" },
        { type: "Venue", id: "LIST" },
      ],
    }),
    updateVenue: builder.mutation({
      query: ({ id, body }) => ({ url: `/api/venues/${id}`, method: "PUT", body }),
      invalidatesTags: (res, err, { id }) => [
        { type: "Venue", id },
        { type: "Venue", id: "MINE" },
        { type: "Venue", id: "LIST" },
      ],
    }),
    deleteVenue: builder.mutation({
      query: (id) => ({ url: `/api/venues/${id}`, method: "DELETE" }),
      invalidatesTags: [
        { type: "Venue", id: "MINE" },
        { type: "Venue", id: "LIST" },
      ],
    }),

    /* -------- Sân trong cụm -------- */
    addCourt: builder.mutation({
      query: ({ venueId, body }) => ({
        url: `/api/venues/${venueId}/courts`,
        method: "POST",
        body,
      }),
      invalidatesTags: (res, err, { venueId }) => [{ type: "Venue", id: venueId }],
    }),
    updateCourt: builder.mutation({
      query: ({ venueId, courtId, body }) => ({
        url: `/api/venues/${venueId}/courts/${courtId}`,
        method: "PUT",
        body,
      }),
      invalidatesTags: (res, err, { venueId }) => [{ type: "Venue", id: venueId }],
    }),
    deleteCourt: builder.mutation({
      query: ({ venueId, courtId }) => ({
        url: `/api/venues/${venueId}/courts/${courtId}`,
        method: "DELETE",
      }),
      invalidatesTags: (res, err, { venueId }) => [{ type: "Venue", id: venueId }],
    }),

    /* -------- Nhân viên & phân quyền -------- */
    getMyVenueAccess: builder.query({
      query: (venueId) => `/api/venues/${venueId}/my-access`,
      providesTags: (r, e, id) => [{ type: "VenueAccess", id }],
    }),
    listStaff: builder.query({
      query: (venueId) => `/api/venues/${venueId}/staff`,
      providesTags: (r, e, id) => [{ type: "VenueStaff", id }],
    }),
    addStaff: builder.mutation({
      query: ({ venueId, ...body }) => ({ url: `/api/venues/${venueId}/staff`, method: "POST", body }),
      invalidatesTags: (r, e, a) => [{ type: "VenueStaff", id: a.venueId }],
    }),
    updateStaff: builder.mutation({
      query: ({ venueId, staffId, ...body }) => ({ url: `/api/venues/${venueId}/staff/${staffId}`, method: "PATCH", body }),
      invalidatesTags: (r, e, a) => [{ type: "VenueStaff", id: a.venueId }],
    }),
    removeStaff: builder.mutation({
      query: ({ venueId, staffId }) => ({ url: `/api/venues/${venueId}/staff/${staffId}`, method: "DELETE" }),
      invalidatesTags: (r, e, a) => [{ type: "VenueStaff", id: a.venueId }],
    }),
    searchUsers: builder.query({
      query: (q) => `/api/users/search?q=${encodeURIComponent(q)}&limit=15`,
    }),
  }),
});

export const {
  useListVenuesQuery,
  useGetVenueQuery,
  useGetVenueAvailabilityQuery,
  useListMyVenuesQuery,
  useCreateVenueMutation,
  useUpdateVenueMutation,
  useDeleteVenueMutation,
  useAddCourtMutation,
  useUpdateCourtMutation,
  useDeleteCourtMutation,
  useGetMyVenueAccessQuery,
  useListStaffQuery,
  useAddStaffMutation,
  useUpdateStaffMutation,
  useRemoveStaffMutation,
  useLazySearchUsersQuery,
} = venuesApiSlice;
