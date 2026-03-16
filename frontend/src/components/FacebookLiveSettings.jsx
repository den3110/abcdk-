// src/pages/settings/FacebookLiveSettings.jsx
import React, { useCallback } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Container,
  Stack,
  Typography,
  Alert,
  List,
  ListItem,
  ListItemAvatar,
  Avatar,
  ListItemText,
  IconButton,
  Chip,
  CircularProgress,
  Tooltip,
  Divider,
} from "@mui/material";
import SEOHead from "../components/SEOHead";

import DeleteIcon from "@mui/icons-material/DeleteOutline";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";

import {
  useGetFacebookLoginUrlMutation,
  useGetFacebookPagesQuery,
  useSetDefaultFacebookPageMutation,
  useDeleteFacebookPageMutation,
} from "../slices/facebookApiSlice";
import { useLanguage } from "../context/LanguageContext.jsx";

const FacebookLiveSettings = () => {
  const { t } = useLanguage();
  // Lấy danh sách page đã connect
  const {
    data: pages = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = useGetFacebookPagesQuery();

  // Gọi login-url để mở OAuth
  const [getLoginUrl, { isLoading: isConnecting }] =
    useGetFacebookLoginUrlMutation();

  // Đặt page mặc định
  const [setDefaultPage, { isLoading: isSettingDefault }] =
    useSetDefaultFacebookPageMutation();

  // Xoá page
  const [deletePage, { isLoading: isDeleting }] =
    useDeleteFacebookPageMutation();

  const handleConnectFacebook = useCallback(async () => {
    try {
      const res = await getLoginUrl().unwrap();
      if (res?.url) {
        window.location.href = res.url; // redirect sang Facebook OAuth
      }
    } catch (err) {
      console.error("getLoginUrl error", err);
      alert(t("facebookLive.connectError"));
    }
  }, [getLoginUrl, t]);

  const handleSetDefault = useCallback(
    async (pageConnectionId) => {
      try {
        await setDefaultPage(pageConnectionId).unwrap();
        void refetch();
      } catch (err) {
        console.error("setDefaultPage error", err);
        alert(t("facebookLive.setDefaultError"));
      }
    },
    [setDefaultPage, refetch, t]
  );

  const handleDelete = useCallback(
    async (id) => {
      const ok = window.confirm(
        t("facebookLive.deleteConfirm")
      );
      if (!ok) return;

      try {
        await deletePage(id).unwrap();
        void refetch();
      } catch (err) {
        console.error("deletePage error", err);
        alert(t("facebookLive.deleteError"));
      }
    },
    [deletePage, refetch, t]
  );

  const loadingList = isLoading || isFetching;



  return (
    <Container maxWidth="md">
      <SEOHead title={t("facebookLive.seoTitle")} noIndex={true} />
      <Stack spacing={3} sx={{ py: 3 }}>
        {/* Header */}
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={2}
        >
          <Box>
            <Typography variant="h5" fontWeight={600}>
              {t("facebookLive.title")}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t("facebookLive.subtitle")}
            </Typography>
          </Box>

          <Button
            variant="contained"
            onClick={handleConnectFacebook}
            disabled={isConnecting}
          >
            {isConnecting
              ? t("facebookLive.connecting")
              : t("facebookLive.connect")}
          </Button>
        </Stack>

        {/* Info */}
        <Alert severity="info">
          {t("facebookLive.infoAlert")}
        </Alert>

        {/* Card danh sách page */}
        <Card>
          <CardHeader
            title={t("facebookLive.connectedPagesTitle")}
            subheader={t("facebookLive.connectedPagesSubtitle")}
          />
          <Divider />

          <CardContent>
            {loadingList && (
              <Stack spacing={2}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <CircularProgress size={18} />
                  <Typography variant="body2">
                    {t("facebookLive.loadingPages")}
                  </Typography>
                </Stack>
              </Stack>
            )}

            {!loadingList && error && (
              <Alert severity="error">
                {t("facebookLive.loadError")}
              </Alert>
            )}

            {!loadingList && !error && pages.length === 0 && (
              <Alert severity="warning">
                {t("facebookLive.empty")}
              </Alert>
            )}

            {!loadingList && !error && pages.length > 0 && (
              <List disablePadding>
                {pages.map((page, index) => {
                  const isDefault = Boolean(page.isDefault);

                  return (
                    <React.Fragment key={page.id}>
                      {index > 0 && <Divider component="li" />}
                      <ListItem
                        alignItems="center"
                        secondaryAction={
                          <Stack
                            direction="row"
                            spacing={1}
                            alignItems="center"
                          >
                            {/* Nút đặt mặc định */}
                            <Tooltip
                              title={
                                isDefault
                                  ? t("facebookLive.defaultPageTooltip")
                                  : t("facebookLive.setDefaultTooltip")
                              }
                            >
                              <span>
                                <IconButton
                                  size="small"
                                  onClick={() => handleSetDefault(page.id)}
                                  disabled={
                                    isDefault || isSettingDefault || isDeleting
                                  }
                                >
                                  {isDefault ? (
                                    <StarIcon fontSize="small" />
                                  ) : (
                                    <StarBorderIcon fontSize="small" />
                                  )}
                                </IconButton>
                              </span>
                            </Tooltip>

                            {/* Nút xoá */}
                            <Tooltip title={t("facebookLive.deleteTooltip")}>
                              <span>
                                <IconButton
                                  edge="end"
                                  size="small"
                                  color="error"
                                  onClick={() => handleDelete(page.id)}
                                  disabled={isDeleting}
                                >
                                  <DeleteIcon fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                          </Stack>
                        }
                      >
                        <ListItemAvatar>
                          <Avatar src={page.pagePicture}>
                            {page.pageName?.[0] || "F"}
                          </Avatar>
                        </ListItemAvatar>

                        <ListItemText
                          primary={
                            <Stack
                              direction="row"
                              alignItems="center"
                              spacing={1}
                            >
                              <Typography variant="subtitle1">
                                {page.pageName}
                              </Typography>
                              {isDefault && (
                                <Chip
                                  size="small"
                                  label={t("facebookLive.defaultBadge")}
                                  color="primary"
                                  variant="outlined"
                                />
                              )}
                            </Stack>
                          }
                          secondary={
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              sx={{ mt: 0.25 }}
                            >
                              {page.pageCategory
                                ? `${page.pageCategory} • ID: ${page.pageId}`
                                : `ID: ${page.pageId}`}
                            </Typography>
                          }
                        />
                      </ListItem>
                    </React.Fragment>
                  );
                })}
              </List>
            )}
          </CardContent>
        </Card>

        {/* Optional: giải thích cách dùng trong match */}
        <Alert severity="success" variant="outlined">
          {t("facebookLive.matchUsage")}
        </Alert>
      </Stack>
    </Container>
  );
};

export default FacebookLiveSettings;
