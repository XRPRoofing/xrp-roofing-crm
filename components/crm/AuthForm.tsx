"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Mail, Lock, UserRound } from "lucide-react";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";

type AuthMode = "login" | "signup" | "forgot" | "reset";

const copy = {
  login: { title: "Welcome back", subtitle: "Log in to XRP Roofing CRM.", cta: "Log in" },
  signup: { title: "Create your account", subtitle: "Invite XRP Roofing staff into the CRM.", cta: "Create account" },
  forgot: { title: "Reset your password", subtitle: "Send a secure reset link to your email.", cta: "Send reset link" },
  reset: { title: "Choose a new password", subtitle: "Set a secure password for your CRM account.", cta: "Update password" },
};

function getAuthRedirectOrigin() {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL;

  if (configuredUrl) return configuredUrl.replace(/\/$/, "");
  if (typeof window !== "undefined") return window.location.origin;

  return "";
}
function withTimeout<T>(promise: Promise<T>, milliseconds = 15000) {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error("Login request timed out. Check your internet connection and Supabase credentials.")), milliseconds);
    }),
  ]);
}

export default function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    if (!hasSupabaseConfig()) {
      setError("CRM login is not configured yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then restart the app.");
      setLoading(false);
      return;
    }

    try {
      const supabase = createClient();

      if (mode === "login") {
        const response = await withTimeout(fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        }));
        const result = await response.json();

        if (!response.ok) {
          setError(result.error || "CRM login failed. Please check your email and password.");
          return;
        }

        setMessage("Logged in. Opening CRM dashboard...");
        const redirectedFrom = new URLSearchParams(window.location.search).get("redirectedFrom");
        window.setTimeout(() => {
          window.location.assign(redirectedFrom || "/crm");
        }, 500);
        return;
      }

      if (mode === "signup") {
        const { error: signUpError } = await withTimeout(supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name, role: "sales_rep" }, emailRedirectTo: `${getAuthRedirectOrigin()}/crm` },
        }));
        if (signUpError) setError(signUpError.message);
        else setMessage("Check your email to confirm the account before logging in.");
      }

      if (mode === "forgot") {
        const { error: resetError } = await withTimeout(supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${getAuthRedirectOrigin()}/reset-password`,
        }));
        if (resetError) setError(resetError.message);
        else setMessage("Password reset email sent.");
      }

      if (mode === "reset") {
        const { error: updateError } = await withTimeout(supabase.auth.updateUser({ password }));
        if (updateError) setError(updateError.message);
        else {
          setMessage("Password updated. Redirecting to CRM...");
          router.push("/crm");
          return;
        }
      }
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "CRM authentication failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0A3D91] px-4 py-10 text-slate-900">
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-6xl overflow-hidden rounded-[2rem] bg-white shadow-2xl lg:grid-cols-[1.05fr_0.95fr]">
        <div className="hidden bg-gradient-to-br from-[#072C6B] via-[#0A3D91] to-[#2B6BC4] p-10 text-white lg:flex lg:flex-col lg:justify-between">
          <div>
            <div className="inline-flex rounded-2xl bg-white/10 px-4 py-2 text-sm font-semibold ring-1 ring-white/15">XRP Roofing CRM</div>
            <h1 className="mt-10 text-5xl font-bold tracking-tight">Manage leads, jobs, estimates, and crews from one roof-ready workspace.</h1>
            <p className="mt-5 text-lg text-blue-100">Built for daily roofing operations with secure Supabase authentication and role-ready access.</p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm text-blue-100">
            <div className="rounded-2xl bg-white/10 p-4">Leads Pipeline</div>
            <div className="rounded-2xl bg-white/10 p-4">Estimates</div>
            <div className="rounded-2xl bg-white/10 p-4">Scheduling</div>
          </div>
        </div>
        <div className="flex items-center justify-center p-6 sm:p-10">
          <form onSubmit={handleSubmit} className="w-full max-w-md space-y-5">
            <div>
              <Link href="/" className="text-sm font-semibold text-[#0A3D91]">← Back to website</Link>
              <h2 className="mt-8 text-3xl font-bold tracking-tight text-[#0A3D91]">{copy[mode].title}</h2>
              <p className="mt-2 text-slate-600">{copy[mode].subtitle}</p>
            </div>
            {mode === "signup" && (
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Full name</span>
                <span className="mt-2 flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3">
                  <UserRound className="h-5 w-5 text-slate-400" />
                  <input className="w-full outline-none" value={name} onChange={(e) => setName(e.target.value)} required />
                </span>
              </label>
            )}
            {mode !== "reset" && (
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Email</span>
                <span className="mt-2 flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3">
                  <Mail className="h-5 w-5 text-slate-400" />
                  <input type="email" className="w-full outline-none" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </span>
              </label>
            )}
            {mode !== "forgot" && (
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Password</span>
                <span className="mt-2 flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3">
                  <Lock className="h-5 w-5 text-slate-400" />
                  <input type="password" className="w-full outline-none" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
                </span>
              </label>
            )}
            {error && <div className="rounded-2xl bg-orange-50 p-3 text-sm text-orange-700">{error}</div>}
            {message && <div className="rounded-2xl bg-blue-50 p-3 text-sm text-blue-700">{message}</div>}
            <button disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#f97316] px-5 py-3 font-bold text-white shadow-lg shadow-orange-200 transition hover:bg-[#ea580c] disabled:opacity-60">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {copy[mode].cta}
            </button>
            <div className="flex justify-between text-sm text-slate-600">
              {mode !== "login" ? <Link href="/login" className="font-semibold text-[#0A3D91]">Log in</Link> : <Link href="/signup" className="font-semibold text-[#0A3D91]">Create account</Link>}
              {mode === "login" && <Link href="/forgot-password" className="font-semibold text-[#0A3D91]">Forgot password?</Link>}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}


