import nodemailer from 'nodemailer';
import config from '../config';

export const sendEmail = async (to: string, html: string, subject?: string) => {
  const transporter = nodemailer.createTransport({
    host: config.smtp_host || 'smtp.gmail.com',
    port: Number(config.smtp_port) || 587,
    secure: config.smtp_secure === 'true', // true for port 465, false for other ports
    auth: {
      user: config.smtp_user,
      pass: config.smtp_pass,
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
