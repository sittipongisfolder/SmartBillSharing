import { NextRequest, NextResponse } from 'next/server';
import { getServerSession, DefaultUser } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import Bill from '@/models/bill';
import { connectMongoDB } from '@/lib/mongodb';
import { notifyBillAddedYou } from '@/lib/notify';



type ParticipantPaymentStatus = 'unpaid' | 'paid';
type BillStatus = 'unpaid' | 'pending' | 'paid';
type SplitType = 'equal' | 'percentage' | 'personal';

interface SessionUserWithId extends DefaultUser {
  id: string;
}

interface CreateBillBody {
  title: string;
  items: Array<{ items: string; price: number | string }>;
  totalPrice?: number | string;
  splitType: SplitType;
  participants: Array<{
    userId: string;
    name: string;
    amount: number | string;
    // ไม่รับ pending แล้ว แต่เผื่อ body เก่า เราไม่สนใจค่านี้อยู่ดี
    paymentStatus?: ParticipantPaymentStatus | 'pending';
  }>;
  description?: string;
}

// ✅ แปลงข้อมูลเก่า: pending -> paid (กันพังถ้ามี record เก่า)
function normalizeParticipantStatus(v: unknown): ParticipantPaymentStatus {
  if (v === 'paid' || v === 'pending') return 'paid';
  return 'unpaid';
}

// ✅ helper: แปลง id ให้เป็น string แบบปลอดภัย (รองรับ populate)
function toIdString(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') return v;

  if (typeof v === 'object' && v !== null) {
    if ('_id' in v) {
      const idVal = (v as { _id?: unknown })._id;
      if (idVal) return String(idVal);
    }
    if ('toString' in v && typeof (v as { toString?: unknown }).toString === 'function') {
      return (v as { toString(): string }).toString();
    }
  }

  return '';
}

// ✅ Hybrid: คิด billStatus จาก “ลูกบิล” เท่านั้น (ไม่นับ createdBy)
// ✅ FIX: ข้าม userId ว่าง/undefined และรองรับ populate object
function computeBillStatusHybrid(
  participants: Array<{ userId?: unknown; paymentStatus?: unknown }>,
  createdById: string
): BillStatus {
  const others = participants.filter((p) => {
    const pid = toIdString(p.userId);
    if (!pid) return false; // ✅ ข้ามแถวที่ userId ว่าง
    return pid !== String(createdById);
  });

  // ถ้ามีแต่หัวบิลคนเดียว → ปิดบิลได้เลย
  if (others.length === 0) return 'paid';

  const statuses = others.map((p) => normalizeParticipantStatus(p.paymentStatus));

  if (statuses.every((s) => s === 'paid')) return 'paid';
  if (statuses.some((s) => s === 'paid')) return 'pending';
  return 'unpaid';
}

function getCreatedById(createdBy: unknown): string {
  return toIdString(createdBy);
}

export async function GET() {
  try {
    await connectMongoDB();

    const bills = await Bill.find()
      .populate('createdBy', 'name email')
      .populate('participants.userId', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    // ✅ กันเอกสารเก่าไม่มี billStatus
    const mapped = bills.map((b) => {
      const bill = b as unknown as {
        billStatus?: BillStatus;
        participants?: Array<{ userId?: unknown; paymentStatus?: unknown }>;
        createdBy?: unknown;
      };

      const createdById = getCreatedById(bill.createdBy);
      const fallbackStatus = computeBillStatusHybrid(bill.participants ?? [], createdById);

      return {
        ...b,
        billStatus: bill.billStatus ?? fallbackStatus,
      };
    });

    return NextResponse.json({ bills: mapped }, { status: 200 });
  } catch (error) {
    console.error('❌ Error fetching bills:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = session.user as SessionUserWithId;
    const userId = user.id;
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized: User ID missing' }, { status: 401 });
    }

    const body = (await req.json()) as CreateBillBody;
    const { title, items, totalPrice, splitType, participants, description } = body;

    await connectMongoDB();

    const cleanedTitle = (title || '').trim();
    if (!cleanedTitle) return NextResponse.json({ error: 'title is required' }, { status: 400 });
    if (!splitType) return NextResponse.json({ error: 'splitType is required' }, { status: 400 });

    const cleanedItems = (Array.isArray(items) ? items : [])
      .map((it) => ({ items: (it.items || '').trim(), price: Number(it.price) || 0 }))
      .filter((it) => it.items.length > 0 && it.price > 0);

    if (cleanedItems.length === 0) {
      return NextResponse.json(
        { error: 'items must have at least 1 row (items+price)' },
        { status: 400 }
      );
    }

    // ✅ เคส A: บังคับหัวบิลเป็น paid, คนอื่นเป็น unpaid
    const cleanedParticipants = (Array.isArray(participants) ? participants : [])
      .filter((p) => p.userId && p.name)
      .map((p) => {
        const isOwner = String(p.userId) === String(userId);
        return {
          userId: p.userId,
          name: p.name,
          amount: Number(p.amount) || 0,
          paymentStatus: (isOwner ? 'paid' : 'unpaid') as ParticipantPaymentStatus,
        };
      });

    if (cleanedParticipants.length === 0) {
      return NextResponse.json({ error: 'participants is required' }, { status: 400 });
    }

    const itemsTotal = cleanedItems.reduce((sum, it) => sum + it.price, 0);
    const finalTotal = Number(totalPrice) && Number(totalPrice) > 0 ? Number(totalPrice) : itemsTotal;

    // ✅ billStatus แบบ Hybrid (ไม่นับหัวบิล)
    const billStatus = computeBillStatusHybrid(cleanedParticipants, userId);

    const newBill = await Bill.create({
      title: cleanedTitle,
      items: cleanedItems,
      totalPrice: finalTotal,
      splitType,
      participants: cleanedParticipants,
      description: description || '',
      createdBy: userId,
      createdAt: new Date(),
      billStatus,
    });
    
     try {
      await notifyBillAddedYou({ billId: newBill._id, actorUserId: userId });
    } catch (err) {
      console.error('⚠️ notifyBillAddedYou failed:', err);
    }

    return NextResponse.json({ message: 'Bill created successfully', bill: newBill }, { status: 201 });
    
  } catch (error) {
    console.error('❌ Error creating bill:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
