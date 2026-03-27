'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { CheckIcon } from '@heroicons/react/24/solid';

interface User {
  _id: string;
  name: string;
  email: string;
}

interface AddParticipantDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  onAddParticipant: (user: User) => void;
  selectedUserIds: Set<string>;
  currentUserEmail?: string | null;
}

type TabType = 'friends' | 'search';
type FriendRequestStatus = 'none' | 'friend' | 'request-sent' | 'request-received';

interface FriendStatus {
  [userId: string]: FriendRequestStatus;
}

export function AddParticipantDropdown({
  isOpen,
  onClose,
  onAddParticipant,
  selectedUserIds,
  currentUserEmail,
}: AddParticipantDropdownProps) {
  const [activeTab, setActiveTab] = useState<TabType>('friends');
  const [friends, setFriends] = useState<User[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [friendStatus, setFriendStatus] = useState<FriendStatus>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendingRequest, setSendingRequest] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // ✅ Fetch friends list
  useEffect(() => {
    if (!isOpen) return;

    const fetchFriends = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/friends/list');
        const data = await res.json();
        setFriends(data.friends || []);
      } catch (error) {
        console.error('Error fetching friends:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchFriends();
  }, [isOpen]);

  // ✅ Fetch all users for search
  useEffect(() => {
    if (!isOpen) return;

    const fetchUsers = async () => {
      try {
        const res = await fetch('/api/users');
        const data = await res.json();
        setAllUsers(data || []);

        // ✅ Get status for each user
        const statusMap: FriendStatus = {};
        for (const user of data) {
          const statusRes = await fetch(
            `/api/friends/request-status?userId=${user._id}`
          );
          const statusData = await statusRes.json();
          statusMap[user._id] = statusData.status;
        }
        setFriendStatus(statusMap);
      } catch (error) {
        console.error('Error fetching users:', error);
      }
    };

    fetchUsers();
  }, [isOpen]);

  // ✅ Focus search input when tab changes
  useEffect(() => {
    if (activeTab === 'search' && isOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [activeTab, isOpen]);

  // ✅ Filter search results
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];

    return allUsers
      .filter((u) => !selectedUserIds.has(u._id))
      .filter((u) => {
        const name = (u.name ?? '').toLowerCase();
        const email = (u.email ?? '').toLowerCase();
        return name.includes(q) || email.includes(q);
      })
      .filter(
        (u) => u.email !== currentUserEmail // Exclude current user
      )
      .slice(0, 20);
  }, [allUsers, selectedUserIds, searchQuery, currentUserEmail]);

  // ✅ Filter friends (exclude already selected)
  const availableFriends = useMemo(() => {
    return friends.filter(
      (f) => !selectedUserIds.has(f._id) && f.email !== currentUserEmail
    );
  }, [friends, selectedUserIds, currentUserEmail]);

  // ✅ Send friend request
  const handleSendRequest = async (userId: string) => {
    try {
      setSendingRequest(userId);
      const res = await fetch('/api/friends/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: userId }),
      });

      if (res.ok) {
        setFriendStatus((prev) => ({
          ...prev,
          [userId]: 'request-sent',
        }));
      } else {
        const error = await res.json();
        alert(`ข้อผิดพลาด: ${error.error}`);
      }
    } catch (error) {
      console.error('Error sending friend request:', error);
      alert('ไม่สามารถส่งคำขอเพื่อนได้');
    } finally {
      setSendingRequest(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="mt-2 rounded-xl border border-gray-200 bg-white p-4">
      {/* Tabs */}
      <div className="flex gap-2 mb-3 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('friends')}
          className={`px-3 py-2 font-medium text-sm transition ${
            activeTab === 'friends'
              ? 'border-b-2 border-[#fb8c00] text-[#fb8c00]'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          เพื่อน ({availableFriends.length})
        </button>
        <button
          onClick={() => setActiveTab('search')}
          className={`px-3 py-2 font-medium text-sm transition ${
            activeTab === 'search'
              ? 'border-b-2 border-[#fb8c00] text-[#fb8c00]'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          ค้นหา
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'friends' ? (
        // Friends Tab
        <div className="space-y-1 max-h-60 overflow-y-auto">
          {loading ? (
            <div className="py-4 text-center text-gray-500 text-sm">
              กำลังโหลด...
            </div>
          ) : availableFriends.length === 0 ? (
            <div className="py-4 text-center text-gray-500 text-sm">
              {friends.length === 0
                ? 'ยังไม่มีเพื่อน'
                : 'เพื่อนทั้งหมดถูกเลือกแล้ว'}
            </div>
          ) : (
            availableFriends.map((friend) => (
              <button
                key={friend._id}
                type="button"
                onClick={() => onAddParticipant(friend)}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-orange-50 transition"
              >
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-500">
                    {friend.name?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {friend.name}
                    </p>
                    <p className="text-[11px] text-gray-400 truncate">
                      {friend.email}
                    </p>
                  </div>
                  <span className="flex-shrink-0 text-[11px] font-semibold text-[#fb8c00] bg-orange-50 px-2 py-0.5 rounded-full">
                    + เพิ่ม
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      ) : (
        // Search Tab
        <div className="space-y-2">
          <input
            ref={searchInputRef}
            type="text"
            placeholder="ค้นหาชื่อหรือ Email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#fb8c00] focus:outline-none focus:ring-1 focus:ring-[#fb8c00]"
          />

          <div className="space-y-1 max-h-60 overflow-y-auto">
            {searchQuery.trim() === '' ? (
              <div className="py-4 text-center text-gray-500 text-sm">
                พิมพ์ชื่อหรือ Email เพื่อค้นหา
              </div>
            ) : searchResults.length === 0 ? (
              <div className="py-4 text-center text-gray-500 text-sm">
                ไม่พบผู้ใช้
              </div>
            ) : (
              searchResults.map((user) => {
                const status = friendStatus[user._id] || 'none';
                return (
                  <div
                    key={user._id}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 transition"
                  >
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-500">
                      {user.name?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {user.name}
                      </p>
                      <p className="text-[11px] text-gray-400 truncate">
                        {user.email}
                      </p>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      {/* Add to bill button */}
                      <button
                        type="button"
                        onClick={() => onAddParticipant(user)}
                        title="เพิ่มเข้าบิล"
                        className="text-[11px] font-semibold text-[#fb8c00] bg-orange-50 px-2 py-0.5 rounded-full hover:bg-orange-100 transition"
                      >
                        + เพิ่ม
                      </button>

                      {/* Friend request button */}
                      {status === 'none' && (
                        <button
                          onClick={() => handleSendRequest(user._id)}
                          disabled={sendingRequest === user._id}
                          title="ส่งคำขอเพื่อน"
                          className="text-[11px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full hover:bg-gray-200 transition disabled:opacity-50"
                        >
                          ส่งคำขอ
                        </button>
                      )}

                      {status === 'request-sent' && (
                        <span className="text-[11px] text-green-600 bg-green-50 px-2 py-0.5 rounded-full flex items-center">
                          <CheckIcon className="h-3 w-3" />
                        </span>
                      )}

                      {status === 'friend' && (
                        <span className="text-[11px] text-green-600 bg-green-50 px-2 py-0.5 rounded-full flex items-center gap-0.5">
                          <CheckIcon className="h-3 w-3" /> เพื่อน
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="mt-3 pt-3 text-right border-t border-gray-200">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition"
        >
          ปิด
        </button>
      </div>
    </div>
  );
}
