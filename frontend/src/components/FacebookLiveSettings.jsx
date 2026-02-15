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
  ListItemSecondaryAction,
  IconButton,
  Chip,
  CircularProgress,
  Tooltip,
  Divider,
} from "@mui/material";
import { toast } from "react-toastify";
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

const FacebookLiveSettings = () => {
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
      alert("Không lấy được link kết nối Facebook, vui lòng thử lại.");
    }
  }, [getLoginUrl]);

  const handleSetDefault = useCallback(
    async (pageConnectionId) => {
      try {
        await setDefaultPage(pageConnectionId).unwrap();
        void refetch();
      } catch (err) {
        console.error("setDefaultPage error", err);
        alert("Không đặt được page mặc định, vui lòng thử lại.");
      }
    },
    [setDefaultPage, refetch]
  );

  const handleDelete = useCallback(
    async (id) => {
      const ok = window.confirm(
        "Bạn có chắc muốn xoá kết nối fanpage này khỏi tài khoản?"
      );
      if (!ok) return;

      try {
        await deletePage(id).unwrap();
        void refetch();
      } catch (err) {
        console.error("deletePage error", err);
        alert("Không xoá được kết nối, vui lòng thử lại.");
      }
    },
    [deletePage, refetch]
  );

  const loadingList = isLoading || isFetching;



  return (
    <Container maxWidth="md">
      <SEOHead title="Cấu hình Facebook Live" noIndex={true} />
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
              Facebook Live
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Kết nối Facebook để livestream match trực tiếp lên fanpage của
              bạn.
            </Typography>
          </Box>

          <Button
            variant="contained"
            onClick={handleConnectFacebook}
            disabled={isConnecting}
          >
            {isConnecting ? "Đang mở Facebook..." : "Kết nối Facebook"}
          </Button>
        </Stack>

        {/* Info */}
        <Alert severity="info">
          Sau khi bấm &quot;Kết nối Facebook&quot;, hệ thống sẽ mở cửa sổ
          Facebook để bạn cấp quyền. Khi chấp nhận xong, quay lại trang này và
          danh sách fanpage sẽ được cập nhật tự động.
        </Alert>

        {/* Card danh sách page */}
        <Card>
          <CardHeader
            title="Fanpage đã kết nối"
            subheader="Chọn 1 fanpage làm mặc định để livestream match."
          />
          <Divider />

          <CardContent>
            {loadingList && (
              <Stack spacing={2}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <CircularProgress size={18} />
                  <Typography variant="body2">
                    Đang tải danh sách fanpage...
                  </Typography>
                </Stack>
              </Stack>
            )}

            {!loadingList && error && (
              <Alert severity="error">
                Không tải được danh sách fanpage. Vui lòng thử lại sau.
              </Alert>
            )}

            {!loadingList && !error && pages.length === 0 && (
              <Alert severity="warning">
                Bạn chưa kết nối fanpage nào. Bấm &quot;Kết nối Facebook&quot;
                để bắt đầu.
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
                                  ? "Đây là fanpage mặc định"
                                  : "Đặt làm fanpage mặc định"
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
                            <Tooltip title="Xoá kết nối fanpage này">
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
                                  label="Mặc định"
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
          Khi tạo live cho match, backend sẽ ưu tiên dùng fanpage mặc định của
          bạn. Nếu không có, hệ thống sẽ tự dùng page pool chung như hiện tại.
        </Alert>
      </Stack>
    </Container>
  );
};

export default FacebookLiveSettings;
