import InvoiceClient from "./InvoiceClient";

export default async function PublicInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InvoiceClient invoiceId={id} />;
}
