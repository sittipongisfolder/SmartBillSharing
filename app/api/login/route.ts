// import { NextRequest, NextResponse } from 'next/server';
// import { connectMongoDB } from '@/lib/mongodb';
// import User from '@/models/user';
// import bcrypt from 'bcryptjs';
// import jwt from 'jsonwebtoken';

// export async function POST(req: NextRequest) {
//   try {
//     const { email, password } = await req.json();
//     await connectMongoDB();

//     // ค้นหาผู้ใช้ในฐานข้อมูล
//     const user = await User.findOne({ email });
    // if (!user) {
    //   return NextResponse.json({ error: 'User not found' }, { status: 404 });
    // }

//     // เปรียบเทียบรหัสผ่านที่ผู้ใช้กรอกกับข้อมูลที่ hash ไว้
//     const isMatch = await bcrypt.compare(password, user.password);
    // if (!isMatch) {
    //   return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
    // }

//     // สร้าง JWT token
//     const token = jwt.sign(
//       { _id: user._id, email: user.email },
//       process.env.JWT_SECRET_KEY as string,
//       { expiresIn: '1h' }
//     );

//     return NextResponse.json({
//       message: 'Login successful',
//       user: { _id: user._id, name: user.name, email: user.email },
//       token: token
//     });

//   } catch (error) {
//     console.error('❌ Error occurred:', error);
//     return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
//   }
// }
