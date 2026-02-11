// src/app/(dashboard)/app/page.tsx
// Dashboard v1 (inspirado no estilo SaaS da imagem): cards + ações claras + estado vazio.
// Assumindo shadcn/ui + Tailwind já configurados no projeto.

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type DashboardData = {
  userEmail: string;
  tenantName: string;
  tone?: string | null;
  handoffMode?: string | null;

  // Métricas (podem começar como 0/undefined)
  conversationsToday?: number | null;
  upcomingAppointments?: number | null;
  nextAppointmentAt?: string | null; // ex: "Hoje 14:00" ou ISO formatado no server
  statusLabel?: string | null; // "Em teste" | "Ativo"
};

async function getDashboardData(): Promise<DashboardData> {
  // MVP: buscar tudo do bootstrap (ou criar /api/app/dashboard depois).
  // Aqui: exemplo simples chamando bootstrap e derivando o que der.
  // Se preferir, mantenha hardcoded até a etapa de appointments estar pronta.

  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/api/app/bootstrap`, {
      // importante no Next app router: para server component com auth via cookies
      cache: "no-store",
      credentials: "include",
    });

    if (!res.ok) throw new Error("bootstrap failed");

    const json = await res.json();

    const tenantName = json?.tenant?.name ?? "Seu negócio";
    const tone = json?.tenant_setting?.tone ?? null;
    const handoffMode = json?.tenant_setting?.handoff_mode ?? null;

    // Quando você tiver appointments:
    // - upcomingAppointments: GET /api/app/appointments (hoje→+30d)
    // - nextAppointmentAt: derivar do primeiro item
    // - conversationsToday: quando tiver conversations reais, contar por data
    return {
      userEmail: json?.user?.email ?? "—",
      tenantName,
      tone,
      handoffMode,
      conversationsToday: 0,
      upcomingAppointments: 0,
      nextAppointmentAt: null,
      statusLabel: "Em teste",
    };
  } catch {
    // fallback para não quebrar a UI
    return {
      userEmail: "—",
      tenantName: "Seu negócio",
      tone: null,
      handoffMode: null,
      conversationsToday: 0,
      upcomingAppointments: 0,
      nextAppointmentAt: null,
      statusLabel: "Em teste",
    };
  }
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
      {children}
    </span>
  );
}

function MetricCard({
  title,
  value,
  helper,
}: {
  title: string;
  value: React.ReactNode;
  helper?: string;
}) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold tracking-tight">{value}</div>
        {helper ? <p className="mt-1 text-xs text-muted-foreground">{helper}</p> : null}
      </CardContent>
    </Card>
  );
}

export default async function AppDashboardPage() {
  const data = await getDashboardData();

  const hasAnyActivity =
    (data.conversationsToday ?? 0) > 0 || (data.upcomingAppointments ?? 0) > 0;

  return (
    <main className="min-h-[calc(100vh-64px)] bg-background">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
        {/* Header */}
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight">
              Painel do <span className="text-primary">{data.tenantName}</span>
            </h1>
            <p className="text-sm text-muted-foreground">
              Bem-vindo, {data.userEmail}.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Badge>Status: {data.statusLabel ?? "—"}</Badge>
              {data.tone ? <Badge>Tom: {data.tone}</Badge> : null}
              {data.handoffMode ? <Badge>Handoff: {data.handoffMode}</Badge> : null}
            </div>
          </div>

          {/* Quick actions (top right) */}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild className="w-full sm:w-auto">
              <Link href="/app/simulator">Testar atendimento</Link>
            </Button>
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link href="/app/settings">Configurar bot</Link>
            </Button>
          </div>
        </div>

        {/* Metrics grid */}
        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Atendimentos hoje"
            value={data.conversationsToday ?? 0}
            helper="Conversas iniciadas hoje"
          />
          <MetricCard
            title="Agendamentos futuros"
            value={data.upcomingAppointments ?? 0}
            helper="Confirmados"
          />
          <MetricCard
            title="Próximo horário"
            value={data.nextAppointmentAt ? data.nextAppointmentAt : "—"}
            helper={data.nextAppointmentAt ? "Próximo agendamento" : "Nenhum agendamento futuro"}
          />
          <MetricCard
            title="Atendimento"
            value={data.statusLabel ?? "—"}
            helper="Modo atual do sistema"
          />
        </div>

        {/* Primary actions row */}
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Agenda</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Veja próximos horários, cancele ou gerencie sua agenda.
              </p>
              <Button asChild variant="secondary">
                <Link href="/app/agenda">Ver agenda</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Simulador</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Teste o atendimento com dados reais do seu tenant.
              </p>
              <Button asChild variant="secondary">
                <Link href="/app/simulator">Abrir simulador</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Configurações</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Ajuste serviços, horários, equipe, tom e handoff.
              </p>
              <Button asChild variant="secondary">
                <Link href="/app/settings">Abrir configurações</Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Empty state / guidance */}
        {!hasAnyActivity ? (
          <Card className="mt-6 border-dashed shadow-sm">
            <CardContent className="flex flex-col gap-3 py-6">
              <div className="space-y-1">
                <p className="text-sm font-medium">Seu painel ainda está vazio.</p>
                <p className="text-sm text-muted-foreground">
                  Comece testando o atendimento no simulador. Quando você confirmar um agendamento,
                  ele vai aparecer automaticamente na agenda.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button asChild>
                  <Link href="/app/simulator">Testar atendimento</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/app/settings">Revisar configurações</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </main>
  );
}


// (Opcional) Se você quiser deixar a nave mais "SaaS" já:
// src/app/(dashboard)/layout.tsx
// Um header simples com marca + links e container consistente.

import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 md:px-6">
          <Link href="/app" className="font-semibold tracking-tight">
            Nevo
          </Link>

          <nav className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/app/agenda">Agenda</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/app/settings">Configurações</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/app/simulator">Simulador</Link>
            </Button>
          </nav>
        </div>
      </header>

      {children}
    </div>
  );
}
