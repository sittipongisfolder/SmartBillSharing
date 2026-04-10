'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BellIcon, CheckIcon, TrashIcon } from '@heroicons/react/24/outline';

type NotificationType =
  | 'BILL_ADDED_YOU'
  | 'BILL_UPDATED'
  | 'BILL_STATUS_CHANGED'
  | 'BILL_CLOSED'
  | 'DAILY_UNPAID_SUMMARY'
  | 'GROUP_MEMBER_CHANGED'
  | 'GROUP_UPDATED'
  | 'FRIEND_REQUEST';

type NotificationItem = {
  _id: string;
  type: NotificationType;
  title: string;
  message: string;
  href?: string;
  isRead: boolean;
  createdAt: string;
  fromUserId?: string;
  friendRequestStatus?: 'pending' | 'accepted' | 'rejected';
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

// ✅ กัน popover ซ้อนกัน (event bus)
const POPOVER_EVENT = 'sb:popover-open';
type PopoverOpenDetail = { id: 'notifications' | 'userMenu' | string };

function dispatchPopoverOpen(id: PopoverOpenDetail['id']) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<PopoverOpenDetail>(POPOVER_EVENT, { detail: { id } }));
}

export default function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'unread' | 'all'>('unread');
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const boxRef = useRef<HTMLDivElement | null>(null);

  const fetchList = useCallback(async (filter: 'unread' | 'all') => {
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
  }, []);

  const filter = tab === 'all' ? 'all' : 'unread';

  useEffect(() => {
    void fetchList(filter);
  }, [fetchList, filter]);

  useEffect(() => {
    if (open) void fetchList(filter);
  }, [open, fetchList, filter]);

  // ✅ ถ้า popover อื่นเปิด (เช่น userMenu) ให้ปิดกระดิ่งทันที
  useEffect(() => {
    const onOtherPopoverOpen = (e: Event) => {
      const ce = e as CustomEvent<PopoverOpenDetail>;
      const id = ce.detail?.id;
      if (id && id !== 'notifications') setOpen(false);
    };

    window.addEventListener(POPOVER_EVENT, onOtherPopoverOpen);
    return () => window.removeEventListener(POPOVER_EVENT, onOtherPopoverOpen);
  }, []);

  // ✅ คลิกนอกกล่อง = ปิด
  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const markAllRead = async () => {
    try {
      await fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
    } finally {
      await fetchList(tab);
    }
  };

  const clearAll = async () => {
    try {
      await fetch('/api/notifications/clear', { method: 'POST' });
    } finally {
      await fetchList(tab);
    }
  };

  const markOneRead = async (id: string) => {
    await fetch('/api/notifications/mark-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id] }),
    });
    await fetchList(tab);
  };

  // ✅ ยอมรับคำขอเพื่อน
  const handleAcceptFriendRequest = async (notificationId: string, fromUserId?: string) => {
    try {
      setProcessingId(notificationId);
      const res = await fetch('/api/friends/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromUserId, notificationId }),
      });
      if (res.ok) {
        await fetchList(tab);
        alert('ยอมรับคำขอเพื่อนสำเร็จ');
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        alert(data?.error ?? 'ไม่สามารถยอมรับคำขอได้');
      }
    } catch (error) {
      console.error('Error accepting friend request:', error);
      alert('ไม่สามารถยอมรับคำขอได้');
    } finally {
      setProcessingId(null);
    }
  };

  // ✅ ปฏิเสธคำขอเพื่อน
  const handleRejectFriendRequest = async (notificationId: string, fromUserId?: string) => {
    try {
      setProcessingId(notificationId);
      const res = await fetch('/api/friends/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromUserId, notificationId }),
      });
      if (res.ok) {
        await fetchList(tab);
        alert('ปฏิเสธคำขอสำเร็จ');
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        alert(data?.error ?? 'ไม่สามารถปฏิเสธคำขอได้');
      }
    } catch (error) {
      console.error('Error rejecting friend request:', error);
      alert('ไม่สามารถปฏิเสธคำขอได้');
    } finally {
      setProcessingId(null);
    }
  };

  const headerTitle = useMemo(() => (tab === 'unread' ? 'Unread' : 'All'), [tab]);

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() =>
          setOpen((v) => {
            const next = !v;
            if (next) dispatchPopoverOpen('notifications'); // ✅ เปิดกระดิ่ง -> ปิดอันอื่น
            return next;
          })
        }
        className="relative h-10 w-10 rounded-full hover:bg-gray-100 flex items-center justify-center"
        aria-label="notifications"
      >
        <BellIcon className="h-6 w-6 text-gray-700" />
        {unreadCount > 0 && (
         <span className="absolute top-0 right-0 sm:-top-0.5 sm:-right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#fb8c00] text-white text-[11px] font-bold flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-x-2 top-16 sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 mt-0 sm:mt-2 w-auto sm:w-[360px] rounded-2xl border border-black/10 bg-white shadow-[0_18px_50px_rgba(0,0,0,0.12)] overflow-hidden z-50">
          <div className="px-4 py-3 border-b border-black/5 flex items-center justify-between">
            <div className="font-semibold text-gray-900">แจ้งเตือน</div>
            <div className="text-xs text-gray-500">{headerTitle}</div>
          </div>

          <div className="px-3 py-2 border-b border-black/5 flex gap-2">
            <button
              type="button"
              onClick={() => setTab('unread')}
              className={[
                'px-3 py-1.5 rounded-full text-sm font-semibold',
                tab === 'unread' ? 'bg-orange-50 text-[#e65100]' : 'text-gray-600 hover:bg-gray-50',
              ].join(' ')}
            >
              ยังไม่อ่าน
            </button>
            <button
              type="button"
              onClick={() => setTab('all')}
              className={[
                'px-3 py-1.5 rounded-full text-sm font-semibold',
                tab === 'all' ? 'bg-orange-50 text-[#e65100]' : 'text-gray-600 hover:bg-gray-50',
              ].join(' ')}
            >
              ทั้งหมด
            </button>

            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={markAllRead}
                className="pointer-events-auto h-9 px-3 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <CheckIcon className="h-4 w-4" />
                อ่านแล้ว
              </button>
              <button
                type="button"
                onClick={clearAll}
                className="pointer-events-auto h-9 px-3 rounded-xl text-sm font-semibold text-gray-700 hover:bg-red-500 flex items-center gap-2"
              >
                <TrashIcon className="h-4 w-4" />
                ลบทั้งหมด
              </button>
            </div>
          </div>

          <div className="max-h-[60vh] sm:max-h-[420px] overflow-y-auto">
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
                          {n.type === 'FRIEND_REQUEST' ? (
                            n.friendRequestStatus === 'pending' ? (
                              // แสดงปุ่มยอมรับ/ปฏิเสธสำหรับคำขอเพื่อน
                              <>
                                <button
                                  onClick={() => handleAcceptFriendRequest(n._id, n.fromUserId)}
                                  disabled={processingId === n._id}
                                  className="text-sm font-semibold text-green-600 hover:text-green-700 disabled:opacity-50"
                                >
                                  ยอมรับ
                                </button>
                                <button
                                  onClick={() => handleRejectFriendRequest(n._id, n.fromUserId)}
                                  disabled={processingId === n._id}
                                  className="text-sm font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
                                >
                                  ปฏิเสธ
                                </button>
                              </>
                            ) : (
                              <span
                                className={[
                                  'text-sm font-semibold',
                                  n.friendRequestStatus === 'accepted' ? 'text-green-600' : 'text-gray-500',
                                ].join(' ')}
                              >
                                {n.friendRequestStatus === 'accepted' ? 'เป็นเพื่อนกันแล้ว' : 'คุณปฏิเสธคำขอแล้ว'}
                              </span>
                            )
                          ) : n.href ? (
                            <button
                              type="button"
                              className="text-sm font-semibold text-[#fb8c00] hover:text-[#e65100]"
                              onClick={() => { setOpen(false); router.push(n.href!); }}
                            >
                              ไปยังบิลนี้
                            </button>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}

                          {!n.isRead && (
                            <button
                              type="button"
                              onClick={() => markOneRead(n._id)}
                              className="ml-auto text-xs font-semibold text-gray-600 hover:text-gray-900"
                            >
                              ทำเครื่องหมายว่าอ่านแล้ว
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

          <div className="px-4 py-3 border-t border-black/5 text-right">
            <Link   href="/settings?tab=notifications" className="text-sm font-semibold text-[#fb8c00] hover:text-[#e65100]">
              กำหนดค่าแจ้งเตือน
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}