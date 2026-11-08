export function selectBranchId<T extends { id: string; isDefault: boolean }>(
  branches: T[],
  activeBranchId: string | null,
  branchOverride?: string | null,
) {
  if (branchOverride && branches.some((branch) => branch.id === branchOverride)) return branchOverride
  if (activeBranchId && branches.some((branch) => branch.id === activeBranchId)) return activeBranchId
  return branches.find((branch) => branch.isDefault)?.id ?? branches[0]?.id ?? null
}
