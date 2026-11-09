import type { RawListing } from "../../src/listings/types.ts";

/** Shapes mirror real MCP payloads seen on 2026-11-08; VINs, ids and dealers are synthetic. */
export const ORIGIN = { lat: 38.9072, lng: -77.0369 }; // downtown Washington, DC

export const cgDetail = (over: Record<string, any> = {}) => ({
  listingId: 900001,
  data: {
    id: 900001, vin: "SYNMAZDA300000001", vehicleCondition: "USED", certified: false, dealerRating: 4.208333,
    dealerLocation: "Chantilly, VA", dealerDistance: "16 mi", vdpUrl: "https://www.cargurus.com/details/900001",
    title: { titleWithoutPrice: "2016 Mazda MAZDA3 i Sport" },
    price: { basePriceString: "$11,495", pricePlusFeesString: "$12,390", differential: 1514 },
    mileage: { displayValue: "80,145" },
    fuelEconomy: { city: 30, highway: 41, fuelType: "Gasoline" },
    history: { daysAtDealer: 7, daysOnCarGurus: 43, hotSeller: true },
    vehicleHistory: { hasVehicleHistory: true, salvage: false, theftTitle: false, lemon: false, frameDamaged: false, accidentCount: 0, ownerCount: 1 },
    ontology: { carYear: 2016, makeName: "Mazda", modelName: "MAZDA3", trimName: "i Sport", bodyTypeName: "Sedan" },
    feeTax: { dealerFees: [{ name: "PROCESSING FEE", amountString: "$895" }] },
    pictures: [{ url: "https://example.invalid/p.jpg" }],
    ...over,
  },
});

export const cgSearchItem = (over: Record<string, any> = {}) => ({
  id: 900101, listingTitle: "2017 Toyota Corolla", dealerLocation: "Laurel, MD",
  priceString: "$12,987", pricePlusFeesString: "$13,787", mileage: { value: 129390, unit: "MILES" },
  dealRating: { localizedValue: "Fair Deal" }, vdpUrl: "https://www.cargurus.com/details/900101", ...over,
});

export const ddVehicle = (over: Record<string, any> = {}) => ({
  id: "veh_syn_1", vin: "SYNCOROLLA0000001", year: 2019, make: "Toyota", model: "Corolla", trim: "LE",
  price: 14200, our_price: 14200, msrp: null, condition: "used", mileage: 110717,
  fee_breakdown: { dealer_fees_total_usd: null }, body_style: "Sedan", fuel_type: "Gasoline", city_mpg: 28, highway_mpg: 36,
  dealer_name: "Synthetic Motors", dealer_city: "California", dealer_state: "MD", lat: 38.30, lng: -76.51,
  distance_miles: 73.13, source_url: "https://dealer.example.invalid/vdp/1", ...over,
});

/** The live-run misparse: internet_price $4,500 on a $42,815-MSRP new Jeep whose real price was $38,805. */
export const ddJeepMisparse = () => ddVehicle({
  id: "veh_syn_jeep", vin: "SYNJEEP0000000001", year: 2026, make: "Jeep", model: "Cherokee", trim: "Limited",
  price: 4500, our_price: 38805, msrp: 42815, condition: "new", mileage: 0,
  fee_breakdown: { dealer_fees_total_usd: 490 }, lat: 38.40, lng: -77.40,
});

export const raw = (over: Partial<RawListing> & { sourceId: string }): RawListing => ({
  source: "user", observedAt: "2026-11-08", year: 2017, make: "Mazda", model: "Mazda3",
  price: 12000, feesTotal: 800, mileage: 90000, condition: "used", reportedDistanceMi: 20, trustedDistance: true, ...over,
});
