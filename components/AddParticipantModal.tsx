'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { XMarkIcon, UserPlusIcon, CheckIcon, PaperAirplaneIcon } from '@heroicons/react/24/solid';

interface User {
  _id: string;
  name: string;
  email: string;
}

interface AddParticipantModalProps {
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

export function AddParticipantModal({
  isOpen,
  onClose,
  onAddParticipant,
  selectedUserIds,
  currentUserEmail,
}: AddParticipantModalProps) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-bold text-gray-900">เพิ่มผู้เข้าร่วมบิล</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 hover:bg-gray-100"
          >
            <XMarkIcon className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setActiveTab('friends')}
            className={`flex-1 px-4 py-3 font-medium text-sm transition ${
              activeTab === 'friends'
                ? 'border-b-2 border-[#fb8c00] text-[#fb8c00]'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            เพื่อน ({availableFriends.length})
          </button>
          <button
            onClick={() => setActiveTab('search')}
            className={`flex-1 px-4 py-3 font-medium text-sm transition ${
              activeTab === 'search'
                ? 'border-b-2 border-[#fb8c00] text-[#fb8c00]'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            ค้นหาสมาชิกทั้งหมด
          </button>
        </div>

        {/* Content */}
        <div className="max-h-96 overflow-y-auto p-4">
          {activeTab === 'friends' ? (
            // Friends Tab
            <div className="space-y-2">
              {loading ? (
                <div className="py-8 text-center text-gray-500">
                  กำลังโหลด...
                </div>
              ) : availableFriends.length === 0 ? (
                <div className="py-8 text-center text-gray-500">
                  {friends.length === 0
                    ? 'ยังไม่มีเพื่อน'
                    : 'เพื่อนทั้งหมดถูกเลือกแล้ว'}
                </div>
              ) : (
                availableFriends.map((friend) => (
                  <div
                    key={friend._id}
                    className="flex items-center justify-between rounded-lg border border-gray-200 p-3 transition hover:bg-gray-50"
                  >
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">
                        {friend.name}
                      </p>
                      <p className="text-xs text-gray-500">{friend.email}</p>
                    </div>
                    <button
                      onClick={() => onAddParticipant(friend)}
                      className="rounded-lg bg-[#fb8c00] px-3 py-2 text-sm font-medium text-white transition hover:bg-[#e65100]"
                    >
                      <UserPlusIcon className="h-4 w-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : (
            // Search Tab
            <div className="space-y-3">
              <input
                ref={searchInputRef}
                type="text"
                placeholder="ค้นหาชื่อหรือ Email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-[#fb8c00] focus:outline-none focus:ring-1 focus:ring-[#fb8c00]"
              />

              <div className="space-y-2">
                {searchQuery.trim() === '' ? (
                  <div className="py-8 text-center text-gray-500">
                    พิมพ์ชื่อหรือ Email เพื่อค้นหา
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="py-8 text-center text-gray-500">
                    ไม่พบผู้ใช้
                  </div>
                ) : (
                  searchResults.map((user) => {
                    const status = friendStatus[user._id] || 'none';
                    return (
                      <div
                        key={user._id}
                        className="flex items-center justify-between rounded-lg border border-gray-200 p-3 transition hover:bg-gray-50"
                      >
                        <div className="flex-1">
                          <p className="font-medium text-gray-900">
                            {user.name}
                          </p>
                          <p className="text-xs text-gray-500">{user.email}</p>
                        </div>
                        <div className="flex gap-2">
                          {/* Add to bill button */}
                          <button
                            onClick={() => onAddParticipant(user)}
                            title="เพิ่มเข้าบิล"
                            className="rounded-lg bg-blue-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-600 disabled:opacity-50"
                          >
                            <UserPlusIcon className="h-4 w-4" />
                          </button>

                          {/* Friend request button */}
                          {status === 'none' && (
                            <button
                              onClick={() => handleSendRequest(user._id)}
                              disabled={sendingRequest === user._id}
                              title="ส่งคำขอเพื่อน"
                              className="rounded-lg bg-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-300 disabled:opacity-50"
                            >
                              <PaperAirplaneIcon className="h-4 w-4" />
                            </button>
                          )}

                          {status === 'request-sent' && (
                            <button
                              disabled
                              title="ส่งคำขอแล้ว"
                              className="rounded-lg bg-green-100 px-3 py-2 text-sm font-medium text-green-700"
                            >
                              <CheckIcon className="h-4 w-4" />
                            </button>
                          )}

                          {status === 'friend' && (
                            <button
                              disabled
                              title="เป็นเพื่อนแล้ว"
                              className="rounded-lg bg-green-500 px-3 py-2 text-sm font-medium text-white"
                            >
                              <CheckIcon className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-6 py-3 text-right">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            ปิด
          </button>
        </div>
      </div>
    </div>
  );
}
