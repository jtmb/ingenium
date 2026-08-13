"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import AuthCard from "@/app/components/auth/AuthCard";
import { api, setSessionCsrfToken } from "@/lib/api";
export default function OidcCallbackPage() { const params = useSearchParams(); const [error, setError] = useState(false); useEffect(() => { void api.auth.oidcCallback(params.get("state") ?? "", params.get("code") ?? "").then((r) => { setSessionCsrfToken(r.data.csrfToken); window.location.assign("/"); }, () => setError(true)); }, [params]); return <AuthCard title="Completing sign in"><p role={error ? "alert" : "status"}>{error ? "Sign in could not be completed. Return to the sign-in page and try again." : "Finishing secure sign in…"}</p></AuthCard>; }
