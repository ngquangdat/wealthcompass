import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import type { FastifyInstance } from 'fastify';
import type { ServerConfig } from './config.js';

// IdP giả lập: đóng vai hệ thống đăng nhập của khách để demo luồng JWT + JWKS.
// Web thật không dùng file này; backend chỉ cần JWKS URL của hệ thống đăng nhập sẵn có.
const USERS: Record<string, { password: string; name: string; roles: string[] }> = {
  demo: { password: 'demo123', name: 'Nguyễn Văn A', roles: ['stock_account', 'bond_account', 'fund_account'] },
  // Tài khoản không có quyền trái phiếu, để thử nhánh thiếu quyền
  nobond: { password: 'demo123', name: 'Trần Thị B', roles: ['stock_account'] },
};

export async function registerMockIdp(app: FastifyInstance, config: ServerConfig): Promise<void> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
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
