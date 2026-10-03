import { resolveLlmConfig, type LlmConfig } from '@wealthcompass/llm';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface ServerConfig {
  port: number;
  host: string;
  repoRoot: string;
  featureMapPath: string;
  packDir: string;
  allowedOrigins: string[];
  mockIdp: boolean;
  jwt: { jwksUrl: string; issuer: string; audience: string };
  llm: LlmConfig;
  capabilitiesClaim: string;
  rateLimit: { max: number; windowMs: number };
}

export function loadConfig(): ServerConfig {
  const port = Number(process.env['PORT'] ?? 8890);
  return {
    port,
    host: process.env['HOST'] ?? '127.0.0.1',
    repoRoot,
    featureMapPath: resolve(repoRoot, process.env['COMPASS_FEATURE_MAP'] ?? 'examples/iconnect-demo/feature-map.json'),
    packDir: resolve(repoRoot, process.env['COMPASS_PACK'] ?? 'packs/finance-vn'),
    allowedOrigins: (process.env['COMPASS_ORIGINS'] ?? 'http://localhost:4200,http://127.0.0.1:4200').split(','),
    mockIdp: process.env['COMPASS_MOCK_IDP'] !== '0',
    jwt: {
      jwksUrl: process.env['COMPASS_JWKS_URL'] ?? `http://127.0.0.1:${port}/idp/jwks.json`,
      issuer: process.env['COMPASS_JWT_ISSUER'] ?? 'https://idp.demo.local',
      audience: process.env['COMPASS_JWT_AUDIENCE'] ?? 'wealthcompass-demo',
    },
    llm: resolveLlmConfig(),
    capabilitiesClaim: process.env['COMPASS_CAPABILITIES_CLAIM'] ?? 'roles',
    rateLimit: { max: Number(process.env['COMPASS_RATE_MAX'] ?? 30), windowMs: 10 * 60_000 },
  };
}
