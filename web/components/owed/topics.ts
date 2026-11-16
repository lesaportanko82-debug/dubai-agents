import type { ClauseTopic } from '@core/owed/types';

export const TOPIC: Record<ClauseTopic, { ru: string; en: string; unit: { ru: string; en: string } }> = {
  warranty_months: { ru: 'Гарантия', en: 'Warranty', unit: { ru: ' мес.', en: ' months' } },
  defect_allowance_pct: { ru: 'Допустимый брак', en: 'Defect allowance', unit: { ru: '%', en: '%' } },
  compensation_basis: { ru: 'Что компенсируется', en: 'Compensation basis', unit: { ru: '', en: '' } },
  evidence_standard: { ru: 'Достаточные доказательства', en: 'Evidence standard', unit: { ru: '', en: '' } },
  delivery_grace_days: { ru: 'Допуск опоздания', en: 'Delivery grace', unit: { ru: ' дн.', en: ' days' } },
  delivery_penalty_pct_day: { ru: 'Штраф за день опоздания', en: 'Penalty per day late', unit: { ru: '% от поставки', en: '% of shipment' } },
  delivery_penalty_cap_pct: { ru: 'Потолок штрафа', en: 'Penalty cap', unit: { ru: '% от поставки', en: '% of shipment' } },
  claim_response_days: { ru: 'Срок ответа на претензию', en: 'Claim reply term', unit: { ru: ' дн.', en: ' days' } },
};
