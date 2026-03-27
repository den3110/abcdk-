export default function SentryRootFallback() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        background: "#f8fafc",
        color: "#0f172a",
        textAlign: "center",
        fontFamily:
          '"Montserrat Variable", "Montserrat", system-ui, -apple-system, sans-serif',
      }}
    >
      <div style={{ maxWidth: 520 }}>
        <h1 style={{ fontSize: "2rem", marginBottom: 12 }}>
          Ứng dụng vừa gặp lỗi ngoài ý muốn
        </h1>
        <p style={{ fontSize: "1rem", margin: 0, opacity: 0.8 }}>
          Hệ thống đã ghi nhận lỗi này. Bạn hãy tải lại trang để thử lại.
        </p>
      </div>
    </div>
  );
}
