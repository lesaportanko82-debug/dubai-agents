import { redirect } from 'next/navigation';
/** Negotiation packs became claims with a full lifecycle. */
export default async function PacksPage({ searchParams }: { searchParams: Promise<{ supplier?: string }> }) {
  const { supplier } = await searchParams;
  redirect(supplier ? `/owed/claims?supplier=${supplier}` : '/owed/claims');
}
