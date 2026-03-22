import "next-auth";
import "next-auth/jwt";

export type UserRole = "user" | "admin";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      _id?: string;
      role: UserRole;
      bank?: string;
      bankAccountNumber?: string;
      promptPayPhone?: string;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    _id?: string;
    role: UserRole;
    bank?: string;
    bankAccountNumber?: string;
    promptPayPhone?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    _id?: string;
    role?: UserRole;
    bank?: string;
    bankAccountNumber?: string;
    promptPayPhone?: string;
  }
}