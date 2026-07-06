"use client";

import Image from "next/image";
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Activity,
  BarChart3,
  BriefcaseBusiness,
  Plus,
  Pencil,
  KeyRound,
  Trash2,
  Loader2,
  Users,
  ShieldAlert,
} from "lucide-react";
import {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  toggleUserActive,
  resetUserPassword,
  getUserDetail,
} from "./actions";

interface User {
  id: string;
  name: string;
  email: string;
  role: "DIREKTOR" | "SATIS_MUDURU";
  isActive: boolean;
  imageUrl?: string | null;
  assignedVendors: string[];
  assignedVendorIds: string[];
}

type ActionResult = {
  success: boolean;
  error?: string;
};

type UserDetail = Awaited<ReturnType<typeof getUserDetail>>;

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatUSD(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatDate(value: Date | string | null) {
  return value ? new Date(value).toLocaleString("tr-TR") : "-";
}

const vendorBadgeColors = [
  "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
  "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200",
  "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
  "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200",
  "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200",
  "border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-200",
  "border-lime-200 bg-lime-50 text-lime-800 dark:border-lime-800 dark:bg-lime-950/40 dark:text-lime-200",
  "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800 dark:border-fuchsia-800 dark:bg-fuchsia-950/40 dark:text-fuchsia-200",
];

function getVendorBadgeColor(vendorName: string) {
  const colorIndex = vendorName
    .split("")
    .reduce((sum, char) => sum + char.charCodeAt(0), 0) % vendorBadgeColors.length;

  return vendorBadgeColors[colorIndex];
}

function MetricCard({ label, value, subValue }: { label: string; value: string; subValue: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 truncate font-mono text-lg font-extrabold text-slate-950 dark:text-slate-100">{value}</div>
      <div className="mt-0.5 truncate text-[11px] font-medium text-slate-500">{subValue}</div>
    </div>
  );
}

function UserMetricBars({ detail }: { detail: UserDetail }) {
  const rows = [
    { label: "Target", revenue: detail.totals.targetRevenue, tone: "bg-slate-500" },
    { label: "Forecast", revenue: detail.totals.forecastRevenue, tone: "bg-emerald-700" },
    { label: "Backlog", revenue: detail.totals.backlogRevenue, tone: "bg-amber-500" },
    { label: "Closing", revenue: detail.totals.closingRevenue, tone: "bg-sky-600" },
  ];
  const maxRevenue = Math.max(1, ...rows.map((row) => row.revenue));

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[82px_1fr_110px] items-center gap-3">
          <div className="text-xs font-bold text-slate-700 dark:text-slate-300">{row.label}</div>
          <div className="h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className={`h-full rounded-full ${row.tone}`} style={{ width: `${Math.max(4, (row.revenue / maxRevenue) * 100)}%` }} />
          </div>
          <div className="text-right font-mono text-xs font-bold text-slate-800 dark:text-slate-200">{formatUSD(row.revenue)}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * Renders the user profile picture inside a circular container.
 * Automatically falls back to initials if no image is present or if loading fails.
 */
function UserAvatar({ imageUrl, name }: { imageUrl?: string | null; name: string }) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();

  return (
    <div className="relative h-12 w-12 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-[#2E5A43] dark:text-emerald-400 font-bold flex items-center justify-center border border-emerald-100/50 dark:border-emerald-900/30 text-sm shrink-0 font-serif overflow-hidden">
      {/* Background Fallback Initials */}
      <span className="absolute inset-0 flex items-center justify-center select-none font-medium">
        {initials}
      </span>

      {/* Profile Image Layer (Covers initials when loaded) */}
      {imageUrl && (
        <Image
          src={imageUrl}
          alt={name}
          fill
          sizes="48px"
          className="absolute inset-0 h-full w-full object-cover bg-white dark:bg-slate-900"
          onError={(e) => {
            (e.currentTarget as HTMLElement).style.display = "none";
          }}
        />
      )}
    </div>
  );
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Form states
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [userForm, setUserForm] = useState({
    name: "",
    email: "",
    role: "SATIS_MUDURU" as "DIREKTOR" | "SATIS_MUDURU",
    password: "",
    isActive: true,
    imageUrl: "",
  });
  const [isSubmittingUser, setIsSubmittingUser] = useState(false);

  // Password reset states
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [passwordResetUser, setPasswordResetUser] = useState<User | null>(null);
  const [newPasswordText, setNewPasswordText] = useState("");
  const [isSubmittingPassword, setIsSubmittingPassword] = useState(false);

  // Delete alert states
  const [isDeleteAlertOpen, setIsDeleteAlertOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Detail modal states
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [detailUser, setDetailUser] = useState<User | null>(null);
  const [userDetail, setUserDetail] = useState<UserDetail | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  const fetchUsers = async () => {
    setIsLoading(true);
    try {
      const data = await getUsers();
      setUsers(data);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Kullanıcılar yüklenirken hata oluştu."));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void Promise.resolve().then(() => {
      void fetchUsers();
    });
  }, []);

  const handleOpenCreate = () => {
    setEditingUser(null);
    setUserForm({
      name: "",
      email: "",
      role: "SATIS_MUDURU",
      password: "",
      isActive: true,
      imageUrl: "",
    });
    setIsUserModalOpen(true);
  };

  const handleOpenEdit = (user: User) => {
    setEditingUser(user);
    setUserForm({
      name: user.name,
      email: user.email,
      role: user.role,
      password: "",
      isActive: user.isActive,
      imageUrl: user.imageUrl || "",
    });
    setIsUserModalOpen(true);
  };

  const handleUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userForm.name.trim() || !userForm.email.trim()) {
      toast.error("Ad Soyad ve E-posta alanları zorunludur.");
      return;
    }

    setIsSubmittingUser(true);
    try {
      let res: ActionResult;
      if (editingUser) {
        res = await updateUser(editingUser.id, {
          name: userForm.name,
          email: userForm.email,
          role: userForm.role,
          isActive: userForm.isActive,
          imageUrl: userForm.imageUrl,
        });
      } else {
        res = await createUser({
          name: userForm.name,
          email: userForm.email,
          role: userForm.role,
          password: userForm.password,
          isActive: userForm.isActive,
          imageUrl: userForm.imageUrl,
        });
      }

      if (res.success) {
        toast.success(
          editingUser ? "Kullanıcı güncellendi." : "Kullanıcı oluşturuldu."
        );
        setIsUserModalOpen(false);
        fetchUsers();
      } else {
        toast.error(res.error || "İşlem sırasında hata oluştu.");
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Beklenmeyen hata."));
    } finally {
      setIsSubmittingUser(false);
    }
  };

  const handleOpenPasswordReset = (user: User) => {
    setPasswordResetUser(user);
    setNewPasswordText("");
    setIsPasswordModalOpen(true);
  };

  const handlePasswordResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordResetUser || !newPasswordText) return;

    setIsSubmittingPassword(true);
    try {
      const res = await resetUserPassword(passwordResetUser.id, newPasswordText);
      if (res.success) {
        toast.success("Şifre başarıyla güncellendi.");
        setIsPasswordModalOpen(false);
      } else {
        toast.error(res.error || "Şifre güncelleme başarısız.");
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Hata oluştu."));
    } finally {
      setIsSubmittingPassword(false);
    }
  };

  const handleToggleActive = async (user: User) => {
    try {
      const res = await toggleUserActive(user.id);
      if (res.success) {
        toast.success("Kullanıcı durumu güncellendi.");
        fetchUsers();
      } else {
        toast.error(res.error || "Durum değiştirilemedi.");
      }
    } catch {
      toast.error("Hata oluştu.");
    }
  };

  const handleOpenDetail = async (user: User) => {
    setDetailUser(user);
    setUserDetail(null);
    setIsDetailModalOpen(true);
    setIsLoadingDetail(true);
    try {
      const detail = await getUserDetail(user.id);
      setUserDetail(detail);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Kullanıcı detayı yüklenemedi."));
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const handleOpenDeleteAlert = (user: User) => {
    setUserToDelete(user);
    setIsDeleteAlertOpen(true);
  };

  const handleDeleteUser = async () => {
    if (!userToDelete) return;
    setIsDeleting(true);
    try {
      const res = await deleteUser(userToDelete.id);
      if (res.success) {
        toast.success("Kullanıcı başarıyla silindi.");
        setIsDeleteAlertOpen(false);
        fetchUsers();
      } else {
        toast.error(res.error || "Silme işlemi başarısız.");
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Hata oluştu."));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header section */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-[#1F3A2E] dark:text-emerald-400 font-serif">
            Kullanıcı Yönetimi
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 font-sans">
            Sistem kullanıcılarını ekleyin, yetkilerini ve aktif durumlarını yönetin.
          </p>
        </div>
        <Button
          onClick={handleOpenCreate}
          className="bg-[#2E5A43] hover:bg-[#1F3A2E] text-white shadow-sm font-sans flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Yeni Kullanıcı
        </Button>
      </div>

      {/* Users Cards Grid */}
      {isLoading ? (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm h-40 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          <span className="ml-2 text-slate-500 font-sans">Kullanıcılar yükleniyor...</span>
        </div>
      ) : users.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm h-40 flex flex-col items-center justify-center text-slate-500 font-sans">
          <Users className="h-10 w-10 text-slate-300 mb-2" />
          <span>Kayıtlı kullanıcı bulunamadı.</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {users.map((user) => (
            <div
              key={user.id}
              role="button"
              tabIndex={0}
              onClick={() => void handleOpenDetail(user)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  void handleOpenDetail(user);
                }
              }}
              className="cursor-pointer bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300 p-5 flex flex-col justify-between space-y-4 border-t-4 border-t-[#2E5A43] dark:border-t-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-700/30"
            >
              {/* Header (Avatar & Name/Email) */}
              <div className="flex items-start gap-3">
                <UserAvatar imageUrl={user.imageUrl} name={user.name} />

                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-bold text-slate-900 dark:text-slate-100 truncate text-base font-serif">
                      {user.name}
                    </h3>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleToggleActive(user);
                      }}
                      className="focus:outline-none shrink-0"
                      title="Aktifliği Değiştir"
                    >
                      {user.isActive ? (
                        <Badge className="bg-emerald-800 hover:bg-emerald-700 text-emerald-100 cursor-pointer font-sans text-[10px] px-2 py-0.5">
                          Aktif
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="bg-red-800 hover:bg-red-700 text-red-100 cursor-pointer font-sans text-[10px] px-2 py-0.5">
                          Pasif
                        </Badge>
                      )}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 font-mono truncate">
                    {user.email}
                  </p>
                </div>
              </div>

              {/* Role & authorized vendors */}
              <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800/80">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-400 font-sans font-semibold uppercase tracking-wider">
                    Yetki Seviyesi
                  </span>
                  {user.role === "DIREKTOR" ? (
                    <Badge className="bg-[#1F3A2E] hover:bg-[#1F3A2E] text-white text-[10px] px-2 py-0.5">
                      Direktör
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300 border-emerald-100 dark:border-emerald-900 text-[10px] px-2 py-0.5">
                      Satış Müdürü
                    </Badge>
                  )}
                </div>

                <div className="space-y-1">
                  <span className="text-[10px] text-slate-400 font-sans font-semibold uppercase tracking-wider block">
                    Sorumlu Olduğu Vendorlar
                  </span>
                  {user.role === "DIREKTOR" ? (
                    <span className="text-xs text-slate-400 dark:text-slate-500 font-sans">Tüm Vendorlar (Sınırsız)</span>
                  ) : user.assignedVendors.length === 0 ? (
                    <span className="text-xs text-amber-600 dark:text-amber-400 font-sans italic font-medium">Vendor Atanmamış</span>
                  ) : (
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {user.assignedVendors.map((vendorName, idx) => (
                        <Badge
                          key={idx}
                          variant="outline"
                          className={`text-[9px] py-0 px-1.5 font-sans font-bold ${getVendorBadgeColor(vendorName)}`}
                        >
                          {vendorName}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Actions Footer */}
              <div className="flex items-center justify-end gap-1.5 pt-3 border-t border-slate-100 dark:border-slate-800/80">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleOpenEdit(user);
                  }}
                  className="h-8 text-xs border-slate-200 text-slate-700 hover:bg-slate-50 flex items-center gap-1 font-sans"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Düzenle
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleOpenPasswordReset(user);
                  }}
                  className="h-8 text-xs border-slate-200 text-slate-700 hover:bg-slate-50 flex items-center gap-1 font-sans"
                  title="Şifre Sıfırla"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  Şifre
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleOpenDeleteAlert(user);
                  }}
                  className="h-8 w-8 text-slate-400 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* User Detail Dialog */}
      <Dialog open={isDetailModalOpen} onOpenChange={setIsDetailModalOpen}>
        <DialogContent className="sm:max-w-5xl max-h-[88vh] overflow-y-auto bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="font-serif text-[#1F3A2E] dark:text-emerald-400 text-2xl font-bold">
              {userDetail?.user.name ?? detailUser?.name ?? "Kullanıcı Detayı"}
            </DialogTitle>
            <DialogDescription className="text-slate-500 font-sans text-xs">
              SM bazlı sorumlu vendor performansı, dönemsel NSB ve GP kırılımları.
            </DialogDescription>
          </DialogHeader>

          {isLoadingDetail ? (
            <div className="flex h-56 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-800">
              <Loader2 className="h-7 w-7 animate-spin text-emerald-700" />
              <span className="ml-2 text-sm font-medium text-slate-500">Detaylar yükleniyor...</span>
            </div>
          ) : userDetail ? (
            <div className="space-y-5">
              <div className="grid gap-4 lg:grid-cols-[1.1fr_1.4fr]">
                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/30">
                  <div className="flex items-start gap-3">
                    <UserAvatar imageUrl={userDetail.user.imageUrl} name={userDetail.user.name} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate font-serif text-lg font-bold text-slate-950 dark:text-slate-100">
                          {userDetail.user.name}
                        </h3>
                        <Badge className={userDetail.user.isActive ? "bg-emerald-800 text-emerald-100" : "bg-red-800 text-red-100"}>
                          {userDetail.user.isActive ? "Aktif" : "Pasif"}
                        </Badge>
                      </div>
                      <p className="mt-0.5 truncate font-mono text-xs text-slate-500">{userDetail.user.email}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge variant="outline" className="bg-white text-xs font-bold text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                          {userDetail.user.role === "DIREKTOR" ? "Direktör" : "Satış Müdürü"}
                        </Badge>
                        <Badge variant="outline" className="bg-white text-xs font-bold text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                          {userDetail.counts.vendors} Vendor
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <div className="rounded-md bg-white p-3 dark:bg-slate-900">
                      <div className="font-bold uppercase text-slate-400">Oluşturma</div>
                      <div className="mt-1 font-mono text-slate-700 dark:text-slate-200">{formatDate(userDetail.user.createdAt)}</div>
                    </div>
                    <div className="rounded-md bg-white p-3 dark:bg-slate-900">
                      <div className="font-bold uppercase text-slate-400">Güncelleme</div>
                      <div className="mt-1 font-mono text-slate-700 dark:text-slate-200">{formatDate(userDetail.user.updatedAt)}</div>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="mb-4 flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-emerald-700" />
                    <h3 className="font-serif text-base font-bold text-slate-950 dark:text-slate-100">Performans Özeti</h3>
                  </div>
                  <UserMetricBars detail={userDetail} />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard label="Target NSB" value={formatUSD(userDetail.totals.targetRevenue)} subValue={`GP ${formatUSD(userDetail.totals.targetGp)} (${formatPercent(userDetail.totals.targetGpPercent)})`} />
                <MetricCard label="Target GP" value={formatUSD(userDetail.totals.targetGp)} subValue={formatPercent(userDetail.totals.targetGpPercent)} />
                <MetricCard label="Forecast NSB" value={formatUSD(userDetail.totals.forecastRevenue)} subValue={`GP ${formatUSD(userDetail.totals.forecastGp)} (${formatPercent(userDetail.totals.forecastGpPercent)})`} />
                <MetricCard label="Forecast GP" value={formatUSD(userDetail.totals.forecastGp)} subValue={formatPercent(userDetail.totals.forecastGpPercent)} />
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <MetricCard label="Vendor" value={String(userDetail.counts.vendors)} subValue="Sorumlu vendor" />
                <MetricCard label="Target Kayıt" value={String(userDetail.counts.targets)} subValue="Hedef satırı" />
                <MetricCard label="Forecast Kayıt" value={String(userDetail.counts.forecasts)} subValue="Aktif forecast" />
                <MetricCard label="Backlog Kayıt" value={String(userDetail.counts.actuals)} subValue="Yüklenen backlog" />
                <MetricCard label="Closing Kayıt" value={String(userDetail.counts.closings)} subValue="Kapanış verisi" />
              </div>

              <div className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                  <Activity className="h-4 w-4 text-emerald-700" />
                  <h3 className="font-serif text-base font-bold text-slate-950 dark:text-slate-100">Dönemsel NSB</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="bg-emerald-800 text-white">
                      <tr>
                        <th className="px-4 py-3 text-left font-bold">Dönem</th>
                        <th className="px-4 py-3 text-right font-bold">Target NSB</th>
                        <th className="px-4 py-3 text-right font-bold">Forecast NSB</th>
                        <th className="px-4 py-3 text-right font-bold">Backlog</th>
                        <th className="px-4 py-3 text-right font-bold">Closing</th>
                        <th className="px-4 py-3 text-right font-bold">Vendor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userDetail.periods.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-slate-500">Dönemsel veri bulunamadı.</td>
                        </tr>
                      ) : (
                        userDetail.periods.map((period) => (
                          <tr key={`${period.fiscalYear}-${period.quarter}-nsb`} className="border-t border-slate-100 dark:border-slate-800">
                            <td className="px-4 py-3 font-bold text-slate-900 dark:text-slate-100">FY{period.fiscalYear} Q{period.quarter}</td>
                            <td className="px-4 py-3 text-right font-mono font-semibold">{formatUSD(period.targetRevenue)}</td>
                            <td className="px-4 py-3 text-right font-mono font-semibold">{formatUSD(period.forecastRevenue)}</td>
                            <td className="px-4 py-3 text-right font-mono font-semibold">{formatUSD(period.backlogRevenue)}</td>
                            <td className="px-4 py-3 text-right font-mono font-semibold">{formatUSD(period.closingRevenue)}</td>
                            <td className="px-4 py-3 text-right font-mono font-semibold">{period.vendorCount}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                  <Activity className="h-4 w-4 text-emerald-700" />
                  <h3 className="font-serif text-base font-bold text-slate-950 dark:text-slate-100">Dönemsel GP</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="bg-emerald-800 text-white">
                      <tr>
                        <th className="px-4 py-3 text-left font-bold">Dönem</th>
                        <th className="px-4 py-3 text-right font-bold">Target GP</th>
                        <th className="px-4 py-3 text-right font-bold">Forecast GP</th>
                        <th className="px-4 py-3 text-right font-bold">Backlog GP</th>
                        <th className="px-4 py-3 text-right font-bold">Closing GP</th>
                        <th className="px-4 py-3 text-right font-bold">Vendor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userDetail.periods.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-slate-500">Dönemsel GP verisi bulunamadı.</td>
                        </tr>
                      ) : (
                        userDetail.periods.map((period) => (
                          <tr key={`${period.fiscalYear}-${period.quarter}-gp`} className="border-t border-slate-100 dark:border-slate-800">
                            <td className="px-4 py-3 font-bold text-slate-900 dark:text-slate-100">FY{period.fiscalYear} Q{period.quarter}</td>
                            <td className="px-4 py-3 text-right font-mono font-semibold">{formatUSD(period.targetGp)}</td>
                            <td className="px-4 py-3 text-right font-mono font-semibold">{formatUSD(period.forecastGp)}</td>
                            <td className="px-4 py-3 text-right font-mono font-semibold">{formatUSD(period.backlogGp)}</td>
                            <td className="px-4 py-3 text-right font-mono font-semibold">{formatUSD(period.closingGp)}</td>
                            <td className="px-4 py-3 text-right font-mono font-semibold">{period.vendorCount}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                  <BriefcaseBusiness className="h-4 w-4 text-emerald-700" />
                  <h3 className="font-serif text-base font-bold text-slate-950 dark:text-slate-100">Vendor Kırılımı</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] text-sm">
                    <thead className="bg-emerald-800 text-white">
                      <tr>
                        <th className="px-4 py-3 text-left font-bold">Vendor</th>
                        <th className="px-4 py-3 text-right font-bold">Target NSB</th>
                        <th className="px-4 py-3 text-right font-bold">Target GP</th>
                        <th className="px-4 py-3 text-right font-bold">Forecast NSB</th>
                        <th className="px-4 py-3 text-right font-bold">Forecast GP</th>
                        <th className="px-4 py-3 text-right font-bold">Backlog</th>
                        <th className="px-4 py-3 text-right font-bold">Closing</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userDetail.vendorRows.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-8 text-center text-slate-500">Sorumlu vendor bulunamadı.</td>
                        </tr>
                      ) : (
                        userDetail.vendorRows.map((vendor) => (
                          <tr key={vendor.vendorId} className="border-t border-slate-100 dark:border-slate-800">
                            <td className="px-4 py-3 font-bold text-slate-900 dark:text-slate-100">{vendor.vendorName}</td>
                            <td className="px-4 py-3 text-right font-mono font-semibold">{formatUSD(vendor.targetRevenue)}</td>
                            <td className="px-4 py-3 text-right font-mono font-semibold">{formatUSD(vendor.targetGp)}</td>
                            <td className="px-4 py-3 text-right font-mono font-semibold">{formatUSD(vendor.forecastRevenue)}</td>
                            <td className="px-4 py-3 text-right font-mono font-semibold">{formatUSD(vendor.forecastGp)}</td>
                            <td className="px-4 py-3 text-right font-mono font-semibold">{formatUSD(vendor.backlogRevenue)}</td>
                            <td className="px-4 py-3 text-right font-mono font-semibold">{formatUSD(vendor.closingRevenue)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 p-8 text-center text-sm text-slate-500 dark:border-slate-800">
              Kullanıcı detayı görüntülenemedi.
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* User Create/Edit Dialog */}
      <Dialog open={isUserModalOpen} onOpenChange={setIsUserModalOpen}>
        <DialogContent className="sm:max-w-md bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="font-serif text-[#1F3A2E] dark:text-emerald-400 text-xl font-bold">
              {editingUser ? "Kullanıcıyı Düzenle" : "Yeni Kullanıcı Ekle"}
            </DialogTitle>
            <DialogDescription className="text-slate-500 font-sans text-xs">
              Kullanıcı profil bilgilerini, rolünü ve profil görselini buradan güncelleyebilirsiniz.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUserSubmit} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="user-name" className="text-slate-700 dark:text-slate-300 font-medium">Ad Soyad</Label>
              <Input
                id="user-name"
                value={userForm.name}
                onChange={(e) => setUserForm({ ...userForm, name: e.target.value })}
                placeholder="Örn: Ahmet Mehmet"
                disabled={isSubmittingUser}
                className="font-sans text-sm border-slate-200 focus-visible:ring-emerald-700 focus-visible:border-emerald-700"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-email" className="text-slate-700 dark:text-slate-300 font-medium">E-posta</Label>
              <Input
                id="user-email"
                type="email"
                value={userForm.email}
                onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                placeholder="Örn: user@sales.local"
                disabled={isSubmittingUser}
                className="font-sans text-sm border-slate-200 focus-visible:ring-emerald-700 focus-visible:border-emerald-700"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="user-image" className="text-slate-700 dark:text-slate-300 font-medium">Görsel URL (Profil Fotoğrafı)</Label>
              <Input
                id="user-image"
                value={userForm.imageUrl}
                onChange={(e) => setUserForm({ ...userForm, imageUrl: e.target.value })}
                placeholder="Örn: https://images.unsplash.com/photo-..."
                disabled={isSubmittingUser}
                className="font-sans text-sm border-slate-200 focus-visible:ring-emerald-700 focus-visible:border-emerald-700"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="user-role" className="text-slate-700 dark:text-slate-300 font-medium">Rol</Label>
              <Select
                value={userForm.role}
                onValueChange={(val: "DIREKTOR" | "SATIS_MUDURU" | null) => {
                  if (val) setUserForm({ ...userForm, role: val });
                }}
                disabled={isSubmittingUser}
              >
                <SelectTrigger id="user-role" className="border-slate-200 font-sans text-sm focus:outline-none bg-white">
                  <SelectValue placeholder="Rol Seçiniz" />
                </SelectTrigger>
                <SelectContent className="bg-white border-slate-200">
                  <SelectItem value="DIREKTOR" className="font-sans text-xs">Direktör (Tüm yetkiler)</SelectItem>
                  <SelectItem value="SATIS_MUDURU" className="font-sans text-xs">Satış Müdürü (Sorumlu olduğu vendorlar)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Password Field (Only displayed on Create User) */}
            {!editingUser && (
              <div className="space-y-1.5">
                <Label htmlFor="user-pass" className="text-slate-700 dark:text-slate-300 font-medium">Şifre</Label>
                <Input
                  id="user-pass"
                  type="password"
                  value={userForm.password}
                  onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                  placeholder="Güçlü bir şifre giriniz"
                  disabled={isSubmittingUser}
                  className="font-sans text-sm border-slate-200 focus-visible:ring-emerald-700 focus-visible:border-emerald-700"
                />
                <p className="text-[10px] text-slate-500 font-sans">
                  * Şifre en az 8 karakter olmalı, en az bir büyük harf, bir küçük harf ve bir rakam içermelidir.
                </p>
              </div>
            )}

            {editingUser && (
              <div className="flex items-center space-x-2 py-1">
                <input
                  type="checkbox"
                  id="user-status"
                  checked={userForm.isActive}
                  onChange={(e) => setUserForm({ ...userForm, isActive: e.target.checked })}
                  disabled={isSubmittingUser}
                  className="rounded border-slate-300 text-emerald-800 focus:ring-emerald-700 h-4 w-4"
                />
                <Label htmlFor="user-status" className="text-slate-700 dark:text-slate-300 font-medium select-none cursor-pointer">
                  Aktif (Sisteme giriş yapabilir)
                </Label>
              </div>
            )}

            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsUserModalOpen(false)}
                disabled={isSubmittingUser}
                className="border-slate-200 hover:bg-slate-50 text-slate-700"
              >
                İptal
              </Button>
              <Button
                type="submit"
                disabled={isSubmittingUser}
                className="bg-[#2E5A43] hover:bg-[#1F3A2E] text-white flex items-center gap-2"
              >
                {isSubmittingUser && <Loader2 className="h-4 w-4 animate-spin" />}
                Kaydet
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Password Reset Dialog */}
      <Dialog open={isPasswordModalOpen} onOpenChange={setIsPasswordModalOpen}>
        <DialogContent className="sm:max-w-md bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="font-serif text-[#1F3A2E] dark:text-emerald-400 text-xl font-bold flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-emerald-600" />
              Şifre Sıfırla
            </DialogTitle>
            <DialogDescription className="text-slate-500 font-sans text-xs">
              <strong className="text-slate-800 dark:text-slate-200">{passwordResetUser?.name}</strong> kullanıcısı için yeni bir şifre tanımlayın.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handlePasswordResetSubmit} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="reset-pass" className="text-slate-700 dark:text-slate-300 font-medium">Yeni Şifre</Label>
              <Input
                id="reset-pass"
                type="password"
                value={newPasswordText}
                onChange={(e) => setNewPasswordText(e.target.value)}
                placeholder="Güçlü bir şifre giriniz"
                disabled={isSubmittingPassword}
                className="border-slate-200 focus-visible:ring-emerald-700"
              />
              <p className="text-[10px] text-slate-500 font-sans">
                * Şifre en az 8 karakter olmalı, en az bir büyük harf, bir küçük harf ve bir rakam içermelidir.
              </p>
            </div>
            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsPasswordModalOpen(false)}
                disabled={isSubmittingPassword}
                className="border-slate-200 hover:bg-slate-50 text-slate-700"
              >
                İptal
              </Button>
              <Button
                type="submit"
                disabled={isSubmittingPassword || !newPasswordText}
                className="bg-[#2E5A43] hover:bg-[#1F3A2E] text-white flex items-center gap-1.5"
              >
                {isSubmittingPassword && <Loader2 className="h-4 w-4 animate-spin" />}
                Şifreyi Değiştir
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Alert */}
      <AlertDialog open={isDeleteAlertOpen} onOpenChange={setIsDeleteAlertOpen}>
        <AlertDialogContent className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif text-slate-900 dark:text-slate-100 text-lg font-bold flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-red-600" />
              Kullanıcıyı Sil
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-500 mt-2 font-sans text-xs">
              <span className="font-semibold text-slate-800 dark:text-slate-200">{userToDelete?.name}</span> adlı kullanıcının hesabını kalıcı olarak silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-6 gap-2">
            <AlertDialogCancel
              disabled={isDeleting}
              className="border-slate-200 hover:bg-slate-50 text-slate-700"
            >
              İptal
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteUser}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700 text-white font-sans text-sm font-semibold"
            >
              {isDeleting && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Kullanıcıyı Sil
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
