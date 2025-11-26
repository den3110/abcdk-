import { apiSlice } from "./apiSlice";

export const adminApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // =========================
    // USER MANAGEMENT (cũ)
    // =========================
    getUsers: builder.query({
      query: ({ page = 1, keyword = "", role = "", cccdStatus = "" }) =>
        `/api/admin/users?page=${page}&keyword=${encodeURIComponent(
          keyword
        )}&role=${role}&cccdStatus=${cccdStatus}`,
      providesTags: ["User"],
      keepUnusedDataFor: 30,
    }),

    updateUserRole: builder.mutation({
      query: ({ id, role }) => ({
        url: `/api/admin/users/${id}/role`,
        method: "PUT",
        body: { role },
      }),
      invalidatesTags: ["User"],
    }),

    deleteUser: builder.mutation({
      query: (id) => ({ url: `/api/admin/users/${id}`, method: "DELETE" }),
      invalidatesTags: ["User"],
    }),

    /** ✨ SỬA hồ sơ (name, phone, …) */
    updateUserInfo: builder.mutation({
      query: ({ id, body }) => ({
        url: `/api/admin/users/${id}`,
        method: "PUT",
        body,
      }),
      invalidatesTags: ["User"],
    }),

    /** ✨ DUYỆT hoặc TỪ CHỐI KYC */
    reviewKyc: builder.mutation({
      query: ({ id, action }) => ({
        url: `/api/admin/users/${id}/kyc`,
        method: "PUT",
        body: { action }, // "approve" | "reject"
      }),
      invalidatesTags: ["User"],
    }),

    updateRanking: builder.mutation({
      query: ({ id, single, double }) => ({
        url: `/api/admin/rankings/${id}`,
        method: "PUT",
        body: { single, double },
      }),
      invalidatesTags: ["User"],
    }),

    // =========================
    // EVALUATOR MANAGEMENT (mới)
    // =========================
    /** Danh sách evaluator + filter */
    getEvaluators: builder.query({
      query: ({ page = 1, keyword = "", province, sport } = {}) => {
        const params = new URLSearchParams();
        params.set("page", String(page));
        if (keyword) params.set("keyword", keyword);
        if (province) params.set("province", province);
        if (sport) params.set("sport", sport);
        return `/api/admin/evaluators?${params.toString()}`;
      },
      // dùng chung tag "User" để tự động refetch các bảng liên quan
      providesTags: ["User"],
      keepUnusedDataFor: 30,
    }),

    /** Cập nhật phạm vi chấm (nhiều tỉnh + nhiều môn) */
    updateEvaluatorScopes: builder.mutation({
      query: ({ id, body }) => ({
        url: `/api/admin/evaluators/${id}/scopes`,
        method: "PATCH",
        body, // { provinces: string[], sports: string[] }
      }),
      invalidatesTags: ["User"],
    }),

    /** Promote user -> evaluator */
    promoteToEvaluator: builder.mutation({
      query: ({ idOrEmail, provinces, sports }) => ({
        url: `/api/admin/evaluators/promote`,
        method: "POST",
        body: { idOrEmail, provinces, sports },
      }),
      invalidatesTags: ["User"],
    }),

    /** Demote evaluator -> role khác (mặc định: user) */
    demoteEvaluator: builder.mutation({
      query: ({ id, body }) => ({
        url: `/api/admin/evaluators/${id}/demote`,
        method: "PATCH",
        body: body ?? { toRole: "user" },
      }),
      invalidatesTags: ["User"],
    }),
    changeUserPassword: builder.mutation({
      query: ({ id, body }) => ({
        url: `/api/admin/users/${id}/password`,
        method: "PATCH",
        body, // { newPassword: string }
      }),
    }),
    updateRankingSearchConfig: builder.mutation({
      query: ({ id, body }) => ({
        url: `/api/admin/users/${id}/ranking-search-config`,
        method: "PATCH",
        body,
      }),
    }),
  }),
});

export const {
  // users
  useGetUsersQuery,
  useUpdateUserRoleMutation,
  useDeleteUserMutation,
  useReviewKycMutation,
  useUpdateUserInfoMutation,
  useUpdateRankingMutation,

  // evaluators
  useGetEvaluatorsQuery,
  useUpdateEvaluatorScopesMutation,
  usePromoteToEvaluatorMutation,
  useDemoteEvaluatorMutation,
  useChangeUserPasswordMutation,
  useUpdateRankingSearchConfigMutation
} = adminApiSlice;
