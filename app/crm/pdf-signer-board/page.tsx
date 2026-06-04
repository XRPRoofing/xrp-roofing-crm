const signingStages = [
  { title: "Needs Signature", count: 4, items: ["Maria Hernandez proposal", "Ryan Mitchell contract", "Desert Plaza HOA authorization"] },
  { title: "Sent", count: 3, items: ["Priya Shah warranty", "Carlos Vega change order", "Mesa Retail Roof agreement"] },
  { title: "Signed", count: 5, items: ["Sunset Retail Center", "Glendale Repair", "Sage Medical Center"] },
];

export default function PdfSignerBoardPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-orange-600">CRM Module</p>
          <h1 className="mt-2 text-3xl font-black text-[#07183f]">PDF Signer Board</h1>
          <p className="crm-board-subtitle mt-2 text-slate-600">Track PDF contracts, proposals, change orders, and documents waiting for signatures.</p>
        </div>
        <button className="w-fit rounded-2xl bg-orange-500 px-4 py-3 font-bold text-white shadow-lg shadow-orange-200">+ Upload PDF</button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {signingStages.map((stage) => (
          <section key={stage.title} className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-lg font-black text-[#07183f]">{stage.title}</h2>
                <p className="text-sm font-semibold text-slate-500">{stage.count} documents</p>
              </div>
              <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-black text-orange-700">PDF</span>
            </div>
            <div className="mt-4 space-y-3">
              {stage.items.map((item) => (
                <article key={item} className="rounded-2xl bg-slate-50 p-4">
                  <p className="font-black text-slate-900">{item}</p>
                  <p className="mt-1 text-sm text-slate-500">Signature document record</p>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
