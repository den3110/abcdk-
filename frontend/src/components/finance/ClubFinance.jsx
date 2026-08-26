/* eslint-disable react/prop-types */
import React, { useState } from "react";
import {
  Stack,
  Card,
  CardContent,
  Box,
  Grid,
  Typography,
  Button,
  ToggleButton,
  ToggleButtonGroup,
  TextField,
  MenuItem,
  IconButton,
  LinearProgress,
  Chip,
  Autocomplete,
  Divider,
  Avatar,
  Switch,
  FormControlLabel,
  Collapse,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DownloadIcon from "@mui/icons-material/Download";
import EditOutlined from "@mui/icons-material/EditOutlined";
import DeleteOutline from "@mui/icons-material/DeleteOutline";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import dayjs from "dayjs";
import { toast } from "react-toastify";
import {
  useListTransactionsQuery,
  useFinanceSummaryQuery,
  useCreateTransactionMutation,
  useUpdateTransactionMutation,
  useDeleteTransactionMutation,
  useLazyExportFinanceCsvQuery,
  useGetDuesConfigQuery,
  useSetDuesConfigMutation,
  useGetDuesPeriodQuery,
  useGetMyDuesQuery,
  usePayDuesMutation,
  useUnpayDuesMutation,
} from "../../slices/clubsApiSlice";

const getApiErrMsg = (e) =>
  e?.data?.message ||
  e?.error ||
  (typeof e?.data === "string" ? e.data : "Có lỗi xảy ra.");
const fmtVnd = (n) => `${Number(n || 0).toLocaleString("vi-VN")} ₫`;
const INCOME_CATS = ["Phí thành viên", "Tài trợ", "Bán đồ", "Ủng hộ", "Khác"];
const EXPENSE_CATS = ["Thuê sân", "Mua bóng", "Mua dụng cụ", "Giải thưởng", "Ăn uống", "Di chuyển", "Sự kiện", "Khác"];
const METHOD_LABELS = { cash: "Tiền mặt", bank: "Ngân hàng", transfer: "Chuyển khoản", momo: "MoMo", other: "Khác" };
const toDateInput = (d) => dayjs(d).format("YYYY-MM-DD");

function StatCard({ label, value, color, icon }) {
  return (
    <Card variant="outlined" sx={{ borderRadius: 3, height: "100%" }}>
      <CardContent>
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: "text.secondary" }}>
          {icon}
          <Typography variant="caption">{label}</Typography>
        </Stack>
        <Typography variant="h6" sx={{ mt: 0.5, fontWeight: 800, color }}>
          {value}
        </Typography>
      </CardContent>
    </Card>
  );
}

