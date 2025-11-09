// Load .env file
require('dotenv').config();

const path = require('path');

// Get project root directory (one level up from config/)
const PROJECT_ROOT = path.resolve(__dirname, '..');

module.exports = {
  apps: [
    {
      name: 'gtt-app',
      script: path.join(__dirname, 'start.sh'),
      interpreter: 'bash',
      cwd: PROJECT_ROOT,
      instances: 1,
      exec_mode: 'fork', // Use fork mode (not cluster) since we're managing multiple processes
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
        NEXT_PUBLIC_API_PORT: process.env.NEXT_PUBLIC_API_PORT || process.env.PORT_API || '8080',
        USE_TEST_CSV: process.env.USE_TEST_CSV || 'true',
      },
      // Logging configuration with built-in PM2 rotation
      error_file: path.join(PROJECT_ROOT, 'logs', 'pm2-error.log'),
      out_file: path.join(PROJECT_ROOT, 'logs', 'pm2-out.log'),
      log_file: path.join(PROJECT_ROOT, 'logs', 'pm2-combined.log'),
      time: true,
      merge_logs: true,
      // Built-in PM2 log rotation (no separate module needed)
      max_size: '2M',        // Rotate when log reaches 2MB
      retain: 2,              // Keep 2 rotated files (minimal retention)
      // Restart configuration
      restart_delay: 5000, // Wait 5 seconds before restarting
      max_restarts: 10, // Max restarts in 1 minute
      min_uptime: '10s', // Consider app stable after 10 seconds
      // Graceful shutdown
      kill_timeout: 10000, // Wait 10 seconds for graceful shutdown
      listen_timeout: 3000, // Wait 3 seconds for app to start listening
      shutdown_with_message: true, // Send shutdown message before killing
    },
  ],
};

