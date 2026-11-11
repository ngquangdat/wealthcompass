import { createHash } from 'node:crypto';
import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ServerConfig } from './config.js';

export interface Principal {
  // Băm để log được mà không lộ định danh thật
  id: string;
  name: string;
  roles: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
  }
}

// Claim quyền có thể là mảng hoặc chuỗi cách nhau bằng dấu cách (kiểu scope của OAuth)
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string') return value.split(/[\s,]+/).filter(Boolean);
  return [];
}

export function createAuthHook(config: ServerConfig) {
  const principalOf = (payload: JWTPayload): Principal => ({
    id: createHash('sha256').update(String(payload.sub)).digest('hex').slice(0, 12),
    name: typeof payload['name'] === 'string' ? payload['name'] : '',
    roles: toStringArray(payload[config.capabilitiesClaim]),
  });

  // Chế độ gateway: API gateway phía trước đã xác minh chữ ký, issuer, audience của JWT rồi mới chuyển yêu cầu tới đây.
  // Backend chỉ đọc sub và quyền trong token, không xác minh lại. Token thiếu, hỏng hoặc đã hết hạn vẫn bị từ chối.
  // CHỈ an toàn khi backend không nhận được yêu cầu nào đi vòng qua gateway (mạng nội bộ, không mở cổng ra ngoài).
  if (config.authMode === 'gateway') {
    return async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
      const header = request.headers.authorization;
      const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
      if (!token) return void reply.code(401).send({ error: 'missing_token' });
      try {
        const payload = decodeJwt(token);
        if (!payload.sub) throw new Error('thiếu sub');
        if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) throw new Error('hết hạn');
        request.principal = principalOf(payload);
      } catch {
        return void reply.code(401).send({ error: 'invalid_token' });
      }
    };
  }

  const jwks = createRemoteJWKSet(new URL(config.jwt.jwksUrl));

  return async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return void reply.code(401).send({ error: 'missing_token' });
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer: config.jwt.issuer, audience: config.jwt.audience });
      request.principal = principalOf(payload);
    } catch {
      return void reply.code(401).send({ error: 'invalid_token' });
    }
  };
}
