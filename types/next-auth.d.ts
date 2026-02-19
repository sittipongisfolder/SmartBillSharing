import 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      promptPayPhone: string;
      id: string;
      _id: string;
      name: string;
      email: string;
      role: string;
      bank: string;
      bankAccountNumber: string;
    };
  }
}
