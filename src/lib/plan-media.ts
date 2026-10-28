// The three kinds of file on a floor plan's page.
//   drawings    floor plan drawings (media kind "floor_plan", room "floor_plan")
//   elevations  elevation renderings (tagged ELEVATION_TAG, room "exterior")
//   photos      model home photos and video (everything else)
export type PlanMediaKind = "drawings" | "elevations" | "photos";

// Shared tag from media_tags (migration 20261028000061). Renaming it in
// Admin > Photo tags would move elevations into the model photos slot.
export const ELEVATION_TAG = "Elevation rendering";
