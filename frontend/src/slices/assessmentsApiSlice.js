// src/slices/assessmentsApiSlice.js
import { apiSlice } from "./apiSlice";

const ASSESSMENTS_URL = "/api/assessments";

export const assessmentsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Tạo bản chấm mới cho 1 user (simple mode)
    createAssessment: builder.mutation({
      query: ({ userId, singleLevel, doubleLevel, meta, note = "" }) => ({
        url: `${ASSESSMENTS_URL}/${userId}`,
        method: "POST",
        body: {
          singleLevel,
          doubleLevel,
          ...(meta ? { meta } : {}),
          note,
        },
      }),
    }),

    // Lấy bản chấm mới nhất của 1 user
    getLatestAssessment: builder.query({
      query: (userId) => `${ASSESSMENTS_URL}/${userId}/latest`,
      keepUnusedDataFor: 0
    }),

    // Lịch sử các lần chấm (có limit)
    getAssessmentHistory: builder.query({
      query: ({ userId, limit = 20 }) =>
        `${ASSESSMENTS_URL}/${userId}/history?limit=${limit}`,
    }),

    // Cập nhật một bản chấm theo id (simple mode)
    updateAssessment: builder.mutation({
      query: ({ id, singleLevel, doubleLevel, meta, note }) => ({
        url: `${ASSESSMENTS_URL}/${id}`,
        method: "PUT",
        body: {
          ...(singleLevel !== undefined ? { singleLevel } : {}),
          ...(doubleLevel !== undefined ? { doubleLevel } : {}),
          ...(meta ? { meta } : {}),
          ...(typeof note === "string" ? { note } : {}),
        },
      }),
    }),

    // (tuỳ chọn) Lấy ranking hiện tại của user – nếu bạn có route này
    getRankingByUser: builder.query({
      query: (userId) => `/api/rankings/${userId}`,
    }),
  }),
});

export const {
  useCreateAssessmentMutation,
  useGetLatestAssessmentQuery,
  useGetAssessmentHistoryQuery,
  useUpdateAssessmentMutation,
  useGetRankingByUserQuery,
} = assessmentsApiSlice;
