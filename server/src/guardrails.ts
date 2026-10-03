import { normalizeVi } from '@wealthcompass/core';
import type { DomainPack } from './pack.js';

export interface InputVerdict {
  blocked: boolean;
  topic?: string;
  message?: string;
}

// Chặn câu hỏi tư vấn/dự đoán/nhờ làm hộ TRƯỚC khi gọi LLM: rẻ, nhanh và không phụ thuộc vào việc
// mô hình có nghe lời prompt hay không. Mẫu nằm trong Domain Pack nên do pháp chế duyệt, không nằm trong code.
export function classifyInput(message: string, pack: DomainPack): InputVerdict {
  const text = normalizeVi(message);
  for (const topic of pack.topics) {
    if (topic.patterns.some((p) => p.test(text))) {
      return { blocked: true, topic: topic.id, message: pack.refusals[topic.refusal] ?? 'Mình không hỗ trợ nội dung này.' };
    }
  }
  return { blocked: false };
}
