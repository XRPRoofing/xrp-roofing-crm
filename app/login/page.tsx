import { Suspense } from "react";
import AuthForm from "@/components/crm/AuthForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <Suspense><AuthForm mode="login" /></Suspense>;
}
