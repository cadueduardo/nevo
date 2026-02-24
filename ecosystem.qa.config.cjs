/**
 * PM2: processo do Nevo QA (nevoqa.pratikapp.com.br).
 * No VPS: cd /opt/nevo-qa && pm2 start ecosystem.qa.config.cjs
 * Ajuste "cwd" se sua pasta QA for outra.
 */
module.exports = {
  apps: [
    {
      name: 'nevo-qa',
      cwd: '/opt/nevo-qa',
      script: 'node_modules/.bin/next',
      args: 'start -p 3010',
      env: { NODE_ENV: 'production', PORT: '3010' },
    },
  ],
}
