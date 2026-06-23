import { Application, Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import express from 'express';
import router from './app/routes';
const app: Application = express();

//parser
app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  }),
);
app.use('/api/v1', router);
app.get('/', (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Server is running successfully!'
  });
});

export default app;
