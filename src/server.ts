import app from './app';
import config from './app/config';
import { connectDB } from './app/DB/connection';

// For local development: start the server with traditional listen
if (config.NODE_ENV !== 'production') {
  async function main() {
    try {
      await connectDB();
      app.listen(config.port, () => {
        console.log(`Example app listening on port ${config.port}`);
      });
    } catch (err) {
      console.log(err);
    }
  }
  main();
}

// Export for Vercel serverless
export default app;

