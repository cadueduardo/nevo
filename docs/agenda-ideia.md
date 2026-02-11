/**
 * INSTRUÇÕES PARA O CURSOR (LEIA PRIMEIRO)
 * ---------------------------------------
 * Objetivo: substituir a UI atual da agenda (/app/agenda) por uma versão mobile-first
 * inspirada na referência (chips de semana + timeline do dia + cards grandes),
 * com boa responsividade no desktop (2 colunas).
 *
 * O bloco abaixo contém TODOS os arquivos necessários. Aplique criando/substituindo
 * os arquivos exatamente nos paths indicados.
 *
 * Dependências assumidas (já usuais no seu projeto):
 * - Tailwind
 * - shadcn/ui: Card, Button, Badge, Drawer (ou Sheet), Separator
 *
 * IMPORTANTE:
 * 1) Este componente busca agendamentos em:
 *    GET /api/app/appointments?from=YYYY-MM-DD&to=YYYY-MM-DD
 *    Retorno esperado: { items: Appointment[] } OU Appointment[] (o código trata ambos).
 * 2) Cancelamento tenta:
 *    PATCH /api/app/appointments/{id}  body: { status: "cancelled" }
 *    Se sua API for diferente, ajuste a função cancelAppointment() no final.
 * 3) Intervalo de timeline: por padrão 08:00–20:00.
 *    Se quiser usar o schedule real do tenant, ajuste START_HOUR / END_HOUR.
 *
 * 4) Caso seu shadcn não tenha Drawer, troque por Sheet (mesma ideia) ou Dialog.
 *
 * 5) Após aplicar, verifique:
 *    - Mobile: chips roláveis + timeline com scroll
 *    - Desktop: 2 colunas (timeline + próximos)
 */

/* =======================================================================================
   FILE: src/features/agenda/types.ts
======================================================================================= */
export type AppointmentStatus = "confirmed" | "cancelled" | "rescheduled";

export type Appointment = {
  id: string;
  attendee_name: string | null;
  staff_name: string | null;
  service_names: string[]; // MVP: nomes
  start_at: string; // ISO
  end_at: string;   // ISO
  status: AppointmentStatus;
  created_at?: string;
};

/* =======================================================================================
   FILE: src/features/agenda/utils.ts
======================================================================================= */
import type { Appointment } from "./types";

export const START_HOUR = 8;
export const END_HOUR = 20;

export function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

export function startOfWeek(d: Date, weekStartsOnMonday = true) {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 Sun..6 Sat
  const diff = weekStartsOnMonday ? (day === 0 ? -6 : 1 - day) : -day;
  return addDays(x, diff);
}

export function endOfWeek(d: Date, weekStartsOnMonday = true) {
  const s = startOfWeek(d, weekStartsOnMonday);
  return addDays(s, 6);
}

export function toISODate(d: Date) {
  // YYYY-MM-DD local
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatWeekLabel(from: Date, to: Date) {
  const fmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });
  return `${fmt.format(from)} – ${fmt.format(to)}`;
}

export function formatDayChip(d: Date) {
  const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "short" }).format(d).replace(".", "");
  const day = new Intl.DateTimeFormat("pt-BR", { day: "2-digit" }).format(d);
  return { weekday, day };
}

export function formatDateLong(d: Date) {
  const fmt = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  return fmt.format(d);
}

export function formatTime(d: Date) {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(d);
}

export function minutesSinceStartHour(date: Date) {
  const start = new Date(date);
  start.setHours(START_HOUR, 0, 0, 0);
  return Math.max(0, Math.round((date.getTime() - start.getTime()) / 60000));
}

