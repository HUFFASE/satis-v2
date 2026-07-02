import { Button } from "@/components/ui/button";
import { TrendingUp, BarChart3, Target, Calendar } from "lucide-react";

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Navigation Header */}
      <header className="sticky top-0 z-50 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
            <span className="font-bold text-xl text-slate-900 dark:text-slate-50">SATIŞ-V2</span>
          </div>
          <nav className="hidden md:flex gap-6 text-sm font-medium text-slate-600 dark:text-slate-300">
            <a href="#" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Ana Sayfa</a>
            <a href="#" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Hakkında</a>
            <a href="#" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Dokümantasyon</a>
          </nav>
          <div className="flex gap-2">
            <Button variant="outline" className="hidden sm:inline-flex">Bize Ulaşın</Button>
            <Button className="bg-indigo-600 hover:bg-indigo-700 text-white dark:bg-indigo-500 dark:hover:bg-indigo-600">Giriş Yap</Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 flex flex-col items-center justify-center text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 mb-8 border border-indigo-100 dark:border-indigo-900/50">
          <Target className="h-3.5 w-3.5" />
          <span>Yeni Nesil Satış Tahminleme Platformu</span>
        </div>
        
        <h1 className="max-w-4xl text-5xl md:text-6xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50 leading-none mb-6">
          Kurumsal Satış Tahmin ve <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-violet-600 dark:from-indigo-400 dark:to-violet-400">Takip Sistemi</span>
        </h1>
        
        <p className="max-w-2xl text-lg md:text-xl text-slate-600 dark:text-slate-400 mb-10">
          Satış hedeflerinizi belirleyin, dönemlik tahminlerinizi girin ve gerçekleşen satış verileriyle karşılaştırmalı analizleri anlık olarak takip edin.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 mb-16">
          <Button size="lg" className="bg-indigo-600 hover:bg-indigo-700 text-white dark:bg-indigo-500 dark:hover:bg-indigo-600 px-8">
            Başlayın
          </Button>
          <Button size="lg" variant="outline" className="px-8">
            Daha Fazla Bilgi
          </Button>
        </div>

        {/* Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full text-left mt-8">
          <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
            <div className="h-12 w-12 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-6">
              <Calendar className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-slate-50 mb-3">Kolay Tahmin Girişi</h3>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
              Satış temsilcileri ve yöneticiler için geliştirilmiş, aylık ve çeyreklik bazda esnek tahmin giriş arayüzü.
            </p>
          </div>

          <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
            <div className="h-12 w-12 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-6">
              <BarChart3 className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-slate-50 mb-3">Karşılaştırmalı Analiz</h3>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
              Tahmin edilen satışlar ile gerçekleşen satışların görsel grafiklerle sapma ve başarı oranı analizleri.
            </p>
          </div>

          <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
            <div className="h-12 w-12 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-6">
              <Target className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-slate-50 mb-3">Hedef Takibi</h3>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
              Yıllık ve çeyreklik şirket hedefleriyle uyumu ölçen, departman bazlı performans göstergeleri.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 py-8 bg-white dark:bg-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between text-sm text-slate-500 dark:text-slate-400 gap-4">
          <p>© 2026 SATIŞ-V2. Tüm hakları saklıdır.</p>
          <div className="flex gap-4">
            <a href="#" className="hover:underline">Kullanım Koşulları</a>
            <a href="#" className="hover:underline">Gizlilik Politikası</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
