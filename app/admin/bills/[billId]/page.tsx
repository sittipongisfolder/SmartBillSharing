import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/authOptions";
import { redirect } from "next/navigation";
import AdminBillDetailClient from "@/app/components/admin/AdminBillDetailClient";

export const dynamic = "force-dynamic";


export default async function AdminBillDetailPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard");
  return <AdminBillDetailClient />;
}