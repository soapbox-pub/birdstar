// The 8 WGSRPD / Wikidata-style top-level regions used as a compact
// continent-level bitmask. Lives in its own module so `speciesRegions.ts`
// can import it without pulling in the full (larger) geo resolver.
//
//   NA      North America (Canada, USA, Mexico, Central America, Caribbean)
//   SA      South America
//   EU      Europe (incl. western Russia)
//   AF      Africa
//   AS      Asia (incl. eastern Russia, Middle East, Indian subcontinent,
//           SE Asia, the Japanese/Philippine/Indonesian archipelagos)
//   OC      Oceania (Australia, NZ, Pacific islands)
//   AN      Antarctica
//   MARINE  Pelagic / worldwide-oceanic (not returned from a lat/lon fix;
//           reserved for species whose range is coded as "oceans worldwide"
//           in the regions table)

/** Region codes. Values are bitmask positions — keep in sync with the
 * species-regions table generator. */
export const REGION = {
  NA: 1 << 0,
  SA: 1 << 1,
  EU: 1 << 2,
  AF: 1 << 3,
  AS: 1 << 4,
  OC: 1 << 5,
  AN: 1 << 6,
  MARINE: 1 << 7,
} as const;

export type RegionCode = keyof typeof REGION;
export type RegionMask = number;
