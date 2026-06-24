import mongoose from 'mongoose';
import config from '../config';

// Cache the MongoDB connection promise for serverless environments (Vercel)
let cachedConnection: typeof mongoose | null = null;
let connectionPromise: Promise<typeof mongoose> | null = null;

export async function connectDB(): Promise<typeof mongoose> {
  // If already connected, return cached connection
  if (cachedConnection && mongoose.connection.readyState === 1) {
    return cachedConnection;
  }

  // If connection is in progress, wait for it
  if (connectionPromise) {
    return connectionPromise;
  }

  // Create new connection
  connectionPromise = mongoose
    .connect(config.database_url as string, {
      bufferCommands: true,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 15000,
    })
    .then((conn) => {
      cachedConnection = conn;
      console.log('✅ MongoDB connected successfully');
      return conn;
    })
    .catch((err) => {
      console.error('❌ MongoDB connection error:', err);
      cachedConnection = null;
      connectionPromise = null;
      throw err;
    });

  return connectionPromise;
}
