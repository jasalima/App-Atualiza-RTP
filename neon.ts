import { defineConfig } from '@neondatabase/config/v1';

export default defineConfig({
  auth: true,
  dataApi: true,
  preview: {
    buckets: {
      'rtp-private': { access: 'private' }
    }
  }
});
