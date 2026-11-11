import { z } from 'zod';
import { redactPii, routeMatches } from '@wealthcompass/core';
import { completeText, type LlmConfig } from '@wealthcompass/llm';
import type { FeatureMap } from '@wealthcompass/contracts';
import type { RecordedStep } from './recorder';

export interface TourDraft {
  title: string;
  description: string;
  steps: Array<{ text: string }>;
  sampleQuestions: string[];
  // llm: LLM soạn; template: dựng bằng mẫu khi không có LLM hoặc LLM lỗi
  source: 'llm' | 'template';
  note?: string;
}

export interface DraftInput {
  id: string;
  title?: string;
  // Các bước đã lọc: mỗi bước có tourId hoặc locator dùng được
  steps: RecordedStep[];
  featureMap: FeatureMap | null;
  featureId?: string;
  // Người ghi mô tả đang ghi tour cho tính năng gì
  purpose?: string;
  llm: LlmConfig | null;
}

const draftSchema = z.object({
  title: z.string().min(3),
  description: z.string().default(''),
  steps: z.array(z.object({ text: z.string().min(3) })),
  sampleQuestions: z.array(z.string()).default([]),
});

interface StepContext {
  index: number;
  // tourId nếu phần tử có gắn, nếu không thì khóa bước (s1, s2...)
  key: string;
  label: string | null;
  hint: string | null;
  screen: string | null;
  advanceOn: 'click' | 'next' | 'hover';
  sensitive: boolean;
}

// Ngữ cảnh gửi LLM: ưu tiên nhãn/mô tả tĩnh lấy từ template (do dev viết), KHÔNG dùng chữ hiển thị trên trang
// vì nó có thể chứa số dư hay tên khách. Chữ trên trang chỉ dùng khi template chưa có nhãn, và đã qua lọc PII.
function stepContexts(input: DraftInput): StepContext[] {
  const targets = new Map<string, { label?: string; hint?: string }>();
  const features = input.featureMap?.features ?? [];
  for (const f of features) {
    for (const t of f.targets) if (!targets.has(t.tourId)) targets.set(t.tourId, { label: t.label, hint: t.hint });
  }
  return input.steps.map((s, index) => {
    const meta = s.tourId ? targets.get(s.tourId) : undefined;
    // Tên truy cập trong locator đã lọc PII lúc ghi; chữ thô trên trang là phương án cuối
    const fallback = s.locator?.name ?? s.locator?.text ?? (s.text ? redactPii(s.text).text : null);
    return {
      index: index + 1,
      key: s.tourId ?? `s${index + 1}`,
      label: meta?.label ?? fallback,
      hint: meta?.hint ?? null,
      screen: features.find((f) => routeMatches(f.route.pattern, s.route))?.title ?? null,
      advanceOn: s.advanceOn,
      sensitive: s.userOnly,
    };
  });
}

function cleanPurpose(input: DraftInput): string {
  return redactPii((input.purpose ?? '').replace(/\s+/g, ' ').trim()).text.slice(0, 600);
}

function templateDraft(input: DraftInput, ctx: StepContext[], note?: string): TourDraft {
  const purpose = cleanPurpose(input);
  return {
    // Không có LLM: dùng chính lời người ghi làm tiêu đề/mô tả còn hơn để trống
    title: input.title ?? (purpose ? purpose.slice(0, 70) : input.id),
    description: purpose,
    steps: ctx.map((c) => ({
      text: c.advanceOn === 'hover' ? `Di chuột vào **${c.label ?? c.key}** để mở menu.` : c.advanceOn === 'click' ? `Bấm **${c.label ?? c.key}**.` : `Đây là **${c.label ?? c.key}**. Bạn tự thao tác và xác nhận ở bước này.`,
    })),
    sampleQuestions: [],
    source: 'template',
    note,
  };
}

const SYSTEM = `Bạn soạn nội dung tour hướng dẫn cho một web giao dịch chứng khoán, bằng tiếng Việt.
Đầu vào là các bước người vận hành vừa thao tác thật, theo thứ tự. Hãy trả về JSON đúng dạng:
{"title": string, "description": string, "steps": [{"text": string}], "sampleQuestions": [string]}

Trường "operatorDescription" là lời mô tả của CHÍNH người đang ghi tour về tính năng họ muốn hướng dẫn: đây là nguồn đáng tin nhất. "title", "description" và "sampleQuestions" phải bám sát nó. Nếu nó mâu thuẫn với nhãn kỹ thuật hay mô tả màn hình đích thì theo operatorDescription. Nếu nó rỗng (null) thì suy từ các bước, và tránh khẳng định những gì đầu vào không nói.

Quy tắc:
- "steps" có ĐÚNG số phần tử bằng số bước đầu vào, cùng thứ tự. Mỗi "text" 1-2 câu, xưng "bạn", in đậm tên nút/tab bằng **...** (dùng đúng nhãn đầu vào).
- Bước advanceOn="hover": bảo người dùng DI CHUỘT vào phần tử đó để mở menu (không bấm).
- Bước advanceOn="click": nói rõ bấm vào đâu và (nếu biết) để làm gì. Bước advanceOn="next" hoặc sensitive=true: chỉ giải thích phần tử đó và nhắc người dùng TỰ nhập, TỰ xác nhận; tuyệt đối không bảo hệ thống hay trợ lý làm hộ.
- "title": ngắn, dạng việc cần làm ("Bán trái phiếu trên iConnect"). "description": một câu nêu tour dẫn tới đâu.
- "sampleQuestions": 4-6 câu hỏi người dùng thật sự sẽ gõ để tìm chức năng này; thêm 1-2 câu viết không dấu, ngắn; không câu nào xin tư vấn đầu tư.
- Chỉ dùng thông tin trong đầu vào; không bịa tên nút hay menu. Không nhắc tên kỹ thuật như key, tourId hay đường dẫn.`;

function parseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  return JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned);
}

export async function draftTour(input: DraftInput): Promise<TourDraft> {
  const ctx = stepContexts(input);
  if (!input.llm) return templateDraft(input, ctx, 'Đã tắt LLM (--no-llm), dùng mẫu.');
  if (!input.llm.apiKey) return templateDraft(input, ctx, 'Không tìm thấy khóa LLM, dùng mẫu.');

  const feature = input.featureMap?.features.find((f) => f.id === input.featureId);
  const user = JSON.stringify({
    tourId: input.id,
    operatorDescription: cleanPurpose(input) || null,
    requestedTitle: input.title ?? null,
    destination: feature ? { title: feature.title, description: feature.description, menuPath: feature.menuPath } : null,
    steps: ctx,
  });

  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await completeText(input.llm, {
        jsonMode: true,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: user },
        ],
      });
      const parsed = draftSchema.parse(parseJson(raw));
      if (parsed.steps.length !== ctx.length) throw new Error(`LLM trả ${parsed.steps.length} bước, cần ${ctx.length}`);
      return {
        title: input.title ?? parsed.title,
        description: parsed.description,
        steps: parsed.steps,
        sampleQuestions: [...new Set(parsed.sampleQuestions.map((q) => q.trim()).filter(Boolean))],
        source: 'llm',
      };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  return templateDraft(input, ctx, `LLM lỗi (${lastError}), dùng mẫu.`);
}
