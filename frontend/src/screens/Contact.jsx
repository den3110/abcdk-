// src/pages/ContactPage.jsx
import {
  Box,
  Container,
  Typography,
  Stack,
  Link,
  IconButton,
} from "@mui/material";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import PhoneIcon from "@mui/icons-material/Phone";
import EmailIcon from "@mui/icons-material/Email";
import FacebookIcon from "@mui/icons-material/Facebook";
import YouTubeIcon from "@mui/icons-material/YouTube";
import ChatIcon from "@mui/icons-material/Chat";

export default function ContactPage() {
  return (
    <Container maxWidth="md" sx={{ py: 5 }}>
      <Typography variant="h4" align="center" fontWeight={700} gutterBottom>
        Thông tin liên hệ.
      </Typography>

      <Stack spacing={2} mt={4}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <LocationOnIcon color="action" />
          <Typography>
            <strong>Địa chỉ:</strong> Abcd, abcd, abcd
          </Typography>
        </Stack>

        <Stack direction="row" alignItems="center" spacing={1}>
          <PhoneIcon color="action" />
          <Typography>
            <strong>Điện thoại:</strong> 012345678
          </Typography>
        </Stack>

        <Stack direction="row" alignItems="center" spacing={1}>
          <EmailIcon color="action" />
          <Typography>
            <strong>Email:</strong>{" "}
            <Link href="mailto:support@pickletour.vn">
              support@pickletour.vn
            </Link>
          </Typography>
        </Stack>

        <Stack direction="row" spacing={2}>
          <IconButton href="https://facebook.com" target="_blank" color="primary">
            <FacebookIcon />
          </IconButton>
          <IconButton href="https://youtube.com" target="_blank" color="error">
            <YouTubeIcon />
          </IconButton>
          <IconButton href="#" target="_blank" color="info">
            <ChatIcon /> {/* Zalo icon thay thế tạm bằng ChatIcon */}
          </IconButton>
        </Stack>

        <Box mt={2}>
          <Typography>
            <strong>Hỗ trợ:</strong>{" "}
            <Link href="mailto:support@pickletour.vn">support@pickletour.vn</Link>{" "}
            – 0943336998
          </Typography>
          <Typography>
            <strong>Hỗ trợ điểm trình:</strong>{" "}
            <Link href="mailto:support@pickletour.vn">support@pickletour.vn</Link>{" "}
            – 0962182308
          </Typography>
          <Typography>
            <strong>Bán hàng:</strong>{" "}
            <Link href="mailto:support@pickletour.vn">support@pickletour.vn</Link>
          </Typography>
        </Box>
      </Stack>
    </Container>
  );
}
