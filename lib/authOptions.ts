import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { connectMongoDB } from "@/lib/mongodb";
import User from "@/models/user";

type UserRole = "user" | "admin";

interface ExtendedUser {
  id: string;
  _id: string;
  name: string;
  email: string;
  role: UserRole;
  bank?: string;
  bankAccountNumber?: string;
  promptPayPhone?: string;
}

interface ExtendedToken {
  id?: string;
  _id?: string;
  name?: string;
  email?: string;
  role?: UserRole;
  bank?: string;
  bankAccountNumber?: string;
  promptPayPhone?: string;
  [key: string]: unknown;
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        username: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials): Promise<ExtendedUser | null> => {
        if (!credentials) return null;

        const { username, password } = credentials;

        try {
          await connectMongoDB();

          const user = await User.findOne({ email: username });
          if (!user) return null;

          const isMatch = await bcrypt.compare(password, user.password);
          if (!isMatch) return null;

          const role: UserRole = user.role === "admin" ? "admin" : "user";

          return {
            id: user._id.toString(),
            _id: user._id.toString(),
            name: user.name,
            email: user.email,
            role,
            bank: user.bank,
            bankAccountNumber: user.bankAccountNumber,
            promptPayPhone: user.promptPayPhone,
          };
        } catch (err) {
          console.error("❌ Auth error:", err);
          return null;
        }
      },
    }),
  ],

  session: {
    strategy: "jwt",
    maxAge: 1 * 60 , // 1 นาที
  },
  jwt: {
    maxAge: 1 * 60, // 1 นาที
  },
  secret: process.env.NEXTAUTH_SECRET,
  pages: { signIn: "/login" },

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
        session.user.id = String(customToken.id ?? "");
        session.user._id = customToken._id
          ? String(customToken._id)
          : undefined;
        session.user.name =
          session.user.name ??
          (customToken.name ? String(customToken.name) : undefined);
        session.user.email =
          session.user.email ??
          (customToken.email ? String(customToken.email) : undefined);

        session.user.role = customToken.role === "admin" ? "admin" : "user";
        session.user.bank = customToken.bank;
        session.user.bankAccountNumber = customToken.bankAccountNumber;
        session.user.promptPayPhone = customToken.promptPayPhone;
      }

      return session;
    },
  },
};
