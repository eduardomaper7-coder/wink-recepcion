import { requirePageUser } from '@/lib/auth';
import { DemoScreen } from './screen';
import { DEMO_CASES } from '@/demo/fixtures';

export const dynamic = 'force-dynamic';

export default async function DemoPage() {
  await requirePageUser();
  const cases = Object.entries(DEMO_CASES).map(([key, v]) => ({ key, label: v.label }));
  return <DemoScreen cases={cases} demoMode={process.env.DEMO_MODE === 'true'} mailbox={process.env.AGENT_MAILBOX ?? 'prueba@aibetech.es'} />;
}
