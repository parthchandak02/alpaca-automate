// Load .env file
require('dotenv').config();

const path = require('path');

// Get project root directory (one level up from config/)
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Improved PM2 Configuration - Separate Processes for Accurate Metrics
// This runs backend and frontend as independent PM2 processes
// No shell script wrapper - PM2 tracks actual Python/Node processes directly

module.exports = {
  apps: [
    // Backend: Python Flask + Monitor
    {
      name: 'gtt-backend',
      script: 'uv',
      args: 'run python -m src.gtt_monitor',
      cwd: PROJECT_ROOT,
      interpreter: 'none', // Run uv directly, not through bash wrapper
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        // Load from .env (dotenv.config() above loads them)
        ALPACA_API_KEY: process.env.ALPACA_API_KEY,
        ALPACA_SECRET_KEY: process.env.ALPACA_SECRET_KEY,
        ALPACA_PAPER: process.env.ALPACA_PAPER || 'true',
        PORT_API: process.env.PORT_API || '8080',
        PORT_UI: process.env.PORT_UI || '3000',
        POLL_INTERVAL_SECONDS: process.env.POLL_INTERVAL_SECONDS || '60',
        DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL,
        // Email notification settings (optional)
        EMAIL_NOTIFICATIONS_ENABLED: process.env.EMAIL_NOTIFICATIONS_ENABLED || 'false',
        SMTP_SERVER: process.env.SMTP_SERVER || 'smtp.gmail.com',
        SMTP_PORT: process.env.SMTP_PORT || '587',
        SMTP_USERNAME: process.env.SMTP_USERNAME,
        SMTP_PASSWORD: process.env.SMTP_PASSWORD,
        EMAIL_TO: process.env.EMAIL_TO,
        USE_TEST_CSV: process.env.USE_TEST_CSV || 'true',
      },
      // Separate log files for backend
      // Note: Log rotation is handled by pm2-logrotate module (10MB max, 3 retained)
      error_file: path.join(PROJECT_ROOT, 'logs', 'pm2-backend-error.log'),
      out_file: path.join(PROJECT_ROOT, 'logs', 'pm2-backend-out.log'),
      log_file: path.join(PROJECT_ROOT, 'logs', 'pm2-backend-combined.log'),
      time: true,
      merge_logs: true,
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '10s',
      kill_timeout: 10000,
      listen_timeout: 3000,
      shutdown_with_message: true,
    },
    
    // Frontend: Next.js UI
    {
      name: 'gtt-frontend',
      script: 'npm',
      args: 'run dev', // Use 'dev' for local, change to 'start' for production after build
      cwd: path.join(PROJECT_ROOT, 'ui'),
      interpreter: 'none', // Run npm directly, not through bash wrapper
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT_UI || '3000',
        NEXT_PUBLIC_API_PORT: process.env.NEXT_PUBLIC_API_PORT || process.env.PORT_API || '8080',
        NEXT_PUBLIC_API_HOST: process.env.NEXT_PUBLIC_API_HOST, // For production (Railway)
      },
      // Separate log files for frontend
      // Note: Log rotation is handled by pm2-logrotate module (10MB max, 3 retained)
      error_file: path.join(PROJECT_ROOT, 'logs', 'pm2-frontend-error.log'),
      out_file: path.join(PROJECT_ROOT, 'logs', 'pm2-frontend-out.log'),
      log_file: path.join(PROJECT_ROOT, 'logs', 'pm2-frontend-combined.log'),
      time: true,
      merge_logs: true,
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '10s',
      kill_timeout: 10000,
      listen_timeout: 3000,
      shutdown_with_message: true,
    },
    
    // Cloudflare Tunnel - Expose app to internet securely
    {
      name: 'cloudflare-tunnel',
      script: 'cloudflared',
      args: 'tunnel run alpaca-backend',
      cwd: PROJECT_ROOT,
      interpreter: 'none',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      env: {
        // Optional: Enable metrics
        TUNNEL_METRICS: '0.0.0.0:9090',
      },
      // Note: Log rotation is handled by pm2-logrotate module (10MB max, 3 retained)
      error_file: path.join(PROJECT_ROOT, 'logs', 'cloudflare-tunnel-error.log'),
      out_file: path.join(PROJECT_ROOT, 'logs', 'cloudflare-tunnel-out.log'),
      log_file: path.join(PROJECT_ROOT, 'logs', 'cloudflare-tunnel-combined.log'),
      time: true,
      merge_logs: true,
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '10s',
      kill_timeout: 10000,
    },
  ],
};

