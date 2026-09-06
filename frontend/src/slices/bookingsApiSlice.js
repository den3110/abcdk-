import { apiSlice } from "./apiSlice";

export const bookingsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    createBooking: builder.mutation({
      query: (body) => ({ url: `/api/bookings`, method: "POST", body }),
      invalidatesTags: (res, err, arg) => [
        { type: "Booking", id: "MINE" },
        { type: "Booking", id: `AVAIL-${arg.venueId}-${arg.date}` },
        { type: "Booking", id: `VENUE-${arg.venueId}` },
      ],
    }),
    listMyBookings: builder.query({
      query: ({ status = "" } = {}) =>
        `/api/bookings/mine${status ? `?status=${status}` : ""}`,
      providesTags: [{ type: "Booking", id: "MINE" }],
    }),
    listVenueBookings: builder.query({
      query: ({ venueId, date = "", status = "" }) => {
        const p = new URLSearchParams();
        if (date) p.set("date", date);
        if (status) p.set("status", status);
        const qs = p.toString();
        return `/api/venues/${venueId}/bookings${qs ? `?${qs}` : ""}`;
      },
      providesTags: (res, err, arg) => [
        { type: "Booking", id: `VENUE-${arg.venueId}` },
      ],
    }),
    updateBookingStatus: builder.mutation({
      query: ({ id, status, cancelReason }) => ({
        url: `/api/bookings/${id}/status`,
        method: "PATCH",
        body: { status, cancelReason },
      }),
      invalidatesTags: (res, err, arg) => [
        { type: "Booking", id: "MINE" },
        { type: "Booking", id: `VENUE-${arg.venueId || ""}` },
      ],
    }),
    getVenueRevenue: builder.query({
      query: ({ venueId, from, to }) =>
        `/api/venues/${venueId}/revenue?from=${from}&to=${to}`,
      providesTags: (res, err, arg) => [
        { type: "Booking", id: `VENUE-${arg.venueId}` },
      ],
    }),
    setBookingPayment: builder.mutation({
      query: ({ id, status }) => ({
        url: `/api/bookings/${id}/payment`,
        method: "PATCH",
        body: { status },
      }),
      invalidatesTags: (res, err, arg) => [
        { type: "Booking", id: `VENUE-${arg.venueId || ""}` },
      ],
    }),
    getBooking: builder.query({
      query: (id) => `/api/bookings/${id}`,
      providesTags: (res, err, id) => [{ type: "Booking", id }],
    }),
    // Khách gửi ảnh bill chuyển khoản → chờ chủ sân duyệt
    submitPaymentProof: builder.mutation({
      query: ({ id, imageUrl, note }) => ({
        url: `/api/bookings/${id}/payment-proof`,
        method: "POST",
        body: { imageUrl, note },
      }),
      invalidatesTags: (res, err, arg) => [
        { type: "Booking", id: "MINE" },
        { type: "Booking", id: arg.id },
      ],
    }),
    approveBooking: builder.mutation({
      query: ({ id }) => ({ url: `/api/bookings/${id}/approve`, method: "PATCH" }),
      invalidatesTags: (res, err, arg) => [
        { type: "Booking", id: `VENUE-${arg.venueId || ""}` },
        { type: "Booking", id: arg.id },
      ],
    }),
    rejectBooking: builder.mutation({
      query: ({ id, reason }) => ({
        url: `/api/bookings/${id}/reject`,
        method: "PATCH",
        body: { reason },
      }),
      invalidatesTags: (res, err, arg) => [
        { type: "Booking", id: `VENUE-${arg.venueId || ""}` },
        { type: "Booking", id: arg.id },
      ],
    }),
    // Chủ sân quét vé QR
    checkInBooking: builder.mutation({
      query: ({ token }) => ({ url: `/api/bookings/checkin`, method: "POST", body: { token } }),
      invalidatesTags: (res, err, arg) => [
        { type: "Booking", id: `VENUE-${arg.venueId || ""}` },
      ],
    }),
  }),
});

export const {
  useCreateBookingMutation,
  useListMyBookingsQuery,
  useListVenueBookingsQuery,
  useGetVenueRevenueQuery,
  useUpdateBookingStatusMutation,
  useSetBookingPaymentMutation,
  useGetBookingQuery,
  useSubmitPaymentProofMutation,
  useApproveBookingMutation,
  useRejectBookingMutation,
  useCheckInBookingMutation,
} = bookingsApiSlice;
