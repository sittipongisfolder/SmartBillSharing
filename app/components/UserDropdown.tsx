'use client';

import { Fragment, useEffect } from 'react';
import { Menu, Transition } from '@headlessui/react';
import {
  UserCircleIcon,
  ChevronDownIcon,
  ArrowLeftOnRectangleIcon,
  ClockIcon,
  UserIcon,
  ReceiptPercentIcon,
  LinkIcon,
} from '@heroicons/react/24/outline';
import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import NotificationBell from './NotificationBell';

const POPOVER_EVENT = 'sb:popover-open';
type PopoverOpenDetail = { id: 'notifications' | 'userMenu' | string };

function dispatchPopoverOpen(id: PopoverOpenDetail['id']) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<PopoverOpenDetail>(POPOVER_EVENT, { detail: { id } })
  );
}

type SessionUserLike = {
  name?: string | null;
  role?: string;
  bank?: string;
  bankAccountNumber?: string;
  promptPayPhone?: string;
};

function UserMenuBody({
  user,
  open,
  close,
  isAdmin,
}: {
  user: SessionUserLike;
  open: boolean;
  close: () => void;
  isAdmin: boolean;
}) {
  useEffect(() => {
    if (open) dispatchPopoverOpen('userMenu');
  }, [open]);

  useEffect(() => {
    const onOtherPopoverOpen = (e: Event) => {
      const ce = e as CustomEvent<PopoverOpenDetail>;
      const id = ce.detail?.id;
      if (id && id !== 'userMenu') close();
    };

    window.addEventListener(POPOVER_EVENT, onOtherPopoverOpen);
    return () => window.removeEventListener(POPOVER_EVENT, onOtherPopoverOpen);
  }, [close]);

  return (
    <Transition
      as={Fragment}
      enter="transition ease-out duration-100"
      enterFrom="transform opacity-0 scale-95"
      enterTo="transform opacity-100 scale-100"
      leave="transition ease-in duration-75"
      leaveFrom="transform opacity-100 scale-100"
      leaveTo="transform opacity-0 scale-95"
    >
      <Menu.Items className="absolute right-0 mt-2 w-72 origin-top-right rounded-xl bg-white shadow-xl ring-1 ring-black/10 focus:outline-none overflow-hidden text-left">
        {isAdmin ? (
          <div className="p-2">
            <Menu.Item>
              {({ active }) => (
                <button
                  onClick={() => signOut({ callbackUrl: '/login' })}
                  className={[
                    'flex w-full items-center px-4 py-3 text-sm font-medium rounded-lg transition',
                    active
                      ? 'bg-red-100 text-red-700'
                      : 'text-red-600 hover:bg-red-50',
                  ].join(' ')}
                >
                  <ArrowLeftOnRectangleIcon className="h-5 w-5 mr-3" />
                  ออกจากระบบ (Logout)
                </button>
              )}
            </Menu.Item>
          </div>
        ) : (
          <>
            <div className="p-4 bg-gray-100 border-b text-left">
              <p className="font-bold text-lg text-gray-800">{user?.name ?? ''}</p>

              <p className="text-sm text-gray-600">
                บัญชี:{' '}
                <span className="font-medium">{user?.bank ?? '-'}</span>
                <br />
                เลขบัญชี:{' '}
                <span className="font-medium">
                  {user?.bankAccountNumber ?? '-'}
                </span>
                <br />
                PromptPay:{' '}
                <span className="font-medium">
                  {user?.promptPayPhone ?? '-'}
                </span>
              </p>
            </div>

            <div className="py-1 space-y-1">
              <Menu.Item as={Fragment}>
                <Link
                  href="/dashboard"
                  className="flex items-center px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900 transition"
                >
                  <ReceiptPercentIcon className="h-5 w-5 mr-3 text-gray-500" />
                  สร้างบิล
                </Link>
              </Menu.Item>

              <Menu.Item as={Fragment}>
                <Link
                  href="/history"
                  className="flex items-center px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900 transition"
                >
                  <ClockIcon className="h-5 w-5 mr-3 text-gray-500" />
                  ดูประวัติการใช้งาน
                </Link>
              </Menu.Item>

              <Menu.Item as={Fragment}>
                <Link
                  href="/settings"
                  className="flex items-center px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900 transition"
                >
                  <UserIcon className="h-5 w-5 mr-3 text-gray-500" />
                  ศูนย์ผู้ใช้งาน &amp; การตั้งค่า{' '}
                  <span className="inline-flex items-center gap-1 text-green-600">
                    <LinkIcon className="h-4 w-4 text-green-600" />
                    LINE
                  </span>
                </Link>
              </Menu.Item>

              <Menu.Item as={Fragment}>
                <button
                  onClick={() => signOut({ callbackUrl: '/login' })}
                  className="flex w-full items-center px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-100 hover:text-red-700 transition"
                >
                  <ArrowLeftOnRectangleIcon className="h-5 w-5 mr-3" />
                  ออกจากระบบ (Logout)
                </button>
              </Menu.Item>
            </div>
          </>
        )}
      </Menu.Items>
    </Transition>
  );
}

export default function UserDropdown() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
  }, [status, router]);

  if (status === 'loading') return null;

  if (
    pathname === '/' ||
    pathname === '/login' ||
    pathname === '/register' ||
    !session?.user
  ) {
    return null;
  }

  const user = session.user as SessionUserLike;

  // ✅ ถ้า role เป็น admin หรืออยู่หน้า /admin ให้ถือว่าเป็น admin mode
  const isAdmin = user?.role === 'admin' || pathname.startsWith('/admin');

  return (
    <div className="fixed top-4 right-6 z-50 flex items-center gap-3">
      {!isAdmin && <NotificationBell />}

      <Menu as="div" className="relative inline-block text-left">
        {({ open, close }) => (
          <>
            <Menu.Button
              className="flex items-center gap-2 px-4 py-2 bg-[#fb8c00] text-white rounded-full hover:bg-[#e65100] hover:shadow-lg focus:outline-none shadow-lg transition"
              onClick={() => {
                dispatchPopoverOpen('userMenu');
              }}
            >
              <UserCircleIcon className="h-6 w-6" />
              <ChevronDownIcon className="h-4 w-4" />
            </Menu.Button>

            <UserMenuBody
              user={user}
              open={open}
              close={close}
              isAdmin={isAdmin}
            />
          </>
        )}
      </Menu>
    </div>
  );
}