import { localDateTime } from "@hms/api/lib/business-date";
import { practitionerDisplayName } from "@hms/api/lib/labels";
import { Badge } from "@hms/ui/components/badge";
import { Button, buttonVariants } from "@hms/ui/components/button";
import { Checkbox } from "@hms/ui/components/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@hms/ui/components/dropdown-menu";
import { Input } from "@hms/ui/components/input";
import { useQuery } from "@tanstack/react-query";
import { ClientOnly, Link, createFileRoute } from "@tanstack/react-router";
import { ChevronLeftIcon, ChevronRightIcon, MoreHorizontalIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { z } from "zod";

import { appHead } from "@/config/site";
import { ListState, ListToolbar, PageBody, PageHeader, Panel } from "@/components/page";
import {
  BookCaseDialog,
  CancelCaseDialog,
  ChangeCaseDialog,
  ConfirmCaseDialog,
  LinkAdmissionDialog,
  resourcesQuery,
  type TheatreCase,
} from "@/components/theatre-dialogs";
import { shift as shiftDay } from "@/lib/date-presets";
import { useCan } from "@/lib/membership";
import { currentMinute, useMinuteClock } from "@/lib/minute-clock";
import { OPERATIONAL_REFETCH } from "@/lib/operational-query";
import {
  formatBusinessDate,
  formatDateTime,
  formatTime,
  orgToday,
  useOrgDateTime,
} from "@/lib/org-datetime";
import { orpc } from "@/lib/orpc";
import { requireOrgPermission } from "@/lib/route-permission";

import { TheatreTabs } from "./route";

const isoDay = z.iso.date();

// The hospital's day, midnight to midnight in its own zone.
const scheduleQuery = (orgSlug: string, day: string, timeZone: string, cancelled: boolean) =>
  orpc.theatre.schedule.queryOptions({
    input: {
      orgSlug,
      from: localDateTime(`${day}T00:00`, timeZone),
      to: localDateTime(`${shiftDay(day, 1)}T00:00`, timeZone),
      includeCancelled: cancelled,
    },
    ...OPERATIONAL_REFETCH,
  });

export const Route = createFileRoute("/$orgSlug/theatre/")({
  head: () => appHead("Theatre schedule"),
  validateSearch: z.object({
    date: isoDay.optional().catch(undefined),
    cancelled: z.boolean().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ date: search.date, cancelled: search.cancelled ?? false }),
  loader: async ({ context: { queryClient }, deps, params: { orgSlug } }) => {
    const { timeZone } = await requireOrgPermission(
      queryClient,
      orgSlug,
      { theatre: ["read"] },
      "/$orgSlug/dashboard",
    );

    const day = deps.date ?? orgToday(timeZone);

    await Promise.all([
      queryClient.query(scheduleQuery(orgSlug, day, timeZone, deps.cancelled)).catch(() => {}),
      queryClient.query(resourcesQuery(orgSlug)).catch(() => {}),
    ]);

    // One clock for server and client render, so "has the case started" agrees.
    return { now: currentMinute() };
  },
  component: ScheduleRoute,
});

type Schedule = Awaited<ReturnType<typeof orpc.theatre.schedule.call>>;

type Block = Schedule["blocks"][number];

type DialogKind = "change" | "confirm" | "link" | "cancel";

type Open = "book" | { kind: DialogKind; theatreCase: TheatreCase } | null;

function ScheduleRoute() {
  const { orgSlug } = Route.useParams();
  const search = Route.useSearch();
  const { timeZone, today } = useOrgDateTime();
  const navigate = Route.useNavigate();
  const day = search.date ?? today;
  const cancelled = search.cancelled ?? false;
  const canSchedule = useCan(orgSlug, { theatre: ["schedule"] });
  const canManage = useCan(orgSlug, { theatre: ["manageResources"] });
  const [open, setOpen] = useState<Open>(null);
  const now = useMinuteClock(Route.useLoaderData().now);

  const schedule = useQuery(scheduleQuery(orgSlug, day, timeZone, cancelled));
  const resources = useQuery(resourcesQuery(orgSlug));
  const cases = schedule.data?.cases ?? [];
  const blocks = schedule.data?.blocks ?? [];
  const units = new Map((resources.data?.equipment ?? []).map((unit) => [unit.id, unit.name]));

  // Every active room, and any other room something is booked or blocked in that day.
  const rooms = (resources.data?.rooms ?? []).filter(
    (room) =>
      room.active ||
      cases.some((item) => item.roomId === room.id) ||
      blocks.some((block) => block.roomId === room.id),
  );

  const anyRoom = (resources.data?.rooms.length ?? 0) > 0;
  const unplaced = cases.filter((item) => item.roomId === null);
  const unitBlocks = blocks.filter((block) => block.equipmentId !== null);
  const close = () => setOpen(null);
  const caseDialog = open === "book" ? null : open;
  const span = (start: Date, end: Date) => <TimeSpan start={start} end={end} day={day} />;

  const caseRow = (item: TheatreCase) => (
    <CaseRow
      key={item.id}
      orgSlug={orgSlug}
      theatreCase={item}
      time={span(item.plannedStartAt, item.plannedEndAt)}
      started={item.plannedStartAt.getTime() < now}
      canSchedule={canSchedule}
      onOpen={(kind) => setOpen({ kind, theatreCase: item })}
    />
  );

  const blockRow = (block: Block, label: string) => (
    <li key={block.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
      <span className="font-medium break-words">
        {label}: {block.reason}
      </span>
      <span className="text-muted-foreground tabular-nums">
        {span(block.startsAt, block.endsAt)}
      </span>
    </li>
  );

  return (
    <>
      <PageHeader
        title="Theatre"
        action={canSchedule ? <Button onClick={() => setOpen("book")}>Book a case</Button> : null}
      />
      <TheatreTabs orgSlug={orgSlug} />

      <PageBody width="max-w-5xl">
        <ListToolbar>
          <nav aria-label="Day" className="flex items-center gap-1">
            <Link
              to="/$orgSlug/theatre"
              params={{ orgSlug }}
              search={{ ...search, date: shiftDay(day, -1) }}
              aria-label="Previous day"
              className={buttonVariants({ variant: "ghost", size: "icon" })}
            >
              <ChevronLeftIcon />
            </Link>
            <Input
              type="date"
              aria-label="Day"
              value={day}
              required
              className="w-36 tabular-nums"
              onChange={(event) => {
                const value = event.target.value;

                if (isoDay.safeParse(value).success)
                  void navigate({ search: { ...search, date: value } });
              }}
            />
            <Link
              to="/$orgSlug/theatre"
              params={{ orgSlug }}
              search={{ ...search, date: shiftDay(day, 1) }}
              aria-label="Next day"
              className={buttonVariants({ variant: "ghost", size: "icon" })}
            >
              <ChevronRightIcon />
            </Link>
            {day === today ? null : (
              <Link
                to="/$orgSlug/theatre"
                params={{ orgSlug }}
                search={{ ...search, date: undefined }}
                className={buttonVariants({ variant: "ghost" })}
              >
                Today
              </Link>
            )}
          </nav>
          <label className="ml-auto flex items-center gap-2">
            <Checkbox
              checked={cancelled}
              onCheckedChange={(checked) =>
                void navigate({ search: { ...search, cancelled: checked || undefined } })
              }
            />
            Show cancelled
          </label>
        </ListToolbar>

        <ListState
          query={schedule}
          errorTitle={`Could not load the schedule for ${formatBusinessDate(day)}`}
          isEmpty={false}
          empty={null}
        >
          <ListState
            query={resources}
            errorTitle="Could not load the theatre rooms"
            isEmpty={false}
            empty={null}
          >
            {rooms.length === 0 ? (
              <Panel label="Rooms" minHeight="">
                <p className="p-3 text-muted-foreground">
                  {anyRoom ? "No theatre room is in use." : "No theatre rooms yet. "}
                  {anyRoom ? null : canManage ? (
                    <Link
                      to="/$orgSlug/theatre/resources"
                      params={{ orgSlug }}
                      className="text-foreground underline underline-offset-4"
                    >
                      Add a room
                    </Link>
                  ) : (
                    "An administrator adds them."
                  )}
                </p>
              </Panel>
            ) : null}

            {rooms.map((room) => {
              const roomCases = cases.filter((item) => item.roomId === room.id);
              const roomBlocks = blocks.filter((block) => block.roomId === room.id);

              const rows = [
                ...roomBlocks.map((block) => ({
                  at: block.startsAt,
                  row: blockRow(block, "Blocked"),
                })),
                ...roomCases.map((item) => ({ at: item.bufferedStartAt, row: caseRow(item) })),
              ].sort((a, b) => a.at.getTime() - b.at.getTime());

              return (
                <Panel key={room.id} label={room.name} minHeight="">
                  {rows.length ? (
                    <ul className="divide-y divide-border">{rows.map(({ row }) => row)}</ul>
                  ) : (
                    <p className="p-3 text-muted-foreground">Nothing booked</p>
                  )}
                </Panel>
              );
            })}

            {unplaced.length ? (
              <Panel label="No room yet" minHeight="">
                <ul className="divide-y divide-border">{unplaced.map(caseRow)}</ul>
              </Panel>
            ) : null}

            {unitBlocks.length ? (
              <Panel label="Equipment out of use" minHeight="">
                <ul className="divide-y divide-border">
                  {unitBlocks.map((block) =>
                    blockRow(block, units.get(block.equipmentId!) ?? "Equipment"),
                  )}
                </ul>
              </Panel>
            ) : null}
          </ListState>
        </ListState>
      </PageBody>

      {open === "book" ? <BookCaseDialog orgSlug={orgSlug} day={day} onClose={close} /> : null}
      {caseDialog?.kind === "change" ? (
        <ChangeCaseDialog orgSlug={orgSlug} theatreCase={caseDialog.theatreCase} onClose={close} />
      ) : null}
      {caseDialog?.kind === "confirm" ? (
        <ConfirmCaseDialog orgSlug={orgSlug} theatreCase={caseDialog.theatreCase} onClose={close} />
      ) : null}
      {caseDialog?.kind === "link" ? (
        <LinkAdmissionDialog
          orgSlug={orgSlug}
          theatreCase={caseDialog.theatreCase}
          onClose={close}
        />
      ) : null}
      {caseDialog?.kind === "cancel" ? (
        <CancelCaseDialog orgSlug={orgSlug} theatreCase={caseDialog.theatreCase} onClose={close} />
      ) : null}
    </>
  );
}

/** Times on the shown day; the date as well for an end or start on another day. */
function TimeSpan({ start, end, day }: { start: Date; end: Date; day: string }) {
  const { timeZone } = useOrgDateTime();

  const at = (instant: Date) =>
    orgToday(timeZone, instant) === day
      ? formatTime(instant, timeZone)
      : formatDateTime(instant, timeZone);

  return (
    <span className="tabular-nums">
      {at(start)} – {at(end)}
    </span>
  );
}

const STATUS: Record<
  TheatreCase["status"],
  { label: string; variant: "outline" | "secondary" | "pending" | "muted" }
> = {
  draft: { label: "Draft", variant: "outline" },
  confirmed: { label: "Confirmed", variant: "secondary" },
  disrupted: { label: "Needs rescheduling", variant: "pending" },
  cancelled: { label: "Cancelled", variant: "muted" },
};

function CaseRow({
  orgSlug,
  theatreCase: item,
  time,
  started,
  canSchedule,
  onOpen,
}: {
  orgSlug: string;
  theatreCase: TheatreCase;
  time: ReactNode;
  /** A case whose start has passed is changed to a future time before it is confirmed. */
  started: boolean;
  canSchedule: boolean;
  onOpen: (kind: DialogKind) => void;
}) {
  const canReadIpd = useCan(orgSlug, { ipd: ["read"] });
  const status = STATUS[item.status];

  const reason =
    item.status === "disrupted"
      ? item.disruptedReason
      : item.status === "cancelled"
        ? item.cancelReason
        : null;

  const live = item.status !== "cancelled";

  const confirmable =
    (item.status === "draft" || item.status === "disrupted") && item.roomId && !started;

  const buffers = [
    item.prepMinutes ? `${item.prepMinutes} min prep` : null,
    item.cleanupMinutes ? `${item.cleanupMinutes} min clean-up` : null,
  ].filter(Boolean);

  const details = [
    item.procedureName,
    practitionerDisplayName(item.consultantName),
    ...item.equipment.map((unit) => unit.name),
  ];

  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-1 px-3 py-2">
      <div className="w-40 shrink-0">
        {time}
        {buffers.length ? (
          <span className="block text-muted-foreground">{buffers.join(" · ")}</span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
        <p className="break-words">
          <span className="font-medium capitalize">{item.patientName}</span>{" "}
          <span className="font-mono text-muted-foreground">{item.mrn}</span>
        </p>
        <p className="break-words">{details.join(" · ")}</p>
        {live ? (
          item.admissionId ? (
            canReadIpd ? (
              <Link
                to="/$orgSlug/ipd/$admissionId"
                params={{ orgSlug, admissionId: item.admissionId }}
                className="self-start underline underline-offset-4"
              >
                Admitted — open stay
              </Link>
            ) : (
              <p>Admitted</p>
            )
          ) : (
            <p className="text-muted-foreground">Not admitted yet</p>
          )
        ) : null}
        {item.notes ? <p className="break-words text-muted-foreground">{item.notes}</p> : null}
      </div>
      <div className="flex min-w-0 flex-col items-start gap-1 sm:w-40">
        <Badge variant={status.variant}>{status.label}</Badge>
        {reason ? <span className="break-words text-muted-foreground">{reason}</span> : null}
      </div>
      {canSchedule && live ? (
        <div className="ml-auto flex items-center gap-1">
          {confirmable ? (
            <Button
              variant="outline"
              aria-label={`Confirm the case for ${item.patientName}`}
              onClick={() => onOpen("confirm")}
            >
              Confirm
            </Button>
          ) : null}
          <Button
            variant="ghost"
            aria-label={`Change the case for ${item.patientName}`}
            onClick={() => onOpen("change")}
          >
            Change
          </Button>
          <ClientOnly fallback={null}>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon-xs" />}
                aria-label={`More for ${item.patientName}`}
              >
                <MoreHorizontalIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-40">
                {item.admissionId === null && canReadIpd ? (
                  <DropdownMenuItem onClick={() => onOpen("link")}>Link admission</DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onClick={() => onOpen("cancel")}>Cancel case</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </ClientOnly>
        </div>
      ) : null}
    </li>
  );
}
