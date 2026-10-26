import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
  ...base,
  testMatch: [
    'mobile.spec.ts',
    'appearance-mobile.spec.ts',
    'thoughts-mobile.spec.ts',
    'canvases-mobile.spec.ts',
  ],
  use: {
    ...base.use,
    browserName: 'webkit',
    launchOptions: {},
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  },
});
