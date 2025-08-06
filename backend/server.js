import path from 'path';
import express from 'express';

import connectDB from './config/db.js';
import cookieParser from 'cookie-parser';
import { notFound, errorHandler } from './middleware/errorMiddleware.js';
import userRoutes from './routes/userRoutes.js';
import tournamentRoute from "./routes/tournamentRoutes.js"
import registrationRoutes from './routes/registrationRoutes.js';
import rankingRoutes from './routes/rankingRoutes.js';
import uploadRoutes from "./routes/uploadRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import authRoutes from "./routes/authRoutes.js";


import cors from "cors"
import dotenv from 'dotenv';
dotenv.config();
const port = process.env.PORT || 5000;

connectDB();

const app = express();
app.use("/uploads", express.static("uploads"));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: ['https://abcdk.vercel.app', "https://abcde-xi.vercel.app"], // ✅ KHÔNG dùng '*'
  credentials: true,               // ✅ Phải bật
}))
app.use(cookieParser());
app.use('/api/users', userRoutes);
app.use("/api/tournaments", tournamentRoute)
app.use('/api/registrations', registrationRoutes);
app.use('/api/rankings', rankingRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/auth", authRoutes);

if (process.env.NODE_ENV === 'production') {
  const __dirname = path.resolve();
  app.use(express.static(path.join(__dirname, '/frontend/dist')));

  app.get('*', (req, res) =>
    res.sendFile(path.resolve(__dirname, 'frontend', 'dist', 'index.html'))
  );
} else {
  app.get('/', (req, res) => {
    res.send('API is running....');
  });
}

app.use(notFound);
app.use(errorHandler);

app.listen(port, () => console.log(`Server started on port ${port}`));
