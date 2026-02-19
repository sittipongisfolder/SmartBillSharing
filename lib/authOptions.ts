import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { connectMongoDB } from '@/lib/mongodb';
import User from '@/models/user';
import bcrypt from 'bcryptjs';
// import { NextResponse } from 'next/server';

// 👤 Extended user interface
interface ExtendedUser {
  id: string;
  _id: string;
  name: string;
  email: string;
  role: string;
  bank: string; 
  bankAccountNumber?: string;
  promptPayPhone?: string;
}

interface ExtendedToken {
  id?: string;
  _id?: string;
  name?: string;
  email?: string;
  role?: string;
  bank?: string;
  bankAccountNumber?: string;
  promptPayPhone?: string;
  [key: string]: unknown;
}

export const authOptions: NextAuthOptions = {
  
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        username: { label: 'Email', type: 'text' }, // ใช้ email เป็น username
        password: { label: 'Password', type: 'password' },
      },
      authorize: async (credentials): Promise<ExtendedUser | null> => {
        if (!credentials) return null;
        const { username, password } = credentials;

        try {
          await connectMongoDB();
          
          // ค้นหาผู้ใช้จาก email ในฐานข้อมูล
          const user = await User.findOne({ email: username });

          if (!user) return null;
          // ตรวจสอบรหัสผ่าน
          const isMatch = await bcrypt.compare(password, user.password);
          if (!isMatch) return null;

          // ส่งข้อมูลผู้ใช้ที่ตรวจสอบแล้ว
          return {
            id: user._id.toString(),
            _id: user._id.toString(),
            name: user.name,
            email: user.email,
            role: user.role || 'user', // ให้ default เป็น 'user'
            bank: user.bank,
            bankAccountNumber: user.bankAccountNumber,
            promptPayPhone: user.promptPayPhone,
          };
        } catch (err) {
          console.error('❌ Auth error:', err);
          return null;
        }
      },
    }),
  ],
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET,
  pages: { signIn: '/login' },
  callbacks: {
    async jwt({ token, user }) {
      const customToken = token as ExtendedToken;

      if (user) {
        const u = user as ExtendedUser;
        customToken.id = u.id;
        customToken._id = u._id;
        customToken.name = u.name;
        customToken.email = u.email;
        customToken.role = u.role;
        customToken.bank = u.bank;
        customToken.bankAccountNumber = u.bankAccountNumber;
        customToken.promptPayPhone = u.promptPayPhone;
      }

      return customToken;
    },
    async session({ session, token }) {
      const customToken = token as ExtendedToken;

      if (session.user) {
        session.user.id = customToken.id!;
        session.user._id = customToken._id!;
        session.user.name = customToken.name!;
        session.user.email = customToken.email!;
        session.user.role = customToken.role!;
        session.user.bank = customToken.bank!;
        session.user.bankAccountNumber = customToken.bankAccountNumber!;
        session.user.promptPayPhone = customToken.promptPayPhone!;
      }

      return session;
    },
  },
};
