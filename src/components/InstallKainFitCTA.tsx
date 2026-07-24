import { useState } from "react";
import { Download, Share, Plus, SquarePlus, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { track } from "@/lib/analytics";
import { useInstallPrompt } from "@/lib/use-install-prompt";

type Variant = "landing" | "post_demo";

/**
 * Device-aware "Install KainFit" experience. There is no native app —
 * this is entirely the standard web PWA install surface
 * (beforeinstallprompt + Add to Home Screen). Renders nothing once the
 * app is already running standalone, or on an unknown/unsupported
 * platform with no useful fallback.
 */
export function InstallKainFitCTA({
  variant = "landing",
  className,
}: {
  variant?: Variant;
  className?: string;
}) {
  const { platform, inAppBrowser, installed, promptInstall } = useInstallPrompt();
  const [iosGuideOpen, setIosGuideOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (installed) return null;

  async function handleClick() {
    if (variant === "post_demo") track("post_demo_install_selected", { platform });
    if (inAppBrowser) return; // no button click target in that branch — copy-link only
    if (platform === "ios") {
      track("ios_install_guide_opened", { platform: "ios" });
      setIosGuideOpen(true);
      return;
    }
    if (platform === "android_chromium") {
      const outcome = await promptInstall();
      if (outcome === "unavailable") {
        toast.message(
          'To install: open your browser menu and choose "Install app" or "Add to Home screen."',
        );
      }
      return;
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setCopied(true);
      toast.success("Link copied");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy the link. Long-press the address bar to copy it instead.");
    }
  }

  if (inAppBrowser) {
    return (
      <div className={className}>
        <div className="rounded-2xl border border-border bg-muted/40 px-4 py-3">
          <p className="text-sm font-medium text-foreground">Installation works best in Safari</p>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            You're viewing KainFit inside {inAppBrowserLabel(inAppBrowser)}. Copy this link and open
            it in Safari or Chrome to install KainFit on your Home Screen.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={copyLink}
            className="mt-3 h-10 rounded-xl"
          >
            {copied ? (
              <Check className="h-4 w-4 mr-1.5" aria-hidden="true" />
            ) : (
              <Copy className="h-4 w-4 mr-1.5" aria-hidden="true" />
            )}
            {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
      </div>
    );
  }

  if (platform === "unknown") return null;

  return (
    <>
      <div className={className}>
        {variant === "landing" ? (
          <Button
            type="button"
            variant="outline"
            onClick={handleClick}
            className="w-full h-12 rounded-2xl"
          >
            <Download className="h-4 w-4 mr-2" aria-hidden="true" />
            Install KainFit
          </Button>
        ) : (
          <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-4">
            <p className="text-sm font-semibold text-foreground">Keep KainFit one tap away.</p>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              Install it on your Home Screen for faster daily logging.
            </p>
            <Button type="button" onClick={handleClick} className="mt-3 w-full h-11 rounded-2xl">
              <Download className="h-4 w-4 mr-2" aria-hidden="true" />
              Install KainFit
            </Button>
          </div>
        )}
        {platform === "desktop" && (
          <p className="mt-2 text-xs text-muted-foreground text-center">
            Or use your browser's own install icon in the address bar.
          </p>
        )}
        <p className="mt-1.5 text-[11px] text-muted-foreground text-center">
          Add KainFit to your Home Screen for faster access.
        </p>
      </div>

      <Dialog open={iosGuideOpen} onOpenChange={setIosGuideOpen}>
        <DialogContent className="max-w-sm rounded-3xl">
          <DialogHeader>
            <DialogTitle>Install KainFit on iPhone</DialogTitle>
            <DialogDescription>
              Add KainFit to your Home Screen for one-tap access, just like a regular app.
            </DialogDescription>
          </DialogHeader>
          <ol className="space-y-3 text-sm">
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold">
                1
              </span>
              <span className="pt-0.5 inline-flex items-center gap-1.5">
                Tap the Share button
                <Share className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold">
                2
              </span>
              <span className="pt-0.5 inline-flex items-center gap-1.5">
                Choose "Add to Home Screen"
                <SquarePlus className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold">
                3
              </span>
              <span className="pt-0.5 inline-flex items-center gap-1.5">
                Tap "Add"
                <Plus className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              </span>
            </li>
          </ol>
          <DialogFooter>
            <Button onClick={() => setIosGuideOpen(false)} className="w-full h-11 rounded-2xl">
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function inAppBrowserLabel(app: NonNullable<ReturnType<typeof useInstallPrompt>["inAppBrowser"]>) {
  switch (app) {
    case "instagram":
      return "Instagram";
    case "facebook":
      return "Facebook";
    case "messenger":
      return "Messenger";
    case "tiktok":
      return "TikTok";
  }
}