/* ---------------- Dues (phí hội viên) helpers ---------------- */
const PERIOD_OPTS = [
  { k: "monthly", l: "Theo tháng" },
  { k: "quarterly", l: "Theo quý" },
  { k: "yearly", l: "Theo năm" },
];
function duesPeriodKey(date, period) {
  const y = date.getFullYear();
  if (period === "yearly") return `${y}`;
  if (period === "quarterly") return `${y}-Q${Math.floor(date.getMonth() / 3) + 1}`;
  return `${y}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
function duesPeriodLabel(date, period) {
  const y = date.getFullYear();
  if (period === "yearly") return `Năm ${y}`;
  if (period === "quarterly") return `Quý ${Math.floor(date.getMonth() / 3) + 1}/${y}`;
  return `Tháng ${String(date.getMonth() + 1).padStart(2, "0")}/${y}`;
}
function duesStep(date, period, dir) {
  const d = new Date(date);
  if (period === "yearly") d.setFullYear(d.getFullYear() + dir);
  else if (period === "quarterly") d.setMonth(d.getMonth() + dir * 3);
  else d.setMonth(d.getMonth() + dir);
  return d;
}

function DuesConfigCard({ id, cfg }) {
  const [setCfg, { isLoading }] = useSetDuesConfigMutation();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(cfg?.amount || ""));
  const [period, setPeriod] = useState(cfg?.period || "monthly");
  const [active, setActive] = useState(!!cfg?.active);

  React.useEffect(() => {
    setAmount(String(cfg?.amount || ""));
    setPeriod(cfg?.period || "monthly");
    setActive(!!cfg?.active);
  }, [cfg?.amount, cfg?.period, cfg?.active]);

  const save = async () => {
    try {
      await setCfg({ id, amount: Number(String(amount).replace(/[^\d]/g, "")) || 0, period, active }).unwrap();
      toast.success("Đã lưu cấu hình phí");
      setOpen(false);
    } catch (e) {
      toast.error(getApiErrMsg(e));
    }
  };

  return (
    <Card variant="outlined" sx={{ borderRadius: 3 }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="body2" color="text.secondary">
            {cfg?.active
              ? <>Phí: <b>{fmtVnd(cfg.amount)}</b> / {(PERIOD_OPTS.find((p) => p.k === cfg.period)?.l || "").replace("Theo ", "")}</>
              : "Chưa bật thu phí hội viên"}
          </Typography>
          <Button size="small" onClick={() => setOpen((v) => !v)}>{open ? "Đóng" : "Cấu hình"}</Button>
        </Stack>
        <Collapse in={open}>
          <Stack spacing={1.5} sx={{ mt: 1.5 }}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <TextField label="Mức phí (₫)" fullWidth value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} inputProps={{ inputMode: "numeric" }} />
              <TextField select label="Chu kỳ" fullWidth value={period} onChange={(e) => setPeriod(e.target.value)}>
                {PERIOD_OPTS.map((p) => <MenuItem key={p.k} value={p.k}>{p.l}</MenuItem>)}
              </TextField>
            </Stack>
            <FormControlLabel control={<Switch checked={active} onChange={(e) => setActive(e.target.checked)} />} label="Bật thu phí hội viên" />
            <Box><Button variant="contained" onClick={save} disabled={isLoading}>Lưu</Button></Box>
          </Stack>
        </Collapse>
      </CardContent>
    </Card>
  );
}

function FinanceDues({ club, canManage }) {
  const id = club?._id;
  const { data: cfg } = useGetDuesConfigQuery({ id }, { skip: !id });
  const period = cfg?.period || "monthly";
  const [cursor, setCursor] = useState(new Date());
  const key = duesPeriodKey(cursor, period);

  const { data: periodData, isLoading } = useGetDuesPeriodQuery({ id, key }, { skip: !id || !canManage });
  const { data: mine } = useGetMyDuesQuery({ id }, { skip: !id || canManage });
  const [payDues] = usePayDuesMutation();
  const [unpayDues] = useUnpayDuesMutation();

  const items = periodData?.items || [];
  const s = periodData?.summary;

  const nav = (
    <Stack direction="row" spacing={2} alignItems="center" justifyContent="center">
      <Button size="small" onClick={() => setCursor((c) => duesStep(c, period, -1))}>‹</Button>
      <Typography sx={{ fontWeight: 700, minWidth: 130, textAlign: "center" }}>{duesPeriodLabel(cursor, period)}</Typography>
      <Button size="small" onClick={() => setCursor((c) => duesStep(c, period, 1))}>›</Button>
    </Stack>
  );

  if (!canManage) {
    const paidKeys = new Set((mine?.payments || []).map((p) => p.periodKey));
    const myPaid = paidKeys.has(key);
    return (
      <Stack spacing={2}>
        <Typography color="text.secondary">
          {cfg?.active ? <>Phí hội viên: <b>{fmtVnd(cfg.amount)}</b> / {(PERIOD_OPTS.find((p) => p.k === cfg.period)?.l || "").replace("Theo ", "")}</> : "CLB chưa thu phí hội viên."}
        </Typography>
        {cfg?.active && (
          <>
            {nav}
            <Card variant="outlined" sx={{ borderRadius: 3 }}>
              <CardContent sx={{ textAlign: "center" }}>
                <Typography sx={{ fontWeight: 700, color: myPaid ? "success.main" : "error.main" }}>
                  {myPaid ? `✓ Bạn đã đóng phí ${duesPeriodLabel(cursor, period)}` : `Bạn chưa đóng phí ${duesPeriodLabel(cursor, period)}`}
                </Typography>
              </CardContent>
            </Card>
            {(mine?.payments || []).length > 0 && (
              <Card variant="outlined" sx={{ borderRadius: 3 }}>
                {(mine.payments).map((p, i) => (
                  <Box key={p._id}>
                    {i > 0 && <Divider />}
                    <Stack direction="row" justifyContent="space-between" sx={{ px: 2, py: 1 }}>
                      <Typography variant="body2">{p.periodKey}</Typography>
                      <Typography variant="body2" sx={{ color: "success.main", fontWeight: 700 }}>{fmtVnd(p.amount)}</Typography>
                    </Stack>
                  </Box>
                ))}
              </Card>
            )}
          </>
        )}
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <DuesConfigCard id={id} cfg={cfg} />
      {!cfg?.active ? (
        <Box sx={{ color: "text.secondary", textAlign: "center", py: 4 }}>
          <Typography>Bấm “Cấu hình” để đặt mức phí và bật thu.</Typography>
        </Box>
      ) : (
        <>
          {nav}
          {s && (
            <Grid container spacing={1.5}>
              <Grid item size={{ xs: 4 }}><StatCard label="Đã đóng" value={`${s.paidCount}/${s.memberCount}`} color="success.main" /></Grid>
              <Grid item size={{ xs: 4 }}><StatCard label="Còn nợ" value={`${s.unpaidCount}`} color="error.main" /></Grid>
              <Grid item size={{ xs: 4 }}><StatCard label="Thu được" value={fmtVnd(s.total)} /></Grid>
            </Grid>
          )}
          {isLoading ? (
            <Typography color="text.secondary">Đang tải…</Typography>
          ) : (
            <Card variant="outlined" sx={{ borderRadius: 3 }}>
              {items.map((it, i) => (
                <Box key={it.user._id}>
                  {i > 0 && <Divider />}
                  <Stack direction="row" spacing={1.5} alignItems="center" sx={{ px: 2, py: 1.25 }}>
                    <Avatar src={it.user.avatar} sx={{ width: 34, height: 34 }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                        {it.user.nickname || it.user.fullName || "Người dùng"}
                      </Typography>
                      {it.paid && it.payment && (
                        <Typography variant="caption" color="text.secondary">
                          {fmtVnd(it.payment.amount)} · {dayjs(it.payment.paidAt).format("DD/MM/YYYY")}
                        </Typography>
                      )}
                    </Box>
                    {it.paid ? (
                      <Button size="small" color="success" variant="outlined" onClick={() => unpayDues({ id, member: it.user._id, periodKey: key })}>
                        ✓ Đã đóng
                      </Button>
                    ) : (
                      <Button size="small" variant="outlined" onClick={() => payDues({ id, member: it.user._id, periodKey: key, amount: cfg?.amount || 0, method: "cash" })}>
                        Đánh dấu đóng
                      </Button>
                    )}
                  </Stack>
                </Box>
              ))}
              {items.length === 0 && <Typography sx={{ p: 2 }} color="text.secondary">Chưa có thành viên.</Typography>}
            </Card>
          )}
        </>
      )}
    </Stack>
  );
}

function FinanceBook({ club, canManage }) {
  const id = club?._id;
  const isMember = !!club?._my?.isMember;
  const [filterType, setFilterType] = useState("");

  const { data: sum } = useFinanceSummaryQuery({ id }, { skip: !id || !isMember });
  const { data: txData, isLoading } = useListTransactionsQuery(
    { id, limit: 100, type: filterType || undefined },
    { skip: !id || !isMember },
  );
  const [createTx, { isLoading: creating }] = useCreateTransactionMutation();
  const [updateTx, { isLoading: updating }] = useUpdateTransactionMutation();
  const [deleteTx] = useDeleteTransactionMutation();
  const [triggerExport, { isFetching: exporting }] = useLazyExportFinanceCsvQuery();

  const emptyForm = { type: "income", amount: "", category: "", description: "", occurredAt: toDateInput(new Date()), method: "cash" };
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const setF = (k, v) => setForm((s) => ({ ...s, [k]: v }));
  const cats = form.type === "income" ? INCOME_CATS : EXPENSE_CATS;

  const items = txData?.items || [];
  const byCat = sum?.byCategory || [];
  const maxCat = Math.max(1, ...byCat.map((c) => c.sum));

  const resetForm = () => {
    setForm(emptyForm);
    setEditId(null);
    setShowForm(false);
  };
  const startEdit = (t) => {
    setEditId(t._id);
    setForm({
      type: t.type,
      amount: String(t.amount || ""),
      category: t.category || "",
      description: t.description || "",
      occurredAt: toDateInput(t.occurredAt),
      method: t.method || "cash",
    });
    setShowForm(true);
  };
  const submit = async () => {
    const amt = Number(String(form.amount).replace(/[^\d]/g, ""));
    if (!amt || amt <= 0) return toast.info("Nhập số tiền hợp lệ.");
    const body = {
      type: form.type,
      amount: amt,
      category: (form.category || "").trim(),
      description: (form.description || "").trim(),
      occurredAt: form.occurredAt ? new Date(form.occurredAt).toISOString() : new Date().toISOString(),
      method: form.method,
    };
    try {
      if (editId) {
        await updateTx({ id, txId: editId, ...body }).unwrap();
        toast.success("Đã cập nhật giao dịch");
      } else {
        await createTx({ id, ...body }).unwrap();
        toast.success("Đã ghi giao dịch");
      }
      resetForm();
    } catch (e) {
      toast.error(getApiErrMsg(e));
    }
  };
  const remove = async (t) => {
    if (!window.confirm("Xoá giao dịch này?")) return;
    try {
      await deleteTx({ id, txId: t._id }).unwrap();
    } catch (e) {
      toast.error(getApiErrMsg(e));
    }
  };
  const doExport = async () => {
    try {
      const blob = await triggerExport({ id, type: filterType || undefined }).unwrap();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `quy-clb-${id}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(getApiErrMsg(e));
    }
  };

  if (!isMember) {
    return (
      <Box sx={{ color: "text.secondary", textAlign: "center", py: 4 }}>
        <AccountBalanceWalletIcon sx={{ fontSize: 40, opacity: 0.5 }} />
        <Typography sx={{ mt: 1 }}>Tham gia câu lạc bộ để xem thu chi quỹ.</Typography>
      </Box>
    );
  }

  return (
    <Stack spacing={2}>
      <Grid container spacing={1.5}>
        <Grid item size={{ xs: 12, sm: 4 }}>
          <StatCard label="Số dư quỹ" value={fmtVnd(sum?.balance)} color={Number(sum?.balance) < 0 ? "error.main" : "text.primary"} icon={<AccountBalanceWalletIcon fontSize="small" />} />
        </Grid>
        <Grid item size={{ xs: 6, sm: 4 }}>
          <StatCard label="Tổng thu" value={fmtVnd(sum?.totalIncome)} color="success.main" icon={<ArrowUpwardIcon fontSize="small" />} />
        </Grid>
        <Grid item size={{ xs: 6, sm: 4 }}>
          <StatCard label="Tổng chi" value={fmtVnd(sum?.totalExpense)} color="error.main" icon={<ArrowDownwardIcon fontSize="small" />} />
        </Grid>
      </Grid>

      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <ToggleButtonGroup size="small" exclusive value={filterType} onChange={(_, v) => setFilterType(v ?? "")}>
          <ToggleButton value="">Tất cả</ToggleButton>
          <ToggleButton value="income">Thu</ToggleButton>
          <ToggleButton value="expense">Chi</ToggleButton>
        </ToggleButtonGroup>
        <Box sx={{ flex: 1 }} />
        <Button size="small" startIcon={<DownloadIcon />} onClick={doExport} disabled={exporting}>
          {exporting ? "…" : "Xuất CSV"}
        </Button>
        {canManage && !showForm && (
          <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => { setForm(emptyForm); setEditId(null); setShowForm(true); }}>
            Ghi thu/chi
          </Button>
        )}
      </Stack>

      {canManage && showForm && (
        <Card variant="outlined" sx={{ borderRadius: 3 }}>
          <CardContent>
            <Stack spacing={1.5}>
              <ToggleButtonGroup
                fullWidth
                size="small"
                exclusive
                value={form.type}
                onChange={(_, v) => v && setF("type", v)}
                color={form.type === "income" ? "success" : "error"}
              >
                <ToggleButton value="income">+ Khoản thu</ToggleButton>
                <ToggleButton value="expense">− Khoản chi</ToggleButton>
              </ToggleButtonGroup>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                <TextField
                  label="Số tiền (₫)"
                  fullWidth
                  value={form.amount}
                  onChange={(e) => setF("amount", e.target.value.replace(/[^\d]/g, ""))}
                  inputProps={{ inputMode: "numeric" }}
                />
                <TextField
                  label="Ngày"
                  type="date"
                  fullWidth
                  value={form.occurredAt}
                  onChange={(e) => setF("occurredAt", e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
              </Stack>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                <Autocomplete
                  freeSolo
                  fullWidth
                  options={cats}
                  value={form.category}
                  onInputChange={(_, v) => setF("category", v)}
                  renderInput={(params) => <TextField {...params} label="Danh mục" />}
                />
                <TextField
                  select
                  label="Phương thức"
                  fullWidth
                  value={form.method}
                  onChange={(e) => setF("method", e.target.value)}
                >
                  {Object.entries(METHOD_LABELS).map(([k, v]) => (
                    <MenuItem key={k} value={k}>{v}</MenuItem>
                  ))}
                </TextField>
              </Stack>
              <TextField
                label="Mô tả"
                fullWidth
                multiline
                minRows={2}
                value={form.description}
                onChange={(e) => setF("description", e.target.value)}
              />
              <Stack direction="row" spacing={1}>
                <Button variant="contained" onClick={submit} disabled={creating || updating}>
                  {editId ? "Lưu" : "Ghi"}
                </Button>
                <Button onClick={resetForm}>Huỷ</Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <Typography color="text.secondary">Đang tải giao dịch…</Typography>
      ) : items.length === 0 ? (
        <Box sx={{ color: "text.secondary", textAlign: "center", py: 4 }}>
          <AccountBalanceWalletIcon sx={{ fontSize: 40, opacity: 0.5 }} />
          <Typography sx={{ mt: 1 }}>Chưa có giao dịch nào.</Typography>
        </Box>
      ) : (
        <Card variant="outlined" sx={{ borderRadius: 3 }}>
          {items.map((t, i) => {
            const inc = t.type === "income";
            return (
              <Box key={t._id}>
                {i > 0 && <Divider />}
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ px: 2, py: 1.25 }}>
                  <Box sx={{ width: 34, height: 34, borderRadius: "50%", display: "grid", placeItems: "center", flexShrink: 0, bgcolor: inc ? "success.light" : "error.light", color: inc ? "success.dark" : "error.dark" }}>
                    {inc ? <ArrowUpwardIcon fontSize="small" /> : <ArrowDownwardIcon fontSize="small" />}
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {t.category || "Khác"}
                      </Typography>
                      <Chip size="small" label={METHOD_LABELS[t.method] || t.method} sx={{ height: 18, fontSize: 10 }} />
                    </Stack>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                      {dayjs(t.occurredAt).format("DD/MM/YYYY")}
                      {t.description ? ` · ${t.description}` : ""}
                    </Typography>
                  </Box>
                  <Typography sx={{ fontWeight: 800, color: inc ? "success.main" : "error.main", whiteSpace: "nowrap" }}>
                    {inc ? "+" : "−"}{fmtVnd(t.amount)}
                  </Typography>
                  {canManage && (
                    <Stack direction="row">
                      <IconButton size="small" onClick={() => startEdit(t)}>
                        <EditOutlined fontSize="small" />
                      </IconButton>
                      <IconButton size="small" color="error" onClick={() => remove(t)}>
                        <DeleteOutline fontSize="small" />
                      </IconButton>
                    </Stack>
                  )}
                </Stack>
              </Box>
            );
          })}
        </Card>
      )}

      {byCat.length > 0 && (
        <Card variant="outlined" sx={{ borderRadius: 3 }}>
          <CardContent>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5 }}>
              Theo danh mục
            </Typography>
            <Stack spacing={1}>
              {byCat.slice(0, 10).map((c, i) => {
                const inc = c.type === "income";
                return (
                  <Box key={i}>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography variant="caption">
                        <Typography component="span" variant="caption" sx={{ color: inc ? "success.main" : "error.main", fontWeight: 700 }}>
                          {inc ? "Thu" : "Chi"}
                        </Typography>{" "}
                        · {c.category}
                      </Typography>
                      <Typography variant="caption" sx={{ fontWeight: 700 }}>
                        {fmtVnd(c.sum)}
                      </Typography>
                    </Stack>
                    <LinearProgress
                      variant="determinate"
                      value={(c.sum / maxCat) * 100}
                      color={inc ? "success" : "error"}
                      sx={{ borderRadius: 1, mt: 0.25 }}
                    />
                  </Box>
                );
              })}
            </Stack>
          </CardContent>
        </Card>
      )}
    </Stack>
  );
}

export default function ClubFinance({ club, canManage }) {
  const [view, setView] = useState("book");
  return (
    <Stack spacing={2}>
      <ToggleButtonGroup
        fullWidth
        size="small"
        exclusive
        value={view}
        onChange={(_, v) => v && setView(v)}
      >
        <ToggleButton value="book">Sổ quỹ</ToggleButton>
        <ToggleButton value="dues">Phí hội viên</ToggleButton>
      </ToggleButtonGroup>
      {view === "book" ? (
        <FinanceBook club={club} canManage={canManage} />
      ) : (
        <FinanceDues club={club} canManage={canManage} />
      )}
    </Stack>
  );
}
