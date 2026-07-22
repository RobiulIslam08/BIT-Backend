import nodemailer from 'nodemailer';
import config from '../config';

export const sendEmail = async (to: string, html: string, subject?: string) => {
  // Gmail App Passwords are displayed with spaces (e.g. "egnl idbs pqpa rpba"),
  // but Gmail rejects them if the spaces are sent. Strip all whitespace to be safe.
  const smtpPass = config.smtp_pass?.replace(/\s+/g, '');

  const transporter = nodemailer.createTransport({
    host: config.smtp_host || 'smtp.gmail.com',
    port: Number(config.smtp_port) || 587,
    secure: config.smtp_secure === 'true', // true for port 465, false for other ports
    auth: {
      user: config.smtp_user,
      pass: smtpPass,
    },
  });

  await transporter.sendMail({
    from: `"BIT Software & IT Solution" <${config.smtp_user || 'no-reply@bitsoftwareitsolution.com'}>`,
    to,
    subject: subject || 'OTP Verification for Password Reset',
    text: '',
    html,
  });
};
