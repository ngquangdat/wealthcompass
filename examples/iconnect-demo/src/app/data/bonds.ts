// Dữ liệu mô phỏng cho bảng giá iConnect (không phải dữ liệu thật)
export interface BondQuote {
  code: string;
  issuer: string;
  tenor: string;
  size: string;
  buyYield?: string;
  buyValue?: string;
  sellYield?: string;
  sellValue?: string;
  // BÁN: có lệnh mua của bên mua mà người dùng đang nắm trái phiếu; XEM: chỉ xem
  buyAction: 'sell' | 'view';
  sellAction: 'buy-all' | 'buy-pro';
}

export const BOND_QUOTES: BondQuote[] = [
  { code: 'NVLB2123012', issuer: 'NOVALAND', tenor: '21.6 tháng', size: '0.009 tỷ', buyYield: '41.00%', buyValue: '0.00 tỷ', sellYield: '38.31%', sellValue: '0.01 tỷ', buyAction: 'sell', sellAction: 'buy-all' },
  { code: 'TRM12503', issuer: 'BĐS TRƯỜNG MINH', tenor: '24.4 tháng', size: '0.532 tỷ', sellYield: '12.19%', sellValue: '0.53 tỷ', buyAction: 'view', sellAction: 'buy-pro' },
  { code: 'VHM12607', issuer: 'VINHOMES', tenor: '34.6 tháng', size: '0.102 tỷ', buyYield: '12.48%', buyValue: '0.61 tỷ', sellYield: '12.01%', sellValue: '0.10 tỷ', buyAction: 'view', sellAction: 'buy-pro' },
  { code: 'VHM12605', issuer: 'VINHOMES', tenor: '31.8 tháng', size: '0.511 tỷ', sellYield: '12.00%', sellValue: '0.51 tỷ', buyAction: 'view', sellAction: 'buy-pro' },
  { code: 'VIF12501', issuer: 'VINFAST', tenor: '19.9 tháng', size: '1.016 tỷ', buyYield: '12.30%', buyValue: '0.51 tỷ', sellYield: '11.91%', sellValue: '1.02 tỷ', buyAction: 'view', sellAction: 'buy-pro' },
  { code: 'VIC12502', issuer: 'VINGROUP', tenor: '20.3 tháng', size: '1.695 tỷ', buyYield: '12.30%', buyValue: '1.49 tỷ', sellYield: '11.85%', sellValue: '1.70 tỷ', buyAction: 'view', sellAction: 'buy-pro' },
  { code: 'VHMB2427009', issuer: 'VINHOMES', tenor: '14.5 tháng', size: '4.823 tỷ', buyYield: '11.88%', buyValue: '0.40 tỷ', sellYield: '11.65%', sellValue: '4.82 tỷ', buyAction: 'view', sellAction: 'buy-pro' },
  { code: 'VHM12503', issuer: 'VINHOMES', tenor: '27.0 tháng', size: '0.105 tỷ', buyYield: '12.50%', buyValue: '1.04 tỷ', sellYield: '11.61%', sellValue: '0.11 tỷ', buyAction: 'view', sellAction: 'buy-pro' },
];

export interface BondHolding {
  code: string;
  issuer: string;
  maturity: string;
  quantity: number;
  principalMillion: number;
}

export const BOND_HOLDINGS: BondHolding[] = [
  { code: 'NVLB2123012', issuer: 'NOVALAND', maturity: '20/07/28', quantity: 10, principalMillion: 1.1 },
  { code: 'VHM12605', issuer: 'VINHOMES', maturity: '15/03/28', quantity: 5, principalMillion: 0.5 },
];
