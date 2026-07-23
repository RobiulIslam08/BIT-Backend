import dotenv from 'dotenv';
import path from 'path';

// Configure dotenv to load .env file
dotenv.config({ path: path.join(process.cwd(), '.env') });



export default {
  port: Number(process.env.PORT) || 5000,
NODE_ENV:process.env.NODE_ENV,
  database_url: process.env.DATABASE_URL,

   bcrypt_solt_rounds: process.env.BCYPT_SALT_ROUNDS,
  default_pass: process.env.DEFAULT_PASS,
  jwt_access_secret:process.env.JWT_ACCESS_SECRET,
  jwt_refresh_secret:process.env.JWT_REFRESH_SECRET,
  jwt_access_expires_in:process.env.JWT_ACCESS_EXPIRES_IN,
  jwt_refresh_expires_in:process.env.JWT_REFRESH_EXPIRES_IN,
  reset_pass_ui_link:process.env.RESET_PASS_UI_LINK,
  smtp_host: process.env.SMTP_HOST,
  smtp_port: process.env.SMTP_PORT,
  smtp_secure: process.env.SMTP_SECURE,
  smtp_user: process.env.SMTP_USER,
  smtp_pass: process.env.SMTP_PASS,
  google_client_id: process.env.GOOGLE_CLIENT_ID,
  // ─── Namecheap API ───
  namecheap_api_key: process.env.NAMECHEAP_API_KEY,
  namecheap_api_user: process.env.NAMECHEAP_API_USER,
  namecheap_client_ip: process.env.NAMECHEAP_CLIENT_IP,
  namecheap_env: process.env.NAMECHEAP_ENV || 'production',
  // ─── cPanel credential encryption (AES-256-GCM) ───
  // Prefer a dedicated secret; falls back to JWT_ACCESS_SECRET in credentialCrypto.
  cpanel_credentials_secret: process.env.CPANEL_CREDENTIALS_SECRET,
};
