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
  Plus,
  Pencil,
  Tags,
  Trash2,
  Loader2,
} from "lucide-react";
import {
  getVendors,
  createVendor,
  updateVendor,
  deleteVendor,
  getVendorAliases,
  addVendorAlias,
  deleteVendorAlias,
  getActiveSalesManagers,
} from "./actions";

interface Vendor {
  id: string;
  name: string;
  code: string | null;
  logoUrl?: string | null;
  isActive: boolean;
  aliasCount: number;
  managerCount: number;
  managerId: string | null;
  managerName?: string | null;
  hasTransactions: boolean;
}

interface Alias {
  id: string;
  alias: string;
}

type ActionResult = {
  success: boolean;
  error?: string;
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Renders the vendor logo inside a circular container.
 * Utilizes a background layer fallback that immediately displays initials if the logo image is loading or fails to render.
 */
function VendorLogo({ logoUrl, name }: { logoUrl?: string | null; name: string }) {
  const initials = name.substring(0, 2).toUpperCase();

  return (
    <div className="relative h-12 w-12 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-[#2E5A43] dark:text-emerald-400 font-bold flex items-center justify-center border border-emerald-100/50 dark:border-emerald-900/30 text-sm shrink-0 font-serif overflow-hidden">
      {/* Background Fallback Initials */}
      <span className="absolute inset-0 flex items-center justify-center select-none">
        {initials}
      </span>

      {/* Main Image Layer (Covers initials when loaded) */}
      {logoUrl && (
        <Image
          src={logoUrl}
          alt={name}
          fill
          sizes="48px"
          className="absolute inset-0 h-full w-full object-contain p-1 bg-white dark:bg-slate-900"
          onError={(e) => {
            (e.currentTarget as HTMLElement).style.display = "none";
          }}
        />
      )}
    </div>
  );
}

export default function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [managers, setManagers] = useState<{ id: string; name: string; email: string }[]>([]);

  // Modal states
  const [isVendorModalOpen, setIsVendorModalOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [vendorForm, setVendorForm] = useState<{
    name: string;
    code: string;
    logoUrl: string;
    isActive: boolean;
    managerId: string;
  }>({ name: "", code: "", logoUrl: "", isActive: true, managerId: "none" });
  const [isSubmittingVendor, setIsSubmittingVendor] = useState(false);

  // Alias states
  const [isAliasModalOpen, setIsAliasModalOpen] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [isLoadingAliases, setIsLoadingAliases] = useState(false);
  const [newAliasText, setNewAliasText] = useState("");
  const [isAddingAlias, setIsAddingAlias] = useState(false);

  // Delete/Deactivate alert states
  const [isDeleteAlertOpen, setIsDeleteAlertOpen] = useState(false);
  const [vendorToDelete, setVendorToDelete] = useState<Vendor | null>(null);
  const [deleteErrorMsg, setDeleteErrorMsg] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchVendors = async () => {
    setIsLoading(true);
    try {
      const data = await getVendors();
      setVendors(data);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Vendor kayıtları yüklenirken bir hata oluştu."));
    } finally {
      setIsLoading(false);
    }
  };

  const fetchManagers = async () => {
    try {
      const data = await getActiveSalesManagers();
      setManagers(data);
    } catch (err) {
      console.error("Yöneticiler yüklenemedi", err);
    }
  };

  useEffect(() => {
    void Promise.resolve().then(() => {
      void fetchVendors();
      void fetchManagers();
    });
  }, []);

  // Open vendor create modal
  const handleOpenCreate = () => {
    setEditingVendor(null);
    setVendorForm({ name: "", code: "", logoUrl: "", isActive: true, managerId: "none" });
    setIsVendorModalOpen(true);
  };

  // Open vendor edit modal
  const handleOpenEdit = (vendor: Vendor) => {
    setEditingVendor(vendor);
    setVendorForm({
      name: vendor.name,
      code: vendor.code || "",
      logoUrl: vendor.logoUrl || "",
      isActive: vendor.isActive,
      managerId: vendor.managerId || "none",
    });
    setIsVendorModalOpen(true);
  };

  // Handle vendor create/edit submit
  const handleVendorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vendorForm.name.trim()) {
      toast.error("Vendor adı boş olamaz.");
      return;
    }

    setIsSubmittingVendor(true);
    try {
      // Resolve single manager ID linkage
      const managerIdValue = vendorForm.managerId === "none" ? null : (vendorForm.managerId || null);

      const payload = {
        name: vendorForm.name,
        code: vendorForm.code,
        logoUrl: vendorForm.logoUrl,
        managerId: managerIdValue,
      };

      let res: ActionResult;
      if (editingVendor) {
        res = await updateVendor(editingVendor.id, {
          ...payload,
          isActive: vendorForm.isActive,
        });
      } else {
        res = await createVendor(payload);
      }

      if (res.success) {
        toast.success(
          editingVendor ? "Vendor başarıyla güncellendi." : "Vendor başarıyla oluşturuldu."
        );
        setIsVendorModalOpen(false);
        fetchVendors();
      } else {
        toast.error(res.error || "İşlem sırasında bir hata oluştu.");
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Beklenmeyen bir hata oluştu."));
    } finally {
      setIsSubmittingVendor(false);
    }
  };

  // Open alias modal and fetch data
  const handleOpenAliases = async (vendor: Vendor) => {
    setSelectedVendor(vendor);
    setIsAliasModalOpen(true);
    setIsLoadingAliases(true);
    setNewAliasText("");
    try {
      const data = await getVendorAliases(vendor.id);
      setAliases(data);
    } catch {
      toast.error("Takma adlar yüklenemedi.");
    } finally {
      setIsLoadingAliases(false);
    }
  };

  // Handle adding a vendor alias
  const handleAddAlias = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVendor || !newAliasText.trim()) return;

    setIsAddingAlias(true);
    try {
      const res = await addVendorAlias(selectedVendor.id, newAliasText);
      if (res.success) {
        toast.success("Takma ad eklendi.");
        setNewAliasText("");
        const updated = await getVendorAliases(selectedVendor.id);
        setAliases(updated);
        fetchVendors();
      } else {
        toast.error(res.error || "Ekleme sırasında hata oluştu.");
      }
    } catch {
      toast.error("İşlem sırasında hata oluştu.");
    } finally {
      setIsAddingAlias(false);
    }
  };

  // Handle deleting a vendor alias
  const handleDeleteAlias = async (aliasId: string) => {
    if (!selectedVendor) return;
    try {
      const res = await deleteVendorAlias(aliasId);
      if (res.success) {
        toast.success("Takma ad silindi.");
        const updated = await getVendorAliases(selectedVendor.id);
        setAliases(updated);
        fetchVendors();
      } else {
        toast.error(res.error);
      }
    } catch {
      toast.error("Silme işlemi başarısız.");
    }
  };

  // Open delete alert
  const handleOpenDeleteAlert = (vendor: Vendor) => {
    setVendorToDelete(vendor);
    setDeleteErrorMsg(null);
    setIsDeleteAlertOpen(true);
  };

  // Handle vendor delete action
  const handleDeleteVendor = async () => {
    if (!vendorToDelete) return;
    setIsDeleting(true);
    try {
      const res = await deleteVendor(vendorToDelete.id);
      if (res.success) {
        toast.success("Vendor başarıyla silindi.");
        setIsDeleteAlertOpen(false);
        fetchVendors();
      } else {
        setDeleteErrorMsg(res.error || "Bu vendor silinemez.");
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "İşlem sırasında hata oluştu."));
    } finally {
      setIsDeleting(false);
    }
  };

  // Quick action: Deactivate vendor instead when deletion is blocked
  const handleDeactivateInstead = async () => {
    if (!vendorToDelete) return;
    setIsDeleting(true);
    try {
      // Map single manager ID linkage
      const managerIdValue = vendorToDelete.managerId || null;

      const res = await updateVendor(vendorToDelete.id, {
        name: vendorToDelete.name,
        code: vendorToDelete.code || "",
        logoUrl: vendorToDelete.logoUrl || "",
        managerId: managerIdValue,
        isActive: false,
      });
      if (res.success) {
        toast.success("Vendor başarıyla pasifleştirildi.");
        setIsDeleteAlertOpen(false);
        fetchVendors();
      } else {
        toast.error(res.error || "Pasifleştirme başarısız.");
      }
    } catch {
      toast.error("Hata oluştu.");
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
            Vendor Yönetimi
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 font-sans">
            Sistemdeki vendor kayıtlarını tanımlayın ve Excel takma adlarını yönetin.
          </p>
        </div>
        <Button
          onClick={handleOpenCreate}
          className="bg-[#2E5A43] hover:bg-[#1F3A2E] text-white shadow-sm font-sans flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Yeni Vendor
        </Button>
      </div>

      {/* Vendor cards grid */}
      {isLoading ? (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm h-40 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          <span className="ml-2 text-slate-500 font-sans">Veriler yükleniyor...</span>
        </div>
      ) : vendors.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm h-40 flex flex-col items-center justify-center text-slate-500 font-sans">
          <Tags className="h-10 w-10 text-slate-300 mb-2" />
          <span>Henüz vendor eklenmemiş.</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {vendors.map((vendor) => (
            <div
              key={vendor.id}
              className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300 p-5 flex flex-col justify-between space-y-4 border-t-4 border-t-[#2E5A43] dark:border-t-emerald-600"
            >
              {/* Header */}
              <div className="flex items-start gap-3">
                <VendorLogo logoUrl={vendor.logoUrl} name={vendor.name} />
                
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-bold text-slate-900 dark:text-slate-100 truncate text-base font-serif">
                      {vendor.name}
                    </h3>
                    {vendor.isActive ? (
                      <Badge className="bg-emerald-800 hover:bg-emerald-800 text-emerald-100 shrink-0 font-sans text-[10px] px-2 py-0.5">
                        Aktif
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="bg-red-800 hover:bg-red-800 text-red-100 shrink-0 font-sans text-[10px] px-2 py-0.5">
                        Pasif
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-400 font-sans">Kod:</span>
                    <span className="text-[10px] font-mono text-emerald-800 dark:text-emerald-300 font-bold bg-emerald-50 dark:bg-emerald-950/20 px-2 py-0.5 rounded border border-emerald-100/50 dark:border-emerald-900/30">
                      {vendor.code || "-"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Info stats */}
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/80">
                <div className="bg-emerald-50/30 dark:bg-emerald-950/10 rounded-lg p-2.5 flex flex-col items-start border border-emerald-100/40 dark:border-emerald-900/20">
                  <span className="text-[10px] text-slate-400 font-sans font-semibold uppercase tracking-wider">
                    Takma Ad
                  </span>
                  <span className="text-sm font-extrabold text-emerald-800 dark:text-emerald-400 font-sans mt-0.5">
                    {vendor.aliasCount} adet
                  </span>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/30 rounded-lg p-2.5 flex flex-col items-start border border-slate-100 dark:border-slate-800 min-w-0 w-full">
                  <span className="text-[10px] text-slate-400 font-sans font-semibold uppercase tracking-wider truncate w-full">
                    Sorumlu Yönetici
                  </span>
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300 font-sans mt-0.5 truncate w-full" title={vendor.managerName || "Atanmamış"}>
                    {vendor.managerName || "Atanmamış"}
                  </span>
                </div>
              </div>

              {/* Actions Footer */}
              <div className="flex items-center justify-end gap-1.5 pt-3 border-t border-slate-100 dark:border-slate-800/80">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleOpenEdit(vendor)}
                  className="h-8 text-xs border-slate-200 text-slate-700 hover:bg-slate-50 flex items-center gap-1 font-sans"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Düzenle
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleOpenAliases(vendor)}
                  className="h-8 text-xs border-slate-200 text-slate-700 hover:bg-slate-50 flex items-center gap-1 font-sans"
                  title="Takma Adları Yönet"
                >
                  <Tags className="h-3.5 w-3.5" />
                  Takma Adlar
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleOpenDeleteAlert(vendor)}
                  className="h-8 w-8 text-slate-400 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Vendor Create/Edit Dialog */}
      <Dialog open={isVendorModalOpen} onOpenChange={setIsVendorModalOpen}>
        <DialogContent className="sm:max-w-md bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="font-serif text-[#1F3A2E] dark:text-emerald-400 text-xl font-bold">
              {editingVendor ? "Vendor Düzenle" : "Yeni Vendor Tanımla"}
            </DialogTitle>
            <DialogDescription className="text-slate-500 font-sans text-xs">
              Vendor ana adı sistem genelinde benzersiz ve büyük harfle kaydedilir.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleVendorSubmit} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="vendor-name" className="text-slate-700 dark:text-slate-300 font-medium">Vendor Adı (Canonical)</Label>
              <Input
                id="vendor-name"
                value={vendorForm.name}
                onChange={(e) => setVendorForm({ ...vendorForm, name: e.target.value })}
                placeholder="Örn: IBM_HW, HPE, DELL"
                disabled={isSubmittingVendor}
                className="font-sans text-sm border-slate-200 focus-visible:ring-emerald-700 focus-visible:border-emerald-700"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="vendor-code" className="text-slate-700 dark:text-slate-300 font-medium">Vendor Kodu (İsteğe Bağlı)</Label>
              <Input
                id="vendor-code"
                value={vendorForm.code}
                onChange={(e) => setVendorForm({ ...vendorForm, code: e.target.value })}
                placeholder="Örn: IBM, HPE"
                disabled={isSubmittingVendor}
                className="font-sans text-sm border-slate-200 focus-visible:ring-emerald-700 focus-visible:border-emerald-700"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="vendor-logo" className="text-slate-700 dark:text-slate-300 font-medium">Logo URL (İsteğe Bağlı)</Label>
              <Input
                id="vendor-logo"
                value={vendorForm.logoUrl}
                onChange={(e) => setVendorForm({ ...vendorForm, logoUrl: e.target.value })}
                placeholder="Örn: https://logo.clearbit.com/dell.com"
                disabled={isSubmittingVendor}
                className="font-sans text-sm border-slate-200 focus-visible:ring-emerald-700 focus-visible:border-emerald-700"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="vendor-manager" className="text-slate-700 dark:text-slate-300 font-medium">Sorumlu Satış Müdürü</Label>
              <Select
                value={vendorForm.managerId}
                onValueChange={(val) => {
                  if (val) setVendorForm({ ...vendorForm, managerId: val });
                }}
                disabled={isSubmittingVendor}
              >
                <SelectTrigger id="vendor-manager" className="border-slate-200 font-sans text-sm focus:outline-none bg-white">
                  <SelectValue placeholder="Sorumlu Seçiniz (İsteğe Bağlı)">
                    {vendorForm.managerId && vendorForm.managerId !== "none"
                      ? managers.find((m) => m.id === vendorForm.managerId)?.name
                      : undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="bg-white border-slate-200">
                  <SelectItem value="none" className="text-slate-500 font-sans text-xs">
                    {"Sorumlu Atama (Yok)"}
                  </SelectItem>
                  {managers.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="font-sans text-xs">
                      {`${m.name} (${m.email})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {editingVendor && (
              <div className="flex items-center space-x-2 py-1">
                <input
                  type="checkbox"
                  id="vendor-status"
                  checked={vendorForm.isActive}
                  onChange={(e) => setVendorForm({ ...vendorForm, isActive: e.target.checked })}
                  disabled={isSubmittingVendor}
                  className="rounded border-slate-300 text-emerald-800 focus:ring-emerald-700 h-4 w-4"
                />
                <Label htmlFor="vendor-status" className="text-slate-700 dark:text-slate-300 font-medium select-none cursor-pointer">
                  Aktif (Sistem genelinde kullanılabilir)
                </Label>
              </div>
            )}
            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsVendorModalOpen(false)}
                disabled={isSubmittingVendor}
                className="border-slate-200 hover:bg-slate-50 text-slate-700"
              >
                İptal
              </Button>
              <Button
                type="submit"
                disabled={isSubmittingVendor}
                className="bg-[#2E5A43] hover:bg-[#1F3A2E] text-white flex items-center gap-2"
              >
                {isSubmittingVendor && <Loader2 className="h-4 w-4 animate-spin" />}
                Kaydet
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete/Deactivate Confirmation Alert */}
      <AlertDialog open={isDeleteAlertOpen} onOpenChange={setIsDeleteAlertOpen}>
        <AlertDialogContent className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif text-[#1F3A2E] dark:text-emerald-400 text-lg font-bold">
              Vendor Silmek İstediğinize Emin Misiniz?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-500 font-sans text-xs">
              <strong className="text-slate-800 dark:text-slate-200">{vendorToDelete?.name}</strong> vendor kaydı kalıcı olarak silinecektir. Bu işlem geri alınamaz.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {deleteErrorMsg && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300 rounded text-xs font-sans space-y-2">
              <p className="font-semibold">{deleteErrorMsg}</p>
              <p>Alternatif olarak, silmek yerine vendor kaydını pasif hale getirebilirsiniz. Pasif vendorlar yeni forecast veya hedeflerde seçilemez ancak geçmiş kayıtları korunur.</p>
            </div>
          )}

          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel
              disabled={isDeleting}
              onClick={() => setIsDeleteAlertOpen(false)}
              className="border-slate-200 hover:bg-slate-50 text-slate-700 font-sans text-xs"
            >
              İptal
            </AlertDialogCancel>

            {deleteErrorMsg ? (
              <Button
                onClick={handleDeactivateInstead}
                disabled={isDeleting}
                className="bg-amber-600 hover:bg-amber-700 text-white font-sans text-xs flex items-center gap-1"
              >
                {isDeleting && <Loader2 className="h-3 w-3 animate-spin" />}
                Pasifleştir
              </Button>
            ) : (
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  handleDeleteVendor();
                }}
                disabled={isDeleting}
                className="bg-red-600 hover:bg-red-700 text-white font-sans text-xs flex items-center gap-1"
              >
                {isDeleting && <Loader2 className="h-3 w-3 animate-spin" />}
                Kalıcı Olarak Sil
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Aliases Modal */}
      <Dialog open={isAliasModalOpen} onOpenChange={setIsAliasModalOpen}>
        <DialogContent className="sm:max-w-lg bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="font-serif text-[#1F3A2E] dark:text-emerald-400 text-xl font-bold flex items-center gap-2">
              <Tags className="h-5 w-5 text-emerald-600" />
              Takma Adları Yönet
            </DialogTitle>
            <DialogDescription className="text-slate-500 font-sans text-xs">
              <strong className="text-slate-800 dark:text-slate-200">{selectedVendor?.name}</strong> vendor kaydı için alternatif Excel isimlendirmelerini ekleyin.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Alias Add form */}
            <form onSubmit={handleAddAlias} className="flex gap-2">
              <Input
                value={newAliasText}
                onChange={(e) => setNewAliasText(e.target.value)}
                placeholder="Örn: IBM HW, Dell Inc"
                disabled={isAddingAlias}
                className="font-sans text-sm flex-1 border-slate-200 focus-visible:ring-emerald-700"
              />
              <Button
                type="submit"
                disabled={isAddingAlias || !newAliasText.trim()}
                className="bg-[#2E5A43] hover:bg-[#1F3A2E] text-white font-sans text-xs flex items-center gap-1"
              >
                {isAddingAlias && <Loader2 className="h-3 w-3 animate-spin" />}
                Ekle
              </Button>
            </form>

            <div className="border border-slate-100 dark:border-slate-800 rounded-lg max-h-60 overflow-y-auto bg-slate-50/20">
              {isLoadingAliases ? (
                <div className="p-8 text-center text-slate-400 font-sans text-xs flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                  Yükleniyor...
                </div>
              ) : aliases.length === 0 ? (
                <div className="p-8 text-center text-slate-400 font-sans text-xs">
                  Eşleştirilmiş takma ad bulunmamaktadır.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {aliases.map((alias) => (
                    <div key={alias.id} className="flex items-center justify-between p-3 hover:bg-slate-50/50">
                      <span className="font-mono text-xs text-slate-800 dark:text-slate-200">{alias.alias}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteAlias(alias.id)}
                        className="h-8 w-8 text-slate-400 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
