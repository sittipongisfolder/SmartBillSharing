export default function GuestLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-screen bg-[#fffaf5]">{children}</div>;
}