// src/screens/RegisterScreen.jsx
import { useState, useEffect } from 'react';
import { Form, Button, Row, Col } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { useRegisterMutation } from '../slices/usersApiSlice';
import { setCredentials } from '../slices/authSlice';
import { toast } from 'react-toastify';
import FormContainer from '../components/FormContainer';
import Loader from '../components/Loader';

const RegisterScreen = () => {
  // ✨ thêm các state mới
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [phone, setPhone] = useState('');
  const [dob, setDob] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const dispatch   = useDispatch();
  const navigate   = useNavigate();
  const [register, { isLoading }] = useRegisterMutation();
  const { userInfo } = useSelector((state) => state.auth);

  useEffect(() => {
    if (userInfo) navigate('/');
  }, [userInfo, navigate]);

  const submitHandler = async (e) => {
    e.preventDefault();
    if (password !== confirmPassword) return toast.error('Passwords do not match');

    try {
      const res = await register({
        name,
        nickname,
        phone,
        dob,
        email,
        password,
      }).unwrap();

      dispatch(setCredentials({ ...res }));
      navigate('/');
    } catch (err) {
      toast.error(err?.data?.message || err.error);
    }
  };

  return (
    <FormContainer>
      <h1>Đăng ký</h1>
      <Form onSubmit={submitHandler}>
        <Form.Group className="my-2" controlId="name">
          <Form.Label>Họ và tên</Form.Label>
          <Form.Control
            type="text"
            placeholder="Nhập họ tên"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Form.Group>

        <Form.Group className="my-2" controlId="nickname">
          <Form.Label>Nickname</Form.Label>
          <Form.Control
            type="text"
            placeholder="Biệt danh"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            required
          />
        </Form.Group>

        <Form.Group className="my-2" controlId="phone">
          <Form.Label>Số điện thoại</Form.Label>
          <Form.Control
            type="tel"
            placeholder="09xx..."
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            pattern="^0[0-9]{9}$"
            required
          />
        </Form.Group>

        <Form.Group className="my-2" controlId="dob">
          <Form.Label>Ngày sinh</Form.Label>
          <Form.Control
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            required
          />
        </Form.Group>

        <Form.Group className="my-2" controlId="email">
          <Form.Label>Email</Form.Label>
          <Form.Control
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Form.Group>

        <Form.Group className="my-2" controlId="password">
          <Form.Label>Mật khẩu</Form.Label>
          <Form.Control
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
          />
        </Form.Group>

        <Form.Group className="my-2" controlId="confirmPassword">
          <Form.Label>Xác nhận mật khẩu</Form.Label>
          <Form.Control
            type="password"
            placeholder="Nhập lại mật khẩu"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </Form.Group>

        <Button type="submit" variant="primary" className="mt-3" disabled={isLoading}>
          Đăng ký
        </Button>
        {isLoading && <Loader />}
      </Form>

      <Row className="py-3">
        <Col>
          Đã có tài khoản? <Link to="/login">Đăng nhập</Link>
        </Col>
      </Row>
    </FormContainer>
  );
};

export default RegisterScreen;
