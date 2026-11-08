import type { DashboardBranch, DashboardRegion } from './api'

export function buildStoreCreationInput(
  regionId: string,
  name: string,
  slug: string,
  syncDefault: boolean,
  makeDefault: boolean,
) {
  return { regionId, name, slug, syncDefault, makeDefault }
}

export function groupStoresByRegion(
  regions: DashboardRegion[],
  branches: DashboardBranch[],
  activeRegionId: string | null,
) {
  return regions.map((region) => ({
    region,
    stores: branches.filter((branch) => branch.regionId === region.id),
    isActive: region.id === activeRegionId,
  }))
}

export function groupStoresForActiveRegion(
  regions: DashboardRegion[],
  branches: DashboardBranch[],
  activeRegionId: string | null,
) {
  return groupStoresByRegion(
    regions.filter((region) => !activeRegionId || region.id === activeRegionId),
    branches,
    activeRegionId,
  )
}
