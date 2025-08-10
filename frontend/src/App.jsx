import { Container } from 'react-bootstrap';
import { Outlet } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import Header from './components/Header';
import MobileBottomNav from './components/MenuMobile';

const App = () => {
  return (
    <>
      <Header />
      <ToastContainer />
      <Container className='' style={{ marginBottom: '80px' }}>
        <Outlet />
         <MobileBottomNav /> 
      </Container>
    </>
  );
};

export default App;