export function minutesBetween(a: Date, b: Date) {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function dayKey(d: Date) {
  return toISODate(d);
}

export function isSameISODate(a: Date, b: Date) {
  return toISODate(a) === toISODate(b);
}

export function parseISO(iso: string) {
  // ISO -> Date (browser local timezone display)
  return new Date(iso);
}

export function groupAppointmentsByDay(items: Appointment[]) {
  const map = new Map<string, Appointment[]>();
  for (const appt of items) {
    const d = toISODate(parseISO(appt.start_at));
    const arr = map.get(d) ?? [];
    arr.push(appt);
    map.set(d, arr);
  }
  for (const [k, arr] of map.entries()) {
    arr.sort((a, b) => parseISO(a.start_at).getTime() - parseISO(b.start_at).getTime());
    map.set(k, arr);
  }
  return map;
}

export function getWeekDays(anchor: Date) {
  const s = startOfWeek(anchor, true);
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
}

/* =======================================================================================
   FILE: src/features/agenda/components/WeekStrip.tsx
======================================================================================= */
"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDayChip, formatWeekLabel, getWeekDays, endOfWeek, startOfWeek } from "../utils";

export function WeekStrip({
  value,
  onChange,
  onPrevWeek,
  onNextWeek,
  onToday,
}: {
  value: Date;
  onChange: (d: Date) => void;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
}) {
  const days = React.useMemo(() => getWeekDays(value), [value]);
  const from = startOfWeek(value, true);
  const to = endOfWeek(value, true);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-muted-foreground">
          {formatWeekLabel(from, to)}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onPrevWeek}>
            ←
          </Button>
          <Button variant="outline" size="sm" onClick={onToday}>
            Hoje
          </Button>
          <Button variant="outline" size="sm" onClick={onNextWeek}>
            →
          </Button>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {days.map((d) => {
          const { weekday, day } = formatDayChip(d);
          const active = d.toDateString() === value.toDateString();
          return (
            <button
              key={d.toISOString()}
              onClick={() => onChange(d)}
              className={cn(
                "shrink-0 rounded-2xl border px-3 py-2 text-left transition",
                "min-w-[74px]",
                active ? "border-primary bg-primary/10" : "bg-background hover:bg-muted/50"
              )}
            >
              <div className={cn("text-xs", active ? "text-primary" : "text-muted-foreground")}>
                {weekday}
              </div>
              <div className="text-base font-semibold">{day}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* =======================================================================================
   FILE: src/features/agenda/components/AppointmentCard.tsx
======================================================================================= */
"use client";

import * as React from "react";
import type { Appointment } from "../types";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatTime, parseISO } from "../utils";

function leftAccent(status: Appointment["status"]) {
  // Sutil e consistente com seu dashboard (sem virar carnaval)
  if (status === "cancelled") return "bg-muted-foreground/30";
  if (status === "rescheduled") return "bg-primary/40";
  return "bg-primary";
}

export function AppointmentCard({
  appt,
  style,
  onClick,
}: {
  appt: Appointment;
  style?: React.CSSProperties;
  onClick?: () => void;
}) {
  const start = parseISO(appt.start_at);
  const end = parseISO(appt.end_at);
  const title = appt.service_names?.[0] ?? "Agendamento";
  const subtitleParts = [
    `${formatTime(start)}–${formatTime(end)}`,
    appt.attendee_name ?? "Cliente",
    appt.staff_name ?? null,
  ].filter(Boolean);

  return (
    <Card
      onClick={onClick}
      role="button"
      style={style}
      className={cn(
        "absolute left-14 right-2 cursor-pointer select-none rounded-2xl border shadow-sm",
        "transition hover:shadow-md"
      )}
    >
      <div className="flex h-full overflow-hidden rounded-2xl">
        <div className={cn("w-1.5", leftAccent(appt.status))} />
        <div className="flex flex-col gap-1 p-3">
          <div className={cn("text-sm font-semibold leading-tight", appt.status === "cancelled" && "line-through text-muted-foreground")}>
            {title}
          </div>
          <div className="text-xs text-muted-foreground">
            {subtitleParts.join(" · ")}
          </div>
        </div>
      </div>
    </Card>
  );
}

/* =======================================================================================
   FILE: src/features/agenda/components/AppointmentDrawer.tsx
   - Se você não tiver Drawer do shadcn, substitua por Sheet ou Dialog.
======================================================================================= */
"use client";

import * as React from "react";
import type { Appointment } from "../types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Drawer, DrawerClose, DrawerContent, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { formatDateLong, formatTime, parseISO } from "../utils";

function statusLabel(s: Appointment["status"]) {
  if (s === "confirmed") return "Confirmado";
  if (s === "cancelled") return "Cancelado";
  return "Remarcado";
}

export function AppointmentDrawer({
  open,
  onOpenChange,
  appt,
  onCancel,
  cancelling,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  appt: Appointment | null;
  onCancel: (id: string) => Promise<void>;
  cancelling?: boolean;
}) {
  if (!appt) return null;

  const start = parseISO(appt.start_at);
  const end = parseISO(appt.end_at);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-w-2xl">
        <DrawerHeader>
          <DrawerTitle className="text-lg">
            {appt.service_names?.[0] ?? "Agendamento"}
          </DrawerTitle>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant="secondary">{statusLabel(appt.status)}</Badge>
            {appt.staff_name ? <Badge variant="outline">Profissional: {appt.staff_name}</Badge> : null}
          </div>
          <div className="mt-3 space-y-1 text-sm text-muted-foreground">
            <div>{formatDateLong(start)}</div>
            <div>
              {formatTime(start)} – {formatTime(end)}
            </div>
            <div>Cliente: {appt.attendee_name ?? "—"}</div>
            <div>Serviços: {appt.service_names?.join(", ") || "—"}</div>
          </div>
        </DrawerHeader>

        <DrawerFooter className="gap-2">
          <DrawerClose asChild>
            <Button variant="outline">Fechar</Button>
          </DrawerClose>

          <Button
            disabled={appt.status === "cancelled" || cancelling}
            onClick={() => onCancel(appt.id)}
          >
            {appt.status === "cancelled" ? "Já cancelado" : cancelling ? "Cancelando..." : "Cancelar agendamento"}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

/* =======================================================================================
   FILE: src/features/agenda/components/DayTimeline.tsx
======================================================================================= */
"use client";

import * as React from "react";
import type { Appointment } from "../types";
import { AppointmentCard } from "./AppointmentCard";
import { START_HOUR, END_HOUR, clamp, minutesBetween, minutesSinceStartHour, parseISO } from "../utils";
import { cn } from "@/lib/utils";

const PX_PER_MINUTE = 1.6; // Ajuste fino do “look” (mais alto = mais espaçoso)

function hourLabel(h: number) {
  return `${String(h).padStart(2, "0")}:00`;
}

export function DayTimeline({
  day,
  items,
  onSelect,
}: {
  day: Date;
  items: Appointment[];
  onSelect: (appt: Appointment) => void;
}) {
  const totalMinutes = (END_HOUR - START_HOUR) * 60;
  const heightPx = totalMinutes * PX_PER_MINUTE;

  return (
    <div className="rounded-2xl border bg-background shadow-sm">
      <div className="relative overflow-hidden rounded-2xl">
        <div className="relative overflow-y-auto" style={{ maxHeight: "70vh" }}>
          <div className="relative" style={{ height: heightPx }}>
            {/* Hour grid */}
            {Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i).map((h) => {
              const top = (h - START_HOUR) * 60 * PX_PER_MINUTE;
              return (
                <div key={h} className="absolute left-0 right-0" style={{ top }}>
                  <div className="flex items-center gap-3">
                    <div className="w-14 px-2 text-xs text-muted-foreground">{hourLabel(h)}</div>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                </div>
              );
            })}

            {/* Appointments */}
            {items.map((appt) => {
              const s = parseISO(appt.start_at);
              const e = parseISO(appt.end_at);

              const startMin = minutesSinceStartHour(s);
              const durMin = minutesBetween(s, e);

              const top = clamp(startMin, 0, totalMinutes) * PX_PER_MINUTE;
              const height = clamp(durMin, 18, totalMinutes) * PX_PER_MINUTE; // min height ~ 18min

              return (
                <AppointmentCard
                  key={appt.id}
                  appt={appt}
                  onClick={() => onSelect(appt)}
                  style={{ top, height }}
                />
              );
            })}

            {/* Subtle "now" indicator (optional) */}
            <NowLine />
          </div>
        </div>
      </div>
    </div>
  );
}

function NowLine() {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const h = now.getHours();
  if (h < START_HOUR || h > END_HOUR) return null;

  const totalMinutes = (END_HOUR - START_HOUR) * 60;
  const top = clamp(minutesSinceStartHour(now), 0, totalMinutes) * PX_PER_MINUTE;

  return (
    <div className={cn("absolute left-0 right-0")} style={{ top }}>
      <div className="flex items-center gap-3">
        <div className="w-14 px-2 text-[10px] text-muted-foreground">agora</div>
        <div className="h-px flex-1 bg-primary/40" />
      </div>
    </div>
  );
}

/* =======================================================================================
   FILE: src/features/agenda/components/UpcomingList.tsx
======================================================================================= */
"use client";

import * as React from "react";
import type { Appointment } from "../types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTime, parseISO } from "../utils";
import { cn } from "@/lib/utils";

export function UpcomingList({
  items,
  onSelect,
}: {
  items: Appointment[];
  onSelect: (appt: Appointment) => void;
}) {
  return (
    <Card className="rounded-2xl shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Próximos agendamentos</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum agendamento nos próximos dias.</p>
        ) : (
          items.slice(0, 8).map((a) => {
            const s = parseISO(a.start_at);
            const title = a.service_names?.[0] ?? "Agendamento";
            const sub = [formatTime(s), a.attendee_name ?? "Cliente", a.staff_name ?? null].filter(Boolean).join(" · ");
            return (
              <button
                key={a.id}
                onClick={() => onSelect(a)}
                className={cn(
                  "w-full rounded-xl border p-3 text-left transition",
                  "hover:bg-muted/40"
                )}
              >
                <div className={cn("text-sm font-semibold", a.status === "cancelled" && "line-through text-muted-foreground")}>
                  {title}
                </div>
                <div className="text-xs text-muted-foreground">{sub}</div>
              </button>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

/* =======================================================================================
   FILE: src/app/(dashboard)/app/agenda/page.tsx
   - Página de Agenda mobile-first + desktop 2 colunas
======================================================================================= */
"use client";

import * as React from "react";
import type { Appointment } from "@/features/agenda/types";
import { WeekStrip } from "@/features/agenda/components/WeekStrip";
import { DayTimeline } from "@/features/agenda/components/DayTimeline";
import { UpcomingList } from "@/features/agenda/components/UpcomingList";
import { AppointmentDrawer } from "@/features/agenda/components/AppointmentDrawer";
import {
  addDays,
  dayKey,
  endOfWeek,
  formatDateLong,
  getWeekDays,
  groupAppointmentsByDay,
  startOfWeek,
  toISODate,
  parseISO,
  isSameISODate,
} from "@/features/agenda/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type LoadState = "idle" | "loading" | "error" | "ready";

async function fetchAppointments(fromISO: string, toISO: string): Promise<Appointment[]> {
  const qs = new URLSearchParams({ from: fromISO, to: toISO });
  const res = await fetch(`/api/app/appointments?${qs.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error("failed");
  const json = await res.json();
  if (Array.isArray(json)) return json as Appointment[];
  if (Array.isArray(json?.items)) return json.items as Appointment[];
  if (Array.isArray(json?.data)) return json.data as Appointment[];
  return [];
}

async function cancelAppointment(id: string): Promise<void> {
  // Ajuste se sua rota for diferente:
  const res = await fetch(`/api/app/appointments/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "cancelled" }),
  });
  if (!res.ok) throw new Error("cancel failed");
}

export default function AgendaPage() {
  const [anchor, setAnchor] = React.useState(() => new Date());
  const [selectedDay, setSelectedDay] = React.useState(() => new Date());
  const [state, setState] = React.useState<LoadState>("idle");
  const [items, setItems] = React.useState<Appointment[]>([]);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [selectedAppt, setSelectedAppt] = React.useState<Appointment | null>(null);
  const [cancelling, setCancelling] = React.useState(false);

  const from = React.useMemo(() => startOfWeek(anchor, true), [anchor]);
  const to = React.useMemo(() => endOfWeek(anchor, true), [anchor]);

  const fromISO = React.useMemo(() => toISODate(from), [from]);
  const toISO = React.useMemo(() => toISODate(addDays(to, 1)), [to]); // exclusivo

  const grouped = React.useMemo(() => groupAppointmentsByDay(items), [items]);
  const dayItems = React.useMemo(() => grouped.get(dayKey(selectedDay)) ?? [], [grouped, selectedDay]);

  const upcoming = React.useMemo(() => {
    // próximos a partir de agora
    const now = Date.now();
    return items
      .filter((a) => parseISO(a.end_at).getTime() >= now && a.status !== "cancelled")
      .sort((a, b) => parseISO(a.start_at).getTime() - parseISO(b.start_at).getTime());
  }, [items]);

  const hasWeekData = items.length > 0;

  const load = React.useCallback(async () => {
    setState("loading");
    try {
      const data = await fetchAppointments(fromISO, toISO);
      setItems(data);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [fromISO, toISO]);

  React.useEffect(() => {
    load();
  }, [load]);

  React.useEffect(() => {
    // se selectedDay sair da semana ao trocar, ajusta automaticamente
    const weekDays = getWeekDays(anchor);
    const inWeek = weekDays.some((d) => isSameISODate(d, selectedDay));
    if (!inWeek) setSelectedDay(weekDays[0]);
  }, [anchor, selectedDay]);

  const onPrevWeek = () => setAnchor((d) => addDays(d, -7));
  const onNextWeek = () => setAnchor((d) => addDays(d, 7));
  const onToday = () => {
    const t = new Date();
    setAnchor(t);
    setSelectedDay(t);
  };

  const onSelectAppt = (appt: Appointment) => {
    setSelectedAppt(appt);
    setDrawerOpen(true);
  };

  const onCancel = async (id: string) => {
    try {
      setCancelling(true);
      await cancelAppointment(id);
      // otimista: atualizar no estado
      setItems((prev) => prev.map((a) => (a.id === id ? { ...a, status: "cancelled" } : a)));
      setSelectedAppt((prev) => (prev && prev.id === id ? { ...prev, status: "cancelled" } : prev));
    } finally {
      setCancelling(false);
    }
  };

  return (
    <main className="min-h-[calc(100vh-64px)] bg-background">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
        {/* Header */}
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight">Agenda</h1>
            <p className="text-sm text-muted-foreground">
              Visualize sua semana e toque em um agendamento para ver detalhes.
            </p>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={load} disabled={state === "loading"}>
              {state === "loading" ? "Atualizando..." : "Atualizar"}
            </Button>
            <Button onClick={() => alert("MVP: bloquear horário vem na próxima etapa")}>
              Bloquear horário
            </Button>
          </div>
        </div>

        {/* Week strip */}
        <div className="mt-6">
          <WeekStrip
            value={selectedDay}
            onChange={(d) => setSelectedDay(d)}
            onPrevWeek={onPrevWeek}
            onNextWeek={onNextWeek}
            onToday={onToday}
          />
        </div>

        {/* Content */}
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
          {/* Left: Timeline */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">
                {formatDateLong(selectedDay)}
              </div>
              <div className="text-xs text-muted-foreground">
                {dayItems.length} agendamento(s) neste dia
              </div>
            </div>

            {state === "error" ? (
              <Card className="rounded-2xl border-dashed">
                <CardContent className="py-8">
                  <p className="text-sm font-medium">Não foi possível carregar sua agenda.</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Verifique sua API /api/app/appointments e tente novamente.
                  </p>
                  <div className="mt-4">
                    <Button onClick={load}>Tentar novamente</Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <DayTimeline day={selectedDay} items={dayItems} onSelect={onSelectAppt} />
            )}

            {!hasWeekData && state === "ready" ? (
              <Card className="rounded-2xl border-dashed">
                <CardContent className="py-6">
                  <p className="text-sm font-medium">Sua semana está vazia.</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Confirme um agendamento no simulador para ver ele aparecer aqui.
                  </p>
                </CardContent>
              </Card>
            ) : null}
          </div>

          {/* Right: Upcoming list (desktop) */}
          <div className="space-y-4">
            <UpcomingList items={upcoming} onSelect={onSelectAppt} />
            <Card className="rounded-2xl shadow-sm">
              <CardContent className="py-5 text-sm text-muted-foreground">
                Dica: no mobile, use os chips acima para trocar o dia rapidamente.
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <AppointmentDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        appt={selectedAppt}
        onCancel={onCancel}
        cancelling={cancelling}
      />
    </main>
  );
}

/* =======================================================================================
   NOTAS FINAIS (para o Cursor)
======================================================================================= *
 * 1) Se você não tiver /api/app/appointments/{id} (PATCH), implemente ou ajuste o path.
 *    Alternativa: PATCH /api/app/appointments com {id, status}.
 *
 * 2) Para performance, depois você pode:
 *    - Cachear appointments por semana no client
 *    - Implementar SSR (server component) para primeira carga
 *
 * 3) Para integrar com schedule real do tenant:
 *    - Busque schedule no bootstrap
 *    - Calcule START_HOUR/END_HOUR dinamicamente
 *
 * 4) Para “ver a semana inteira” no desktop (grid de 7 colunas):
 *    - Faça uma v2 com WeekViewGrid, mas mantenha este DayTimeline como base mobile-first.
 *    - O padrão recomendado é: mobile = dia; desktop = semana (opcional).
 */
