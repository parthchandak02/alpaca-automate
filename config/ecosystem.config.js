// Load .env file
require('dotenv').config();

module.exports = {
  apps: [
    {
      name: 'gtt-app',
      script: './config/start.sh',
      interpreter: 'bash',
      cwd: '/Users/parthchandak/Documents/alpaca-trading',
      instances: 1,
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
        USE_TEST_CSV: process.env.USE_TEST_CSV || 'true',
        POLL_INTERVAL_SECONDS: process.env.POLL_INTERVAL_SECONDS || '60',
        DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL,
        NEXT_PUBLIC_API_PORT: process.env.PORT_API || '8080',
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_file: './logs/pm2-combined.log',
      time: true,
      merge_logs: true,
      restart_delay: 5000,
      max_restarts: 5,
      min_uptime: '10s',
    },
  ],
};

