"use client";

import React, { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { TrendingUp, AlertCircle, Loader2 } from "lucide-react";

// Zod schema for login inputs with Turkish validation messages
const loginSchema = z.object({
  email: z.string().email("Geçerli bir e-posta adresi giriniz."),
  password: z.string().min(1, "Şifre alanı boş bırakılamaz."),
});

type LoginFormValues = z.infer<typeof loginSchema>;

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";

  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit = async (data: LoginFormValues) => {
    setError(null);
    setIsLoading(true);

    try {
      const result = await signIn("credentials", {
        email: data.email,
        password: data.password,
        redirect: false,
      });

      if (result?.error) {
        // Map Auth.js errors to user-friendly Turkish messages
        if (result.error === "rate_limit_exceeded") {
          setError("Çok fazla başarısız giriş denemesi. Lütfen 15 dakika sonra tekrar deneyin.");
        } else if (result.error === "user_inactive") {
          setError("Bu hesap devre dışı bırakılmıştır.");
        } else {
          setError("E-posta veya şifre hatalı.");
        }
      } else {
        // Redirect upon successful sign-in
        router.push(callbackUrl);
        router.refresh();
      }
    } catch (err) {
      setError("Beklenmedik bir hata oluştu. Lütfen tekrar deneyin.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="border-slate-200 dark:border-slate-800 shadow-lg">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl font-bold tracking-tight text-[#1F3A2E] dark:text-emerald-400">
          Giriş Yap
        </CardTitle>
        <CardDescription>
          Hesabınıza erişmek için bilgilerinizi giriniz.
        </CardDescription>
      </CardHeader>
      
      <form onSubmit={handleSubmit(onSubmit)}>
        <CardContent className="space-y-4">
          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-600 dark:text-red-400 border border-red-100 dark:border-red-900/30">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="email" className="text-slate-700 dark:text-slate-300 font-sans">
              E-posta
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="name@example.com"
              disabled={isLoading}
              className="focus-visible:ring-[#2E5A43]"
              {...register("email")}
                />
            {errors.email && (
              <p className="text-xs text-red-600 dark:text-red-400">
                {errors.email.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-slate-700 dark:text-slate-300 font-sans">
              Şifre
            </Label>
            <Input
              id="password"
              type="password"
              disabled={isLoading}
              className="focus-visible:ring-[#2E5A43]"
              {...register("password")}
            />
            {errors.password && (
              <p className="text-xs text-red-600 dark:text-red-400">
                {errors.password.message}
              </p>
            )}
          </div>
        </CardContent>

        <CardFooter>
          <Button
            type="submit"
            disabled={isLoading}
            className="w-full bg-[#1F3A2E] hover:bg-[#2E5A43] text-white dark:bg-[#1f3a2e] dark:hover:bg-[#2e5a43] font-semibold"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Giriş Yapılıyor...
              </>
            ) : (
              "Giriş Yap"
            )}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950 px-4 sm:px-6 py-12">
      <div className="w-full max-w-md space-y-6">
        {/* Logo and Headings */}
        <div className="flex flex-col items-center justify-center gap-2 text-center">
          <div className="flex items-center justify-center h-12 w-12 rounded-xl bg-[#1F3A2E] text-white">
            <TrendingUp className="h-6 w-6" />
          </div>
          <h2 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-50 font-serif">
            Satış Forecast
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Kurumsal Satış Tahmin ve Takip Platformu
          </p>
        </div>

        {/* Suspense Wrapper to prevent Next.js build-time prerender exceptions */}
        <Suspense fallback={
          <Card className="border-slate-200 dark:border-slate-800 shadow-lg animate-pulse">
            <CardHeader className="space-y-1 text-center">
              <CardTitle className="text-2xl font-bold tracking-tight text-[#1F3A2E] dark:text-emerald-400">
                Yükleniyor...
              </CardTitle>
            </CardHeader>
            <CardContent className="h-48 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-[#1F3A2E] dark:text-[#2E5A43]" />
            </CardContent>
          </Card>
        }>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
