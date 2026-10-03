import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SignJWT, exportJWK, generateKeyPair, importJWK, type JWK, type CryptoKey, type KeyObject } from 'jose';
import type { FastifyInstance } from 'fastify';
import type { ServerConfig } from './config.js';

// IdP giả lập: đóng vai hệ thống đăng nhập của khách để demo luồng JWT + JWKS.
// Web thật không dùng file này; backend chỉ cần JWKS URL của hệ thống đăng nhập sẵn có.
const USERS: Record<string, { password: string; name: string; roles: string[] }> = {
  demo: { password: 'demo123', name: 'Nguyễn Văn A', roles: ['stock_account', 'bond_account', 'fund_account'] },
  // Tài khoản không có quyền trái phiếu, để thử nhánh thiếu quyền
  nobond: { password: 'demo123', name: 'Trần Thị B', roles: ['stock_account'] },
  // Cho web mẫu HR (examples/hr-portal)
  hr: { password: 'demo123', name: 'Phạm Minh E', roles: ['employee', 'manager', 'payroll_viewer'] },
};

// Giữ cặp khóa demo trong .wealthcompass/ (đã gitignore) để khởi động lại server không làm mọi phiên đăng nhập hết hiệu lực.
// Chỉ dùng cho IdP giả lập; web thật dùng khóa của hệ thống đăng nhập thật.
async function loadOrCreateKeys(dir: string): Promise<{ publicKey: CryptoKey | KeyObject; privateKey: CryptoKey | KeyObject }> {
  const file = join(dir, 'demo-idp-key.json');
  if (existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { publicJwk: JWK; privateJwk: JWK };
    return { publicKey: (await importJWK(saved.publicJwk, 'RS256')) as CryptoKey, privateKey: (await importJWK(saved.privateJwk, 'RS256')) as CryptoKey };
  }
  const pair = await generateKeyPair('RS256', { extractable: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify({ publicJwk: await exportJWK(pair.publicKey), privateJwk: await exportJWK(pair.privateKey) }), { mode: 0o600 });
  return pair;
}

export async function registerMockIdp(app: FastifyInstance, config: ServerConfig): Promise<void> {
  const { publicKey, privateKey } = await loadOrCreateKeys(config.dataDir);
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'demo-key-1', alg: 'RS256', use: 'sig' };

  app.get('/idp/jwks.json', async () => ({ keys: [jwk] }));

  app.post('/idp/login', async (request, reply) => {
    const body = request.body as { username?: string; password?: string } | undefined;
    const user = body?.username ? USERS[body.username] : undefined;
    if (!user || user.password !== body?.password) return reply.code(401).send({ error: 'invalid_credentials' });

    const token = await new SignJWT({ name: user.name, roles: user.roles })
      .setProtectedHeader({ alg: 'RS256', kid: 'demo-key-1' })
      .setSubject(`user-${body.username}`)
      .setIssuer(config.jwt.issuer)
      .setAudience(config.jwt.audience)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
    return { access_token: token, token_type: 'Bearer', expires_in: 3600 };
  });
}
