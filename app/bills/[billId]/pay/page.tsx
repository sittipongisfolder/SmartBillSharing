import PaySlipClient from './PaySlipClient';

type PageProps = {
  params: Promise<{ billId: string }>;
};

export default async function Page({ params }: PageProps) {
  const { billId } = await params;
  return <PaySlipClient billId={billId} />;
}
