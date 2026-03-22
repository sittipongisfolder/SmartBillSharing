import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/authOptions";
import { redirect } from "next/navigation";
import AdminUserDetailClient from "@/app/components/admin/AdminUserDetailClient";

export const dynamic = "force-dynamic";

export default async function AdminUserDetailPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard");

  return <AdminUserDetailClient />;
}