import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({
  invoiceId: z.string().min(1),
  invoiceNumber: z.string().min(1),
  amount: z.number().positive(),
  paymentMethod: z.enum(["ach", "card"]),
  customerEmail: z.string().email(),
  customerName: z.string().optional(),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

export async function POST(req: NextRequest) {
  try {
    const data = schema.parse(await req.json());
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

    if (!stripeSecretKey) {
      return NextResponse.json({ error: "Stripe is not configured" }, { status: 503 });
    }

    const paymentMethodTypes = data.paymentMethod === "ach" ? ["us_bank_account"] : ["card"];
    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        mode: "payment",
        "payment_method_types[0]": paymentMethodTypes[0],
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][product_data][name]": `XRP Roofing Invoice ${data.invoiceNumber}`,
        "line_items[0][price_data][unit_amount]": String(Math.round(data.amount * 100)),
        "line_items[0][quantity]": "1",
        customer_email: data.customerEmail,
        success_url: data.successUrl,
        cancel_url: data.cancelUrl,
        "metadata[invoiceId]": data.invoiceId,
        "metadata[invoiceNumber]": data.invoiceNumber,
        "metadata[paymentMethod]": data.paymentMethod,
        ...(data.customerName ? { "metadata[clientName]": data.customerName } : {}),
        // Copy metadata onto the PaymentIntent so payment_intent.* webhook
        // events can resolve back to this invoice.
        "payment_intent_data[metadata][invoiceId]": data.invoiceId,
        "payment_intent_data[metadata][invoiceNumber]": data.invoiceNumber,
        "payment_intent_data[metadata][paymentMethod]": data.paymentMethod,
        ...(data.customerName ? { "payment_intent_data[metadata][clientName]": data.customerName } : {}),
      }),
    });

    const checkoutSession = await response.json();

    if (!response.ok) {
      return NextResponse.json({ error: checkoutSession.error?.message || "Unable to create Stripe checkout session" }, { status: 500 });
    }

    return NextResponse.json({ checkoutUrl: checkoutSession.url });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid checkout data", details: error.issues }, { status: 400 });
    }

    return NextResponse.json({ error: "Unable to start checkout" }, { status: 500 });
  }
}
