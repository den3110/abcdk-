import { Container } from "react-bootstrap";
import { Outlet, useLocation } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import Header from "./components/Header";
import MobileBottomNav from "./components/MenuMobile";
import RegInvitesModal from "./components/RegInvitesModal";
import { useEffect } from "react";
import { initGA, logPageView } from "./utils/analytics";

const App = () => {
  const location = useLocation();

  useEffect(() => {
    // Khởi tạo GA4 khi app load
    initGA();
  }, []);

  useEffect(() => {
    // Track mỗi lần đổi page
    logPageView(location.pathname + location.search, document.title);
  }, [location]);

  return (
    <>
      <Header />
      <ToastContainer />
      <Container className="" style={{ marginBottom: "80px" }}>
        <Outlet />
        <MobileBottomNav />
        {/* <RegInvitesModal /> */}
      </Container>
    </>
  );
};

export default App;
