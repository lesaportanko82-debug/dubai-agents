import type { Batch, Supplier } from '../types';

/** Factory warranty runs from shipment date. */
export function withinFactoryWarranty(batch: Batch, supplier: Supplier, receivedAtIso: string): boolean {
  const shipped = new Date(batch.shippedAt + 'T00:00:00Z');
  const end = new Date(shipped);
  end.setUTCMonth(end.getUTCMonth() + supplier.warrantyMonths);
  return new Date(receivedAtIso) <= end;
}
