'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

import { isRole, setRoleCookie } from '@/lib/role';

/**
 * Role switcher (C1): visiting `/?as=customer|worker|reviewer` stores the role in
 * the `pp_role` cookie (path /, SameSite=Lax, 7 days) and then removes `as` from
 * the URL so the page behaves as the plain landing page.
 */
export function RoleSetter() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const requested = searchParams.get('as');
    if (!isRole(requested)) return;

    setRoleCookie(requested);

    const params = new URLSearchParams(searchParams.toString());
    params.delete('as');
    const query = params.toString();
    router.replace(query ? `/?${query}` : '/');
    router.refresh();
  }, [router, searchParams]);

  return null;
}
