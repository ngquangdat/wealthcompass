import { readFileSync, statSync } from 'node:fs';
import { featureMapSchema, type Feature, type FeatureMap, type Tour } from '@wealthcompass/contracts';
import { normalizeVi, tokenize } from '@wealthcompass/core';

interface IndexedFeature {
  feature: Feature;
  tokens: Map<string, number>; // token -> trọng số tf đã nhân hệ số trường
  phrase: string; // văn bản chuẩn hóa để thưởng khi khớp cụm
  length: number;
}

export interface SearchHit {
  id: string;
  title: string;
  route: string;
  description: string;
  menuPath: string[];
  score: number;
  tours: Array<{ id: string; title: string; steps: string[] }>;
}

export interface SearchResult {
  results: SearchHit[];
  // Tính năng khớp nhất nhưng người dùng không đủ quyền (để agent giải thích thay vì im lặng)
  restricted?: { id: string; title: string; requires: string[] };
}

export interface SearchExplain {
  terms: string[]; // từ khóa sau khi mở rộng bằng từ đồng nghĩa
  threshold: number;
  ranked: Array<{ id: string; title: string; route: string; score: number; allowed: boolean; requires: string[] }>;
}

// Dưới ngưỡng này coi như không tìm thấy
const SCORE_THRESHOLD = 1.2;

// Từ hỏi chung không mang nghĩa tìm kiếm
const STOPWORDS = new Set(
  'o dau la nhu the nao cach lam sao de toi muon co the xem khong cho minh ban oi voi va cua tai trong tren di den thi hay gi nay kia can biet tim giup duoc'.split(' '),
);

// Không dùng STOPWORDS cho "ban" vì "ban trai phieu" là cụm quan trọng; xử lý bằng cụm từ ở dưới.
STOPWORDS.delete('ban');

export class FeatureStore {
  private map!: FeatureMap;
  private docs: IndexedFeature[] = [];
  private idf = new Map<string, number>();
  private avgLength = 1;
  private mtime = 0;
  // Tour từ kho backend (TourStore): thắng tour cùng id trong Feature Map
  private overlay: () => Array<{ tour: Tour; feature?: string }> = () => [];

  constructor(private readonly file: string) {
    this.load();
  }

  // Tự nạp lại khi scanner ghi file mới, để demo không cần restart server
  private refresh(): void {
    const mtime = statSync(this.file).mtimeMs;
    if (mtime !== this.mtime) this.load();
  }

  // Nguồn tour bổ sung (kho tour của backend); gọi lại reloadTours() sau mỗi lần kho đổi
  useTours(source: () => Array<{ tour: Tour; feature?: string }>): void {
    this.overlay = source;
    this.load();
  }

  reloadTours(): void {
    this.load();
  }

