/**
 * useConfirm — async confirmation dialog hook.
 * Replaces synchronous window.confirm() with a non-blocking AlertDialog.
 *
 * Usage:
 *   const { confirm, dialog } = useConfirm();
 *   // In a handler (must be async):
 *   if (!await confirm("האם למחוק?")) return;
 *   // In JSX:
 *   {dialog}
 */
import { useState, useCallback } from "react";
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

interface PendingConfirm {
  message: string;
  resolve: (value: boolean) => void;
}

export function useConfirm() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setPending({ message, resolve });
    });
  }, []);

  const handleOk = () => {
    pending?.resolve(true);
    setPending(null);
  };

  const handleCancel = () => {
    pending?.resolve(false);
    setPending(null);
  };

  const dialog = (
    <AlertDialog open={!!pending} onOpenChange={(open) => { if (!open) handleCancel(); }}>
      <AlertDialogContent dir="rtl">
        <AlertDialogHeader>
          <AlertDialogTitle>אישור</AlertDialogTitle>
          <AlertDialogDescription>{pending?.message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-0">
          <AlertDialogCancel onClick={handleCancel}>ביטול</AlertDialogCancel>
          <AlertDialogAction onClick={handleOk}>אישור</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirm, dialog };
}
