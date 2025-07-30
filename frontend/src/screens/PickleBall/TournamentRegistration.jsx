// src/pages/TournamentRegistration.jsx
// Trang đăng ký 2 VĐV + bảng danh sách (phong cách SportConnect)

import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Container,
  Row,
  Col,
  Form,
  Spinner,
  Alert,
  Badge,
  Image,
} from "react-bootstrap";
import {
  TextField,
  Button,
  Avatar,
  Typography,
  MenuItem,
  Box,
} from "@mui/material";
import {
  useGetRegistrationsQuery,
  useCreateRegistrationMutation,
  useUpdatePaymentMutation,
  useCheckinMutation,
  useGetTournamentQuery,
} from "../../slices/tournamentsApiSlice";
import { toast } from "react-toastify";
import {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Chip,
} from "@mui/material";
import { Stack } from "@mui/system";
import { Button as ButtonMui } from "@mui/material";
import { useUploadAvatarMutation } from "../../slices/uploadApiSlice";

const PROVINCES = [
  "An Giang",
  "Bà Rịa‑Vũng Tàu",
  "Bắc Giang",
  "Bắc Kạn",
  "Bạc Liêu",
  "Bắc Ninh",
  "Bến Tre",
  "Bình Định",
  "Bình Dương",
  "Bình Phước",
  "Bình Thuận",
  "Cà Mau",
  "Cần Thơ",
  "Cao Bằng",
  "Đà Nẵng",
  "Đắk Lắk",
  "Đắk Nông",
  "Điện Biên",
  "Đồng Nai",
  "Đồng Tháp",
  "Gia Lai",
  "Hà Giang",
  "Hà Nam",
  "Hà Nội",
  "Hà Tĩnh",
  "Hải Dương",
  "Hải Phòng",
  "Hậu Giang",
  "Hòa Bình",
  "Hưng Yên",
  "Khánh Hòa",
  "Kiên Giang",
  "Kon Tum",
  "Lai Châu",
  "Lâm Đồng",
  "Lạng Sơn",
  "Lào Cai",
  "Long An",
  "Nam Định",
  "Nghệ An",
  "Ninh Bình",
  "Ninh Thuận",
  "Phú Thọ",
  "Phú Yên",
  "Quảng Bình",
  "Quảng Nam",
  "Quảng Ngãi",
  "Quảng Ninh",
  "Quảng Trị",
  "Sóc Trăng",
  "Sơn La",
  "Tây Ninh",
  "Thái Bình",
  "Thái Nguyên",
  "Thanh Hóa",
  "Thừa Thiên‑Huế",
  "Tiền Giang",
  "TP. Hồ Chí Minh",
  "Trà Vinh",
  "Tuyên Quang",
  "Vĩnh Long",
  "Vĩnh Phúc",
  "Yên Bái",
];

