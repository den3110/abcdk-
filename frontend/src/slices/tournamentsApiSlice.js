import { apiSlice } from "./apiSlice";

export const tournamentsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getTournaments: builder.query({
      query: ({ sportType, groupId }) =>
        `/api/tournaments?sportType=${sportType}&groupId=${groupId}`,
      providesTags: ["Tournaments"],
    }),
    /* ---------------------------------- REG LIST ---------------------------------- */
    getRegistrations: builder.query({
      query: (tourId) => `/api/tournaments/${tourId}/registrations`,
      providesTags: (r, e, id) => [{ type: "Registrations", id }],
    }),

    /* ---------------------------- CREATE REGISTRATION ----------------------------- */
    createRegistration: builder.mutation({
      query: ({ tourId, ...body }) => ({
        url: `/api/tournaments/${tourId}/registrations`,
        method: "POST",
        body,
      }),
      invalidatesTags: (r, e, arg) => [
        { type: "Registrations", id: arg.tourId },
        { type: "Tournaments", id: arg.tourId },
      ],
    }),

    /* --------------------------- UPDATE PAYMENT STATUS --------------------------- */
    updatePayment: builder.mutation({
      query: ({ regId, status }) => ({
        url: `/api/registrations/${regId}/payment`,
        method: "PATCH",
        body: { status },
      }),
      invalidatesTags: (r, e, arg) => [
        { type: "Registrations", id: arg.regId },
      ],
    }),

    /* ----------------------------- CHECK‑IN REGISTRATION ----------------------------- */
    checkin: builder.mutation({
      query: ({ regId }) => ({
        url: `/api/registrations/${regId}/checkin`,
        method: "PATCH",
      }),
      invalidatesTags: (r, e, arg) => [
        { type: "Registrations", id: arg.regId },
      ],
    }),
    getTournament: builder.query({
      query: (id) => `/api/tournaments/${id}`,
      providesTags: (r, e, id) => [{ type: "Tournaments", id }],
    }),
    // ✨ LẤY DANH SÁCH TRẬN ĐẤU (bracket + check‑in page)
    getMatches: builder.query({
      query: (tourId) => `/api/tournaments/${tourId}/matches`,
      providesTags: (r,e,id) => [{ type: 'Matches', id }],
    }),
  }),
});

export const {
  useGetTournamentsQuery,
  useGetRegistrationsQuery,
  useCreateRegistrationMutation,
  useUpdatePaymentMutation,
  useCheckinMutation,
   useGetTournamentQuery,
     useGetMatchesQuery,      
} = tournamentsApiSlice;
