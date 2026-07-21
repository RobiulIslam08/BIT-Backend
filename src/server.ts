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
import { dropStaleAbandonedHardDeleteIndex } from './app/modules/DomainOrder/domainOrder.model';
import { sweepAbandonedCheckouts } from './app/modules/DomainOrder/domainOrder.service';
import { seedDomainPricingIfEmpty } from './app/modules/DomainPricing/domainPricing.service';

const ABANDONED_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // every hour

async function sweepAbandoned() {
  try {
    const n = await sweepAbandonedCheckouts();
    if (n > 0) console.log(`[Housekeeping] Cancelled ${n} abandoned checkout(s).`);
  } catch (err) {
    console.error('[Housekeeping] Abandoned checkout sweep failed (non-critical):', err);
  }
}

async function main() {
  try {
    // ডাটাবেস কানেক্ট হচ্ছে
    await connectDB();

    // One-shot: drop leftover hard-delete TTL that briefly existed during
    // development (Mongoose never auto-removes indexes that leave the schema).
    try {
      await dropStaleAbandonedHardDeleteIndex();
    } catch (err) {
      console.error('[Startup] Stale index cleanup failed (non-critical):', err);
    }

    // Seed default domain sell prices if the collection is empty
    // (so admin can maintain them from the dashboard afterwards).
    try {
      await seedDomainPricingIfEmpty();
    } catch (err) {
      console.error('[Startup] Domain pricing seed failed (non-critical):', err);
    }

    // Sweep abandoned checkouts now, and every hour thereafter, so cleanup
    // does NOT depend solely on the renewal-engine cron (which may not be
    // wired in every environment). Safe on long-running Node; on serverless
    // the renewal-engine cron still also runs the same sweep.
    await sweepAbandoned();
    setInterval(() => {
      void sweepAbandoned();
    }, ABANDONED_SWEEP_INTERVAL_MS);

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