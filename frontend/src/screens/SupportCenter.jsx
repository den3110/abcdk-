import { useEffect, useMemo, useState } from "react";
import { skipToken } from "@reduxjs/toolkit/query";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  MenuItem,
  Rating,
  Skeleton,
  Stack,
  TextField,
  Tooltip,
  Typography,
  alpha,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import CloseIcon from "@mui/icons-material/Close";
import InboxIcon from "@mui/icons-material/Inbox";
import MailOutlineIcon from "@mui/icons-material/MailOutline";
import RefreshIcon from "@mui/icons-material/Refresh";
import ReplyIcon from "@mui/icons-material/Reply";
import SearchIcon from "@mui/icons-material/Search";
import SupportAgentIcon from "@mui/icons-material/SupportAgent";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { toast } from "react-toastify";
import SEOHead from "../components/SEOHead";
import {
  useCreateSupportTicketMutation,
  useGetMySupportTicketQuery,
  useListMySupportTicketsQuery,
  useRateMySupportTicketMutation,
  useReplyMySupportTicketMutation,
} from "../slices/supportApiSlice";
import { useUploadImageToFolderMutation } from "../slices/uploadApiSlice";

const STATUS_META = {
  open: { label: "Đang mở", color: "warning" },
  pending: { label: "Đã phản hồi", color: "info" },
  closed: { label: "Đã đóng", color: "success" },
};

const CATEGORY_OPTIONS = [
  { value: "account", label: "Tài khoản" },
  { value: "tournament", label: "Giải đấu" },
  { value: "payment", label: "Thanh toán" },
  { value: "technical", label: "Kỹ thuật" },
  { value: "report", label: "Báo lỗi" },
  { value: "other", label: "Khác" },
];

const PRIORITY_OPTIONS = [
  { value: "low", label: "Thấp", color: "default" },
  { value: "normal", label: "Bình thường", color: "primary" },
  { value: "high", label: "Cao", color: "warning" },
  { value: "urgent", label: "Khẩn cấp", color: "error" },
];

function optionLabel(options, value, fallback = "Khác") {
  return options.find((item) => item.value === value)?.label || fallback;
}

