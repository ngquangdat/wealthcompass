import root from '../../../package.json' with { type: 'json' };

// Một nguồn phiên bản duy nhất: trường compassVersion ở package.json gốc của repo (script đóng gói cũng đọc trường này)
export const VERSION: string = (root as { compassVersion?: string }).compassVersion ?? '0.1.0';
