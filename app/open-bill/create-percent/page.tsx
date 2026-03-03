'use client';

import { useSearchParams } from 'next/navigation';
import {  Suspense, useEffect, useState } from 'react';
import { ArrowLeftIcon } from '@heroicons/react/24/solid';

interface User {
  _id: string;
  name: string;
  email: string;
}

interface Item {
  name: string;
  price: number;
}

interface Participant {
  userId: string;
  name: string;
  percent?: number; // เปอร์เซ็นต์ที่จะแบ่งค่าใช้จ่าย
  items: Item[];
  amount: number;
}

function CreatePercentPageInner() {
  const searchParams = useSearchParams();
  const splitType = searchParams.get('type');
  const [title, setTitle] = useState('');
  const [totalPrice, setTotalPrice] = useState(0);
  const [users, setUsers] = useState<User[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([{ userId: '', name: '', items: [], amount: 0 }]);

  // โหลดรายชื่อผู้ใช้จาก DB
  useEffect(() => {
    async function fetchUsers() {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/users', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      setUsers(data);
    }
    fetchUsers();
  }, []);

  const handleAddParticipant = () => {
    setParticipants([...participants, { userId: '', name: '', items: [], amount: 0 }]);
  };

  const handleSubmit = async () => {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/bills', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        title,
        totalPrice,
        splitType,
        participants
      })
    });

    const data = await res.json();
    if (res.ok) {
      alert('สร้างบิลสำเร็จ!');
    } else {
      alert(`เกิดข้อผิดพลาด: ${data.error || 'Unknown error'}`);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-6">
      <h1 className="text-3xl font-bold mb-6">สร้างบิล ({splitType})</h1>
      <input
        type="text"
        placeholder="ชื่อบิล"
        className="border p-2 w-100 mb-4"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <input
        type="number"
        placeholder="ราคารวม"
        className="border p-2 w-100 mb-4"
        value={totalPrice}
        onChange={(e) => setTotalPrice(Number(e.target.value))}
      />

      {participants.map((participant, index) => (
        <div key={index} className="flex gap-2 mb-2 items-center">
          {/* dropdown เลือก user */}
          <select
            className="border p-2 flex-1 text-white bg-gray-900"
            value={participant.userId}
            onChange={(e) =>
              setParticipants(
                participants.map((p, i) =>
                  i === index ? { ...p, userId: e.target.value, name: users.find(u => u._id === e.target.value)?.name || '' } : p
                )
              )
            }
          >
            <option value="">-- เลือกผู้ใช้ --</option>
            {users.map((user) => (
              <option key={user._id} value={user._id}>
                {user.name} ({user.email})
              </option>
            ))}
          </select>

          {/* input จำนวนเงิน */}
          <input
            type="number"
            placeholder="จำนวนเงิน"
            className="border p-2 w-32"
            value={participant.amount}
            onChange={(e) =>
              setParticipants(
                participants.map((p, i) =>
                  i === index ? { ...p, amount: Number(e.target.value) } : p
                )
              )
            }
          />
        </div>
      ))}

      <button
        onClick={handleAddParticipant}
        className="w-50 max-w-md p-4 bg-blue-500 text-black rounded-lg mb-4"
      >
        ➕ เพิ่มผู้เข้าร่วม
      </button>

      <button
        onClick={handleSubmit}
        className="w-50 max-w-md p-4 bg-green-600 text-black rounded-lg"
      >
        ✅ สร้างบิล
      </button>
       <button
        onClick={() => window.history.back()}
        className="fixed top-4 left-4 flex items-center gap-2 p-2 bg-gray-500 text-white rounded-lg shadow-lg z-50 hover:bg-gray-600"
      >
        <ArrowLeftIcon className="h-5 w-5" />
        <span>ย้อนกลับ</span>
      </button>

    </div>
  );
}
export default function CreatePercentPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#fbf7f1]" />}>
      <CreatePercentPageInner />
    </Suspense>
  );
}