function priorityMeta(value) {
  return (
    PRIORITY_OPTIONS.find((item) => item.value === value) ||
    PRIORITY_OPTIONS[1]
  );
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function getStatusMeta(status) {
  return STATUS_META[status] || STATUS_META.open;
}

function isUnreadForUser(ticket) {
  if (!ticket?.lastMessageAt) return false;
  if (!ticket?.userLastReadAt) return true;
  return (
    new Date(ticket.lastMessageAt).getTime() >
    new Date(ticket.userLastReadAt).getTime()
  );
}

function attachmentPayload(uploadResult, file) {
  const body = uploadResult || {};
  return {
    url: body.url,
    mime: body.mime || file.type || "image/jpeg",
    name: body.filename || file.name || "attachment",
    size: body.size || file.size || 0,
  };
}

function FilesPreview({ files, onRemove }) {
  if (!files.length) return null;
  return (
    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
      {files.map((file) => (
        <Chip
          key={`${file.name}-${file.size}-${file.lastModified}`}
          size="small"
          icon={<AttachFileIcon />}
          label={file.name}
          onDelete={() => onRemove(file)}
          sx={{ maxWidth: 260 }}
        />
      ))}
    </Stack>
  );
}

function AttachmentList({ attachments = [] }) {
  if (!Array.isArray(attachments) || !attachments.length) return null;
  return (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
      {attachments.map((attachment, index) => {
        const isImage = String(attachment.mime || "").startsWith("image/");
        return (
          <Button
            key={`${attachment.url}-${index}`}
            href={attachment.url}
            target="_blank"
            rel="noopener noreferrer"
            size="small"
            variant="outlined"
            startIcon={<AttachFileIcon />}
            sx={{ textTransform: "none" }}
          >
            {isImage ? "Xem ảnh" : attachment.name || `Tệp ${index + 1}`}
          </Button>
        );
      })}
    </Stack>
  );
}

function TicketCard({ ticket, active, onClick }) {
  const meta = getStatusMeta(ticket?.status);
  const unread = isUnreadForUser(ticket);
  const priority = priorityMeta(ticket?.priority);

  return (
    <Card
      variant="outlined"
      sx={{
        borderRadius: 2,
        borderColor: active ? "primary.main" : "divider",
        bgcolor: active ? "action.selected" : "background.paper",
      }}
    >
      <CardActionArea onClick={onClick}>
        <Stack spacing={1} sx={{ p: 1.5 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography
              variant="subtitle2"
              fontWeight={unread ? 850 : 700}
              noWrap
              sx={{ flex: 1, minWidth: 0 }}
            >
              {ticket?.title || "Hỗ trợ"}
            </Typography>
            {unread ? <Chip size="small" label="Mới" color="error" /> : null}
          </Stack>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              minHeight: 40,
            }}
          >
            {ticket?.lastMessagePreview || "Chưa có nội dung"}
          </Typography>
          <Stack direction="row" alignItems="center" spacing={0.75} flexWrap="wrap" useFlexGap>
            <Chip size="small" color={meta.color} label={meta.label} />
            <Chip size="small" color={priority.color} label={priority.label} />
            <Typography variant="caption" color="text.secondary">
              {formatDate(ticket?.lastMessageAt || ticket?.updatedAt)}
            </Typography>
          </Stack>
        </Stack>
      </CardActionArea>
    </Card>
  );
}

function MessageBubble({ message }) {
  const fromStaff = message?.senderRole === "staff";
  const senderName =
    message?.senderUser?.nickname ||
    message?.senderUser?.name ||
    (fromStaff ? "Support" : "Bạn");

  return (
    <Stack
      alignItems={fromStaff ? "flex-start" : "flex-end"}
      spacing={0.5}
      sx={{ width: "100%" }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={0.75}
        sx={{ maxWidth: "min(760px, 92%)" }}
      >
        <Typography variant="caption" color="text.secondary" noWrap>
          {fromStaff ? `Support - ${senderName}` : senderName}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {formatDate(message?.createdAt)}
        </Typography>
      </Stack>
      <Box
        sx={(currentTheme) => ({
          maxWidth: "min(760px, 92%)",
          px: 1.5,
          py: 1.1,
          borderRadius: 2,
          bgcolor: fromStaff
            ? currentTheme.palette.mode === "dark"
              ? alpha(currentTheme.palette.primary.main, 0.2)
              : alpha(currentTheme.palette.primary.main, 0.08)
            : currentTheme.palette.mode === "dark"
              ? alpha(currentTheme.palette.success.main, 0.2)
              : alpha(currentTheme.palette.success.main, 0.08),
          border: "1px solid",
          borderColor: fromStaff
            ? alpha(currentTheme.palette.primary.main, 0.22)
            : alpha(currentTheme.palette.success.main, 0.22),
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        })}
      >
        <Typography variant="body2">
          {message?.text || "[Đính kèm]"}
        </Typography>
        <AttachmentList attachments={message?.attachments} />
      </Box>
    </Stack>
  );
}

function EmptyThread({ onCreate }) {
  return (
    <Stack
      alignItems="center"
      justifyContent="center"
      spacing={1.5}
      sx={{ minHeight: 360, textAlign: "center", p: 3 }}
    >
      <InboxIcon sx={{ fontSize: 48, color: "text.secondary" }} />
      <Typography variant="h6" fontWeight={700}>
        Chưa chọn case hỗ trợ
      </Typography>
      <Typography color="text.secondary" sx={{ maxWidth: 420 }}>
        Chọn một case trong danh sách hoặc tạo case mới để gửi yêu cầu cho đội
        ngũ hỗ trợ.
      </Typography>
      <Button variant="contained" startIcon={<AddIcon />} onClick={onCreate}>
        Tạo case mới
      </Button>
    </Stack>
  );
}

export default function SupportCenter() {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up("md"));
  const navigate = useNavigate();
  const { id: routeTicketId } = useParams();

  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newCategory, setNewCategory] = useState("other");
  const [newPriority, setNewPriority] = useState("normal");
  const [newText, setNewText] = useState("");
  const [newContactEmail, setNewContactEmail] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");
  const [newFiles, setNewFiles] = useState([]);
  const [replyText, setReplyText] = useState("");
  const [replyFiles, setReplyFiles] = useState([]);
  const [ratingScore, setRatingScore] = useState(0);
  const [ratingComment, setRatingComment] = useState("");

  const {
    data: ticketsData,
    isLoading: ticketsLoading,
    isFetching: ticketsFetching,
    isError: ticketsError,
    refetch: refetchTickets,
  } = useListMySupportTicketsQuery();

  const tickets = useMemo(
    () => (Array.isArray(ticketsData) ? ticketsData : []),
    [ticketsData],
  );

  const selectedId = routeTicketId || "";
  const {
    data: detail,
    isFetching: detailFetching,
    isError: detailError,
    refetch: refetchDetail,
  } = useGetMySupportTicketQuery(selectedId || skipToken);

  const [createTicket, { isLoading: creating }] =
    useCreateSupportTicketMutation();
  const [replyTicket, { isLoading: replying }] =
    useReplyMySupportTicketMutation();
  const [rateTicket, { isLoading: rating }] = useRateMySupportTicketMutation();
  const [uploadImage, { isLoading: uploading }] =
    useUploadImageToFolderMutation();

  useEffect(() => {
    if (routeTicketId || ticketsLoading || !tickets.length) return;
    navigate(`/support/${tickets[0]._id}`, { replace: true });
  }, [navigate, routeTicketId, tickets, ticketsLoading]);

  useEffect(() => {
    const ticket = detail?.ticket;
    setRatingScore(ticket?.ratingScore || 0);
    setRatingComment(ticket?.ratingComment || "");
  }, [detail?.ticket]);

  const filteredTickets = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return tickets.filter((ticket) => {
      if (statusFilter && ticket.status !== statusFilter) return false;
      if (categoryFilter && ticket.category !== categoryFilter) return false;
      if (priorityFilter && ticket.priority !== priorityFilter) return false;
      if (!q) return true;
      const haystack = [
        ticket.title,
        ticket.lastMessagePreview,
        ticket.status,
        ticket.category,
        ticket.priority,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [categoryFilter, keyword, priorityFilter, statusFilter, tickets]);

  const selectedTicket = detail?.ticket || null;
  const messages = Array.isArray(detail?.messages) ? detail.messages : [];
  const selectedStatus = getStatusMeta(selectedTicket?.status);
  const selectedPriority = priorityMeta(selectedTicket?.priority);
  const busy = creating || replying || uploading;

  const stats = useMemo(() => {
    return tickets.reduce(
      (acc, ticket) => {
        acc.total += 1;
        if (ticket.status === "open") acc.open += 1;
        if (ticket.status === "pending") acc.pending += 1;
        if (ticket.status === "closed") acc.closed += 1;
        if (isUnreadForUser(ticket)) acc.unread += 1;
        return acc;
      },
      { total: 0, open: 0, pending: 0, closed: 0, unread: 0 },
    );
  }, [tickets]);

  const uploadFiles = async (files) => {
    const attachments = [];
    for (const file of files) {
      const result = await uploadImage({
        folder: "support",
        file,
        options: {
          format: "webp",
          width: 1280,
          height: 1280,
          quality: 82,
        },
      }).unwrap();
      attachments.push(attachmentPayload(result, file));
    }
    return attachments;
  };

  const onPickFiles = (event, setter) => {
    const files = Array.from(event.target.files || []).slice(0, 5);
    setter((current) => [...current, ...files].slice(0, 5));
    event.target.value = "";
  };

  const removeFile = (file, setter) => {
    setter((current) => current.filter((item) => item !== file));
  };

  const closeNewDialog = () => {
    if (busy) return;
    setNewOpen(false);
    setNewTitle("");
    setNewCategory("other");
    setNewPriority("normal");
    setNewText("");
    setNewContactEmail("");
    setNewContactPhone("");
    setNewFiles([]);
  };

  const handleCreateTicket = async () => {
    const text = newText.trim();
    if (!text && !newFiles.length) {
      toast.error("Vui lòng nhập nội dung hoặc đính kèm ảnh.");
      return;
    }

    try {
      const attachments = await uploadFiles(newFiles);
      const ticket = await createTicket({
        title: newTitle.trim() || "Hỗ trợ",
        text,
        attachments,
        category: newCategory,
        priority: newPriority,
        contactEmail: newContactEmail,
        contactPhone: newContactPhone,
        source: "web",
      }).unwrap();
      closeNewDialog();
      toast.success("Đã tạo case hỗ trợ.");
      if (ticket?._id) navigate(`/support/${ticket._id}`);
    } catch (error) {
      toast.error(error?.data?.message || "Không thể tạo case hỗ trợ.");
    }
  };

  const handleReply = async () => {
    const text = replyText.trim();
    if (!selectedId || (!text && !replyFiles.length)) return;

    try {
      const attachments = await uploadFiles(replyFiles);
      await replyTicket({ id: selectedId, text, attachments }).unwrap();
      setReplyText("");
      setReplyFiles([]);
      toast.success("Đã gửi phản hồi.");
    } catch (error) {
      toast.error(error?.data?.message || "Không thể gửi phản hồi.");
    }
  };

  const handleRateTicket = async () => {
    if (!selectedId || !ratingScore) return;
    try {
      await rateTicket({
        id: selectedId,
        score: ratingScore,
        comment: ratingComment,
      }).unwrap();
      toast.success("Đã lưu đánh giá.");
    } catch (error) {
      toast.error(error?.data?.message || "Không thể lưu đánh giá.");
    }
  };

  return (
    <Container maxWidth="xl" sx={{ py: { xs: 2, md: 3 } }}>
      <SEOHead title="Trung tâm hỗ trợ" noIndex />

      <Stack spacing={2.5}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={1.5}
          alignItems={{ xs: "stretch", md: "center" }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h4" fontWeight={800}>
              Trung tâm hỗ trợ
            </Typography>
            <Typography color="text.secondary">
              Gửi case, theo dõi phản hồi và nhận thông báo khi support trả lời.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Tooltip title="Tải lại">
              <IconButton
                onClick={() => {
                  refetchTickets();
                  if (selectedId) refetchDetail();
                }}
                disabled={ticketsFetching || detailFetching}
              >
                <RefreshIcon />
              </IconButton>
            </Tooltip>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setNewOpen(true)}
            >
              Tạo case
            </Button>
          </Stack>
        </Stack>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "repeat(2, 1fr)", md: "repeat(5, 1fr)" },
            gap: 1,
          }}
        >
          {[
            ["Tất cả", stats.total],
            ["Chưa đọc", stats.unread],
            ["Đang mở", stats.open],
            ["Đã phản hồi", stats.pending],
            ["Đã đóng", stats.closed],
          ].map(([label, value]) => (
            <Card key={label} variant="outlined" sx={{ borderRadius: 2, p: 1.5 }}>
              <Typography variant="caption" color="text.secondary">
                {label}
              </Typography>
              <Typography variant="h5" fontWeight={850}>
                {value}
              </Typography>
            </Card>
          ))}
        </Box>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "380px minmax(0, 1fr)" },
            gap: 2,
            alignItems: "start",
          }}
        >
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <Stack spacing={1.5} sx={{ p: 2 }}>
              <TextField
                size="small"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="Tìm case hỗ trợ"
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                  endAdornment: keyword ? (
                    <InputAdornment position="end">
                      <IconButton
                        size="small"
                        onClick={() => setKeyword("")}
                        edge="end"
                      >
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </InputAdornment>
                  ) : null,
                }}
              />
              <Stack direction={{ xs: "column", sm: "row", md: "column" }} spacing={1}>
                <TextField
                  size="small"
                  select
                  label="Trạng thái"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  fullWidth
                >
                  <MenuItem value="">Tất cả</MenuItem>
                  <MenuItem value="open">Đang mở</MenuItem>
                  <MenuItem value="pending">Đã phản hồi</MenuItem>
                  <MenuItem value="closed">Đã đóng</MenuItem>
                </TextField>
                <TextField
                  size="small"
                  select
                  label="Loại"
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                  fullWidth
                >
                  <MenuItem value="">Tất cả</MenuItem>
                  {CATEGORY_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  size="small"
                  select
                  label="Ưu tiên"
                  value={priorityFilter}
                  onChange={(event) => setPriorityFilter(event.target.value)}
                  fullWidth
                >
                  <MenuItem value="">Tất cả</MenuItem>
                  {PRIORITY_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>
            </Stack>
            <Divider />
            <Stack
              spacing={1}
              sx={{
                p: 1.5,
                maxHeight: { xs: "none", md: "calc(100vh - 390px)" },
                overflowY: isDesktop ? "auto" : "visible",
              }}
            >
              {ticketsLoading ? (
                Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} variant="rounded" height={124} />
                ))
              ) : ticketsError ? (
                <Alert severity="error">Không thể tải danh sách case.</Alert>
              ) : filteredTickets.length ? (
                filteredTickets.map((ticket) => (
                  <TicketCard
                    key={ticket._id}
                    ticket={ticket}
                    active={String(ticket._id) === String(selectedId)}
                    onClick={() => navigate(`/support/${ticket._id}`)}
                  />
                ))
              ) : (
                <Stack alignItems="center" spacing={1.25} sx={{ py: 4 }}>
                  <MailOutlineIcon color="disabled" />
                  <Typography color="text.secondary" textAlign="center">
                    Chưa có case phù hợp.
                  </Typography>
                </Stack>
              )}
            </Stack>
          </Card>

          <Card
            variant="outlined"
            sx={{
              borderRadius: 2,
              minHeight: { xs: 460, md: "calc(100vh - 258px)" },
              display: "flex",
              flexDirection: "column",
            }}
          >
            {!selectedId ? (
              <EmptyThread onCreate={() => setNewOpen(true)} />
            ) : detailError ? (
              <Alert severity="error" sx={{ m: 2 }}>
                Không thể tải chi tiết case.
              </Alert>
            ) : (
              <>
                <Stack spacing={1.25} sx={{ p: 2 }}>
                  {selectedTicket ? (
                    <>
                      <Stack
                        direction={{ xs: "column", sm: "row" }}
                        spacing={1}
                        alignItems={{ xs: "flex-start", sm: "center" }}
                      >
                        <Typography variant="h6" fontWeight={850} sx={{ flex: 1 }}>
                          {selectedTicket.title || "Hỗ trợ"}
                        </Typography>
                        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                          <Chip
                            size="small"
                            color={selectedStatus.color}
                            label={selectedStatus.label}
                          />
                          <Chip
                            size="small"
                            label={optionLabel(CATEGORY_OPTIONS, selectedTicket.category)}
                          />
                          <Chip
                            size="small"
                            color={selectedPriority.color}
                            label={selectedPriority.label}
                          />
                        </Stack>
                      </Stack>
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        <Typography variant="body2" color="text.secondary">
                          Cập nhật lần cuối {formatDate(selectedTicket.lastMessageAt)}
                        </Typography>
                        {selectedTicket.assignedTo ? (
                          <Typography variant="body2" color="text.secondary">
                            Support:{" "}
                            {selectedTicket.assignedTo.nickname ||
                              selectedTicket.assignedTo.name ||
                              selectedTicket.assignedTo.email}
                          </Typography>
                        ) : null}
                      </Stack>
                      {selectedTicket.closeReason ? (
                        <Alert severity="success" sx={{ py: 0.5 }}>
                          Lý do đóng: {selectedTicket.closeReason}
                        </Alert>
                      ) : null}
                    </>
                  ) : (
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <CircularProgress size={18} />
                      <Typography color="text.secondary">Đang tải case...</Typography>
                    </Stack>
                  )}
                </Stack>
                <Divider />
                <Stack
                  spacing={1.75}
                  sx={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: "auto",
                    p: 2,
                    bgcolor: (currentTheme) =>
                      currentTheme.palette.mode === "dark"
                        ? alpha(currentTheme.palette.common.white, 0.02)
                        : alpha(currentTheme.palette.grey[100], 0.65),
                  }}
                >
                  {detailFetching && !messages.length ? (
                    Array.from({ length: 4 }).map((_, index) => (
                      <Skeleton
                        key={index}
                        variant="rounded"
                        height={72}
                        sx={{ maxWidth: index % 2 ? "70%" : "82%" }}
                      />
                    ))
                  ) : messages.length ? (
                    messages.map((message) => (
                      <MessageBubble key={message._id} message={message} />
                    ))
                  ) : (
                    <Stack
                      alignItems="center"
                      justifyContent="center"
                      spacing={1}
                      sx={{ minHeight: 220 }}
                    >
                      <SupportAgentIcon color="disabled" />
                      <Typography color="text.secondary">
                        Chưa có phản hồi trong case này.
                      </Typography>
                    </Stack>
                  )}
                </Stack>
                <Divider />
                {selectedTicket?.status === "closed" ? (
                  <Stack spacing={1} sx={{ p: 2 }}>
                    <Typography variant="subtitle2" fontWeight={800}>
                      Đánh giá hỗ trợ
                    </Typography>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                      <Rating
                        value={ratingScore}
                        onChange={(_, value) => setRatingScore(value || 0)}
                      />
                      <TextField
                        size="small"
                        value={ratingComment}
                        onChange={(event) => setRatingComment(event.target.value)}
                        placeholder="Góp ý thêm cho support..."
                        fullWidth
                      />
                      <Button
                        variant="outlined"
                        onClick={handleRateTicket}
                        disabled={!ratingScore || rating}
                      >
                        Lưu
                      </Button>
                    </Stack>
                  </Stack>
                ) : null}
                <Stack spacing={1} sx={{ p: 2 }}>
                  <FilesPreview
                    files={replyFiles}
                    onRemove={(file) => removeFile(file, setReplyFiles)}
                  />
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                    <TextField
                      value={replyText}
                      onChange={(event) => setReplyText(event.target.value)}
                      placeholder={
                        selectedTicket?.status === "closed"
                          ? "Gửi phản hồi để mở lại case"
                          : "Nhập phản hồi..."
                      }
                      multiline
                      minRows={1}
                      maxRows={4}
                      fullWidth
                      disabled={!selectedTicket || busy}
                    />
                    <Stack direction="row" spacing={1} sx={{ alignSelf: { xs: "stretch", sm: "flex-end" } }}>
                      <Button
                        component="label"
                        variant="outlined"
                        startIcon={<UploadFileIcon />}
                        disabled={!selectedTicket || busy}
                      >
                        Ảnh
                        <input
                          hidden
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={(event) => onPickFiles(event, setReplyFiles)}
                        />
                      </Button>
                      <Button
                        variant="contained"
                        startIcon={<ReplyIcon />}
                        onClick={handleReply}
                        disabled={
                          !selectedTicket ||
                          (!replyText.trim() && !replyFiles.length) ||
                          busy
                        }
                      >
                        Gửi
                      </Button>
                    </Stack>
                  </Stack>
                </Stack>
              </>
            )}
          </Card>
        </Box>
      </Stack>

      <Dialog open={newOpen} onClose={closeNewDialog} maxWidth="sm" fullWidth>
        <DialogTitle>Tạo case hỗ trợ</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Tiêu đề"
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              fullWidth
              placeholder="Ví dụ: Cần hỗ trợ đăng ký giải"
            />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
              <TextField
                select
                label="Loại vấn đề"
                value={newCategory}
                onChange={(event) => setNewCategory(event.target.value)}
                fullWidth
              >
                {CATEGORY_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Mức ưu tiên"
                value={newPriority}
                onChange={(event) => setNewPriority(event.target.value)}
                fullWidth
              >
                {PRIORITY_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
            <TextField
              label="Nội dung"
              value={newText}
              onChange={(event) => setNewText(event.target.value)}
              fullWidth
              multiline
              minRows={5}
              placeholder="Mô tả vấn đề, bước tái hiện, mã đơn hoặc thông tin liên quan..."
            />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
              <TextField
                label="Email liên hệ"
                value={newContactEmail}
                onChange={(event) => setNewContactEmail(event.target.value)}
                fullWidth
              />
              <TextField
                label="Số điện thoại"
                value={newContactPhone}
                onChange={(event) => setNewContactPhone(event.target.value)}
                fullWidth
              />
            </Stack>
            <Stack spacing={1}>
              <Button
                component="label"
                variant="outlined"
                startIcon={<UploadFileIcon />}
                disabled={busy}
                sx={{ alignSelf: "flex-start" }}
              >
                Đính kèm ảnh
                <input
                  hidden
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(event) => onPickFiles(event, setNewFiles)}
                />
              </Button>
              <FilesPreview
                files={newFiles}
                onRemove={(file) => removeFile(file, setNewFiles)}
              />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeNewDialog} disabled={busy}>
            Hủy
          </Button>
          <Button
            variant="contained"
            onClick={handleCreateTicket}
            disabled={(!newText.trim() && !newFiles.length) || busy}
          >
            {busy ? "Đang gửi..." : "Gửi case"}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
