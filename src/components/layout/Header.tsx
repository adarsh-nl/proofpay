import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ROLE_LABELS, type Role } from '@/lib/role';

export function Header({ role }: { role: Role }) {
  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md font-semibold tracking-tight focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
          aria-label="ProofPay home"
        >
          <span
            aria-hidden="true"
            className="grid size-7 place-items-center rounded-md bg-emerald-600 text-xs font-bold text-white"
          >
            PP
          </span>
          <span>ProofPay</span>
        </Link>

        <nav
          aria-label="Main"
          className="order-3 flex w-full items-center gap-1 text-sm sm:order-none sm:ml-4 sm:w-auto"
        >
          <Button asChild variant="ghost" size="sm">
            <Link href="/customer/new">New job</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/reviewer">Reviewer</Link>
          </Button>
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:ml-0">
          <Badge
            variant="secondary"
            data-testid="current-role"
            aria-label={`Current role: ${ROLE_LABELS[role]}`}
          >
            {ROLE_LABELS[role]}
          </Badge>
          <Badge
            variant="outline"
            data-testid="sandbox-badge"
            className="border-blue-300 bg-blue-50 text-blue-700"
          >
            PayPal Sandbox
          </Badge>
        </div>
      </div>
    </header>
  );
}
