import 'dotenv/config';
import { z } from 'zod';

export const config = z.object({
  DATABASE_URL: z.string().url().startsWith('postgresql://')
}).parse(process.env);
