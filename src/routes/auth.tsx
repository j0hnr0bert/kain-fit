import { createFileRoute, useNavigate, useSearch, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, Mail, Phone } from "lucide-react";

const searchSchema = z.object({
  mode: z.enum(["signin", "signup"]).optional().default("signup"),
});

export const Route = createFileRoute("/auth")({
  validateSearch: (s) => searchSchema.parse(s),
  component: AuthPage,
});

function AuthPage() {
  const { mode: initialMode } = useSearch({ from: "/auth" });
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">(initialMode);
  const [method, setMethod] = useState<"choose" | "email" | "phone">("choose");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleOAuth(provider: "google" | "apple") {
    setLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth(provider, {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        toast.error(result.error.message ?? "Sign-in failed");
        setLoading(false);
        return;
      }
      if (result.redirected) return;
      navigate({ to: "/today", replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sign-in failed");
      setLoading(false);
    }
  }

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (data.session) {
          navigate({ to: "/today", replace: true });
        } else {
          toast.success("Check your email to confirm your account, then sign in.");
          setMode("signin");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/today", replace: true });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handlePhoneSend(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone });
      if (error) throw error;
      setOtpSent(true);
      toast.success("Code sent to your phone");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send code");
    } finally {
      setLoading(false);
    }
  }

  async function handlePhoneVerify(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({ phone, token: otp, type: "sms" });
      if (error) throw error;
      navigate({ to: "/today", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[100dvh] bg-background px-6 pt-6 pb-10 flex flex-col">
      <button
        onClick={() => (method === "choose" ? navigate({ to: "/" }) : setMethod("choose"))}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground w-fit -ml-2 px-2 py-1"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <div className="flex-1 flex flex-col justify-center max-w-sm mx-auto w-full">
        <h1 className="text-3xl font-bold tracking-tight mb-2">
          {mode === "signup" ? "Create your account" : "Welcome back"}
        </h1>
        <p className="text-muted-foreground mb-8">
          {mode === "signup"
            ? "Start tracking in seconds."
            : "Sign in to continue tracking."}
        </p>

        {method === "choose" && (
          <div className="space-y-3">
            <Button
              onClick={() => handleOAuth("apple")}
              disabled={loading}
              className="w-full h-12 rounded-2xl bg-foreground text-background hover:bg-foreground/90"
            >
              Continue with Apple
            </Button>
            <Button
              onClick={() => handleOAuth("google")}
              disabled={loading}
              variant="outline"
              className="w-full h-12 rounded-2xl"
            >
              Continue with Google
            </Button>
            <Button
              onClick={() => setMethod("email")}
              variant="outline"
              className="w-full h-12 rounded-2xl"
            >
              <Mail className="mr-2 h-4 w-4" /> Continue with email
            </Button>
            <Button
              onClick={() => setMethod("phone")}
              variant="outline"
              className="w-full h-12 rounded-2xl"
            >
              <Phone className="mr-2 h-4 w-4" /> Continue with phone number
            </Button>
          </div>
        )}

        {method === "email" && (
          <form onSubmit={handleEmail} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-12 rounded-xl" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="h-12 rounded-xl" />
            </div>
            <Button type="submit" disabled={loading} className="w-full h-12 rounded-2xl">
              {mode === "signup" ? "Create account" : "Sign in"}
            </Button>
          </form>
        )}

        {method === "phone" && !otpSent && (
          <form onSubmit={handlePhoneSend} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone number</Label>
              <Input id="phone" type="tel" placeholder="+639171234567" required value={phone} onChange={(e) => setPhone(e.target.value)} className="h-12 rounded-xl" />
            </div>
            <Button type="submit" disabled={loading} className="w-full h-12 rounded-2xl">
              Send code
            </Button>
          </form>
        )}

        {method === "phone" && otpSent && (
          <form onSubmit={handlePhoneVerify} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="otp">Verification code</Label>
              <Input id="otp" inputMode="numeric" required value={otp} onChange={(e) => setOtp(e.target.value)} className="h-12 rounded-xl text-center tracking-widest text-lg" />
            </div>
            <Button type="submit" disabled={loading} className="w-full h-12 rounded-2xl">
              Verify & continue
            </Button>
          </form>
        )}

        <div className="mt-6 text-center text-sm text-muted-foreground">
          {mode === "signup" ? (
            <>Already have an account?{" "}
              <button onClick={() => setMode("signin")} className="text-primary font-medium">Sign in</button>
            </>
          ) : (
            <>New here?{" "}
              <button onClick={() => setMode("signup")} className="text-primary font-medium">Create account</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}