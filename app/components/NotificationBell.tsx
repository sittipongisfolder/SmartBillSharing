'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { BellIcon, CheckIcon, TrashIcon } from '@heroicons/react/24/outline';

type NotificationType =
  | 'BILL_ADDED_YOU'
  | 'BILL_UPDATED'
  | 'BILL_STATUS_CHANGED'
  | 'BILL_CLOSED'
  | 'DAILY_UNPAID_SUMMARY'
  | 'GROUP_MEMBER_CHANGED'
  | 'GROUP_UPDATED'
  | 'GROUP_NEW_BILL';

type NotificationItem = {
  _id: string;
  type: NotificationType;
  title: string;
  message: string;
  href?: string;
  isRead: boolean;
  createdAt: string;
  meta?: { overdueDays?: number; unpaidCount?: number; totalOwed?: number };
};

type ListResponse =
  | { ok: true; items: NotificationItem[]; unreadCount: number }
  | { ok: false; message: string };

const timeAgo = (iso: string) => {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
};

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'unread' | 'all'>('unread');
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const boxRef = useRef<HTMLDivElement | null>(null);

  const fetchList = async (filter: 'unread' | 'all') => {
    setLoading(true);
    try {
      const res = await fetch(`/api/notifications?filter=${filter}&limit=20`);
      const data = (await res.json()) as ListResponse;
      if (data.ok) {
        setItems(data.items);
        setUnreadCount(data.unreadCount);
      }
    } finally {
      setLoading(false);
    }
  };

const filter = tab === 'all' ? 'all' : 'unread';

useEffect(() => {
  fetchList(filter);
}, [filter]);

useEffect(() => {
  if (open) fetchList(filter);
}, [open, filter]);


  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const markAllRead = async () => {
    await fetch('/api/notifications/mark-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    });
    await fetchList(tab);
  };

  const clearAll = async () => {
    await fetch('/api/notifications/clear', { method: 'POST' });
    await fetchList(tab);
  };

  const markOneRead = async (id: string) => {
    await fetch('/api/notifications/mark-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id] }),
    });
    await fetchList(tab);
  };

  const headerTitle = useMemo(() => (tab === 'unread' ? 'Unread' : 'All'), [tab]);

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative h-10 w-10 rounded-full hover:bg-gray-100 flex items-center justify-center"
        aria-label="notifications"
      >
        <BellIcon className="h-6 w-6 text-gray-700" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#fb8c00] text-white text-[11px] font-bold flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[360px] rounded-2xl border border-black/10 bg-white shadow-[0_18px_50px_rgba(0,0,0,0.12)] overflow-hidden z-50">
          {/* Top */}
          <div className="px-4 py-3 border-b border-black/5 flex items-center justify-between">
            <div className="font-semibold text-gray-900">Notifications</div>
            <div className="text-xs text-gray-500">{headerTitle}</div>
          </div>

          {/* Tabs */}
          <div className="px-3 py-2 border-b border-black/5 flex gap-2">
            <button
              type="button"
              onClick={() => setTab('unread')}
              className={[
                'px-3 py-1.5 rounded-full text-sm font-semibold',
                tab === 'unread' ? 'bg-orange-50 text-[#e65100]' : 'text-gray-600 hover:bg-gray-50',
              ].join(' ')}
            >
              Unread
            </button>
            <button
              type="button"
              onClick={() => setTab('all')}
              className={[
                'px-3 py-1.5 rounded-full text-sm font-semibold',
                tab === 'all' ? 'bg-orange-50 text-[#e65100]' : 'text-gray-600 hover:bg-gray-50',
              ].join(' ')}
            >
              All
            </button>

            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={markAllRead}
                className="h-9 px-3 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <CheckIcon className="h-4 w-4" />
                Mark as read
              </button>
              <button
                type="button"
                onClick={clearAll}
                className="h-9 px-3 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <TrashIcon className="h-4 w-4" />
                Clear all
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-[420px] overflow-y-auto">
            {loading ? (
              <div className="p-4 text-sm text-gray-500">Loading...</div>
            ) : items.length === 0 ? (
              <div className="p-6 text-center">
                <div className="text-sm font-semibold text-gray-900">No notifications</div>
                <div className="text-xs text-gray-500 mt-1">คุณไม่มีแจ้งเตือนในตอนนี้</div>
              </div>
            ) : (
              <div className="divide-y divide-black/5">
                {items.map((n) => (
                  <div key={n._id} className="p-4 hover:bg-gray-50">
                    <div className="flex items-start gap-3">
                      <span
                        className={[
                          'mt-1 h-2.5 w-2.5 rounded-full',
                          n.isRead ? 'bg-gray-300' : 'bg-[#fb8c00]',
                        ].join(' ')}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-semibold text-sm text-gray-900 truncate">{n.title}</div>
                          <div className="text-[11px] text-gray-400">{timeAgo(n.createdAt)}</div>
                        </div>

                        <div className="text-sm text-gray-600 mt-1">
                          {n.message}{' '}
                          {typeof n.meta?.overdueDays === 'number' && n.meta.overdueDays > 0 && (
                            <span className="ml-1 text-xs font-semibold text-red-500">
                              (ค้าง {n.meta.overdueDays} วัน)
                            </span>
                          )}
                        </div>

                        <div className="mt-3 flex items-center gap-2">
                          {n.href ? (
                            <Link
                              href={n.href}
                              className="text-sm font-semibold text-[#fb8c00] hover:text-[#e65100]"
                              onClick={() => setOpen(false)}
                            >
                              ไปยังบิลนี้
                            </Link>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}

                          {!n.isRead && (
                            <button
                              type="button"
                              onClick={() => markOneRead(n._id)}
                              className="ml-auto text-xs font-semibold text-gray-600 hover:text-gray-900"
                            >
                              Mark read
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer link ไปตั้งค่า */}
          <div className="px-4 py-3 border-t border-black/5 text-right">
            <Link href="/settings" className="text-sm font-semibold text-[#fb8c00] hover:text-[#e65100]">
              Notification settings
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
