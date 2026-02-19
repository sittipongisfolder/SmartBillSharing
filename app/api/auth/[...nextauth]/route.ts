import NextAuth from 'next-auth/next';
import { authOptions } from '@/lib/authOptions';

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST, handler as DELETE 
    , handler as PUT, handler as PATCH };