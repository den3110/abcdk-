// slices/eventsApiSlice.js — Sự kiện xé vé / social (web)
import { apiSlice } from "./apiSlice";

export const eventsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    listPublicEvents: builder.query({
      query: (venueId) => ({ url: `/api/events${venueId ? `?venue=${venueId}` : ""}` }),
      providesTags: [{ type: "Event", id: "PUBLIC" }],
    }),
    getEvent: builder.query({
      query: (eventId) => ({ url: `/api/events/${eventId}` }),
      providesTags: (r, e, id) => [{ type: "Event", id }],
    }),
    registerEvent: builder.mutation({
      query: ({ eventId, ...body }) => ({ url: `/api/events/${eventId}/register`, method: "POST", body }),
      invalidatesTags: (r, e, arg) => [{ type: "Event", id: arg.eventId }],
    }),
    listMyEventRegs: builder.query({
      query: () => ({ url: `/api/events/mine` }),
      providesTags: [{ type: "Event", id: "MINE" }],
    }),
    submitEventProof: builder.mutation({
      query: ({ regId, ...body }) => ({ url: `/api/events/registrations/${regId}/proof`, method: "POST", body }),
      invalidatesTags: [{ type: "Event", id: "MINE" }],
    }),
    cancelMyEventReg: builder.mutation({
      query: (regId) => ({ url: `/api/events/registrations/${regId}`, method: "DELETE" }),
      invalidatesTags: [{ type: "Event", id: "MINE" }],
    }),
  }),
  overrideExisting: false,
});

export const {
  useListPublicEventsQuery,
  useGetEventQuery,
  useRegisterEventMutation,
  useListMyEventRegsQuery,
  useSubmitEventProofMutation,
  useCancelMyEventRegMutation,
} = eventsApiSlice;
