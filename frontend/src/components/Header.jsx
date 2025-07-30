// src/components/Header.jsx – MUI version with responsive menus and polished UX
import React, { useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Link, useNavigate } from 'react-router-dom';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Avatar from '@mui/material/Avatar';
import Tooltip from '@mui/material/Tooltip';
import MenuIcon from '@mui/icons-material/Menu';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import LoginIcon from '@mui/icons-material/Login';
import HowToRegIcon from '@mui/icons-material/HowToReg';
import { useLogoutMutation } from '../slices/usersApiSlice';
import { logout } from '../slices/authSlice';

const navConfig = [
  {
    label: 'Pickle Ball',
    submenu: [
      { label: 'Giải đấu', path: '/pickle-ball/tournaments' },
      { label: 'Điểm trình', path: '/pickle-ball/rankings' },
    ],
  },
  {
    label: 'Tennis',
    submenu: [
      { label: 'Giải đấu', path: '/tennis/tournaments' },
      { label: 'Điểm trình', path: '/tennis/rankings' },
    ],
  },
];

const Header = () => {
  const { userInfo } = useSelector((state) => state.auth);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [logoutApiCall] = useLogoutMutation();

  // * Menu anchors *
  const [mobileAnchor, setMobileAnchor] = useState(null);
  const [desktopAnchor, setDesktopAnchor] = useState(null);
  const [desktopIdx, setDesktopIdx] = useState(null);
  const [userAnchor, setUserAnchor] = useState(null);

  // * Handlers *
  const openMobileMenu = (e) => setMobileAnchor(e.currentTarget);
  const closeMobileMenu = () => setMobileAnchor(null);

  const openDesktopMenu = (e, idx) => {
    setDesktopAnchor(e.currentTarget);
    setDesktopIdx(idx);
  };
  const closeDesktopMenu = () => {
    setDesktopAnchor(null);
    setDesktopIdx(null);
  };

  const openUserMenu = (e) => setUserAnchor(e.currentTarget);
  const closeUserMenu = () => setUserAnchor(null);

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
    <AppBar position="static" color="primary" elevation={2}>
      <Toolbar>
        {/* Brand */}
        <Typography
          variant="h6"
          component={Link}
          to="/"
          sx={{
            mr: 2,
            textDecoration: 'none',
            color: 'inherit',
            fontWeight: 700,
            letterSpacing: '.08rem',
          }}
        >
          SportConnect
        </Typography>

        {/* Desktop nav */}
        <Box sx={{ flexGrow: 1, display: { xs: 'none', md: 'flex' } }}>
          {navConfig.map((item, idx) => (
            <Button
              key={item.label}
              onClick={(e) => openDesktopMenu(e, idx)}
              endIcon={<KeyboardArrowDownIcon />}
              sx={{ my: 2, color: 'white', textTransform: 'none' }}
            >
              {item.label}
            </Button>
          ))}
        </Box>

        {/* Auth buttons / avatar */}
        {userInfo ? (
          <Box sx={{ flexGrow: 0 }}>
            <Tooltip title="Tài khoản">
              <IconButton onClick={openUserMenu} sx={{ p: 0 }}>
                <Avatar alt={userInfo.name} src={userInfo.avatar || ''}>
                  {userInfo.name?.charAt(0).toUpperCase()}
                </Avatar>
              </IconButton>
            </Tooltip>
            <Menu
              anchorEl={userAnchor}
              open={Boolean(userAnchor)}
              onClose={closeUserMenu}
              transformOrigin={{ horizontal: 'right', vertical: 'top' }}
              anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
            >
              <MenuItem component={Link} to="/profile" onClick={closeUserMenu}>
                Profile
              </MenuItem>
              <MenuItem onClick={logoutHandler}>Logout</MenuItem>
            </Menu>
          </Box>
        ) : (
          <Box sx={{ display: { xs: 'none', md: 'flex' }, gap: 1 }}>
            <Button
              component={Link}
              to="/login"
              startIcon={<LoginIcon />}
              variant="outlined"
              color="inherit"
            >
              Sign In
            </Button>
            <Button
              component={Link}
              to="/register"
              startIcon={<HowToRegIcon />}
              variant="contained"
              color="secondary"
            >
              Sign Up
            </Button>
          </Box>
        )}

        {/* Mobile hamburger */}
        <Box sx={{ display: { xs: 'flex', md: 'none' } }}>
          <IconButton
            size="large"
            aria-label="navigation menu"
            aria-controls="mobile-menu"
            aria-haspopup="true"
            onClick={openMobileMenu}
            color="inherit"
          >
            <MenuIcon />
          </IconButton>
        </Box>
      </Toolbar>

      {/* Mobile nav menu */}
      <Menu
        id="mobile-menu"
        anchorEl={mobileAnchor}
        open={Boolean(mobileAnchor)}
        onClose={closeMobileMenu}
        keepMounted
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        sx={{ display: { xs: 'block', md: 'none' } }}
      >
        {navConfig.map((item) => (
          <Box key={item.label}>
            <MenuItem disabled>{item.label}</MenuItem>
            {item.submenu.map((sub) => (
              <MenuItem
                key={sub.path}
                component={Link}
                to={sub.path}
                onClick={closeMobileMenu}
                sx={{ pl: 4 }}
              >
                {sub.label}
              </MenuItem>
            ))}
          </Box>
        ))}
        {!userInfo && (
          <>
            <MenuItem component={Link} to="/login" onClick={closeMobileMenu}>
              <LoginIcon fontSize="small" sx={{ mr: 1 }} /> Sign In
            </MenuItem>
            <MenuItem component={Link} to="/register" onClick={closeMobileMenu}>
              <HowToRegIcon fontSize="small" sx={{ mr: 1 }} /> Sign Up
            </MenuItem>
          </>
        )}
      </Menu>

      {/* Desktop dropdown submenu */}
      <Menu
        anchorEl={desktopAnchor}
        open={Boolean(desktopAnchor)}
        onClose={closeDesktopMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        {desktopIdx !== null &&
          navConfig[desktopIdx].submenu.map((sub) => (
            <MenuItem
              key={sub.path}
              component={Link}
              to={sub.path}
              onClick={closeDesktopMenu}
            >
              {sub.label}
            </MenuItem>
          ))}
      </Menu>
    </AppBar>
  );
};

export default Header;
