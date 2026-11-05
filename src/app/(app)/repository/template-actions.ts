"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { fail, fromDbError, ok, type ActionResult } from "@/lib/actions"
import { requireAppContext } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"

type PayloadShape = {
  name: string
  reference_id?: string
  owner_id?: string
  start_date?: string
  end_date?: string
  requirements_from?: "start_date" | "today"
  uploaders: Record<string, string>
  slots: Record<string, PayloadShape[]>
}

// Shape check only; the database function enforces every business rule.
const payloadSchema: z.ZodType<PayloadShape> = z.lazy(() =>
  z.object({
    name: z.string().trim().min(1, "Every entry needs a name").max(120),
    reference_id: z.string().trim().max(60).optional(),
    owner_id: z.uuid().optional(),
    start_date: z.iso.date().optional(),
    end_date: z.iso.date().optional(),
    requirements_from: z.enum(["start_date", "today"]).optional(),
    uploaders: z.record(z.uuid(), z.uuid()),
    slots: z.record(z.uuid(), z.array(payloadSchema)),
  })
)

function refresh() {
  revalidatePath("/", "layout")
}

export async function createFromTemplate(
  parentFolderId: string,
  templateId: string,
  payload: unknown
): Promise<ActionResult<{ folderId: string }>> {
  await requireAppContext()
  const parsed = payloadSchema.safeParse(payload)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Some details are missing.")

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("instantiate_template", {
    p_parent_folder: parentFolderId,
    p_template: templateId,
    p_payload: parsed.data,
  })
  if (error) return fromDbError(error)

  refresh()
  return ok({ folderId: data as string })
}

export async function addSlotEntry(instanceId: string, slotNodeId: string, payload: unknown): Promise<ActionResult<{ folderId: string }>> {
  await requireAppContext()
  const parsed = payloadSchema.safeParse(payload)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Some details are missing.")

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("add_slot_entry", {
    p_instance: instanceId,
    p_slot_node: slotNodeId,
    p_entry: parsed.data,
  })
  if (error) return fromDbError(error)

  refresh()
  return ok({ folderId: data as string })
}

export async function reassignSeries(seriesId: string, uploaderId: string, reassignOpen: boolean): Promise<ActionResult> {
  await requireAppContext()
  if (!z.uuid().safeParse(uploaderId).success) return fail("Choose who uploads.")

  const supabase = await createClient()
  const { error } = await supabase.rpc("reassign_series", {
    p_series: seriesId,
    p_uploader: uploaderId,
    p_reassign_open: reassignOpen,
  })
  if (error) return fromDbError(error)

  refresh()
  return ok()
}

export async function setSeriesPaused(seriesId: string, paused: boolean): Promise<ActionResult<{ created: number }>> {
  await requireAppContext()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("set_series_paused", { p_series: seriesId, p_paused: paused })
  if (error) return fromDbError(error)
  refresh()
  return ok({ created: (data as number) ?? 0 })
}

/** endDate null removes the end date and restarts the series from the current period. */
export async function setSeriesEnd(seriesId: string, endDate: string | null): Promise<ActionResult<{ created: number }>> {
  await requireAppContext()
  if (endDate !== null && !z.iso.date().safeParse(endDate).success) return fail("Choose a valid end date.")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("set_series_end", { p_series: seriesId, p_end_date: endDate })
  if (error) return fromDbError(error)
  refresh()
  return ok({ created: (data as number) ?? 0 })
}

/** Corrects an instance's dates (e.g. a semester's). Nested items that inherited them follow. */
export async function setInstanceDates(instanceId: string, start: string, end: string | null): Promise<ActionResult<{ created: number }>> {
  await requireAppContext()
  if (!z.iso.date().safeParse(start).success) return fail("Enter the start date.")
  if (end !== null && !z.iso.date().safeParse(end).success) return fail("Enter a valid end date.")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("set_instance_dates", { p_instance: instanceId, p_start: start, p_end: end })
  if (error) return fromDbError(error)
  refresh()
  return ok({ created: (data as number) ?? 0 })
}

export async function setInstanceStatus(instanceId: string, active: boolean): Promise<ActionResult<{ created: number }>> {
  await requireAppContext()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("set_instance_status", { p_instance: instanceId, p_active: active })
  if (error) return fromDbError(error)
  refresh()
  return ok({ created: (data as number) ?? 0 })
}
