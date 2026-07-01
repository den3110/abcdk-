import { apiSlice } from "./apiSlice";

const SUPPORT_URL = "/api/support";

export const supportApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    listMySupportTickets: builder.query({
      query: (params = {}) => ({
        url: `${SUPPORT_URL}/tickets`,
        params,
      }),
      providesTags: (result) => [
        { type: "SupportTicket", id: "MINE" },
        ...(Array.isArray(result)
          ? result.map((ticket) => ({
              type: "SupportTicket",
              id: ticket._id,
            }))
          : []),
      ],
    }),
    getMySupportTicket: builder.query({
      query: (id) => `${SUPPORT_URL}/tickets/${id}`,
      providesTags: (result, error, id) => [
        { type: "SupportTicket", id },
        { type: "SupportTicket", id: "MINE" },
      ],
      extraOptions: { skip404Redirect: true },
    }),
    createSupportTicket: builder.mutation({
      query: (body) => ({
        url: `${SUPPORT_URL}/tickets`,
        method: "POST",
        body,
      }),
      invalidatesTags: [{ type: "SupportTicket", id: "MINE" }],
    }),
    replyMySupportTicket: builder.mutation({
      query: ({ id, text, attachments = [] }) => ({
        url: `${SUPPORT_URL}/tickets/${id}/messages`,
        method: "POST",
        body: { text, attachments },
      }),
      invalidatesTags: (result, error, { id }) => [
        { type: "SupportTicket", id },
        { type: "SupportTicket", id: "MINE" },
      ],
    }),
    rateMySupportTicket: builder.mutation({
      query: ({ id, score, comment = "" }) => ({
        url: `${SUPPORT_URL}/tickets/${id}/rating`,
        method: "PATCH",
        body: { score, comment },
      }),
      invalidatesTags: (result, error, { id }) => [
        { type: "SupportTicket", id },
        { type: "SupportTicket", id: "MINE" },
      ],
    }),
  }),
});

export const {
  useListMySupportTicketsQuery,
  useGetMySupportTicketQuery,
  useCreateSupportTicketMutation,
  useReplyMySupportTicketMutation,
  useRateMySupportTicketMutation,
} = supportApiSlice;
