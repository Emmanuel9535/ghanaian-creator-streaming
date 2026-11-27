import type { SupabaseClient } from "@supabase/supabase-js";

type BusinessRow = { id: string; name: string; setup_status: string };
type BoothRow = { id: string; business_id: string; name: string; location: string; status: string; created_at: string };
type MembershipRow = { business_id: string; booth_id: string | null; role: "OWNER" | "ATTENDANT"; created_at: string };

export type ActiveWorkspace = {
  business: BusinessRow;
  booth: Pick<BoothRow, "id" | "name" | "location"> | null;
  role: MembershipRow["role"];
};

export type WorkspaceResolution = {
  workspace: ActiveWorkspace | null;
  activeMembershipCount: number;
  error: string | null;
};

/**
 * Resolve only workspaces visible through the caller's existing active membership.
 * Owners may operate any active booth in their business; attendants are restricted
 * to their explicitly assigned active booth. Database RLS remains authoritative.
 */
export async function resolveActiveWorkspace(
  supabase: SupabaseClient,
  userId: string,
): Promise<WorkspaceResolution> {
  const membershipsResult = await supabase
    .from("business_members")
    .select("business_id,booth_id,role,created_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (membershipsResult.error) {
    return { workspace: null, activeMembershipCount: 0, error: membershipsResult.error.message };
  }

  const memberships = (membershipsResult.data ?? []) as MembershipRow[];
  if (memberships.length === 0) {
    return { workspace: null, activeMembershipCount: 0, error: null };
  }

  const businessIds = Array.from(new Set(memberships.map((membership) => membership.business_id)));
  const [businessesResult, boothsResult] = await Promise.all([
    supabase.from("businesses").select("id,name,setup_status").in("id", businessIds),
    supabase
      .from("booths")
      .select("id,business_id,name,location,status,created_at")
      .in("business_id", businessIds)
      .eq("status", "active")
      .order("created_at", { ascending: true }),
  ]);

  if (businessesResult.error || boothsResult.error) {
    return {
      workspace: null,
      activeMembershipCount: memberships.length,
      error: businessesResult.error?.message ?? boothsResult.error?.message ?? "Workspace lookup failed.",
    };
  }

  const businesses = (businessesResult.data ?? []) as BusinessRow[];
  const booths = (boothsResult.data ?? []) as BoothRow[];
  const candidates: Array<{ workspace: ActiveWorkspace; complete: boolean; index: number }> = [];

  memberships.forEach((membership, index) => {
    const business = businesses.find((row) => row.id === membership.business_id);
    if (!business) return;

    const activeBooths = booths.filter((row) => row.business_id === business.id);
    const assignedBooth = membership.booth_id
      ? activeBooths.find((row) => row.id === membership.booth_id)
      : undefined;
    const booth = membership.role === "OWNER"
      ? assignedBooth ?? activeBooths[0] ?? null
      : assignedBooth ?? null;

    candidates.push({
      workspace: {
        business,
        booth: booth ? { id: booth.id, name: booth.name, location: booth.location } : null,
        role: membership.role,
      },
      complete: business.setup_status === "complete" && booth !== null,
      index,
    });
  });

  candidates.sort((left, right) => Number(right.complete) - Number(left.complete) || left.index - right.index);
  return {
    workspace: candidates[0]?.workspace ?? null,
    activeMembershipCount: memberships.length,
    error: null,
  };
}
