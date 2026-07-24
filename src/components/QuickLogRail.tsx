import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Clock, Star, BookmarkPlus, Plus, Loader2, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { track, noteTapForRageDetection } from "@/lib/analytics";

// KainFit no longer categorizes meals by time of day. `meal_type` remains a
// required, non-null column with a fixed enum CHECK constraint in the
// database, so every insert still needs a value — this is a fixed
// compatibility placeholder, never shown in any UI.
const LEGACY_MEAL_TYPE = "snacks";

type SavedItem = {
  display_name: string;
  normalized_name: string;
  quantity: number;
  unit: string;
  preparation?: string | null;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  data_source: string;
  is_estimate: boolean;
};

type RecentRow = SavedItem & { id: string; last_at: string };
type FavoriteRow = SavedItem & { id: string; is_favorite: boolean };
type SavedMealRow = {
  id: string;
  name: string;
  items: SavedItem[];
  usage_count: number;
  last_used_at: string | null;
};

function createUuid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `x-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function scaleMacros(item: SavedItem, newQty: number): SavedItem {
  const q = item.quantity > 0 ? item.quantity : 1;
  const factor = newQty / q;
  return {
    ...item,
    quantity: newQty,
    calories: Math.round(item.calories * factor),
    protein_g: Math.round(item.protein_g * factor * 10) / 10,
    carbs_g: Math.round(item.carbs_g * factor * 10) / 10,
    fat_g: Math.round(item.fat_g * factor * 10) / 10,
  };
}

export type QuickLogRailProps = {
  todaysEntries: Array<{
    id: string;
    display_name: string;
    quantity: number;
    unit: string;
    preparation?: string | null;
    calories: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    data_source: string;
    is_estimate: boolean;
  }>;
};

/**
 * Recent / Favorites / My Meals rail. Every "Add" here bypasses the AI
 * pipeline entirely — it inserts snapshotted macros straight into
 * food_entries, so it never touches the daily beta AI cap.
 */
export function QuickLogRail({ todaysEntries }: QuickLogRailProps) {
  const [openTab, setOpenTab] = useState<"recent" | "favorites" | "meals" | null>(null);
  const [saveMealOpen, setSaveMealOpen] = useState(false);
  const [renaming, setRenaming] = useState<SavedMealRow | null>(null);
  const [editing, setEditing] = useState<{
    item: SavedItem;
    source: "recent" | "favorite" | "meal";
  } | null>(null);
  const [inserting, setInserting] = useState(false);
  const qc = useQueryClient();

  const userIdQ = useQuery({
    queryKey: ["user-id"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? null;
    },
    staleTime: 5 * 60_000,
  });
  const userId = userIdQ.data ?? null;

  const recentQ = useQuery({
    enabled: openTab === "recent" && !!userId,
    queryKey: ["quicklog", "recent", userId],
    staleTime: 30_000,
    queryFn: async (): Promise<RecentRow[]> => {
      const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const { data, error } = await supabase
        .from("food_entries")
        .select(
          "id,display_name,normalized_name,quantity,unit,preparation,calories,protein_g,carbs_g,fat_g,data_source,is_estimate,created_at",
        )
        .eq("user_id", userId!)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(80);
      if (error) throw error;
      // dedupe by normalized_name, keep most recent
      const seen = new Set<string>();
      const rows: RecentRow[] = [];
      for (const r of data ?? []) {
        const key = (r.normalized_name || r.display_name || "").toLowerCase().trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        rows.push({
          id: r.id as string,
          last_at: r.created_at as string,
          display_name: r.display_name as string,
          normalized_name: (r.normalized_name ?? r.display_name) as string,
          quantity: Number(r.quantity),
          unit: (r.unit as string) ?? "g",
          preparation: (r.preparation as string | null) ?? null,
          calories: Number(r.calories),
          protein_g: Number(r.protein_g),
          carbs_g: Number(r.carbs_g),
          fat_g: Number(r.fat_g),
          data_source: (r.data_source as string) ?? "user_history",
          is_estimate: Boolean(r.is_estimate),
        });
        if (rows.length >= 20) break;
      }
      return rows;
    },
  });

  const favQ = useQuery({
    enabled: openTab === "favorites" && !!userId,
    queryKey: ["quicklog", "favorites", userId],
    staleTime: 30_000,
    queryFn: async (): Promise<FavoriteRow[]> => {
      const { data, error } = await supabase
        .from("saved_foods")
        .select(
          "id,food_name,normalized_name,default_quantity,default_unit,calories,protein_g,carbs_g,fat_g,source,is_favorite,last_used_at",
        )
        .eq("user_id", userId!)
        .eq("is_favorite", true)
        .order("last_used_at", { ascending: false, nullsFirst: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id as string,
        display_name: r.food_name as string,
        normalized_name: (r.normalized_name ?? r.food_name) as string,
        quantity: Number(r.default_quantity ?? 100),
        unit: (r.default_unit as string) ?? "g",
        preparation: null,
        calories: Number(r.calories),
        protein_g: Number(r.protein_g),
        carbs_g: Number(r.carbs_g),
        fat_g: Number(r.fat_g),
        data_source: (r.source as string) ?? "favorite",
        is_estimate: false,
        is_favorite: true,
      }));
    },
  });

  const mealsQ = useQuery({
    enabled: openTab === "meals" && !!userId,
    queryKey: ["quicklog", "meals", userId],
    staleTime: 30_000,
    queryFn: async (): Promise<SavedMealRow[]> => {
      const { data, error } = await supabase
        .from("saved_meals")
        .select("id,name,items,usage_count,last_used_at")
        .eq("user_id", userId!)
        .order("last_used_at", { ascending: false, nullsFirst: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id as string,
        name: r.name as string,
        items: (r.items as SavedItem[]) ?? [],
        usage_count: Number(r.usage_count ?? 0),
        last_used_at: (r.last_used_at as string | null) ?? null,
      }));
    },
  });

  async function insertEntries(
    items: SavedItem[],
    analyticsEvent: "recent_item_reused" | "favorite_used" | "saved_meal_reused",
  ) {
    if (!userId || items.length === 0) return;
    setInserting(true);
    const loggedAt = new Date().toISOString();
    const rows = items.map((i) => ({
      user_id: userId,
      logged_at: loggedAt,
      meal_type: LEGACY_MEAL_TYPE,
      original_input: `[repeat] ${i.display_name}`,
      display_name: i.display_name,
      normalized_name: i.normalized_name,
      quantity: i.quantity,
      unit: i.unit,
      preparation: i.preparation ?? null,
      calories: Math.round(i.calories),
      protein_g: Math.round(i.protein_g),
      carbs_g: Math.round(i.carbs_g),
      fat_g: Math.round(i.fat_g),
      data_source: i.data_source || "user_history",
      confidence: 1,
      is_estimate: i.is_estimate,
      client_request_id: createUuid(),
    }));
    const { data, error } = await supabase.from("food_entries").insert(rows).select("*");
    setInserting(false);
    if (error) {
      toast.error("Couldn't add. Please retry.");
      return;
    }
    // Optimistic cache bump (matches Today's cache shape).
    qc.setQueryData<unknown[]>(["entries", "today"], (current = []) => {
      const list = Array.isArray(current) ? current : [];
      return [...(data ?? []), ...list];
    });
    await qc.invalidateQueries({ queryKey: ["entries", "today"] });
    track(analyticsEvent, { count: items.length });
    toast.success("Added to Today");
    setOpenTab(null);
    setEditing(null);
  }

  async function toggleFavorite(item: SavedItem) {
    if (!userId) return;
    // upsert into saved_foods keyed by normalized_name
    const { data: existing } = await supabase
      .from("saved_foods")
      .select("id,is_favorite")
      .eq("user_id", userId)
      .eq("normalized_name", item.normalized_name)
      .maybeSingle();
    if (existing) {
      const newVal = !existing.is_favorite;
      const { error } = await supabase
        .from("saved_foods")
        .update({ is_favorite: newVal, last_used_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (error) return toast.error("Couldn't update favorite");
      toast(newVal ? "Saved to Favorites" : "Removed from Favorites");
    } else {
      const { error } = await supabase.from("saved_foods").insert({
        user_id: userId,
        food_name: item.display_name,
        normalized_name: item.normalized_name,
        default_quantity: item.quantity,
        default_unit: item.unit,
        calories: item.calories,
        protein_g: item.protein_g,
        carbs_g: item.carbs_g,
        fat_g: item.fat_g,
        source: item.data_source,
        is_favorite: true,
        usage_count: 1,
        last_used_at: new Date().toISOString(),
      });
      if (error) return toast.error("Couldn't add favorite");
      toast("Saved to Favorites");
    }
    qc.invalidateQueries({ queryKey: ["quicklog", "favorites"] });
  }

  function nameFromItems(items: { display_name: string }[]): string {
    if (items.length === 0) return "";
    const names = items.map((i) => i.display_name);
    if (names.length <= 2) return names.join(" + ");
    return `${names.slice(0, 2).join(" + ")} +${names.length - 2} more`;
  }

  async function saveTodaysLogAsMeal(name: string) {
    if (!userId || todaysEntries.length === 0) return;
    const items: SavedItem[] = todaysEntries.map((e) => ({
      display_name: e.display_name,
      normalized_name: e.display_name,
      quantity: Number(e.quantity),
      unit: e.unit,
      preparation: e.preparation ?? null,
      calories: Number(e.calories),
      protein_g: Number(e.protein_g),
      carbs_g: Number(e.carbs_g),
      fat_g: Number(e.fat_g),
      data_source: e.data_source,
      is_estimate: Boolean(e.is_estimate),
    }));
    const { error } = await supabase.from("saved_meals").insert({
      user_id: userId,
      name: name.trim() || "My meal",
      items,
    });
    if (error) return toast.error("Couldn't save meal");
    toast.success("Meal saved");
    setSaveMealOpen(false);
    qc.invalidateQueries({ queryKey: ["quicklog", "meals"] });
    track("saved_meal_repeated", { action: "created", count: items.length });
  }

  async function deleteSavedMeal(meal: SavedMealRow) {
    const { error } = await supabase.from("saved_meals").delete().eq("id", meal.id);
    if (error) return toast.error("Couldn't delete meal");
    qc.invalidateQueries({ queryKey: ["quicklog", "meals"] });
    toast("Meal removed", {
      duration: 5000,
      action: {
        label: "Undo",
        onClick: async () => {
          if (!userId) return;
          await supabase.from("saved_meals").insert({
            user_id: userId,
            name: meal.name,
            items: meal.items,
          });
          qc.invalidateQueries({ queryKey: ["quicklog", "meals"] });
        },
      },
    });
  }

  async function renameSavedMeal(meal: SavedMealRow, newName: string) {
    const trimmed = newName.trim();
    setRenaming(null);
    if (!trimmed || trimmed === meal.name) return;
    const { error } = await supabase
      .from("saved_meals")
      .update({ name: trimmed })
      .eq("id", meal.id);
    if (error) return toast.error("Couldn't rename meal");
    qc.invalidateQueries({ queryKey: ["quicklog", "meals"] });
  }

  return (
    <>
      {/* Deliberately horizontally scrollable when the four chips don't
          all fit — the trailing pr-5 (wider than the leading px-1) gives
          the last chip breathing room instead of ending flush with the
          viewport edge, and the mask-image fade signals "more content"
          now that the native scrollbar is hidden. Without both, a partial
          last chip at rest reads as accidentally clipped rather than an
          intentional scroll affordance (see the 2026-07-25 production
          report: "+ Sa…" from "Save today as meal" cut mid-word). */}
      <div
        className="mt-4 flex gap-2 overflow-x-auto no-scrollbar px-1 -mx-1 pr-5"
        style={{
          maskImage: "linear-gradient(to right, black calc(100% - 24px), transparent 100%)",
          WebkitMaskImage: "linear-gradient(to right, black calc(100% - 24px), transparent 100%)",
        }}
      >
        <RailChip
          icon={<Clock className="h-3.5 w-3.5" />}
          label="Recent"
          onClick={() => setOpenTab("recent")}
        />
        <RailChip
          icon={<Star className="h-3.5 w-3.5" />}
          label="Favorites"
          onClick={() => setOpenTab("favorites")}
        />
        <RailChip
          icon={<BookmarkPlus className="h-3.5 w-3.5" />}
          label="My Meals"
          onClick={() => setOpenTab("meals")}
        />
        {todaysEntries.length > 0 && (
          <RailChip
            icon={<Plus className="h-3.5 w-3.5" />}
            label="Save as meal"
            onClick={() => setSaveMealOpen(true)}
            subtle
          />
        )}
      </div>

      <Sheet open={openTab !== null} onOpenChange={(o) => !o && setOpenTab(null)}>
        <SheetContent side="bottom" className="max-h-[85vh] rounded-t-3xl">
          <SheetHeader>
            <SheetTitle>
              {openTab === "recent" && "Recent foods"}
              {openTab === "favorites" && "Favorites"}
              {openTab === "meals" && "My meals"}
            </SheetTitle>
            <SheetDescription>
              Tap to add, or tap the pencil to adjust grams first.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 overflow-y-auto pb-8" style={{ maxHeight: "60vh" }}>
            {openTab === "recent" && (
              <ItemList
                loading={recentQ.isLoading}
                empty="Nothing logged in the last 30 days yet."
                rows={(recentQ.data ?? []).map((r) => ({
                  key: r.id,
                  item: r,
                  extra: (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        noteTapForRageDetection("quicklog_favorite_star");
                        toggleFavorite(r);
                      }}
                      className="h-10 w-10 flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-amber-500"
                      aria-label="Add to favorites"
                    >
                      <Star className="h-4 w-4" />
                    </button>
                  ),
                }))}
                onAdd={(item) => insertEntries([item], "recent_item_reused")}
                onEdit={(item) => setEditing({ item, source: "recent" })}
                inserting={inserting}
              />
            )}
            {openTab === "favorites" && (
              <ItemList
                loading={favQ.isLoading}
                empty="No favorites yet. Star an item from Recent to save it here."
                rows={(favQ.data ?? []).map((r) => ({
                  key: r.id,
                  item: r,
                  extra: (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        noteTapForRageDetection("quicklog_favorite_star");
                        toggleFavorite(r);
                      }}
                      className="h-10 w-10 flex items-center justify-center rounded-full text-amber-500 hover:bg-muted"
                      aria-label="Remove from favorites"
                    >
                      <Star className="h-4 w-4 fill-current" />
                    </button>
                  ),
                }))}
                onAdd={(item) => insertEntries([item], "favorite_used")}
                onEdit={(item) => setEditing({ item, source: "favorite" })}
                inserting={inserting}
              />
            )}
            {openTab === "meals" && (
              <MealList
                loading={mealsQ.isLoading}
                meals={mealsQ.data ?? []}
                onAdd={(meal) => insertEntries(meal.items, "saved_meal_reused")}
                onRename={(meal) => setRenaming(meal)}
                onDelete={deleteSavedMeal}
                inserting={inserting}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Grams edit sheet */}
      <Sheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          {editing && (
            <EditGramsPanel
              item={editing.item}
              inserting={inserting}
              onCancel={() => setEditing(null)}
              onConfirm={(scaled) =>
                insertEntries(
                  [scaled],
                  editing.source === "recent"
                    ? "recent_item_reused"
                    : editing.source === "favorite"
                      ? "favorite_used"
                      : "saved_meal_reused",
                )
              }
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Save today as meal dialog */}
      <Sheet open={saveMealOpen} onOpenChange={setSaveMealOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          <SaveMealPanel
            defaultName={nameFromItems(todaysEntries)}
            count={todaysEntries.length}
            onCancel={() => setSaveMealOpen(false)}
            onConfirm={saveTodaysLogAsMeal}
          />
        </SheetContent>
      </Sheet>

      {/* Rename saved meal */}
      <Sheet open={renaming !== null} onOpenChange={(o) => !o && setRenaming(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          {renaming && (
            <RenameMealPanel
              meal={renaming}
              onCancel={() => setRenaming(null)}
              onConfirm={(name) => renameSavedMeal(renaming, name)}
            />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function RailChip({
  icon,
  label,
  onClick,
  subtle,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  subtle?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 flex items-center gap-1.5 px-3 h-8 rounded-full text-xs font-medium border transition",
        // A solid, lighter-weight border reads as a genuine secondary
        // action; a dashed one reads as a placeholder or disabled control,
        // which is what made this chip look accidentally broken rather
        // than intentional (2026-07-25 fix).
        subtle
          ? "border-border/60 bg-transparent text-muted-foreground hover:text-foreground hover:border-primary/40"
          : "border-border bg-card text-foreground hover:border-primary/60",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function ItemList({
  loading,
  empty,
  rows,
  onAdd,
  onEdit,
  inserting,
}: {
  loading: boolean;
  empty: string;
  rows: Array<{ key: string; item: SavedItem; extra?: React.ReactNode }>;
  onAdd: (item: SavedItem) => void;
  onEdit: (item: SavedItem) => void;
  inserting: boolean;
}) {
  if (loading)
    return <div className="text-sm text-muted-foreground py-6 text-center">Loading…</div>;
  if (rows.length === 0)
    return <div className="text-sm text-muted-foreground py-6 text-center">{empty}</div>;
  return (
    <ul className="space-y-2">
      {rows.map(({ key, item, extra }) => (
        <li
          key={key}
          className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5"
        >
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{item.display_name}</div>
            <div className="text-[11px] text-muted-foreground">
              {Math.round(item.quantity)}
              {item.unit} · {Math.round(item.calories)} kcal · P{Math.round(item.protein_g)} C
              {Math.round(item.carbs_g)} F{Math.round(item.fat_g)}
            </div>
          </div>
          {extra}
          <button
            onClick={() => {
              noteTapForRageDetection("quicklog_edit_grams");
              onEdit(item);
            }}
            className="h-10 w-10 flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
            aria-label="Adjust grams"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <Button
            size="sm"
            className="h-8 rounded-full px-3"
            disabled={inserting}
            onClick={() => onAdd(item)}
          >
            {inserting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add
              </>
            )}
          </Button>
        </li>
      ))}
    </ul>
  );
}

function MealList({
  loading,
  meals,
  onAdd,
  onRename,
  onDelete,
  inserting,
}: {
  loading: boolean;
  meals: SavedMealRow[];
  onAdd: (meal: SavedMealRow) => void;
  onRename: (meal: SavedMealRow) => void;
  onDelete: (meal: SavedMealRow) => void;
  inserting: boolean;
}) {
  if (loading)
    return <div className="text-sm text-muted-foreground py-6 text-center">Loading…</div>;
  if (meals.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-6 text-center">
        No saved meals yet. Log a few foods then tap "Save today as meal" to make repeat logging one
        tap.
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {meals.map((m) => {
        const totals = m.items.reduce(
          (acc, i) => ({
            cal: acc.cal + Number(i.calories),
            p: acc.p + Number(i.protein_g),
            c: acc.c + Number(i.carbs_g),
            f: acc.f + Number(i.fat_g),
          }),
          { cal: 0, p: 0, c: 0, f: 0 },
        );
        return (
          <li
            key={m.id}
            className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5"
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{m.name}</div>
              <div className="text-[11px] text-muted-foreground">
                {m.items.length} items · {Math.round(totals.cal)} kcal · P{Math.round(totals.p)} C
                {Math.round(totals.c)} F{Math.round(totals.f)}
              </div>
            </div>
            <button
              onClick={() => onRename(m)}
              className="h-10 w-10 flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
              aria-label="Rename meal"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => onDelete(m)}
              className="h-10 w-10 flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-destructive"
              aria-label="Delete meal"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <Button
              size="sm"
              className="h-8 rounded-full px-3"
              disabled={inserting}
              onClick={() => onAdd(m)}
            >
              {inserting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add all
                </>
              )}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

function EditGramsPanel({
  item,
  inserting,
  onCancel,
  onConfirm,
}: {
  item: SavedItem;
  inserting: boolean;
  onCancel: () => void;
  onConfirm: (scaled: SavedItem) => void;
}) {
  const [qty, setQty] = useState<string>(String(Math.round(item.quantity)));
  const scaled = useMemo(() => scaleMacros(item, Number(qty) || 0), [item, qty]);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 40);
  }, []);
  return (
    <div className="py-2">
      <SheetHeader>
        <SheetTitle>{item.display_name}</SheetTitle>
        <SheetDescription>Adjust the amount before adding.</SheetDescription>
      </SheetHeader>
      <div className="mt-4 flex items-center gap-2">
        <Input
          ref={inputRef}
          type="number"
          inputMode="numeric"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="h-12 text-lg"
        />
        <span className="text-sm text-muted-foreground">{item.unit}</span>
      </div>
      <div className="mt-3 text-xs text-muted-foreground">
        {Math.round(scaled.calories)} kcal · P{Math.round(scaled.protein_g)} C
        {Math.round(scaled.carbs_g)} F{Math.round(scaled.fat_g)}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={inserting}>
          Cancel
        </Button>
        <Button onClick={() => onConfirm(scaled)} disabled={inserting || Number(qty) <= 0}>
          {inserting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add to Today"}
        </Button>
      </div>
    </div>
  );
}

function SaveMealPanel({
  defaultName,
  count,
  onCancel,
  onConfirm,
}: {
  defaultName: string;
  count: number;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}) {
  const [name, setName] = useState(defaultName);
  return (
    <div className="py-2">
      <SheetHeader>
        <SheetTitle>Save today's log as a meal</SheetTitle>
        <SheetDescription>
          {count} item{count === 1 ? "" : "s"} will be saved with their current amounts.
        </SheetDescription>
      </SheetHeader>
      <div className="mt-4">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. My go-to plate, Post-workout"
          className="h-12"
          autoFocus
        />
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => onConfirm(name)} disabled={!name.trim()}>
          Save meal
        </Button>
      </div>
    </div>
  );
}

function RenameMealPanel({
  meal,
  onCancel,
  onConfirm,
}: {
  meal: SavedMealRow;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}) {
  const [name, setName] = useState(meal.name);
  return (
    <div className="py-2">
      <SheetHeader>
        <SheetTitle>Rename meal</SheetTitle>
        <SheetDescription>Choose a new name for "{meal.name}".</SheetDescription>
      </SheetHeader>
      <div className="mt-4">
        <Input value={name} onChange={(e) => setName(e.target.value)} className="h-12" autoFocus />
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => onConfirm(name)} disabled={!name.trim()}>
          Save
        </Button>
      </div>
    </div>
  );
}
