"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import AuthCard from "@/app/components/auth/AuthCard";
import { api } from "@/lib/api";
export default function VerifyEmailPage() { const token = useSearchParams().get("token") ?? ""; const [message, setMessage] = useState("Verifying your email…"); useEffect(() => { void api.auth.csrf().then((c) => api.auth.verifyEmail(token, c.data.csrfToken)).then(() => setMessage("Email verified. You can sign in."), () => setMessage("This verification link is invalid or expired.")); }, [token]); return <AuthCard title="Email verification"><p role="status">{message}</p></AuthCard>; }
