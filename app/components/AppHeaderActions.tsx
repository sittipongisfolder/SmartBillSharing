'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import UserDropdown from './UserDropdown';

export default function AppHeaderActions() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const hasGuestAccessToken = Boolean(
    searchParams.get('guestAccessToken')?.trim()
  );

  const isGuestPage =
    pathname.startsWith('/guest/access/') ||
    pathname.startsWith('/guest/bills/') ||
    pathname.startsWith('/i/') ||
    hasGuestAccessToken;

  if (isGuestPage) return null;

  return <UserDropdown />;
}