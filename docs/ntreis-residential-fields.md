# NTREIS Matrix: Residential input form

Every field on NTREIS's **Matrix → Input → Add new → Residential** form, read directly from a blank form on 26 Oct 2026 (Matrix v12.7). Nothing was saved or submitted in NTREIS.

- **Order** is the order of the tabs and fields on the Matrix screen, so the MLS sheet can follow it.
- **Req** = Matrix shades the field yellow (it won't accept the listing without it). "When used" means required only once you fill in that row or section.
- **Choices** are copied exactly as Matrix spells them, including its typos ("Mississipi", "Floor Furnance"). Our pick-lists must match these exactly so staff can copy them over.
- **RESO** is the standard field name we store the value under. Names marked *local* are NTREIS-only fields with no RESO standard name; we store them under the key shown. These mappings are our best match and should be checked against NTREIS's feed field list once the read-only feed is approved.
- **Who fills it**: *Builder* (on Add a home), *Community* (set once per community, our team or the builder), *Team* (our listing coordinators on the MLS sheet), *Auto* (filled by the system).

Long pick-lists for things a new-construction home never uses (farm, condo, loans) are listed once and only on this page; they are not on the builder's form.

---

## 1. Property Info

| Field | Type | Req | RESO | Who | Choices |
|---|---|---|---|---|---|
| Property Sub Type | pick one | Yes | PropertySubType | Builder | Single Family Residence; Condominium; Townhouse; Mobile Home; Manufactured Home; Farm/Ranch |
| Property Attached YN | yes/no | Yes | PropertyAttachedYN | Builder | Yes; No |
| Listing Agreement Type | pick one | Yes | ListingAgreement | Team | Exclusive Right To Sell; Exclusive Right With Exception; Exclusive Agency; Exclusive Agency with Reservation; Exclusive Right To Lease |
| Transaction Type | pick one | Yes | *TransactionType* (local) | Team | For Sale; For Sale/Lease (defaults to For Sale) |
| For Lease MLS # | text | | *ForLeaseMlsNumber* (local) | Team | |
| Adult Community YN | yes/no | | SeniorCommunityYN | Community | Yes; No |
| Will Subdivide YN | pick one | Yes | *WillSubdivide* (local) | Auto (No) | Yes; No; Subdivided |
| Accessory Unit YN | yes/no | | *AccessoryUnitYN* (local) | Builder | Yes; No |
| Accessory Unit SqFt | number | | *AccessoryUnitSqFt* (local) | Builder | |
| Accessory Unit Type | pick one | | *AccessoryUnitType* (local) | Builder | Accessory Dwelling Unit (AdU); Guest Quarters; Pool House; Other |
| Housing Type | check any | Yes | StructureType | Builder | Apartment; Attached or 1/2 Duplex; Condo/Townhome; Designated Historical Home; Farm/Ranch House; Garden/Zero Lot Line; Hi Rise; Historical/Conservation Dist.; Interval Ownership; Lake House; Log Cabin; Manufactured (certificate exch); Mobile Doublewide w/Land; Mobile Singlewide w/Land; Resort Property; Single Detached; Underground; Vacation Home |
| Construction Material | check any | | ConstructionMaterials | Builder | Aluminum Siding; Block; Board & Batten Siding; Brick; Cedar; Concrete; Fiber Cement; Fiberglass Siding; Frame; Log; Metal Siding; Plaster; Radiant Barrier; Rock/Stone; Siding; Steel Siding; Stone Veneer; Stucco; Tilt Wall; Unknown; Vinyl Siding; Wood; See Remarks; Other |
| Architectural Style | check any | | ArchitecturalStyle | Builder | A-Frame; Barndominium; Colonial; Contemporary/Modern; Craftsman; Early American; English; French; Geo/Dome; Loft; Mediterranean; Mid-Century Modern; Modern Farmhouse; Oriental; Prairie; Ranch; Southwestern; Spanish; Split Level; Studio; Traditional; Tudor; Victorian; Other |
| Year Built Details/Construc. Status | pick one | | PropertyCondition | Auto (from build stage) | Preowned; New Construction - Complete; New Construction - Incomplete; Proposed; Unknown |
| Estimated Completion Date | date | | *EstimatedCompletion* (local) | Builder | |
| List Price | money | Yes | ListPrice | Builder | |
| List Date | date | Yes | ListingContractDate | Team | |
| Expire Date | date | Yes | ExpirationDate | Team | |
| Year Built | number | Yes | YearBuilt | Builder | |
| Year Built Source | pick one | | YearBuiltSource | Auto (Builder) | Appraiser; Assessor; Builder; Estimated; Owner; Public Records; See Remarks; Other |
| SqFt/Living Area | number | Yes | LivingArea | Builder | |
| SqFt Source | pick one | | LivingAreaSource | Builder | Appraiser; Assessor; Builder; Other; Owner; Plans; Public Records; See Remarks |
| Parcel ID | text | Yes | ParcelNumber | Builder | |
| Additional Parcel ID | text | | AdditionalParcelsDescription | Builder | |
| Multi Parcel ID YN | yes/no | Yes | AdditionalParcelsYN | Builder | Yes; No |

## 2. Location / Schools

| Field | Type | Req | RESO | Who | Choices |
|---|---|---|---|---|---|
| Street/Box Number | text | Yes | StreetNumber | Builder | |
| Street Dir | pick one | | StreetDirPrefix | Builder | E; N; NE; NW; S; SE; SW; W |
| Street Name | text | Yes | StreetName | Builder | |
| Street Type | pick one | | StreetSuffix | Builder | Alley; Avenue; Bend; Bluff; Boulevard; Branch; ByPass; Circle; Cliff; Annex; Corner; Court; Cove; Creek; Crest; Crossing; Drive; Expressway; Extension; Freeway; Canyon; Gardens; Glen; Green; Grove; Heights; Highway; Hill; Hollow; Junction; Knoll; Falls; Landing; Lane; Loop; Manor; Meadows; Mews; NONE; Park; Parkway; Pass; Forest; Path; Pathway; Pike; Place; Plaza; Point; Pointe; Ridge; Road; Row; Harbor; Run; Shore; Springs; Spur; Square; Street; Terrace; Trace; Trail; Turn; Lake; Valley; Viaduct; View; Village; Ville; Vista; Walk; Way; Lakes; Meadow; Station |
| Street Dir/Suffix | pick one | | StreetDirSuffix | Builder | E; N; NE; NW; S; SE; SW; W |
| Unit # | text | | UnitNumber | Builder | |
| State | pick one | Yes | StateOrProvince | Auto (Texas) | Texas; Louisiana; then every other state (Matrix spells "Mississipi") |
| County/Parish | pick one | Yes | CountyOrParish | Community | All 254 Texas counties. These carry "(TX)" after the name: Caldwell, Cameron, Franklin, Jackson, Jefferson, Madison, Red River, Sabine, Washington |
| City | pick one | Yes | City | Builder | List loads after the county is picked |
| Zip | text | Yes | PostalCode | Builder | |
| Zip + 4 | text | | PostalCodePlus4 | Builder | |
| Country | pick one | | Country | Auto (United States) | |
| Lot | text | | *Lot* (local) | Builder | |
| Tax Block | text | | TaxBlock | Builder | |
| Subdivision | text | Yes | SubdivisionName | Community | The legal plat name on the deed; can differ from the marketing name |
| Lake Name | pick one | | *LakeName* (local) | Community | List loads from county |
| Planned Development | text | | *PlannedDevelopment* (local) | Community | |
| Additn'l Legal Desc. | text | | TaxLegalDescription | Builder | |
| School District | pick one | Yes | HighSchoolDistrict | Community | List loads after the county is picked |
| Elementary School Name | pick one | | ElementarySchool | Community | Loads from district |
| Junior High School Name | pick one | | MiddleOrJuniorSchool | Community | Loads from district |
| Senior High School Name | pick one | | HighSchool | Community | Loads from district |
| Primary School Name | pick one | | *PrimarySchool* (local) | Community | Loads from district |
| Middle School Name | pick one | | *MiddleSchool* (local) | Community | Loads from district |
| High School Name | pick one | | *HighSchoolAlt* (local) | Community | Loads from district |
| Intermediate School Name | pick one | | *IntermediateSchool* (local) | Community | Loads from district |

NTREIS has two sets of school boxes. Most districts use Elementary / Junior High / Senior High; some use the Primary / Intermediate / Middle / High set. Fill whichever set the district shows.

## 3. Rooms

| Field | Type | Req | RESO | Who | Choices |
|---|---|---|---|---|---|
| # Bedrooms | number | Yes | BedroomsTotal | Builder | |
| # Full Baths | number | Yes | BathroomsFull | Builder | |
| # Half Baths | number | Yes | BathroomsHalf | Builder | |
| Levels | pick one | Yes | Levels | Builder | One; One and One Half; Two; Three Or More; Multi/Split |
| # Living Areas | number | Yes | *LivingAreasTotal* (local) | Builder | |
| # Dining Areas | number | Yes | *DiningAreasTotal* (local) | Builder | |

**Room list** (repeats; "More" adds a row). Level, Length and Width are required on any row that's used.

| Field | Type | Req | RESO (Rooms) | Choices |
|---|---|---|---|---|
| Type | pick one | | RoomType | Basement; Bath-Full; Bath-Half; Bath-Primary; Bedroom; Bedroom-2nd Primary; Bedroom-Primary; Bonus Room; Breakfast Rm; Den; Dining Room; Exercise Room; Extra Strg Rm; Family Room; Game Room; Great Room; Guest Suite; Gym; Kitchen; Laundry; Library; Living Room; Loft; Media Room; Mud Room; Music Room; Office; Sauna; Solarium/Sunrm; Spa/HotTub Rm; Utility Room; Wine Cellar; Workshop |
| Level | pick one | When used | RoomLevel | 1; 2; 3; 4; 5; 6; 7; 8; 9; B |
| Length | number | When used | RoomLength | feet |
| Width | number | When used | RoomWidth | feet |
| Features | pick any | | RoomFeatures | List depends on room type |

## 4. Features

| Field | Type | Req | RESO | Who | Choices |
|---|---|---|---|---|---|
| Accessibility Features YN | yes/no | Yes | *AccessibilityFeaturesYN* (local) | Builder | Yes; No |
| Accessibility Features | check any | | AccessibilityFeatures | Builder | Approach with Ramp; Accessible Bath - Full; Accessible Bath - Half+Hall; Accessible Bedroom; Accessible Doors; Elec. & Env. Controls; Accessible Elevator Installed; Accessible Entrance; Hearing-Impairment; Accessible Grip; Accessible Hallway(s); Accessible Kitchen; Customized Wheelchair Acc; Meets ADA Requirements; Smart Technology; Stair Lift |
| Interior Features | check any | Yes | InteriorFeatures | Builder | Built-in Features; Built-in Wine Cooler; Cable TV Available; Cathedral Ceiling(s); Cedar Closet(s); Central Vacuum; Chandelier; Decorative Lighting; Double Vanity; Dry Bar; Dumbwaiter; Eat-in Kitchen; Elevator; Flat Screen Wiring; Granite Counters; High Speed Internet Available; In-Law Suite Floorplan; Kitchen Island; Loft; Multiple Staircases; Natural Woodwork; Open Floorplan; Other; Paneling; Pantry; Smart Home System; Sound System Wiring; Tile Counters; Vaulted Ceiling(s); Wainscoting; Walk-In Closet(s); Wet Bar; Wired for Data; Second Primary Bedroom |
| Security Features | check any | | SecurityFeatures | Builder | Burglar; Carbon Monoxide Detector(s); Fire Alarm; Fire Sprinkler System; Firewall(s); Gated Community; Key Card Entry; Prewired; Security Gate; Security Guard; Security Lights; Security Service; Security System; Security System Leased; Security System Owned; Smoke Detector(s); Unknown; Wireless; Other |
| Laundry Features | check any | | LaundryFeatures | Builder | Dryer - Electric Hookup; Dryer - Gas Hookup; In Garage; In Hall; In Kitchen; In Utility Room; Laundry Chute; W/D - Full Size W/D Area; W/D - Stacked W/D Area; Dryer Hookup; Washer Hookup; Other; On Site; None |
| Smart Home Features YN | yes/no | Yes | *SmartHomeFeaturesYN* (local) | Builder | Yes; No |
| Pool on Property YN | yes/no | Yes | PoolPrivateYN | Builder | Yes; No |
| Pool Features | check any | | PoolFeatures | Builder | Above Ground; Cabana; Diving Board; Fenced; Fiberglass; Gunite; Heated; In Ground; Indoor; Infinity; Lap; Outdoor Pool; Pool Cover; Pool Sweep; Pool/Spa Combo; Private; Pump; Salt Water; Sep. Spa/Hot Tub; Solar Cover; Solar Heat; Sport; Vinyl; Water Feature; Waterfall; Other |
| Basement YN | yes/no | Yes | BasementYN | Builder | Yes; No |
| Foundation | check any | | FoundationDetails | Builder | Block; Bois DArc Post; Brick/Mortar; Combination; Concrete Perimeter; Pillar/Post/Pier; Slab; Stone; Other; None |
| Roof | check any | | Roof | Builder | Asphalt; Built-Up; Composition; Concrete; Fiber Cement; Fiberglass; Flat; Metal; Mixed; Shake; Shingle; Slate; Spanish Tile; Synthetic; Tar/Gravel; Tile; Wood; Other |
| Flooring | check any | | Flooring | Builder | Adobe; Bamboo; Brick; Brick/Adobe; Carpet; Ceramic Tile; Clay; Combination; Concrete; Cork; Dirt; Engineered Wood; Granite; Hardwood; Laminate; Linoleum; Luxury Vinyl Plank; Marble; None; Other; Painted/Stained; Parquet; Pavers; Reclaimed Wood; See Remarks; Simulated Wood; Slate; Softwood; Stamped; Stone; Sustainable; Terrazzo; Tile; Travertine Stone; Varies; Vinyl; Wood; Wood Under Carpet |
| Community Features | check any | | CommunityFeatures | Community | Airport/Runway; Boat Ramp; Campground; Club House; Common Elevator; Community Dock; Community Pool; Community Sprinkler; Concierge; Curbs; Electric Car Charging Station; Fishing; Fitness Center; Gated; Golf; Greenbelt; Guarded Entrance; Hangar; Horse Facilities; Jogging Path/Bike Path; Lake; Laundry; Marina; Park; Perimeter Fencing; Pickle Ball Court; Playground; Pool; Racquet Ball; Restaurant; RV Parking; Sauna; Sidewalks; Spa; Stable(s); Tennis Court(s); Other |
| # Fireplaces | number | Yes | FireplacesTotal | Builder | Enter 0 if none |
| Fireplace Features | check any | | FireplaceFeatures | Builder | Bath; Bedroom; Blower Fan; Brick; Circulating; Decorative; Den; Dining Room; Double Sided; Electric; EPA Certified Wood Stove; EPA Qualified Fireplace; Family Room; Fire Pit; Freestanding; Gas; Gas Logs; Gas Starter; Glass Doors; Great Room; Heatilator; Insert; Kitchen; Library; Living Room; Masonry; Primary Bedroom; Metal; Outside; Pellet Stove; Propane; Raised Hearth; Recreation Room; Sealed Combustion; See Remarks; See Through Fireplace; Stone; Ventless; Wood Burning; Wood Burning Stove; Zero Clearance; Other; None |
| Appliances | check any | Yes | Appliances | Builder | Built-in Coffee Maker; Built-in Gas Range; Built-in Refrigerator; Commercial Grade Range; Commercial Grade Vent; Dishwasher; Disposal; Dryer; Electric Cooktop; Electric Oven; Electric Range; Electric Water Heater; Gas Cooktop; Gas Oven; Gas Range; Gas Water Heater; Ice Maker; Indoor Grill; Microwave; Oven-Convection; Oven-Double; Plumbed For Gas in Kitchen; Refrigerator; Tankless Water Heater; Trash Compactor; Vented Exhaust Fan; Warming Drawer; Washer; Water Filter; Water Purifier; Other; Water Softener; None |
| Other Equipment | check any | | OtherEquipment | Builder | Air Purifier; Call Listing Agent; Compressor; DC Well Pump; Dehumidifier; Farm Equipment; Fuel Tank(s); Generator; Home Theater; Intercom; Irrigation Equipment; List Available; Livestock Equipment; Negotiable; Orchard Equipment; Rotary Antenna; Satellite Dish; TV Antenna; Varies By Unit; Other; None |
| Window Features | check any | | WindowFeatures | Builder | Bay Window(s); Electric Shades; Shutters; Skylights(s); Window Coverings |
| Patio & Porch Features | check any | | PatioAndPorchFeatures | Builder | Awning(s); Covered; Deck; Enclosed; Front Porch; Glass Enclosed; Patio; Rear Porch; Roof Top Deck/Patio; Screened; Side Porch; Terrace; Wrap Around; See Remarks; Other; None |
| # Carport Spaces | number | Yes | CarportSpaces | Builder | Enter 0 if none |
| # Garage Spaces | number | | GarageSpaces | Builder | |
| # Covered Spaces (Total) | number | Yes | CoveredSpaces | Builder | Garage + carport spaces |
| Garage YN | yes/no | Yes | GarageYN | Builder | Yes; No |
| Attached Garage YN | yes/no | | AttachedGarageYN | Builder | Yes; No |
| Garage Length / Width / Height | number | | *GarageLength*, *GarageWidth*, *GarageHeight* (local) | Builder | feet |
| Parking Features | check any | Yes | ParkingFeatures | Builder | Additional Parking; Aggregate; Alley Access; Asphalt; Assigned; Attached Carport; Basement; Boat; Carport; Circular Driveway; Porte-Cochere; Common; Community Structure; Concrete; Converted Garage; Covered; Deck; Deeded; Detached Carport; Direct Access; Drive Through; Driveway; Electric Gate; Elec Vehicle Charging Station(s); Enclosed; Epoxy Flooring; Garage; Garage Door Opener; Garage Double Door; Garage Faces Front; Garage Faces Rear; Garage Faces Side; Garage Single Door; Gated; Golf Cart Garage; Gravel; Guest; Heated Garage; Inside Entrance; Kitchen Level; Leased; Lighted; No Garage; None; Off Site; Off Street; On Site; On Street; Open; Other; Outside; Oversized; Parking Lot; Parking Pad; Paved; Paver Block; Permit Required; Private; RV Access/Parking; RV Carport; RV Garage; RV Gated; Secured; See Remarks; Shared Driveway; Side By Side; Storage; Tandem; Unassigned; Underground; Unpaved; Valet; Varies by Unit; Workshop in Garage |
| Special Notes | check any | | *SpecialNotes* (local) | Team | Aerial Photo; Affordable Housing; Age-Restricted; Agent Related to Owner; Build to Suit; Deed Restrictions; Deep Hole Test; Environ. Study Complete; Feasibility Study Available; Flood Plain; Flowage Easement; Highline; Historical; HUD; Inland/Wetland Restrictions; Meets ADA Guidelines; Owner/ Agent; Perc Test; Phase I Complete; Phase II Complete; Pipeline; Res. Service Contract; Right of First Refusal; Section 8 Qualified; Special Assessments; Special Contracts/Provisions; Survey Available; Utility Easement; Verify Flood Insurance; Verify Rollback Tax; Verify Tax Exemptions; Other |

## 5. Lot Info

| Field | Type | Req | RESO | Who | Choices |
|---|---|---|---|---|---|
| Lot Size Area | number | Yes | LotSizeArea | Builder | |
| Lot Size Unit | pick one | Yes | LotSizeUnits | Builder | Acres; Square Feet |
| Lot Dimensions | text | | LotSizeDimensions | Builder | |
| Lot Size Source | pick one | | LotSizeSource | Builder | Appraiser; Assessor; Builder; Estimated; Owner; Plans; Public Records; See Remarks; Other |
| Lot Size (Acreage) | pick one | Yes | *LotSizeRange* (local) | Auto (from lot size) | < .5 Acre (not Zero); .5 to < 1 Acre; 1 to < 3 Acres; 3 to < 5 Acres; 5 to < 10 Acres; 10 to < 50 Acres; 50 to =< 100 Acres; Over 100 Acres; Condo/Townhome Lot; Zero Lot |
| Horse Permitted YN | yes/no | | HorseYN | Community | Yes; No |
| Lot Features | check any | | LotFeatures | Builder | Acreage; Adjacent to Greenbelt; Agricultural; Airstrip; Bayou; Bottom; Brush; Cleared; Corner Lot; Cul-De-Sac; Few Trees; Flag Lot; Greenbelt; Gullies; Hilly; Interior Lot; Irregular Lot; Landscaped; Leasehold; Level; Lrg. Backyard Grass; Many Trees; Cedar; Mesquite; Oak; Pine; Shinnery; Need Fill; No Backyard Grass; On Golf Course; Other; Park View; Pasture; Rock Outcropping; Rolling Slope; Rugged; Sloped; Sprinkler System; Steep Slope; Subdivision; Swamp; Tank/ Pond; Taxi-way; Undivided; Varied; Water/Lake View; Waterfront; Zero Lot Line |
| Exterior Features | check any | | ExteriorFeatures | Builder | Attached Grill; Awning(s); Balcony; Barbecue; Basketball Court; Boat Slip; Built-in Barbecue; Courtyard; Covered Courtyard; Covered Deck; Covered Patio/Porch; Dock; Dog Run; Electric Grill; Fire Pit; Garden(s); Gas Grill; Gray Water System; Rain Gutters; Kennel; Lighting; Misting System; Mosquito Mist System; Outdoor Grill; Outdoor Kitchen; Outdoor Living Center; Outdoor Shower; Permeable Paving; Playground; Private Entrance; Private Landing Strip; Private Yard; Putting Green; Rain Barrel/Cistern(s); RV Hookup; RV/Boat Parking; Sport Court; Stable/Barn; Storage; Storm Cellar; Tennis Court(s); Uncovered Courtyard; Other |
| Restrictions | check any | | *Restrictions* (local) | Community | Agricultural; Animals; Architectural; Building; Deed; Development; Easement(s); Health Department; Hi Line; Inland-Wetland Restr.; Lease While on Market; Mobile Home Only; No Divide; No Known Restriction(s); No Livestock; No Mobile Home; No Pets; No Restrictions; No Smoking; No Sublease; No Waterbeds; Pet Restrictions; Pipeline; Surface Lease(s); Timber Lease(s); Unknown Encumbrance(s); Other; None |
| Easements | check any | | *Easements* (local) | Community | Access; Drainage; Electric; Natural Gas; Pipeline; Telephone; Utilities; Water Lines; Other; None |
| Type of Fence | check any | | Fencing | Builder | Back Yard; Barbed Wire; Block; Brick; Chain Link; Cross Fenced; Electric; Fenced; Front Yard; Full; Gate; High Fence; Invisible; Masonry; Metal; Net; Partial; Partial Cross; Perimeter; Pipe; Privacy; Rock/Stone; Security; Split Rail; Vinyl; Wire; Wood; Wrought Iron; Other; None |
| Soil | check any | | *Soil* (local) | Team | Black; Clay; Fill; Limestone; Rocky/Shale; Sandy Loam; Unknown; Other |
| Vegetation | check any | | Vegetation | Team | Brush; Cleared; Crop(s); Grassed; Heavily Wooded; Partially Wooded; Wooded |
| Waterfront YN | yes/no | Yes | WaterfrontYN | Builder | Yes; No |
| Waterfront Features | check any | | WaterfrontFeatures | Builder | 21 choices beginning Canal (Man Made); Creek; Dock – Covered; Dock – Enclosed; Dock – Uncovered; Lake Front; Lake Front - Common Area; Lake Front – Corps of Engineers; Lake Front – Main Body; Beach Access; Leasehold; Personal Watercraft Lift; Retaining Wall – Concrete; Retaining Wall – Other; Retaining Wall – Steel … (full list not captured; read it in Matrix if a waterfront home comes up) |
| Lake Pump YN | yes/no | | *LakePumpYN* (local) | Builder | Yes; No |
| Other Structures | check any | | OtherStructures | Builder | 42 choices beginning Airplane Hangar; Arena; Barn(s); Boat House; Boiler Operation; Bunk House; Cabana; Cave(s); Corral(s); Covered Arena; Garage(s); Gazebo; Grain Storage; Greenhouse; Guest House; Hunters Cabin; Kennel/Dog Run; Mobile Home; Outbuilding; Outdoor Kitchen; Packing Shed; Pergola; Pool House; Poultry Coop … (full list not captured) |
| Platted Waterfront Boundary | text | | *PlattedWaterfrontBoundary* (local) | Builder | |
| Dock Permitted YN | yes/no | | *DockPermittedYN* (local) | Builder | Yes; No |

## 6. Utilities

| Field | Type | Req | RESO | Who | Choices |
|---|---|---|---|---|---|
| Street/Utilities | check any | Yes | Utilities (also feeds WaterSource and Sewer) | Community | Aerobic Septic; All Weather Road; Alley; Asphalt; Cable Available; City Sewer; City Water; Co-op Electric; Co-op Membership Included; Co-op Water; Community Mailbox; Concrete; Curbs; Dirt; Electricity Available; Electricity Connected; Electricity Not Available; Gravel/Rock; Individual Gas Meter; Individual Water Meter; Master Gas Meter; Master Water Meter; MUD Sewer; MUD Water; Natural Gas Available; Outside City Limits; Overhead Utilities; Phone Available; Private Road; Private Sewer; Private Water; Propane; Rural Water District; Septic; Sewer Available; Sewer Not Available; Sewer Tap Fee Paid; Sidewalk; Underground Utilities; Unincorporated; Water Tap Fee Paid; Well; See Remarks; No City Services; No Sewer; No Water; Other; None |
| Heating | check any | | Heating | Builder | Active Solar; Central; Electric; ENERGY STAR Equipment; ENERGY STAR Installation; Fireplace Insert; Fireplace(s); Floor Furnance; Gas Jets; Geothermal; Heat Pump; Humidity Control; Natural Gas; Oil; Passive Solar; Pellet Stove; Propane; Solar; Space Heater; Wall Furnace; Wood Stove; Zoned; Other; None; Radiant Heat Floors |
| Cooling | check any | | Cooling | Builder | Attic Fan; Ceiling Fan(s); Central Air; Electric; ENERGY STAR Qualified Equipment; Evaporative Cooling; Gas; Geothermal; Heat Pump; Humidity Control; Multi Units; Roof Turbine(s); Wall Unit(s); Wall/Window Unit(s); Window Unit(s); Zoned; Other; None |
| MUD District YN | yes/no | Yes | *MudDistrictYN* (local) | Community | Yes; No |
| Special Taxing Authority YN | yes/no | | *SpecialTaxingAuthorityYN* (local) | Community | Yes; No |
| Public Improvement District YN | yes/no | Yes | *PublicImprovementDistrictYN* (local) | Community | Yes; No |

## 7. Environment (green features; all optional)

| Field | Type | RESO | Choices |
|---|---|---|---|
| Green Sustainability | check any | GreenSustainability | Conserving Methods; Onsite Recycling Center; Recyclable Materials; Recycled Materials; Regionally-Sourced Materials; Renewable Materials; Salvaged Materials |
| Green Energy Generation | check any | GreenEnergyGeneration | Hydro Power; Solar; Wind; Assumable; Leased; Owned |
| Green Water Features | check any | GreenWaterConservation | Efficient Hot Water Distribution; Gray Water System; Green Infrastructure; Low-Flow Fixtures; Water Recycling; Water-Smart Landscaping |
| Walk Score | number | WalkScore | |
| Indoor Air Quality | check any | GreenIndoorAirQuality | Integrated Pest Management; Moisture Control; Ventilation |
| Green Energy Features | check any | GreenEnergyEfficient | 12 inch+ Attic Insulation; Appliances; Construction; Doors; Drought Tolerant Plants; Energy Recovery Ventilator; Enhanced Air Filtration; ET Irrigation Control; Exposure/Shade; Geo-thermal HVAC; Other; HVAC; Incentives; Insulation; Lighting; Low Flow Commode; Mechanical Fresh Air; Rain / Freeze Sensors; Rain Water Catchment; Roof; Solar Electric System; Solar Electric System - Leased; Solar Electric System - Owned; Solar Hot Water; Thermostat; Waterheater; Windows |
| Green Landscaping | check any | *GreenLandscaping* (local) | Native Landscape; Non-Toxic Fertilizer/Pesticides; Rain Water Harvesting; Veg. (Productive) Garden |

**Green certification** (two identical blocks, for up to two certifications): Building Verification (GreenBuildingVerificationType: Certified Passive House; ENERGY STAR Certified Homes; EnerPHit; Green Built N. TX; HERS Index Score; Home Energy Score; Home Energy Upgrade Cert of Energy Efficiency Improvements; Home Energy Upgrade Cert of Energy Efficiency Performance; Home Performance with ENERGY STAR; Indoor airPLUS; LEED For Homes; Living Building Challenge; NGBP-National Green; NGBS New Construction; NGBS Small Projects Remodel; NGBS Whole-Home Remodel; PHIUS+; WaterSense; Zero Energy Ready Home; Pearl Certification), Status (Complete; In Process), Year, Source (Administrator; Assessor; Builder; Contractor or Installer; Owner; Program Sponsor; Program Verifier; Public Records; See Remarks; Other), Body, Green Verification URL, Metric, Rating, Version. Builders with HERS scores or ENERGY STAR certification fill the first block.

## 8. Financial

| Field | Type | Req | RESO | Who | Choices |
|---|---|---|---|---|---|
| Listing Terms (Proposed Financing) | check any | | ListingTerms | Builder | 1031 Exchange; All Incl Trust Deed; Assumable; Cash; Contact Agent; Contract; Conventional; Convl Assumable; Escalating; Existing Bonds; Federal Land Bank; FHA; FHA Assumable; FHA-203K; Fixed; FMHA; Land Use Fee; Lease Back; Lease Option; Lease Purchase; Lien Release; Not Assumable; Owner Carry 2nd; Owner Will Carry; Priv Financing Avail; Relo Property; Seller Equity Share; Special Funding; Submit; Texas Vet; Trade; Trust Conveyance; Trust Deed; TX VET Assumable; USDA Loan; VA Assumable; VA Loan; VA Reinstmt Reqd; Other |
| Seller Concessions | yes/no | | *SellerConcessionsYN* (local) | Team | Yes; No |
| Possession | check any | Yes | Possession | Builder | 30-60 Days; 60-90 Days; Closing/Funding; Lease Outstanding; Negotiable; Specific Date; Subject to Lease; Upon Completion; Other |
| Unexempt Taxes | money | | *UnexemptTaxes* (local) | Team | |
| Loan Type | pick one | Yes | *ExistingLoanType* (local) | Auto (Treat As Clear) | Assumable Non Qualifying; Assumable Qualifying; Treat As Clear |
| Loan Payment Type, Loan Payment, Loan Balance, Loan Interest Rate, Lender Name, Appraiser's Name, Orig Mortgage Date | various | | *local* | Team | Only for assumable loans; blank for new homes |
| Second Mortgage YN | yes/no | Yes | *SecondMortgageYN* (local) | Auto (No) | Yes; No |
| Title Company Preferred / Location / Phone | text | | *TitleCompany…* (local) | Community | |

## 9. HOA

| Field | Type | Req | RESO | Who | Choices |
|---|---|---|---|---|---|
| HOA Type | pick one | Yes | *AssociationType* (local; AssociationYN = not None) | Community | Mandatory; Voluntary; None |
| HOA Billing Frequency | pick one | | AssociationFeeFrequency | Community | Annually; Bi-Monthly; Bi-Weekly; Daily; Monthly; One Time; Quarterly; Seasonal; Semi-Annual; Semi-Monthly; Weekly; Other |
| HOA Dues | money | | AssociationFee | Community | |
| HOA Management Company | text | | AssociationName | Community | |
| HOA Management Company Phone | text | | AssociationPhone | Community | |
| HOA Website | text | | *AssociationWebsite* (local) | Community | |
| HOA Management Email | text | | *AssociationEmail* (local) | Community | |
| HOA Includes | check any | | AssociationFeeIncludes | Community | Back Yard Maintenance; Concierge; Electricity; Front Yard Maintenance; Full Use of Facilities; Gas; Insurance; Internet; Maintenance Grounds; Maintenance Structure; Management Fees; Pest Control; Security; Sewer; Trash; Utilities; Water |

## 10. Agent / Office (our team)

| Field | Type | Req | RESO | Notes |
|---|---|---|---|---|
| Agent ID | text | Yes | ListAgentMlsId | Fills in from whoever is signed in to Matrix |
| List Team ID | text | | ListTeamKey | |
| Co List Agent ID | text | | CoListAgentMlsId | |
| Supervisor ID | text | Yes | *SupervisorMlsId* (local) | Fills in from the office |
| List Agent Texting Allowed / Co List Agent Texting Allowed | yes/no | | *local* | |
| Listing Override | text | | *local* | |

## 11. Showing

| Field | Type | Req | RESO | Who | Choices |
|---|---|---|---|---|---|
| Special Listing Conditions | check any | Yes | SpecialListingConditions | Auto (Builder) | Standard/Individual; Builder; Real Estate (Bank) Owned; Auction; Bankruptcy Property; HUD Owned; In Foreclosure; Notice Of Default; Probate Listing; Short Sale; Third Party Approval |
| Consent for Visitors to Record | check any | | *ConsentToRecord* (local) | Community | Audio; Video; None |
| Notice Surveillance Devices Present | check any | | *SurveillanceDevices* (local) | Community | Audio; Video; None |
| Showing Allowed | yes/no | Yes | *ShowingAllowedYN* (local) | Builder | Yes; No |
| Showing Attended YN | yes/no | | ShowingAttendedYN | Community | Yes; No |
| Owner Name | text | Yes | OwnerName | Auto (builder's legal company name) | |
| Lockbox Type | pick one | Yes | LockBoxType | Community | Blue BT LE; Blue iBox; Call Listing Office; Call Seller Direct; Combo; SentriLock; Supra; See Remarks; Other; None |
| Key Box Number | text | Yes | LockBoxSerialNumber | Builder | |
| Lock Box Location | text | | LockBoxLocation | Builder | |
| Access/Gate Code | text | | AccessCode | Community | |
| Occupant Type | pick one | | OccupantType | Auto (Vacant) | Owner; Tenant; Vacant |
| Occupant Name / Phone / Alternate Phone | text | | OccupantName, OccupantPhone | Team | |
| Showing Requirements | check any | Yes | ShowingRequirements | Community | 24 Hour Notice; Appointment Only; Call-Key Box; Combination Lock Box; Courtesy Call (Appt Svc Only); Day Sleeper; Email Listing Agent; Go (Appt Svc Only); Go - Key Box; Go Show-No Appt. Needed; Key In Office; Occupied; Pet(s) on Premises; Restricted Hours; Security System; Showing Service; Special; To Be Built; Under Construction; Virtual Showing - Call Agent; See Remarks; No Lock Box; No Sign |
| Office Preferred Showing Service | display only | | | | Shows the office's default (BrokerBay) |
| Showing Service(s) | check any | Yes | *ShowingService* (local) | Team | BrokerBay; ShowingTime; None |
| Showing Contact Type | check any | | ShowingContactType | Community | Showing Service; Agent; Builder; Occupant; Office; Other; Owner; Property Manager |
| Showing Contact Phone / Ext | text | | ShowingContactPhone, ShowingContactPhoneExt | Community | |
| Showing Instructions | long text | | ShowingInstructions | Community | |
| Showing Instructions Secured (Intra Office) | long text | | *local* | Team | |

## 12. Remarks

| Field | Type | Req | RESO | Who | Choices |
|---|---|---|---|---|---|
| Listing will be distributed to | check any | | SyndicateTo | Team | Members IDX Websites; Realtor.com; Syndicate Listing; Homes.com; NTREIS Translator; Realtors Property Resource |
| Allow Address Display | yes/no | Yes | InternetAddressDisplayYN | Team | Yes; No |
| Allow Comments/Reviews | yes/no | Yes | InternetConsumerCommentYN | Team | Yes; No |
| Allow AVM | yes/no | Yes | InternetAutomatedValuationDisplayYN | Team | Yes; No |
| Allow Internet Display | yes/no | Yes | InternetEntireListingDisplayYN | Team | Yes; No |
| Public Driving Directions | long text | Yes | Directions | Community | Real directions; NTREIS fines "use GPS" |
| Property Description | long text | | PublicRemarks | Builder | No phone, email, web address or agent pay |
| Excludes | long text | | Exclusions | Builder | Items that don't convey (e.g. model furniture) |
| Private Remarks | long text | | PrivateRemarks | Team | Agents only |
| Intra Office Remarks | long text | | *local* | Team | Our office only |

## 13. Condo Info (not used for single-family)

Complex Name, Building Number, Building Stories, Floor Location, FHA/VA Approved Complex # (all text, optional).

## 14. Farm & Ranch (not used for subdivision homes)

All optional: # Residences, # Stock Tanks/Ponds, # Barns, # Lakes, # Wells, # Separate Water Meters, Present Use, Proposed Use, Crop/Grasses, Horse/Barn Info, Bottom Land / Cultivated / Irrigated / Pasture Acres, Topography, Crop Retire Program YN, Land Leased YN, Agri. Exemption YN, Aerial Photo Available YN, Feet to the Road, Road Surface Type, Road Frontage Desc, Surface Rights, Ranch Name, Farm/Ranch Miscellaneous, and two barn blocks (Barn Type, # Stalls, Barn Length, Barn Width).

## 15. Status

| Field | Type | Req | RESO | Choices |
|---|---|---|---|---|
| Status | pick one | Yes | StandardStatus | Incomplete; Active; Coming Soon |

Matrix's note on this tab: a new listing can be submitted as Active or as Incoming. Incoming gets an MLS number but isn't shown to other agents until it's changed to Active, and photos and supplements can be added while it's incoming.
