import type { FuelType, RawListing } from "./types.ts";

const money = (s: unknown): number | undefined => {
  if (typeof s === "number") return s;
  if (typeof s !== "string") return undefined;
  const n = Number(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && s.match(/\d/) ? n : undefined;
};
const miles = (s: unknown): number | undefined => money(s);
const cityState = (loc: unknown) => {
  const m = typeof loc === "string" ? /^(.*),\s*([A-Z]{2})$/.exec(loc.trim()) : null;
  return m ? { city: m[1]!, state: m[2]! } : {};
};
/** EPA-style combined from city/highway (55/45 harmonic). */
export const combinedMpg = (city?: number, hwy?: number) =>
  city && hwy ? Math.round(1 / (0.55 / city + 0.45 / hwy)) : undefined;
const fuelType = (s: unknown): FuelType | undefined => {
  const t = String(s ?? "").toLowerCase();
  if (!t) return undefined;
  if (t.includes("plug")) return "plug_in_hybrid";
  if (t.includes("hybrid")) return "hybrid";
  if (t.includes("electric")) return "electric";
  if (t.includes("diesel")) return "diesel";
  return "gas";
};
const today = () => new Date().toISOString().slice(0, 10);
const listingsOf = (payload: any): any[] => (Array.isArray(payload) ? payload : payload?.listings ?? payload?.vehicles ?? []);

/** CarGurus MCP: accepts `vehicle-listing-detail` items ({listingId, data}) or `vehicle-listing-search` items. */
export const fromCarGurus = (payload: unknown, observedAt = today()): RawListing[] =>
  listingsOf(payload).flatMap((item: any): RawListing[] => {
    if (item?.data) {
      const d = item.data; const h = d.vehicleHistory ?? {};
      const base = money(d.price?.basePriceString);
      if (!base || !d.ontology?.carYear) return [];
      const fees = (d.feeTax?.dealerFees ?? []).reduce((s: number, f: any) => s + (money(f.amountString) ?? 0), 0)
        || Math.max(0, (money(d.price?.pricePlusFeesString) ?? base) - base);
      const flags: string[] = [];
      if (h.theftTitle) flags.push("theft_title_reported");
      const titleBrand = h.salvage ? "salvage" as const : h.lemon ? "lemon_buyback" as const : h.hasVehicleHistory ? "clean" as const : undefined;
      return [{
        source: "cargurus", sourceId: String(item.listingId ?? d.id), url: d.vdpUrl, observedAt,
        vin: d.vin, year: d.ontology.carYear, make: d.ontology.makeName, model: d.ontology.modelName, trim: d.ontology.trimName,
        condition: d.certified ? "cpo" : d.vehicleCondition === "NEW" ? "new" : d.vehicleCondition === "USED" ? "used" : undefined,
        price: base, feesTotal: fees, mileage: miles(d.mileage?.displayValue) ?? 0,
        dealer: { ...cityState(d.dealerLocation), rating: typeof d.dealerRating === "number" ? Math.round(d.dealerRating * 100) / 100 : undefined },
        reportedDistanceMi: miles(d.dealerDistance), trustedDistance: true,
        bodyStyle: d.ontology.bodyTypeName, fuelType: fuelType(d.fuelEconomy?.fuelType),
        mpg: combinedMpg(d.fuelEconomy?.city, d.fuelEconomy?.highway),
        daysOnMarket: d.history?.daysOnCarGurus ?? d.history?.daysAtDealer,
        history: h.hasVehicleHistory ? {
          source: "listing", titleBrand, accidents: h.accidentCount, owners: h.ownerCount, frameDamaged: h.frameDamaged,
        } : undefined,
        flags,
      }];
    }
    const title = /^(\d{4})\s+(\S+)\s+(.+)$/.exec(String(item?.listingTitle ?? ""));
    const price = money(item?.priceString);
    if (!title || !price) return [];
    return [{
      source: "cargurus", sourceId: String(item.id), url: item.vdpUrl, observedAt,
      year: Number(title[1]), make: title[2]!, model: title[3]!,
      price, feesTotal: Math.max(0, (money(item.pricePlusFeesString) ?? price) - price),
      mileage: item.mileage?.value ?? 0, dealer: cityState(item.dealerLocation),
    }];
  });

const usageOf = (s: unknown): "personal" | "rental" | "fleet" | "unknown" => {
  const t = String(s ?? "").toLowerCase();
  if (t.includes("rental")) return "rental";
  if (t.includes("fleet") || t.includes("commercial") || t.includes("taxi")) return "fleet";
  if (t.includes("personal") || t.includes("lease")) return "personal";
  return "unknown";
};

/**
 * Auto.dev `/listings` rows (MCP `auto_listings` or `auto listings --json`). Dealer fees are not published,
 * so `assumedFees` (a typical local doc/processing fee) is added and the listing is flagged `fees_assumed`;
 * pass 0 to leave fees out. History has accident/owner/usage counts but no title brand, so title stays unknown.
 */
export const fromAutoDev = (payload: unknown, observedAt = today(), assumedFees = 0): RawListing[] =>
  listingsOf(payload).flatMap((x: any): RawListing[] => {
    const v = x?.vehicle ?? {}; const r = x?.retailListing ?? {}; const h = x?.history;
    if (!r.price || !v.year || !v.make || !v.model) return [];
    const [lng, lat] = Array.isArray(x.location) ? x.location : [];
    const flags: string[] = [];
    if (assumedFees > 0) flags.push("fees_assumed");
    return [{
      source: "auto_dev", sourceId: String(x.vin ?? v.vin), url: r.vdp, observedAt,
      vin: x.vin ?? v.vin, year: v.year, make: v.make, model: v.model, trim: v.trim,
      condition: r.cpo ? "cpo" : r.used === false ? "new" : "used",
      price: r.price, feesTotal: assumedFees, mileage: r.miles ?? 0,
      dealer: { name: r.dealer, city: r.city, state: r.state, lat, lng },
      trustedDistance: false,
      bodyStyle: v.style ?? v.bodyStyle, fuelType: fuelType(v.fuel),
      history: h ? {
        source: "listing", accidents: typeof h.accidentCount === "number" ? h.accidentCount : undefined,
        // Auto.dev sometimes reports 0 owners (no title records yet); a used car has at least one, so treat as unknown.
        owners: typeof h.ownerCount === "number" && h.ownerCount > 0 ? h.ownerCount : undefined, usage: usageOf(h.usageType),
      } : undefined,
      flags,
    }];
  });

/** Dealer-Direct MCP `search_inventory` vehicles. Its distance_miles is unreliable, so coordinates are kept instead. */
export const fromDealerDirect = (payload: unknown, observedAt = today()): RawListing[] =>
  listingsOf(payload).flatMap((x: any): RawListing[] => {
    const msrp = typeof x?.msrp === "number" && x.msrp > 0 ? x.msrp : undefined;
    const flags: string[] = [];
    let prices = [x?.price, x?.our_price].filter((p): p is number => typeof p === "number" && p > 0);
    if (msrp) {
      const kept = prices.filter(p => p >= 0.5 * msrp);
      if (kept.length < prices.length) flags.push("price_field_discarded");
      prices = kept;
    }
    if (!prices.length || !x?.year) return [];
    const cond = String(x.condition ?? "").toLowerCase();
    return [{
      source: "dealer_direct", sourceId: String(x.id ?? x.vin), url: x.source_url, observedAt,
      vin: x.vin, year: x.year, make: x.make, model: x.model, trim: x.trim,
      condition: x.certified ? "cpo" : cond === "new" ? "new" : cond === "used" ? "used" : cond.includes("cert") ? "cpo" : undefined,
      price: Math.min(...prices), feesTotal: x.fee_breakdown?.dealer_fees_total_usd ?? 0, msrp,
      mileage: x.mileage ?? 0,
      dealer: { name: x.dealer_name, city: x.dealer_city, state: x.dealer_state, lat: x.lat, lng: x.lng },
      reportedDistanceMi: typeof x.distance_miles === "number" ? x.distance_miles : undefined, trustedDistance: false,
      bodyStyle: x.body_style, fuelType: fuelType(x.fuel_type), mpg: combinedMpg(x.city_mpg, x.highway_mpg),
      flags,
    }];
  });
