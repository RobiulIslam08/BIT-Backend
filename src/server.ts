// import app from './app';
// import config from './app/config';
// import { connectDB } from './app/DB/connection';

// // For local development: start the server with traditional listen
// if (config.NODE_ENV !== 'production') {
//   async function main() {
//     try {
//       await connectDB();
//       app.listen(config.port, () => {
//         console.log(`Example app listening on port ${config.port}`);
//       });
//     } catch (err) {
//       console.log(err);
//     }
//   }
//   main();
// }

// // Export for Vercel serverless
// export default app;


import app from './app';
import config from './app/config';
import { connectDB } from './app/DB/connection';

async function main() {
  try {
    // ডাটাবেস কানেক্ট হচ্ছে
    await connectDB();
    
    // Vercel-এর if কন্ডিশন বাদ দিয়ে সরাসরি 0.0.0.0 দিয়ে পোর্ট লিসেন করা হচ্ছে
    app.listen(config.port, '0.0.0.0', () => {
      console.log(`✅ Application is running on port ${config.port}`);
    });
  } catch (err) {
    console.log('❌ Failed to connect database:', err);
  }
}

main();

// Export for other uses (optional but fine to keep)
export default app;