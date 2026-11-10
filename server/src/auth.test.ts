import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import Fastify from 'fastify';
import { SignJWT } from 'jose';
import { createAuthHook } from './auth.js';
import { loadConfig } from './config.js';

const token = (claims: Record<string, unknown>, exp = '10m') =>
  new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setExpirationTime(exp).sign(new TextEncoder().encode('khóa-của-gateway-backend-không-biết'));

test('xác thực qua gateway: không kiểm chữ ký, đọc sub và quyền; thiếu token, token hỏng hoặc hết hạn bị từ chối', async () => {
  const config = { ...loadConfig(), authMode: 'gateway' as const, capabilitiesClaim: 'roles' };
  const app = Fastify();
  app.get('/me', { preHandler: createAuthHook(config) }, async (request) => request.principal);
  const call = (authorization?: string) => app.inject({ url: '/me', headers: authorization ? { authorization } : {} });

  const ok = await call(`Bearer ${await token({ sub: 'u-1', name: 'An', roles: ['bond_account', 'stock_account'] })}`);
  assert.equal(ok.statusCode, 200);
  assert.deepEqual([ok.json().name, ok.json().roles], ['An', ['bond_account', 'stock_account']]);
  assert.notEqual(ok.json().id, 'u-1', 'định danh được băm');

  assert.equal((await call()).json().error, 'missing_token');
  assert.equal((await call('Bearer không-phải-jwt')).json().error, 'invalid_token');
  assert.equal((await call(`Bearer ${await token({ name: 'thiếu sub' })}`)).json().error, 'invalid_token');
  assert.equal((await call(`Bearer ${await token({ sub: 'u-1' }, '-1m')}`)).json().error, 'invalid_token', 'token hết hạn');
});

test('mặc định là gateway; COMPASS_AUTH=jwks thì tự xác minh chữ ký: token ký bằng khóa lạ bị từ chối', async () => {
  assert.equal(loadConfig().authMode, process.env['COMPASS_AUTH'] === 'jwks' ? 'jwks' : 'gateway');
  const config = { ...loadConfig(), authMode: 'jwks' as const, jwt: { jwksUrl: 'http://127.0.0.1:1/jwks.json', issuer: 'x', audience: 'y' } };
  const app = Fastify();
  app.get('/me', { preHandler: createAuthHook(config) }, async (request) => request.principal);
  const res = await app.inject({ url: '/me', headers: { authorization: `Bearer ${await token({ sub: 'u-1' })}` } });
  assert.equal(res.statusCode, 401);
});