  private load(): void {
    this.mtime = statSync(this.file).mtimeMs;
    this.map = withTours(featureMapSchema.parse(JSON.parse(readFileSync(this.file, 'utf8'))), this.overlay());
    this.docs = this.map.features.map((feature) => this.index(feature));
    const df = new Map<string, number>();
    for (const d of this.docs) for (const t of d.tokens.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    this.idf = new Map([...df].map(([t, n]) => [t, Math.log(1 + (this.docs.length - n + 0.5) / (n + 0.5))]));
    this.avgLength = this.docs.reduce((s, d) => s + d.length, 0) / Math.max(1, this.docs.length);
  }

  private index(feature: Feature): IndexedFeature {
    const tokens = new Map<string, number>();
    const add = (text: string, weight: number) => {
      for (const t of tokenize(text)) if (!STOPWORDS.has(t)) tokens.set(t, (tokens.get(t) ?? 0) + weight);
    };
    add(feature.title, 4);
    feature.keywords.forEach((k) => add(k, 3));
    feature.sampleQuestions.forEach((q) => add(q, 3));
    feature.menuPath.forEach((m) => add(m, 2));
    Object.values(feature.facets).forEach((v) => add(v, 1));
    add(feature.description, 1);
    const phrase = normalizeVi(
      [feature.title, ...feature.keywords, ...feature.sampleQuestions, ...feature.menuPath, feature.description].join(' | '),
    );
    return { feature, tokens, phrase, length: [...tokens.values()].reduce((a, b) => a + b, 0) };
  }

  get featureMap(): FeatureMap {
    this.refresh();
    return this.map;
  }

  getTour(id: string): Tour | undefined {
    return this.featureMap.tours.find((t) => t.id === id);
  }

  getFeature(id: string): Feature | undefined {
    return this.featureMap.features.find((f) => f.id === id);
  }

  // Từ khóa của câu hỏi (đã bỏ từ dừng). Từ đồng nghĩa khai trong `keywords` của từng màn hình.
  private expand(query: string): string[] {
    return [...new Set(tokenize(query).filter((t) => !STOPWORDS.has(t)))];
  }

  // Chấm điểm mọi màn hình cho câu hỏi (BM25 trên các trường + thưởng cụm từ liền nhau)
  private rank(query: string): { terms: string[]; scored: Array<{ d: IndexedFeature; score: number }> } {
    this.refresh();
    const terms = this.expand(query);
    const queryTokens = tokenize(query).filter((t) => !STOPWORDS.has(t) || t === 'ban');
    const k1 = 1.4;
    const b = 0.6;

    const scored = this.docs
      .map((d) => {
        let score = 0;
        for (const t of terms) {
          const tf = d.tokens.get(t);
          if (!tf) continue;
          const norm = tf * (k1 + 1) / (tf + k1 * (1 - b + (b * d.length) / this.avgLength));
          score += (this.idf.get(t) ?? 0) * norm;
        }
        // Thưởng khi các từ liền nhau của câu hỏi xuất hiện liền nhau trong tài liệu ("ban trai phieu")
        for (let i = 0; i < queryTokens.length - 1; i++) {
          if (d.phrase.includes(`${queryTokens[i]} ${queryTokens[i + 1]}`)) score += 2.5;
        }
        return { d, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b2) => b2.score - a.score);
    return { terms, scored };
  }

  search(query: string, capabilities: string[], limit = 3): SearchResult {
    const { scored } = this.rank(query);
    const allowed = (f: Feature) => f.access.requires.every((r) => capabilities.includes(r));
    const results = scored
      .filter((x) => allowed(x.d.feature))
      .slice(0, limit)
      .map(({ d, score }) => this.hit(d.feature, score));

    const topDenied = scored.find((x) => !allowed(x.d.feature));
    const restricted =
      topDenied && (!results.length || topDenied.score > results[0].score)
        ? { id: topDenied.d.feature.id, title: topDenied.d.feature.title, requires: topDenied.d.feature.access.requires }
        : undefined;

    // Điểm quá thấp thì coi như không tìm thấy để agent hỏi lại thay vì đoán
    const top = results[0]?.score ?? 0;
    return { results: top < SCORE_THRESHOLD ? [] : results, restricted };
  }

  // Cho chế độ debug và bộ kiểm thử: toàn bộ thứ hạng kèm điểm, kể cả màn hình thiếu quyền hoặc dưới ngưỡng
  explain(query: string, capabilities: string[], limit = 10): SearchExplain {
    const { terms, scored } = this.rank(query);
    return {
      terms,
      threshold: SCORE_THRESHOLD,
      ranked: scored.slice(0, limit).map(({ d, score }) => ({
        id: d.feature.id,
        title: d.feature.title,
        route: d.feature.route.pattern,
        score: Math.round(score * 100) / 100,
        allowed: d.feature.access.requires.every((r) => capabilities.includes(r)),
        requires: d.feature.access.requires,
      })),
    };
  }

  private hit(f: Feature, score: number): SearchHit {
    const tours = f.tourIds
      .map((id) => this.map.tours.find((t) => t.id === id))
      .filter((t): t is Tour => Boolean(t))
      .map((t) => ({ id: t.id, title: t.title, steps: t.steps.map((s) => s.text) }));
    return {
      id: f.id,
      title: f.title,
      route: f.route.pattern,
      description: f.description,
      menuPath: f.menuPath,
      score: Math.round(score * 100) / 100,
      tours,
    };
  }
}

// Gộp tour của kho backend vào Feature Map: thay tour cùng id, gắn tour vào tính năng sở hữu để tìm kiếm và
// kiểm quyền (offer_tour, /v1/tours/:id) dùng chung một đường như tour quét từ repo
export function withTours(map: FeatureMap, extra: Array<{ tour: Tour; feature?: string }>): FeatureMap {
  if (!extra.length) return map;
  const ids = new Set(extra.map((e) => e.tour.id));
  const owners = new Map(extra.filter((e) => e.feature).map((e) => [e.tour.id, e.feature!]));
  return {
    ...map,
    tours: [...map.tours.filter((t) => !ids.has(t.id)), ...extra.map((e) => e.tour)],
    features: map.features.map((f) => {
      // Tour trong kho có ghi tính năng: chỉ tính năng đó sở hữu; không ghi thì giữ chủ sở hữu cũ trong Feature Map
      const kept = f.tourIds.filter((id) => !owners.has(id) || owners.get(id) === f.id);
      const added = [...owners].filter(([id, owner]) => owner === f.id && !kept.includes(id)).map(([id]) => id);
      return kept.length === f.tourIds.length && !added.length ? f : { ...f, tourIds: [...kept, ...added] };
    }),
  };
}
