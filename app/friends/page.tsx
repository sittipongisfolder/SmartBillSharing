'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import {
  UserPlusIcon,
  CheckIcon,
  XMarkIcon,
  TrashIcon,
  PaperAirplaneIcon,
} from '@heroicons/react/24/solid';

interface User {
  _id: string;
  name: string;
  email: string;
}

type TabType = 'friends' | 'requests' | 'search';

function FriendsPageInner() {
  const { data: session } = useSession();
  const [activeTab, setActiveTab] = useState<TabType>('friends');
  const [friends, setFriends] = useState<User[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<User[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<User[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // ✅ Fetch friends
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

  // ✅ Fetch requests
  const fetchRequests = async () => {
    try {
      const res = await fetch('/api/friends/requests');
      const data = await res.json();
      setIncomingRequests(data.incoming || []);
      setOutgoingRequests(data.outgoing || []);
    } catch (error) {
      console.error('Error fetching requests:', error);
    }
  };

  // ✅ Fetch all users
  const fetchAllUsers = async () => {
    try {
      const res = await fetch('/api/users');
      const data = await res.json();
      setAllUsers(data || []);
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  };

  useEffect(() => {
    if (!session?.user) return;
    fetchFriends();
    fetchRequests();
    if (activeTab === 'search') {
      fetchAllUsers();
    }
  }, [session?.user, activeTab]);

  // ✅ Send friend request
  const handleSendRequest = async (userId: string) => {
    try {
      setActionLoading(userId);
      const res = await fetch('/api/friends/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: userId }),
      });

      if (res.ok) {
        await fetchRequests();
        alert('ส่งคำขอเพื่อนสำเร็จ');
      } else {
        const error = await res.json();
        alert(`ข้อผิดพลาด: ${error.error}`);
      }
    } catch (error) {
      console.error('Error sending request:', error);
      alert('ไม่สามารถส่งคำขอได้');
    } finally {
      setActionLoading(null);
    }
  };

  // ✅ Cancel outgoing request
  const handleCancelOutgoingRequest = async (userId: string) => {
    try {
      setActionLoading(userId);
      const res = await fetch('/api/friends/request', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: userId }),
      });

      if (res.ok) {
        await fetchRequests();
        alert('ยกเลิกคำขอสำเร็จ');
      } else {
        const error = (await res.json().catch(() => null)) as { error?: string } | null;
        alert(`ข้อผิดพลาด: ${error?.error ?? 'ไม่สามารถยกเลิกคำขอได้'}`);
      }
    } catch (error) {
      console.error('Error canceling outgoing request:', error);
      alert('ไม่สามารถยกเลิกคำขอได้');
    } finally {
      setActionLoading(null);
    }
  };

  // ✅ Accept request
  const handleAccept = async (userId: string) => {
    try {
      setActionLoading(userId);
      const res = await fetch('/api/friends/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromUserId: userId }),
      });

      if (res.ok) {
        await fetchFriends();
        await fetchRequests();
        alert('ยอมรับคำขอเพื่อนสำเร็จ');
      } else {
        const error = await res.json();
        alert(`ข้อผิดพลาด: ${error.error}`);
      }
    } catch (error) {
      console.error('Error accepting request:', error);
      alert('ไม่สามารถยอมรับคำขอได้');
    } finally {
      setActionLoading(null);
    }
  };

  // ✅ Reject request
  const handleReject = async (userId: string) => {
    try {
      setActionLoading(userId);
      const res = await fetch('/api/friends/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromUserId: userId }),
      });

      if (res.ok) {
        await fetchRequests();
        alert('ปฏิเสธคำขอสำเร็จ');
      } else {
        const error = await res.json();
        alert(`ข้อผิดพลาด: ${error.error}`);
      }
    } catch (error) {
      console.error('Error rejecting request:', error);
      alert('ไม่สามารถปฏิเสธคำขอได้');
    } finally {
      setActionLoading(null);
    }
  };

  // ✅ Remove friend
  const handleRemoveFriend = async (userId: string) => {
    if (!confirm('ยืนยันการลบเพื่อน?')) return;

    try {
      setActionLoading(userId);
      const res = await fetch('/api/friends/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendUserId: userId }),
      });

      if (res.ok) {
        await fetchFriends();
        alert('ลบเพื่อนสำเร็จ');
      } else {
        const error = await res.json();
        alert(`ข้อผิดพลาด: ${error.error}`);
      }
    } catch (error) {
      console.error('Error removing friend:', error);
      alert('ไม่สามารถลบเพื่อนได้');
    } finally {
      setActionLoading(null);
    }
  };

  if (!session?.user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-600">ต้องเข้าสู่ระบบก่อน</p>
      </div>
    );
  }

  const friendIds = new Set(friends.map((f) => f._id));
  const incomingIds = new Set(incomingRequests.map((r) => r._id));
  const outgoingIds = new Set(outgoingRequests.map((r) => r._id));

  const searchResults = allUsers.filter((user) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return false;
    if (user.email === session.user?.email) return false;
    if (friendIds.has(user._id)) return false;
    if (incomingIds.has(user._id)) return false;
    if (outgoingIds.has(user._id)) return false;

    const name = (user.name ?? '').toLowerCase();
    const email = (user.email ?? '').toLowerCase();
    return name.includes(q) || email.includes(q);
  });

  return (
    <div className="min-h-screen bg-[#fbf7f1] py-8">
      <div className="max-w-2xl mx-auto px-4">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">เพื่อน</h1>
          <p className="text-gray-600 mt-2">จัดการเพื่อนและคำขอ</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-gray-200">
          {[
            { id: 'friends', label: `เพื่อน (${friends.length})` },
            {
              id: 'requests',
              label: `คำขอ (${incomingRequests.length + outgoingRequests.length})`,
            },
            { id: 'search', label: 'เพิ่มเพื่อน' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={`px-4 py-3 font-medium text-sm transition border-b-2 ${
                activeTab === tab.id
                  ? 'border-[#fb8c00] text-[#fb8c00]'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="bg-white rounded-xl shadow-sm">
          {/* Friends Tab */}
          {activeTab === 'friends' && (
            <div className="p-6">
              {loading ? (
                <div className="text-center py-8 text-gray-500">กำลังโหลด...</div>
              ) : friends.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-gray-500 mb-4">ยังไม่มีเพื่อน</p>
                  <button
                    onClick={() => setActiveTab('search')}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-[#fb8c00] text-white rounded-lg hover:bg-[#e65100]"
                  >
                    <UserPlusIcon className="h-4 w-4" />
                    ค้นหาเพื่อน
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {friends.map((friend) => (
                    <div
                      key={friend._id}
                      className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
                    >
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">{friend.name}</p>
                        <p className="text-sm text-gray-500">{friend.email}</p>
                      </div>
                      <button
                        onClick={() => handleRemoveFriend(friend._id)}
                        disabled={actionLoading === friend._id}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition disabled:opacity-50"
                        title="ลบเพื่อน"
                      >
                        <TrashIcon className="h-5 w-5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Requests Tab */}
          {activeTab === 'requests' && (
            <div className="p-6">
              {/* Incoming Requests */}
              <div className="mb-8">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  คำขอที่ได้รับ ({incomingRequests.length})
                </h3>
                {incomingRequests.length === 0 ? (
                  <p className="text-gray-500 py-4">ไม่มีคำขอใหม่</p>
                ) : (
                  <div className="space-y-3">
                    {incomingRequests.map((request) => (
                      <div
                        key={request._id}
                        className="flex items-center justify-between p-4 border border-gray-200 rounded-lg"
                      >
                        <div className="flex-1">
                          <p className="font-medium text-gray-900">
                            {request.name}
                          </p>
                          <p className="text-sm text-gray-500">
                            {request.email}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleAccept(request._id)}
                            disabled={actionLoading === request._id}
                            className="p-2 bg-green-100 text-green-700 hover:bg-green-200 rounded-lg transition disabled:opacity-50"
                            title="ยอมรับ"
                          >
                            <CheckIcon className="h-5 w-5" />
                          </button>
                          <button
                            onClick={() => handleReject(request._id)}
                            disabled={actionLoading === request._id}
                            className="p-2 bg-red-100 text-red-700 hover:bg-red-200 rounded-lg transition disabled:opacity-50"
                            title="ปฏิเสธ"
                          >
                            <XMarkIcon className="h-5 w-5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Outgoing Requests */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  คำขอที่ส่งไป ({outgoingRequests.length})
                </h3>
                {outgoingRequests.length === 0 ? (
                  <p className="text-gray-500 py-4">ไม่มีคำขอที่รอการตอบ</p>
                ) : (
                  <div className="space-y-3">
                    {outgoingRequests.map((request) => (
                      <div
                        key={request._id}
                        className="flex items-center justify-between p-4 border border-gray-200 rounded-lg"
                      >
                        <div className="flex-1">
                          <p className="font-medium text-gray-900">
                            {request.name}
                          </p>
                          <p className="text-sm text-gray-500">
                            {request.email}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-lg text-sm text-gray-600">
                            <PaperAirplaneIcon className="h-4 w-4" />
                            รอการตอบ
                          </div>
                          <button
                            onClick={() => handleCancelOutgoingRequest(request._id)}
                            disabled={actionLoading === request._id}
                            className="inline-flex items-center gap-1 px-3 py-2 bg-red-100 text-red-700 hover:bg-red-200 rounded-lg text-sm transition disabled:opacity-50"
                            title="ยกเลิกคำขอ"
                          >
                            <XMarkIcon className="h-4 w-4" />
                            ยกเลิกคำขอ
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Search Tab */}
          {activeTab === 'search' && (
            <div className="p-6">
              <div className="mb-6">
                <input
                  type="text"
                  placeholder="ค้นหาชื่อหรือ Email..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full px-4 py-3 border text-black border-gray-300 rounded-lg focus:border-[#fb8c00] focus:outline-none focus:ring-1 focus:ring-[#fb8c00]"
                />
              </div>

              {searchQuery.trim() === '' ? (
                <div className="text-center py-12 text-gray-500">
                  พิมพ์ชื่อหรือ Email เพื่อค้นหา
                </div>
              ) : searchResults.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  ไม่พบผู้ใช้
                </div>
              ) : (
                <div className="space-y-3">
                  {searchResults.map((user) => (
                    <div
                      key={user._id}
                      className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
                    >
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">{user.name}</p>
                        <p className="text-sm text-gray-500">{user.email}</p>
                      </div>
                      <button
                        onClick={() => handleSendRequest(user._id)}
                        disabled={actionLoading === user._id}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-[#fb8c00] text-white rounded-lg hover:bg-[#e65100] transition disabled:opacity-50"
                      >
                        <UserPlusIcon className="h-4 w-4" />
                        ส่งคำขอ
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function FriendsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <FriendsPageInner />
    </Suspense>
  );
}
