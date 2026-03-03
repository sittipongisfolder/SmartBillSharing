'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useEffect, useState, useRef } from 'react';
import { CheckCircleIcon } from '@heroicons/react/24/solid';
import { useSession } from 'next-auth/react';

interface User {
  _id: string;
  name: string;
  email: string;
}

interface Participant {
  userId: string;
  name: string;
  amount: number;
}

type SplitType = 'equal' | 'percentage' | 'personal';

function CreateBillPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const splitTypeRaw = searchParams.get('type');
  const splitType = (splitTypeRaw as SplitType) || 'equal'; // กัน null ให้ตรง schema

  const [title, setTitle] = useState('');
  const [totalPrice, setTotalPrice] = useState<number | ''>('');
  const [users, setUsers] = useState<User[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([
    { userId: '', name: '', amount: 0 },
  ]);
  const [sharePerPerson, setSharePerPerson] = useState(0);
  const [description, setDescription] = useState('');

  const { data: session } = useSession();
  const currentUserEmail = session?.user?.email;

  const [uploading, setUploading] = useState(false);
  const [itemList, setItemList] = useState<{ items: string; price: string }[]>([
    { items: '', price: '' },
  ]);

  // คง UI upload แต่ไม่ทำ OCR
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string>('');

  function getMeByEmail(usersList: User[], email?: string | null): User | undefined {
    if (!email) return undefined;
    return usersList.find((u) => u.email === email);
  }

  useEffect(() => {
    async function fetchUsers() {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/users', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const data = await res.json();
      setUsers(data);
    }
    fetchUsers();
  }, []);

  useEffect(() => {
    const me = getMeByEmail(users, currentUserEmail ?? null);
    if (!me) return;

    setParticipants((prev) => {
      if (prev.length > 0 && prev[0].userId === me._id) return prev;

      const headAmount = prev[0]?.amount ?? 0;
      const tail = prev.slice(1).filter((p) => p.userId !== me._id);

      if (prev.length === 0) return [{ userId: me._id, name: me.name, amount: 0 }];

      return [{ userId: me._id, name: me.name, amount: headAmount }, ...tail];
    });
  }, [users, currentUserEmail]);

  const handleReceiptChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFileName(file.name);

    setUploading(true);
    console.log('Uploading file...');
  };

  // ✅ resetForm อยู่ “นอก handleSubmit” และมีหน้าที่แค่รีเซ็ต state
  const resetForm = () => {
    setTitle('');
    setDescription('');
    setItemList([{ items: '', price: '' }]);

    setParticipants(() => {
      const me = getMeByEmail(users, currentUserEmail ?? null);
      return me
        ? [{ userId: me._id, name: me.name, amount: 0 }]
        : [{ userId: '', name: '', amount: 0 }];
    });

    setSelectedFileName('');
    setTotalPrice('');
    setSharePerPerson(0);
    setUploading(false);

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleAddParticipant = () => {
    setParticipants((prev) => [...prev, { userId: '', name: '', amount: 0 }]);
  };

  const handleAddItems = () => {
    setItemList((prev) => [...prev, { items: '', price: '' }]);
  };

  const handleInputChange = (index: number, field: 'items' | 'price', value: string) => {
    const updatedItemList = [...itemList];
    updatedItemList[index] = { ...updatedItemList[index], [field]: value };

    const totalAmount = updatedItemList.reduce(
      (total, item) => total + (parseFloat(item.price) || 0),
      0
    );

    setItemList(updatedItemList);
    setTotalPrice(totalAmount);
  };

  // หารเท่ากัน
  useEffect(() => {
    if (typeof totalPrice === 'number' && totalPrice > 0 && participants.length > 0) {
      const share = totalPrice / participants.length;
      setSharePerPerson(share);
      setParticipants((prev) => prev.map((p) => ({ ...p, amount: share })));
    } else {
      setSharePerPerson(0);
      setParticipants((prev) => prev.map((p) => ({ ...p, amount: 0 })));
    }
  }, [totalPrice, participants.length]);

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '') setTotalPrice('');
    else setTotalPrice(Number(value));
  };

  const handleSubmit = async () => {
    const token = localStorage.getItem('token');

    const cleanedItems = itemList
      .map((it) => ({
        items: (it.items || '').trim(),
        price: parseFloat(it.price) || 0,
      }))
      .filter((it) => it.items.length > 0 && it.price > 0);

    const cleanedParticipants = participants
      .filter((p) => p.userId && p.name)
      .map((p) => ({
        userId: p.userId,
        name: p.name,
        amount: Number(p.amount) || 0,
      }));

    if (!title.trim()) return alert('กรุณากรอก Bill Title');
    if (cleanedItems.length === 0)
      return alert('กรุณาเพิ่มรายการอาหารอย่างน้อย 1 รายการ (ชื่อ + ราคา)');
    if (cleanedParticipants.length === 0)
      return alert('กรุณาเลือก Participants อย่างน้อย 1 คน');

    const normalizedTotalPrice = cleanedItems.reduce((total, item) => total + item.price, 0);

    const res = await fetch('/api/bills', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        title,
        totalPrice: normalizedTotalPrice,
        splitType,
        participants: cleanedParticipants,
        description,
        items: cleanedItems,
      }),
    });

    const data = await res.json();

    if (res.ok) {
      alert('สร้างบิลสำเร็จ!');
      resetForm();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      router.refresh();
    } else {
      alert(`สร้างบิลไม่สำเร็จ: ${data.error || 'Unknown error'}`);
    }
  };

  return (
    <div className="min-h-screen bg-[#fbf7f1] text-[#111827]">
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b border-black/5">
        <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#fb8c00]/10 text-[#fb8c00]">
              <span className="text-lg">🍊</span>
            </span>
            <span className="font-semibold">Smart Bill Sharing System</span>
          </div>
        </div>
      </header>

      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[radial-gradient(circle_at_top_right,#fff5e6_0%,#ffffff_40%,#fff0e0_100%)]">
        <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl p-8 relative">
          <h1 className="text-3xl font-bold mb-4 text-center text-[#4a4a4a] ">
            Add New Bill <span className="text-sm font-normal text-gray-500">({splitType})</span>
          </h1>

          <div className="border-dashed border-2 border-gray-300 rounded-xl p-8 text-center mb-6">
            <p className="text-lg text-[#4a4a4a] mb-2">Upload a receipt or drag and drop</p>
            <p className="text-xs text-gray-400 mb-2">PNG, JPG up to 10MB</p>

            {selectedFileName ? (
              <p className="text-xs text-gray-500 mb-4">
                Selected: <span className="font-medium">{selectedFileName}</span>
              </p>
            ) : (
              <div className="mb-4" />
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleReceiptChange}
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="bg-[#fb8c00] text-white py-3 px-6 rounded-lg hover:bg-[#e65100] transition duration-300"
              disabled={uploading}
            >
              {uploading ? 'Processing...' : 'Upload Image'}
            </button>

            <p className="text-xs text-gray-400 mt-3">* OCR ปิดชั่วคราว (ยังไม่ประมวลผลรูป)</p>
          </div>

          <div className="flex items-center justify-center mb-6">
            <hr className="w-1/3 border-[#e0e0e0]" />
            <span className="mx-2 text-[#4a4a4a] text-sm">OR</span>
            <hr className="w-1/3 border-[#e0e0e0]" />
          </div>

          {/* Bill Title */}
          <div className="mb-4">
            <label className="block mb-1 text-sm text-gray-600">Bill Title</label>
            <input
              type="text"
              className="w-full p-3 border text-gray-800 placeholder:text-gray-400 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fb8c00]"
              placeholder="e.g., Friday Team Lunch"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Items */}
          <div className="mb-4">
            <button
              onClick={handleAddItems}
              className="mt-3 text-sm text-[#fb8c00] font-medium hover:text-[#e65100]"
              type="button"
            >
              ➕ เพิ่มรายการอาหาร
            </button>

            {itemList.map((item, index) => (
              <div key={index} className="flex gap-4 mb-4">
                <div className="flex-1">
                  <label className="block mb-1 text-sm text-gray-600">Items</label>
                  <input
                    type="text"
                    className="w-full p-3 border text-gray-800 placeholder:text-gray-400 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fb8c00]"
                    placeholder="e.g., Fried rice"
                    value={item.items}
                    onChange={(e) => handleInputChange(index, 'items', e.target.value)}
                  />
                </div>

                <div className="flex-1">
                  <label className="block mb-1 text-sm text-gray-600">Price</label>
                  <input
                    type="text"
                    className="w-full p-3 border text-gray-800 placeholder:text-gray-400 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fb8c00]"
                    placeholder="e.g., 100"
                    value={item.price}
                    onChange={(e) => handleInputChange(index, 'price', e.target.value)}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Participants */}
          <div className="mb-6">
            <label className="block mb-1 text-sm text-gray-600">Participants</label>

            <div className="space-y-3">
              {participants.map((participant, index) => (
                <div key={index} className="flex gap-2 items-center">
                  <select
                    className="flex-1 p-3 border border-gray-300 rounded-lg bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#fb8c00]"
                    value={participant.userId}
                    disabled={index === 0}
                    onChange={(e) =>
                      setParticipants(
                        participants.map((p, i) =>
                          i === index
                            ? {
                                ...p,
                                userId: e.target.value,
                                name: users.find((u) => u._id === e.target.value)?.name || '',
                              }
                            : p
                        )
                      )
                    }
                  >
                    <option value="">-- เลือกผู้ใช้ --</option>

                    {users
                      .filter(
                        (u) =>
                          !participants.some(
                            (p) => p.userId === u._id && p.userId !== participant.userId
                          )
                      )
                      .map((u) => (
                        <option key={u._id} value={u._id}>
                          {u.name}
                          {u.email === currentUserEmail ? ' (You)' : ''}
                        </option>
                      ))}
                  </select>

                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => {
                      if (index === 0) return;
                      if (participants.length > 1) {
                        setParticipants((prev) => prev.filter((_, i) => i !== index));
                      } else {
                        alert('ต้องมีผู้เข้าร่วมอย่างน้อย 1 คน');
                      }
                    }}
                    className={`px-5 py-2 rounded-lg transition-all duration-200 shadow-sm ${
                      index === 0
                        ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        : 'bg-red-500 text-white hover:bg-red-600 hover:scale-105'
                    }`}
                  >
                    🗑
                  </button>
                </div>
              ))}
            </div>

            <button
              onClick={handleAddParticipant}
              className="mt-3 text-sm text-[#fb8c00] font-medium hover:text-[#e65100]"
              type="button"
            >
              ➕ เพิ่มผู้เข้าร่วม
            </button>
          </div>

          {/* Total Amount */}
          <div className="mb-6">
            <label className="block mb-1 text-sm text-gray-600">Total Amount</label>
            <input
              type="number"
              className="w-full p-3 border text-gray-800 placeholder:text-gray-400 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fb8c00]"
              placeholder="1000"
              value={totalPrice}
              onChange={handleAmountChange}
            />
          </div>

          {/* Description */}
          <div className="mb-6">
            <label className="block mb-1 text-sm text-gray-600">Description</label>
            <textarea
              className="w-full p-3 border text-gray-800 placeholder:text-gray-400 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fb8c00]"
              placeholder="....."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Share */}
          <div className="mb-6 text-center">
            <p className="text-lg text-[#4a4a4a]">Share per person</p>
            <p className="text-2xl font-semibold text-[#fb8c00]">
              {sharePerPerson.toFixed(2)} ฿
            </p>
            <p className="text-sm text-[#4a4a4a]">Based on {participants.length} participants</p>
          </div>

          <div className="flex items-center justify-center mt-4">
            <button
              onClick={handleSubmit}
              className="w-70 inline-flex items-center justify-center gap-2 px-3 py-3 bg-[#fb8c00] text-white font-semibold rounded-full shadow-md hover:bg-[#e65100] hover:shadow-lg transition-all duration-300"
              type="button"
            >
              <CheckCircleIcon className="w-5 h-5 text-white" />
              <span>Confirm and Save Bill</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ✅ สำคัญ: default export ต้องครอบ Suspense และเรียก CreateBillPageInner จริง
export default function CreateBillPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#fbf7f1]" />}>
      <CreateBillPageInner />
    </Suspense>
  );
}