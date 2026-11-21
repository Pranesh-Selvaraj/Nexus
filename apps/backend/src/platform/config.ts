import { z } from 'zod';

/**
 * Server configuration.
 *
 * Every setting the HTTP layer, authentication and operations need is declared
 * here once, validated at boot, and read through `config` instead of touching
 * `process.env` from modules. A bad value fails the process with the offending
 * name and the reason, instead of becoming `undefined` somewhere deep in a
 * request.
 *
 * Modules that still read the environment directly (providers, storage, the
 * worker) keep doing so until they move into `modules/`; this object is the
 * single source for everything the composition root owns.
 */
const origins = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? 'http://localhost:5173')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().url()).min(1));

const bool = z
  .string()
  .optional()
  .transform((value) => value === 'true');

const port = z.coerce.number().int().min(1).max(65535);

const schema = z.object({
  env: z.enum(['development', 'test', 'production']).default('development'),
  port: port.default(3000),
  /** Comma-separated list of browser origins allowed to call the API. */
  frontendOrigins: origins,
  auth: z.object({
    /** A non-empty password turns the login screen on. */
    password: z.string().optional(),
    secureCookie: bool,
    allowRegistration: bool,
    localEmail: z.string().email().default('local@nexus.dev'),
  }),
  settings: z.object({
    secret: z.string().optional(),
  }),
  observability: z.object({
    logLevel: z.string().default('info'),
    metricsToken: z.string().optional(),
  }),
  providers: z.object({
    openaiKey: z.string().optional(),
  }),
});

export type Config = z.infer<typeof schema>;

/**
 * Parse `process.env`. Exported so tests can validate a candidate environment
 * without booting the process.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse({
    env: env.NODE_ENV,
    port: env.PORT,
    frontendOrigins: env.FRONTEND_ORIGIN,
    auth: {
      password: env.AUTH_PASSWORD || undefined,
      secureCookie: env.AUTH_COOKIE_SECURE,
      allowRegistration: env.ALLOW_REGISTRATION,
      localEmail: env.LOCAL_USER_EMAIL,
    },
    settings: { secret: env.SETTINGS_SECRET },
    observability: {
      logLevel: env.LOG_LEVEL,
      metricsToken: env.METRICS_TOKEN,
    },
    providers: { openaiKey: env.OPENAI_API_KEY || undefined },
  });

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return parsed.data;
}

/** Validated at import time: the process refuses to start on bad config. */
export const config: Config = loadConfig();

export const authEnabled = (): boolean => Boolean(config.auth.password);
