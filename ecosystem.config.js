module.exports = {
  apps: [
    {
      name: 'admiral-insights',
      script: 'server.js',
      cwd: '/var/www/admiral-insights',   // adjust to your deploy path
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production'
        // Actual secrets live in .env — dotenv loads them at startup
      },
      error_file: './logs/err.log',
      out_file:   './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    }
  ]
};
