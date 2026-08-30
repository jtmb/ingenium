"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import AuthCard, { authInput } from "@/app/components/auth/AuthCard";
import { api, setSessionCsrfToken } from "@/lib/api";
import { safeReturnTo } from "@/lib/safe-return-to";
export default function MfaPage() { const params = useSearchParams(); const [code, setCode] = useState(""); const [error, setError] = useState<string | null>(null); return <AuthCard title="Security challenge" description="Enter an authenticator code or one unused recovery code."><form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); try { const result = await api.auth.mfaChallenge(params.get("challenge") ?? "", code, params.get("csrf") ?? ""); setCode(""); setSessionCsrfToken(result.data.csrfToken); window.location.assign(safeReturnTo(params.get("returnTo"))); } catch { setCode(""); setError("The code is invalid or expired."); } }}><label className="block text-sm font-medium" htmlFor="mfa-code">Code</label><input id="mfa-code" className={authInput} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required />{error && <p role="alert" className="text-sm text-[var(--color-error-text)]">{error}</p>}<button className="w-full rounded bg-blue-600 px-4 py-2 text-white">Verify</button></form></AuthCard>; }
