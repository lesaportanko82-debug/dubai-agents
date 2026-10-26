import { redirect } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { panelContext } from '@/lib/domovoy-server';

export const dynamic = 'force-dynamic';

export default async function DomovoyLayout({ children }: { children: React.ReactNode }) {
  const ctx = await panelContext();
  // Supabase configured, no session → every panel page goes through the login (or the demo entrance)
  if (!ctx.authenticated) redirect('/login/domovoy');
  return <Shell product="domovoy">{children}</Shell>;
}
