// src/components/Header.jsx
// React‑Bootstrap Navbar with extra dropdowns: Pickle Ball & Tennis

import { Navbar, Nav, Container, NavDropdown } from 'react-bootstrap';
import { FaSignInAlt, FaSignOutAlt } from 'react-icons/fa';
import { LinkContainer } from 'react-router-bootstrap';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { useLogoutMutation } from '../slices/usersApiSlice';
import { logout } from '../slices/authSlice';

const Header = () => {
  const { userInfo } = useSelector((state) => state.auth);
  const dispatch   = useDispatch();
  const navigate   = useNavigate();
  const [logoutApiCall] = useLogoutMutation();

  const logoutHandler = async () => {
    try {
      await logoutApiCall().unwrap();
      dispatch(logout());
      navigate('/login');
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <header>
      <Navbar bg="dark" variant="dark" expand="lg" collapseOnSelect>
        <Container>
          <LinkContainer to="/">
            <Navbar.Brand>SportConnect</Navbar.Brand>
          </LinkContainer>

          <Navbar.Toggle aria-controls="basic-navbar-nav" />
          <Navbar.Collapse id="basic-navbar-nav">
            <Nav className="me-auto">
              {/* Pickle Ball menu */}
              <NavDropdown title="Pickle Ball" id="pickleball-menu" align="end">
                <LinkContainer to="/pickle-ball/tournaments">
                  <NavDropdown.Item>Giải đấu</NavDropdown.Item>
                </LinkContainer>
                <LinkContainer to="/pickle-ball/rankings">
                  <NavDropdown.Item>Điểm trình</NavDropdown.Item>
                </LinkContainer>
              </NavDropdown>

              {/* Tennis menu */}
              <NavDropdown title="Tennis" id="tennis-menu" align="end">
                <LinkContainer to="/tennis/tournaments">
                  <NavDropdown.Item>Giải đấu</NavDropdown.Item>
                </LinkContainer>
                <LinkContainer to="/tennis/rankings">
                  <NavDropdown.Item>Điểm trình</NavDropdown.Item>
                </LinkContainer>
              </NavDropdown>
            </Nav>

            <Nav className="ms-auto">
              {userInfo ? (
                <NavDropdown title={userInfo.name} id="username" align="end">
                  <LinkContainer to="/profile">
                    <NavDropdown.Item>Profile</NavDropdown.Item>
                  </LinkContainer>
                  <NavDropdown.Item onClick={logoutHandler}>Logout</NavDropdown.Item>
                </NavDropdown>
              ) : (
                <>
                  <LinkContainer to="/login">
                    <Nav.Link>
                      <FaSignInAlt /> Sign In
                    </Nav.Link>
                  </LinkContainer>
                  <LinkContainer to="/register">
                    <Nav.Link>
                      <FaSignOutAlt /> Sign Up
                    </Nav.Link>
                  </LinkContainer>
                </>
              )}
            </Nav>
          </Navbar.Collapse>
        </Container>
      </Navbar>
    </header>
  );
};

export default Header;
