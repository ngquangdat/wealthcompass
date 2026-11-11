import type { Layout, Locator, RecordedTour, ToursFile, TourStep } from '@wealthcompass/contracts';
import { layoutOfSteps } from '../record/write';

// Mảng bước của tour ứng với bố cục, cùng quy tắc với widget (stepsForLayout): bản riêng nếu có, không thì bản chính
export function stepsOf(tour: RecordedTour, layout?: Layout): TourStep[] {
  return (layout && tour.variants?.[layout]) || tour.steps;
}

function locate(data: ToursFile, id: string, key: string, layout?: Layout): { tour: RecordedTour; steps: TourStep[]; index: number } {
  const tour = data.tours[id];
  if (!tour) throw new Error(`Không có tour "${id}" trong compass.tours.json`);
  const steps = stepsOf(tour, layout);
  const index = steps.findIndex((s) => s.key === key);
  if (index === -1) throw new Error(`Tour "${id}"${layout ? ` (${layout})` : ''} không có bước "${key}"`);
  return { tour, steps, index };
}

export interface HealInput {
  id: string;
  key: string;
  layout?: Layout;
  proposed: Locator;
  changed: string[];
  // Phần tử nhạy cảm: chỉ đề xuất, người duyệt chấp nhận trong Studio
  needsReview: boolean;
  today: string;
}

// Sửa locator của một bước: bước thường thì áp luôn (ghi healedAt), bước nhạy cảm thì lưu thành đề xuất.
// Bước có tourId mà ghim không còn tìm thấy: bỏ tourId để locator (đã tìm chắc) làm nguồn chính.
export function applyHealing(data: ToursFile, input: HealInput): 'applied' | 'proposed' {
  const { steps, index } = locate(data, input.id, input.key, input.layout);
  const step = steps[index];
  if (input.needsReview) {
    steps[index] = { ...step, proposal: { locator: input.proposed, changed: input.changed, at: input.today } };
    return 'proposed';
  }
  const { proposal: _p, ...rest } = step;
  const dropPin = input.changed.includes('tourId');
  const { tourId: _t, ...unpinned } = rest;
  steps[index] = { ...(dropPin ? unpinned : rest), locator: input.proposed, healedAt: input.today };
  return 'applied';
}

// Đổi thiết bị của một bản tour (ghi trên desktop nhưng thật ra dành cho iPad...). Bố cục đích đã có bản thì hai bản
// đổi chỗ cho nhau. Bản chính vẫn là mảng `steps` cũ, chỉ đổi nhãn; locator của các bước được gắn bố cục mới.
export function relabelLayout(tour: RecordedTour, from: Layout, to: Layout): RecordedTour {
  const main = mainLayout(tour);
  const versions = new Map<Layout, TourStep[]>([[main, tour.steps]]);
  for (const [l, steps] of Object.entries(tour.variants ?? {}) as Array<[Layout, TourStep[] | undefined]>) if (steps && l !== main) versions.set(l, steps);
  const moving = versions.get(from);
  if (!moving) throw new Error(`Tour không có bản ${from}`);
  if (from === to) return tour;
  const other = versions.get(to);
  const relabel = (steps: TourStep[], layout: Layout) => steps.map((s) => (s.locator ? { ...s, locator: { ...s.locator, layout } } : s));
  versions.delete(from);
  versions.delete(to);
  versions.set(to, relabel(moving, to));
  if (other) versions.set(from, relabel(other, from));
  const newMain = from === main ? to : other && to === main ? from : main;
  const { variants: _v, ...rest } = tour;
  const variants = Object.fromEntries([...versions].filter(([l]) => l !== newMain));
  return { ...rest, layout: newMain, steps: versions.get(newMain)!, ...(Object.keys(variants).length ? { variants } : {}) };
}

// Người duyệt chấp nhận/bỏ đề xuất sửa locator (Studio)
export function resolveProposal(data: ToursFile, id: string, key: string, layout: Layout | undefined, approve: boolean, today: string): void {
  const { steps, index } = locate(data, id, key, layout);
  const { proposal, ...rest } = steps[index];
  if (!proposal) throw new Error(`Bước "${key}" không có đề xuất nào`);
  if (!approve) {
    steps[index] = rest;
    return;
  }
  const { tourId: _t, ...unpinned } = rest;
  steps[index] = { ...(proposal.changed.includes('tourId') ? unpinned : rest), locator: proposal.locator, healedAt: today };
}

// Ghi lại riêng một bước (Studio/CLI tour:rerecord): thay phần tử, giữ chữ và khóa của bước
export function replaceStep(
  data: ToursFile,
  input: { id: string; key: string; layout?: Layout; tourId: string | null; locator?: Locator | null; userOnly: boolean; route?: string; today: string },
): TourStep {
  const { steps, index } = locate(data, input.id, input.key, input.layout);
  const old = steps[index];
  if (!input.tourId && !input.locator) throw new Error('Lần bấm không ghi được phần tử (không có tourId hay manh mối nào)');
  const { proposal: _p, tourId: _t, locator: _l, ...rest } = old;
  const next: TourStep = {
    ...rest,
    ...(input.tourId ? { tourId: input.tourId } : {}),
    ...(input.locator ? { locator: input.locator } : {}),
    ...(input.route ? { route: input.route } : {}),
    // Phần tử mới nhạy cảm: chỉ tô sáng, không chờ người dùng bấm
    advanceOn: input.userOnly ? 'next' : old.advanceOn,
    healedAt: input.today,
  };
  steps[index] = next;
  return next;
}

// Bố cục của mảng bước chính của tour (để biết `steps` là bản desktop hay mobile)
export function mainLayout(tour: RecordedTour): Layout {
  return tour.layout ?? layoutOfSteps(tour.steps) ?? 'desktop';
}
