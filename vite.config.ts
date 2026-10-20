import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import { localAIPlugin } from './server/local-api.js';
import { notesAPI } from './server/notes-api.js';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      notesAPI(`${process.cwd()}/.data`),
      localAIPlugin({ apiKey: env.OPENAI_API_KEY ?? '', model: env.OPENAI_MODEL || 'gpt-6-luna' }),
    ],
    test: { environment: 'jsdom', include: ['tests/**/*.test.ts*'], restoreMocks: true },
  };
});
