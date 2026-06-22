import { apiSlice } from "./apiSlice";

const CHECKPOINT_URL = "/api/checkpoints";

export const checkpointApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getActiveCheckpointRequirement: builder.query({
      query: () => `${CHECKPOINT_URL}/me/active`,
      extraOptions: {
        skip404Redirect: true,
        skipSentryCapture: true,
      },
    }),
    startActiveCheckpoint: builder.mutation({
      query: () => ({
        url: `${CHECKPOINT_URL}/me/start`,
        method: "POST",
      }),
      extraOptions: {
        skip404Redirect: true,
        skipSentryCapture: true,
      },
    }),
    getCheckpoint: builder.query({
      query: (token) => `${CHECKPOINT_URL}/${encodeURIComponent(token)}`,
      extraOptions: { skip404Redirect: true, skipSentryCapture: true },
    }),
    resendCheckpoint: builder.mutation({
      query: (token) => ({
        url: `${CHECKPOINT_URL}/${encodeURIComponent(token)}/resend`,
        method: "POST",
      }),
      extraOptions: { skip404Redirect: true },
    }),
    startCheckpointOtp: builder.mutation({
      query: (token) => ({
        url: `${CHECKPOINT_URL}/${encodeURIComponent(token)}/start`,
        method: "POST",
      }),
      extraOptions: { skip404Redirect: true },
    }),
    verifyCheckpointOtp: builder.mutation({
      query: ({ token, code }) => ({
        url: `${CHECKPOINT_URL}/${encodeURIComponent(token)}/phone`,
        method: "POST",
        body: { code },
      }),
      extraOptions: { skip404Redirect: true },
    }),
    uploadCheckpointEvidence: builder.mutation({
      query: ({ token, factor, files }) => {
        const body = new FormData();
        body.append("factor", factor);
        Object.entries(files || {}).forEach(([key, file]) => {
          if (file) body.append(key, file);
        });

        return {
          url: `${CHECKPOINT_URL}/${encodeURIComponent(token)}/evidence`,
          method: "POST",
          body,
        };
      },
      extraOptions: { skip404Redirect: true },
    }),
    recordCheckpointEvent: builder.mutation({
      query: (body) => ({
        url: `${CHECKPOINT_URL}/events`,
        method: "POST",
        body,
      }),
    }),
  }),
});

export const {
  useGetActiveCheckpointRequirementQuery,
  useStartActiveCheckpointMutation,
  useGetCheckpointQuery,
  useResendCheckpointMutation,
  useStartCheckpointOtpMutation,
  useVerifyCheckpointOtpMutation,
  useUploadCheckpointEvidenceMutation,
  useRecordCheckpointEventMutation,
} = checkpointApiSlice;
