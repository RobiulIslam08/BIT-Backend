import { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import express from 'express';
import { connectDB } from './app/DB/connection';
import path from 'path';
import helmet from 'helmet';
import router from './app/routes';
import globalErrorHandler from './app/middleware/globalErrorHandler';
import notFound from './app/middleware/notFound';

const app: Application = express();

// ─── Security: HTTP Headers ───
// Helmet sets Content-Security-Policy, X-Frame-Options, etc.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow serving uploaded images to frontend
  }),
);

// ─── CORS ───
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, Postman)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS policy: Origin '${origin}' is not allowed.`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);

// ─── Body Parsers ───
app.use(express.json({ limit: '2mb' }));        // Limit JSON payload size
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());

// ─── Static Files: Uploaded screenshots ───
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Ensure MongoDB is connected before processing any request (critical for Vercel serverless)
app.use(async (req: Request, res: Response, next: NextFunction) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('Failed to connect to MongoDB:', err);
    res.status(503).json({
      success: false,
      message: 'Database connection failed. Please try again later.',
      errorSources: [{ path: '', message: 'Database connection failed' }],
    });
  }
});

// ─── API Routes ───
app.use('/api/v1', router);

// ─── Health Check ───
app.get('/', (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'BIT Software & IT Solution — Server is running.',
    env: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// ─── Error Handlers (must come after routes) ───
app.use(globalErrorHandler);
app.use(notFound);

export default app;
