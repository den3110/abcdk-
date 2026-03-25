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
    }),

    updateUserSuperAdmin: builder.mutation({
      query: ({ id, isSuperUser }) => ({
        url: `/api/admin/users/${id}/super-admin`,
        method: "PATCH",
        body: { isSuperUser },
      }),
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
    }),

    /** âœ¨ DUYá»†T hoặc TỪ CHỐI KYC */
    reviewKyc: builder.mutation({
      query: ({ id, action }) => ({
        url: `/api/admin/users/${id}/kyc`,
        method: "PUT",
        body: { action }, // "approve" | "reject"
      }),
    }),

    updateRanking: builder.mutation({
      query: ({ id, single, double }) => ({
        url: `/api/admin/rankings/${id}`,
        method: "PUT",
        body: { single, double },
      }),
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

    /** Cáº­p nháº­t pháº¡m vi cháº¥m (nhiá»u tá»‰nh + nhiều môn) */
    updateEvaluatorScopes: builder.mutation({
      query: ({ id, body }) => ({
        url: `/api/admin/evaluators/${id}/scopes`,
        method: "PATCH",
        body, // { provinces: string[], sports: string[] }
      }),
    }),

    /** Promote user -> evaluator */
    promoteToEvaluator: builder.mutation({
      query: ({ idOrEmail, provinces, sports }) => ({
        url: `/api/admin/evaluators/promote`,
        method: "POST",
        body: { idOrEmail, provinces, sports },
      }),
    }),

    /** Demote evaluator -> role khác (mặc định: user) */
    demoteEvaluator: builder.mutation({
      query: ({ id, body }) => ({
        url: `/api/admin/evaluators/${id}/demote`,
        method: "PATCH",
        body: body ?? { toRole: "user" },
      }),
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

    getAvatarOptimizationStatus: builder.query({
      query: () => ({
        url: "/api/admin/avatar-optimization/status",
        method: "GET",
      }),
      providesTags: ["AvatarOptimization"],
      keepUnusedDataFor: 10,
    }),

    runAvatarOptimizationSweep: builder.mutation({
      query: () => ({
        url: "/api/admin/avatar-optimization/run",
        method: "POST",
      }),
      invalidatesTags: ["AvatarOptimization"],
    }),

    runAvatarOptimizationCleanup: builder.mutation({
      query: () => ({
        url: "/api/admin/avatar-optimization/cleanup",
        method: "POST",
      }),
      invalidatesTags: ["AvatarOptimization"],
    }),

    // ✅ ADD trong adminApiSlice.js
    getUserAudit: builder.query({
      query: ({ userId, page = 1, limit = 20, actorId, field }) => {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("limit", String(limit));
        if (actorId) params.set("actorId", actorId);
        if (field) params.set("field", field);

        return {
          url: `/api/audit/users/${userId}?${params.toString()}`,
          method: "GET",
        };
      },
    }),

    // =========================
    // SEO NEWS ADMIN
    // =========================
    getSeoNewsSettings: builder.query({
      query: () => ({
        url: "/api/admin/seo-news/settings",
        method: "GET",
      }),
    }),
    updateSeoNewsSettings: builder.mutation({
      query: (body) => ({
        url: "/api/admin/seo-news/settings",
        method: "PUT",
        body,
      }),
    }),
    getSeoNewsCandidates: builder.query({
      query: ({ limit = 120, status } = {}) => ({
        url: "/api/admin/seo-news/candidates",
        method: "GET",
        params: {
          limit,
          ...(status ? { status } : {}),
        },
      }),
    }),
    getSeoNewsArticles: builder.query({
      query: ({
        page = 1,
        limit = 40,
        status = "draft",
        origin = "external",
        keyword = "",
      } = {}) => ({
        url: "/api/admin/seo-news/articles",
        method: "GET",
        params: {
          page,
          limit,
          status,
          origin,
          ...(keyword ? { keyword } : {}),
        },
      }),
    }),
    pushSeoNewsDrafts: builder.mutation({
      query: (body = {}) => ({
        url: "/api/admin/seo-news/articles/push",
        method: "POST",
        body,
      }),
    }),
    createSeoNewsReadyArticles: builder.mutation({
      query: (body = {}) => ({
        url: "/api/admin/seo-news/articles/create-ready",
        method: "POST",
        body,
      }),
    }),
    runSeoNewsPendingCandidates: builder.mutation({
      query: (body = {}) => ({
        url: "/api/admin/seo-news/candidates/run",
        method: "POST",
        body,
      }),
    }),
    runSeoNewsSync: builder.mutation({
      query: (body = {}) => ({
        url: "/api/admin/seo-news/run",
        method: "POST",
        body,
      }),
    }),
    // =========================
    // SYSTEM SETTINGS
    // =========================
    getSystemSettings: builder.query({
      query: () => `/api/admin/settings`,
      providesTags: ["SystemSettings"],
    }),
    updateSystemSettings: builder.mutation({
      query: (body) => ({
        url: `/api/admin/settings`,
        method: "PUT",
        body,
      }),
      invalidatesTags: ["SystemSettings"],
    }),
  }),
});

export const {
  // users
  useGetUsersQuery,
  useUpdateUserRoleMutation,
  useUpdateUserSuperAdminMutation,
  useDeleteUserMutation,
  useReviewKycMutation,
  useUpdateUserInfoMutation,
  useUpdateRankingMutation,
  useGetUserAuditQuery,
  // evaluators
  useGetEvaluatorsQuery,
  useUpdateEvaluatorScopesMutation,
  usePromoteToEvaluatorMutation,
  useDemoteEvaluatorMutation,
  useChangeUserPasswordMutation,
  useUpdateRankingSearchConfigMutation,
  useGetAvatarOptimizationStatusQuery,
  useRunAvatarOptimizationSweepMutation,
  useRunAvatarOptimizationCleanupMutation,
  // seo news admin
  useGetSeoNewsSettingsQuery,
  useUpdateSeoNewsSettingsMutation,
  useGetSeoNewsCandidatesQuery,
  useGetSeoNewsArticlesQuery,
  usePushSeoNewsDraftsMutation,
  useCreateSeoNewsReadyArticlesMutation,
  useRunSeoNewsPendingCandidatesMutation,
  useRunSeoNewsSyncMutation,
  // system settings
  useGetSystemSettingsQuery,
  useUpdateSystemSettingsMutation,
} = adminApiSlice;
