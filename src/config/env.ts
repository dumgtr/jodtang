import path from 'path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

const optionalNonEmptyString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().optional(),
);

const optionalUrl = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().url().optional(),
);

const envSchema = z.object({
  PORT: z.string().default('3000').transform((val) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  LINE_CHANNEL_ACCESS_TOKEN: z.string().default(''),
  LINE_CHANNEL_SECRET: z.string().default(''),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  OPENROUTER_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  DATABASE_SSL_REJECT_UNAUTHORIZED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  SLIPOK_API_KEY: z.string().optional(),
  SLIPOK_BRANCH_ID: z.string().optional(),
  SLIP2GO_API_SECRET: optionalNonEmptyString,
  SLIP2GO_BASE_URL: optionalUrl.default('https://connect.slip2go.com'),
  PUBLIC_BASE_URL: optionalUrl,
  EXPORT_TOKEN_SECRET: optionalNonEmptyString.refine(
    (value) => value === undefined || value.length >= 16,
    'EXPORT_TOKEN_SECRET must be at least 16 characters when provided',
  ),
});

export const env = envSchema.parse(process.env);
