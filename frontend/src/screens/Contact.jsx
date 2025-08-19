// src/pages/ContactPage.jsx
import {
  Box,
  Container,
  Typography,
  Stack,
  Link as MuiLink,
  IconButton,
} from "@mui/material";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import PhoneIcon from "@mui/icons-material/Phone";
import EmailIcon from "@mui/icons-material/Email";
import FacebookIcon from "@mui/icons-material/Facebook";
import YouTubeIcon from "@mui/icons-material/YouTube";
import ChatIcon from "@mui/icons-material/Chat";
import { useGetContactContentQuery } from "../slices/cmsApiSlice";

const FALLBACK = {
  address: "Abcd, abcd, abcd",
  phone: "012345678",
  email: "support@pickletour.vn",
  support: {
    generalEmail: "support@pickletour.vn",
    generalPhone: "0123456789",
    scoringEmail: "support@pickletour.vn",
    scoringPhone: "0123456789",
    salesEmail: "support@pickletour.vn",
  },
  socials: {
    facebook: "https://facebook.com",
    youtube: "https://youtube.com",
    zalo: "#",
  },
};

const Bar = ({ w = "100%", h = 18, r = 8, mt = 6 }) => (
  <div
    style={{
      width: w,
      height: h,
      borderRadius: r,
      background: "rgba(0,0,0,0.08)",
      marginTop: mt,
    }}
  />
);

export default function ContactPage() {
  const { data, isLoading, isError } = useGetContactContentQuery();

  const info = isLoading ? null : isError ? FALLBACK : { ...FALLBACK, ...data };

  return (
    <Container maxWidth="md" sx={{ py: 5 }}>
      <Typography variant="h4" align="center" fontWeight={700} gutterBottom>
        Thông tin liên hệ.
      </Typography>

      {info ? (
        <Stack spacing={2} mt={4}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <LocationOnIcon color="action" />
            <Typography>
              <strong>Địa chỉ:</strong> {info.address}
            </Typography>
          </Stack>

          <Stack direction="row" alignItems="center" spacing={1}>
            <PhoneIcon color="action" />
            <Typography>
              <strong>Điện thoại:</strong>{" "}
              {info.phone ? (
                <MuiLink href={`tel:${info.phone}`}>{info.phone}</MuiLink>
              ) : (
                "—"
              )}
            </Typography>
          </Stack>

          <Stack direction="row" alignItems="center" spacing={1}>
            <EmailIcon color="action" />
            <Typography>
              <strong>Email:</strong>{" "}
              <MuiLink href={`mailto:${info.email}`}>{info.email}</MuiLink>
            </Typography>
          </Stack>

          <Stack direction="row" spacing={2} mt={1}>
            {info?.socials?.facebook && (
              <IconButton
                href={info.socials.facebook}
                target="_blank"
                rel="noopener noreferrer"
                color="primary"
              >
                <FacebookIcon />
              </IconButton>
            )}
            {info?.socials?.youtube && (
              <IconButton
                href={info.socials.youtube}
                target="_blank"
                rel="noopener noreferrer"
                color="error"
              >
                <YouTubeIcon />
              </IconButton>
            )}
            {info?.socials?.zalo && (
              <IconButton
                href={info.socials.zalo}
                target="_blank"
                rel="noopener noreferrer"
                color="info"
              >
                <ChatIcon /> {/* tạm thay Zalo icon */}
              </IconButton>
            )}
          </Stack>

          <Box mt={2}>
            <Typography>
              <strong>Hỗ trợ:</strong>{" "}
              <MuiLink href={`mailto:${info.support.generalEmail}`}>
                {info.support.generalEmail}
              </MuiLink>{" "}
              –{" "}
              {info.support.generalPhone ? (
                <MuiLink href={`tel:${info.support.generalPhone}`}>
                  {info.support.generalPhone}
                </MuiLink>
              ) : (
                "—"
              )}
            </Typography>
            <Typography>
              <strong>Hỗ trợ điểm trình:</strong>{" "}
              <MuiLink href={`mailto:${info.support.scoringEmail}`}>
                {info.support.scoringEmail}
              </MuiLink>{" "}
              –{" "}
              {info.support.scoringPhone ? (
                <MuiLink href={`tel:${info.support.scoringPhone}`}>
                  {info.support.scoringPhone}
                </MuiLink>
              ) : (
                "—"
              )}
            </Typography>
            <Typography>
              <strong>Bán hàng:</strong>{" "}
              <MuiLink href={`mailto:${info.support.salesEmail}`}>
                {info.support.salesEmail}
              </MuiLink>
            </Typography>
          </Box>
        </Stack>
      ) : (
        // Skeleton khi loading
        <Stack spacing={1} mt={4}>
          <Bar w="60%" h={26} mt={0} />
          <Bar w="45%" />
          <Bar w="70%" />
          <Bar w="30%" />
          <Bar w="65%" />
        </Stack>
      )}
    </Container>
  );
}
