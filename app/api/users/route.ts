// app/api/users/list/route.ts
import { connectMongoDB } from '@/lib/mongodb';
import User from '@/models/user';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    await connectMongoDB(); // เชื่อมต่อ MongoDB
    const users = await User.find({}, '_id name email'); // ดึงเฉพาะ field ที่จำเป็น

    return NextResponse.json(users);
  } catch (error) {
    console.error('❌ Failed to fetch users:', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}
