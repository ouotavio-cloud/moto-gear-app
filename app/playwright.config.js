import { defineConfig, devices } from '@playwright/test';

const PORT = 8791;

// Permite usar um Chromium já presente na máquina (útil em ambientes que trazem
// o browser pré-instalado numa build diferente da que o Playwright baixaria).
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'list' : 'html',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure'
  },
  projects: [{ name: 'android-phone', use: { ...devices['Pixel 7'], launchOptions: { executablePath } } }],
  // O próprio backend serve a interface: os testes exercitam a mesma pilha que
  // roda no Render, com banco em memória.
  webServer: {
    command: 'node ../server/src/index.js',
    env: {
      PORT: String(PORT),
      ADMIN_USUARIO: 'teste',
      ADMIN_SENHA: 'segredo123',
      JWT_SECRET: 'segredo-de-teste-e2e'
    },
    url: `http://127.0.0.1:${PORT}/api/saude`,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore'
  }
});