const emptyPlayer = {
  fullName: "",
  phone: "",
  avatar: "",
  selfScore: "",
  province: "",
  note: "",
};
const PLACEHOLDER = "https://dummyimage.com/80x80/cccccc/ffffff&text=Avatar";
const TournamentRegistration = () => {
  const { id } = useParams();
  const [player1, setP1] = useState(emptyPlayer);
  const [player2, setP2] = useState(emptyPlayer);
  const [message, setMessage] = useState("");
  const { data: tour } = useGetTournamentQuery(id);
  const { data: regs, isLoading, error } = useGetRegistrationsQuery(id);
  const [createReg, { isLoading: saving }] = useCreateRegistrationMutation();
  const [updatePayment] = useUpdatePaymentMutation();
  const [checkin] = useCheckinMutation();
  const [uploadAvatar] = useUploadAvatarMutation();
  const onChange = (setter) => (e) =>
    setter((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    try {
      const body = {
        tourId: id,
        message,
        player1,
        player2,
      };

      await createReg(body).unwrap();
      toast.success("Đăng ký thành công");
      setP1(emptyPlayer);
      setP2(emptyPlayer);
      setMessage("");
    } catch (err) {
      toast.error(err?.data?.message || err.error);
    }
  };

  const togglePayment = async (reg) => {
    try {
      await updatePayment({
        regId: reg._id,
        status: reg.payment.status === "Đã nộp" ? "Chưa nộp" : "Đã nộp",
      }).unwrap();
    } catch (err) {
      toast.error("Lỗi cập nhật lệ phí");
    }
  };

  const handleCheckin = async (reg) => {
    try {
      await checkin({ regId: reg._id }).unwrap();
    } catch (err) {
      toast.error("Lỗi check‑in");
    }
  };

  const playerForm = (p, setP, label) => (
    <>
      <h6 className="mt-3">{label}</h6>
      <Form.Group className="mb-2" controlId={`${label}-name`}>
        <Form.Label>Họ tên</Form.Label>
        <Form.Control
          name="fullName"
          value={p.fullName}
          onChange={onChange(setP)}
          required
        />
      </Form.Group>
      <Form.Group className="mb-2" controlId={`${label}-phone`}>
        <Form.Label>Số ĐT</Form.Label>
        <Form.Control
          name="phone"
          value={p.phone}
          onChange={onChange(setP)}
          required
        />
      </Form.Group>
      <Form.Group className="mb-2" controlId={`${label}-avatar`}>
        <Form.Label>Ảnh (URL)</Form.Label>
        <Form.Control
          name="avatar"
          value={p.avatar}
          onChange={onChange(setP)}
        />
      </Form.Group>
      <Row>
        <Col>
          <Form.Group className="mb-2" controlId={`${label}-score`}>
            <Form.Label>Điểm tự chấm</Form.Label>
            <Form.Control
              type="number"
              min="0"
              max="10"
              name="selfScore"
              value={p.selfScore}
              onChange={onChange(setP)}
              required
            />
          </Form.Group>
        </Col>
        <Col>
          <Form.Group className="mb-2" controlId={`${label}-province`}>
            <Form.Label>Khu vực</Form.Label>
            <Form.Select
              name="province"
              value={p.province}
              onChange={onChange(setP)}
              required
            >
              <option value="">Chọn tỉnh</option>
              {PROVINCES.map((pr) => (
                <option key={pr} value={pr}>
                  {pr}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
        </Col>
      </Row>
      <Form.Group className="mb-3" controlId={`${label}-note`}>
        <Form.Label>Ghi chú</Form.Label>
        <Form.Control name="note" value={p.note} onChange={onChange(setP)} />
      </Form.Group>
    </>
  );

  const Avatar = ({ src, name }) => (
    <Image
      src={src || PLACEHOLDER}
      onError={(e) => {
        e.currentTarget.src = PLACEHOLDER;
      }}
      roundedCircle
      width={40}
      height={40}
      className="me-2 mb-1"
      alt={name}
    />
  );

  return (
    <Container className="py-4">
      <h3 className="mb-4">Đăng ký Giải đấu</h3>
      <Row>
        {/* Left form */}
        <Col lg={4}>
          <form onSubmit={submit}>
            {[
              { label: "VĐV 1", state: player1, setState: setP1 },
              { label: "VĐV 2", state: player2, setState: setP2 },
            ].map(({ label, state, setState }) => (
              <Box key={label} mb={3}>
                <Typography fontWeight="bold" mb={1}>
                  {label}
                </Typography>
                <TextField
                  label="Họ tên"
                  name="fullName"
                  value={state.fullName}
                  onChange={(e) =>
                    setState((p) => ({ ...p, fullName: e.target.value }))
                  }
                  fullWidth
                  required
                  margin="dense"
                />
                <TextField
                  label="Số điện thoại"
                  name="phone"
                  value={state.phone}
                  onChange={(e) =>
                    setState((p) => ({ ...p, phone: e.target.value }))
                  }
                  fullWidth
                  required
                  margin="dense"
                  inputProps={{ pattern: "[0-9]{10,11}" }}
                />
                <Stack direction="row" alignItems="center" spacing={2} mt={1}>
                  <Avatar
                    src={state.avatar || ""}
                    sx={{ width: 56, height: 56 }}
                  />
                  <Button variant="outlined" component="label">
                    Chọn ảnh
                    <input
                      hidden
                      type="file"
                      accept="image/*"
                      onChange={async (e) => {
                        const file = e.target.files[0];
                        if (!file) return;

                        try {
                          const res = await uploadAvatar(file).unwrap(); // trả về { url: 'http://...' }
                          setState((prev) => ({
                            ...prev,
                            avatar: res.url, // dùng luôn url BE trả về
                            avatarFile: file, // optional nếu bạn muốn lưu file gốc
                          }));
                        } catch (err) {
                          toast.error("Lỗi upload ảnh");
                        }
                      }}
                    />
                  </Button>
                </Stack>
                <TextField
                  label="Điểm tự chấm (0–10)"
                  name="selfScore"
                  type="number"
                  value={state.selfScore}
                  onChange={(e) =>
                    setState((p) => ({ ...p, selfScore: e.target.value }))
                  }
                  inputProps={{ min: 0, max: 10 }}
                  fullWidth
                  required
                  margin="dense"
                />
                <TextField
                  label="Tỉnh/Thành"
                  name="province"
                  select
                  value={state.province}
                  onChange={(e) =>
                    setState((p) => ({ ...p, province: e.target.value }))
                  }
                  fullWidth
                  required
                  margin="dense"
                >
                  {PROVINCES.map((prov) => (
                    <MenuItem key={prov} value={prov}>
                      {prov}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  label="Ghi chú"
                  name="note"
                  value={state.note}
                  onChange={(e) =>
                    setState((p) => ({ ...p, note: e.target.value }))
                  }
                  fullWidth
                  margin="dense"
                />
              </Box>
            ))}

            <TextField
              label="Lời nhắn"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              fullWidth
              multiline
              rows={2}
              margin="normal"
            />

            <Stack direction="row" spacing={2} mt={2}>
              <Button
                type="submit"
                variant="contained"
                color="primary"
                disabled={saving}
              >
                {saving ? "Đang lưu…" : "Đăng ký"}
              </Button>

              <Button
                component={Link}
                to={`/tournament/${id}/checkin`}
                variant="contained"
                color="success"
                size="small"
              >
                Check‑in
              </Button>

              <Button
                component={Link}
                to={`/tournament/${id}/bracket`}
                variant="contained"
                color="info"
                size="small"
              >
                Sơ đồ
              </Button>
            </Stack>
          </form>
        </Col>

        {/* Right table list */}
        <Col lg={8}>
          <h5 className="mb-2">Danh sách đăng ký</h5>
          {isLoading ? (
            <Spinner animation="border" />
          ) : error ? (
            <Alert variant="danger">
              {error?.data?.message || error.error}
            </Alert>
          ) : regs.length === 0 ? (
            <div className="text-center py-4">
              <Typography variant="h6" color="text.secondary">
                Hiện chưa có đăng ký nào!
              </Typography>
            </div>
          ) : (
            <Table
              size="small"
              sx={{
                "& thead th": { fontWeight: 600 },
                "& tbody td": { verticalAlign: "middle" },
              }}
            >
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>VĐV 1</TableCell>
                  <TableCell>VĐV 2</TableCell>
                  <TableCell>Đăng lúc</TableCell>
                  <TableCell>Lệ phí</TableCell>
                  <TableCell>Check‑in</TableCell>
                  <TableCell>Thao tác</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {regs.map((r, idx) => (
                  <TableRow key={r._id} hover>
                    <TableCell>{idx + 1}</TableCell>

                    <TableCell>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <Avatar src={r.player1.avatar} />
                        <div>
                          <Typography variant="body2">
                            {r.player1.fullName}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {r.player1.phone}
                          </Typography>
                        </div>
                      </Stack>
                    </TableCell>

                    <TableCell>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <Avatar src={r.player2.avatar} />
                        <div>
                          <Typography variant="body2">
                            {r.player2.fullName}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {r.player2.phone}
                          </Typography>
                        </div>
                      </Stack>
                    </TableCell>

                    <TableCell>
                      {new Date(r.createdAt).toLocaleString()}
                    </TableCell>

                    <TableCell>
                      {r.payment.status === "Đã nộp" ? (
                        <Chip
                          label={`Đã nộp\n${new Date(
                            r.payment.paidAt
                          ).toLocaleDateString()}`}
                          color="success"
                          size="small"
                          sx={{ whiteSpace: "pre-line" }}
                        />
                      ) : (
                        <Chip label="Chưa nộp" color="default" size="small" />
                      )}
                    </TableCell>

                    <TableCell>
                      {r.checkinAt ? (
                        <Chip
                          label={new Date(r.checkinAt).toLocaleTimeString()}
                          color="info"
                          size="small"
                        />
                      ) : (
                        <Chip label="Chưa" color="default" size="small" />
                      )}
                    </TableCell>

                    <TableCell>
                      <Stack direction="row" spacing={1}>
                        <Button
                          variant="outlined"
                          color={
                            r.payment.status === "Đã nộp" ? "error" : "success"
                          }
                          size="small"
                          onClick={() => togglePayment(r)}
                        >
                          {r.payment.status === "Đã nộp"
                            ? "Huỷ phí"
                            : "Xác nhận phí"}
                        </Button>
                        <Button
                          variant="outlined"
                          color="primary"
                          size="small"
                          onClick={() => handleCheckin(r)}
                        >
                          Check‑in
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {tour && (
            <Row className="mt-4">
              <Col md={6}>
                <div dangerouslySetInnerHTML={{ __html: tour.contactHtml }} />
              </Col>
              <Col md={6}>
                <div dangerouslySetInnerHTML={{ __html: tour.contentHtml }} />
              </Col>
            </Row>
          )}
        </Col>
      </Row>
    </Container>
  );
};

export default TournamentRegistration;
