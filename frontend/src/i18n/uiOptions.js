export function getGenderOptions(t) {
  return [
    {
      value: "unspecified",
      label: t("profile.genderOptions.unspecified"),
    },
    { value: "male", label: t("profile.genderOptions.male") },
    { value: "female", label: t("profile.genderOptions.female") },
    { value: "other", label: t("profile.genderOptions.other") },
  ];
}

export function getGenderLabel(t, value) {
  return (
    getGenderOptions(t).find((option) => option.value === value)?.label ||
    t("profile.genderOptions.unspecified")
  );
}

export function getKycMeta(t) {
  return {
    unverified: {
      label: t("profile.kyc.statuses.unverified"),
      chipColor: "default",
      accent: "#64748b",
      description: t("profile.kyc.descriptions.unverified"),
    },
    pending: {
      label: t("profile.kyc.statuses.pending"),
      chipColor: "warning",
      accent: "#f59e0b",
      description: t("profile.kyc.descriptions.pending"),
    },
    verified: {
      label: t("profile.kyc.statuses.verified"),
      chipColor: "success",
      accent: "#10b981",
      description: t("profile.kyc.descriptions.verified"),
    },
    rejected: {
      label: t("profile.kyc.statuses.rejected"),
      chipColor: "error",
      accent: "#ef4444",
      description: t("profile.kyc.descriptions.rejected"),
    },
  };
}

export function getKycLabelMap(t) {
  return {
    unverified: t("profile.kyc.statuses.unverifiedShort"),
    pending: t("profile.kyc.statuses.pendingShort"),
    verified: t("profile.kyc.statuses.verifiedShort"),
    rejected: t("profile.kyc.statuses.rejectedShort"),
  };
}

export function getRoleLabel(t, role) {
  switch (String(role || "").toLowerCase()) {
    case "admin":
      return t("admin.users.roles.admin");
    case "referee":
      return t("admin.users.roles.referee");
    case "superadmin":
    case "superuser":
      return t("admin.users.roles.superAdmin");
    default:
      return t("admin.users.roles.user");
  }
}

export function getProvincePlaceholder(t) {
  return t("profile.provincePlaceholder");
}

