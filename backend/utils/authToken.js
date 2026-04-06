export const extractBearerToken = (authorizationValue) => {
  const rawAuthorization = String(authorizationValue || "").trim();
  if (!rawAuthorization) return null;

  const match = rawAuthorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const token = String(match[1] || "").trim();
  return token || null;
};
