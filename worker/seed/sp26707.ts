// SAMPLE records for the pilot scheme, SP 26707 - 34 Davies Road, Claremont.
// Everything here is placeholder data for the demo: fictional people, example.com addresses,
// 0400 000 0xx phone numbers. Replace it with Ikon's real records before go-live.
//
// Wording matters: the template (no-AI) drafting path quotes the first matching line of a
// document, so the first line mentioning the water main, and the first mentioning contractor
// access, are written to read well on their own.

import type { Contact } from "../../shared/types";
import type { SeedData, SeedDoc } from "./portfolio";

const SCHEME = "SP 26707 - 34 Davies Road, Claremont WA 6010";

function sampleDoc(folder: string, name: string, realThing: string, body: string): SeedDoc {
  return {
    folder,
    name,
    scope: "building",
    sample: true,
    text: `SAMPLE DOCUMENT - replace with the real ${realThing} for SP 26707 before relying on it.\n\n${body.trim()}\n`,
  };
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

const BUILDING_INFORMATION = sampleDoc(
  "06 Compliance & Safety",
  "Building information and emergency procedures.md",
  "building information and emergency procedures",
  `
Every location, name and phone number in this document is a placeholder for the IkonSM demo.

# Building information and emergency procedures

${SCHEME}. Prepared by Ikon Strata Management for occupiers, contractors and Ikon staff (sample version, November 2026).

## Water: where to turn it off

- Water main (stop-cock) for the whole building: red lever valve inside the garage meter box on the rear wall of the car park, next to the Water Corporation meter. Turn the lever a quarter-turn so it sits across the pipe; this shuts off cold water to all 8 lots.
- The garage meter box has a standard utility latch and is not locked, so any occupier can reach the main in an emergency.
- Lot stop-cocks: each lot has its own isolation valve (a small round tap handle) in the laundry cupboard, low on the wall behind the washing machine. Turning it off isolates that lot only, and it is the first thing to try for a leak inside a lot.
- Hot water: each lot has its own electric storage hot water system in the laundry cupboard (the lot owner's property). Its cold-water inlet valve is on the pipe entering the top of the unit.
- Garden reticulation: the controller and solenoid valves are in the bin store; the reticulation is fed from the building water main.
- After turning off the main, put a note on the meter box and tell Ikon, so it is turned back on once the plumber has made the area safe.

## Power and meters

- Main switchboard and electricity meters: top half of the same garage meter box (one Western Power meter per lot plus the common property meter). Common property circuits (stairwell lights, car park lights, reticulation controller) are labelled "CP".
- Each lot has its own switchboard with circuit breakers and RCDs (safety switches) just inside the front door. If water is near electrics, switch off the main switch there, but only if you can do it without touching water.
- Gas: the building is all-electric (sample); there is no gas supply to the lots. If anyone smells gas near the building, get clear and call 000.
- Stairwell and car park lights run on a timer and daylight sensor in the meter box.

## Contractors on site

- Access: building keys, the garage remote and the roof hatch key are kept in the key safe on the wall beside the garage meter box. Ikon gives the key safe code by phone once a job is approved; it is never written in emails or work orders.
- Contractors need the occupier's permission to enter a lot, except in an emergency: the strata company may enter a lot without notice in an emergency (Strata Titles Act 1985, s95).
- Normal work hours: 7 am to 6 pm on weekdays and 8 am to 1 pm on Saturdays. Emergency make-safe work can be done at any time.
- Asbestos: the eaves lining and the backing board in the garage meter box are recorded as non-friable asbestos cement (see the Fire safety and compliance register). Do not drill, cut or sand them.

## The building

- 8 residential lots over 2 levels in one brick and concrete walk-up building (sample: built about 1975).
- Ground floor: lots 1 to 4. First floor: lots 5 to 8, each directly above a ground-floor lot (lot 5 above lot 1, lot 6 above lot 2, lot 7 above lot 3, lot 8 above lot 4).
- Two common stairwells (east and west), each serving 4 lots. There is no lift.
- Rear car park with 8 undercover car bays (one per lot) and 2 visitor bays. Bin store behind the car park. The front garden, lawns, paths, stairwells and roof are common property.
- Roof: concrete tiles with box gutters over the stairwells. Roof hatch in the east stairwell ceiling (contractors only, with their own ladder and fall protection).

## In an emergency

1. Danger to life, fire, smoke or a gas smell: call 000 first, then get everyone out. The assembly point is the front verge on Davies Road.
2. Water pouring through a ceiling or flooding: if it is safe, turn off the lot stop-cock, or the building water main if the source is not inside your lot. Switch off power at the lot switchboard if water is near light fittings or power points. Contain the water with buckets and towels. Then call the after-hours plumber.
3. Sparking, a burning smell from electrics, or a power failure to common property: keep clear and call the after-hours electrician (call 000 if there is fire or smoke).
4. Break-in, a broken entry door or broken glass: call the police on 000 if a crime is in progress, then the after-hours locksmith or glazier.
5. Storm damage that opens the roof: SES on 132 500, then Ikon.
6. Fire indicator panel alarm or fault: see "Fire safety equipment" below.
7. Always tell Ikon as soon as it is safe. Ikon tells the council and, for damage to the building, the strata company's insurer. Take photos or video with the time noted and keep damaged items.

## Fire safety equipment

- Fire indicator panel (sample): red cabinet at the bottom of the east stairwell. It monitors the smoke detectors in both stairwells. If it shows FIRE, call 000 and evacuate. If it shows FAULT, call Sample Fire Protection (24/7) and tell Ikon; do not silence or reset the panel unless the fire services contractor tells you to.
- Portable fire extinguishers: one dry chemical extinguisher on each stairwell landing (4 in total).
- Emergency and exit lighting in both stairwells, tested every 6 months.
- Smoke alarms inside each lot are the lot owner's responsibility (see the Fire safety and compliance register).

## After-hours numbers

| Situation | Who to call | Phone |
|---|---|---|
| Danger to life, fire, smoke, gas | Emergency services | 000 |
| Burst pipe, water leak, blocked sewer | Sample Plumbing (24/7) | 0400 000 021 |
| Sparking, power failure to common property | Sample Electrical (24/7) | 0400 000 022 |
| Building left unsecured, broken lock | Sample Locksmiths (24/7) | 0400 000 023 |
| Broken window or glass door | Sample Glass & Glazing (24/7) | 0400 000 024 |
| Fire indicator panel alarm or fault | Sample Fire Protection (24/7) | 0400 000 027 |
| Storm damage | SES | 132 500 |
| Power outage in the street | Western Power faults | 13 13 51 |
| Water supply fault in the street | Water Corporation faults | 13 13 75 |
| Ikon strata manager on call (after hours) | Ikon after-hours line (SAMPLE number) | 0400 000 050 |
`,
);

const BY_LAWS = sampleDoc(
  "01 Plan & By-laws",
  "Scheme by-laws summary.md",
  "registered scheme by-laws",
  `
This is a sample summary written in the style of the WA default by-laws. It is not the scheme's registered by-laws.

# Scheme by-laws summary

SP 26707 - 34 Davies Road, Claremont. The real scheme by-laws are the ones registered with Landgate for SP 26707, including any amendments. Always check the registered by-laws (and the strata plan) before telling anyone what a by-law says or who is responsible for a repair. By-law numbers are not shown here because the registered numbering may differ.

## Conduct by-laws (Schedule 2 style: they apply to owners, tenants, other occupiers and visitors)

- Animals: an occupier may keep one cat or one small dog with the council's written approval, which must not be unreasonably refused. Assistance animals are always permitted. Animals must be on a lead and under control on common property, and any mess must be cleaned up straight away.
- Noise and behaviour: occupiers and visitors must not make noise, or behave in a way, likely to interfere with the peaceful enjoyment of another lot or the common property. Sample quiet hours: 10 pm to 7 am Sunday to Thursday, and 11 pm to 7 am on Friday and Saturday; parties must finish by then.
- Smoking and vaping: no smoking or vaping on common property, including the stairwells, landings, garage and gardens. An occupier who smokes on their own balcony or courtyard must stop smoke drifting into other lots.
- Rubbish and recycling: keep bins in the bin store, put them out on the street only on collection night and bring them back within 24 hours. Do not leave rubbish, bulky items or furniture on common property.
- Vehicles and parking: park only in your own lot's car bay. The 2 visitor bays are for visitors only, for up to 24 hours. No parking on the driveway, lawns or paths, and no storing boats, trailers or caravans on common property.
- Short-stay letting: this sample summary records no short-stay by-law for SP 26707. Check the registered by-laws; if there is none, short-stay letting is subject to the local government's rules and to all the conduct by-laws.
- Common property: do not obstruct the stairwells, landings or paths, or damage lawns, gardens or other common property. Children playing near the car park must be supervised.
- Laundry: no washing hung on balconies where it can be seen from the street.
- Floor coverings: hard floor coverings (timber, tiles, vinyl plank) in first-floor lots need acoustic underlay and the council's written approval first.
- Flammable liquids: do not store petrol or other flammable liquids in a lot or car bay, other than in a vehicle's fuel tank or small household quantities.
- Appearance: anything visible from outside (blinds, screens, signs, satellite dishes) must not detract from the appearance of the building.

## Governance by-laws (Schedule 1 style)

- Maintenance of lots: each owner must keep their lot, including fixtures, fittings and the hot water system, in good repair. The strata company maintains, repairs and replaces common property (Strata Titles Act 1985, s91). See "Responsibility guide - lot vs common property".
- Council: between 3 and 7 members, elected at each AGM, who choose a chairperson, secretary and treasurer. Current members and spending delegations are in "Council members and delegations".
- Alterations and air-conditioners: an owner needs the council's written approval before installing an air-conditioner, awning, security screen or solar panels, or making any change that affects the outside of the building or the common property. Structural changes to a lot usually need a resolution of the strata company, and the work must be done by licensed tradespeople.
- Contributions: owners pay the contributions set at the AGM by the due dates on the contribution notice. Overdue amounts attract simple interest at 11% a year (Strata Titles (General) Regulations 2019, reg 78).
- Car bays: each lot's car bay is shown on the strata plan as part of that lot (sample assumption - check the plan).
- Exclusive use: no exclusive use by-laws are recorded in this sample summary.
- Damage: an owner can be asked to pay for damage to common property caused by them, their tenants or their visitors.

## Disputes

If a by-law issue cannot be resolved through Ikon and the council, an owner or the strata company can apply to the State Administrative Tribunal (SAT).
`,
);

const INSURANCE = sampleDoc(
  "02 Insurance",
  "Insurance certificate of currency summary.md",
  "insurance certificate of currency and policy schedule",
  `
The insurer, policy number and every amount below are samples.

# Insurance certificate of currency summary

${SCHEME}

## Policy

- Insurer: Sample Strata Insurance Pty Ltd (sample insurer)
- Policy number: SAMPLE-SSI-26707-2026
- Insured: the strata company for Strata Plan 26707 (check the exact registered name on the real certificate)
- Period of insurance: 4 pm 30 June 2026 to 4 pm 30 June 2027
- Policy type: residential strata
- Premium 2026/27: $11,600 including GST and charges, paid from the administrative fund

## Sums insured

| Cover | Sum insured |
|---|---|
| Building (replacement and reinstatement value) | $4,850,000 |
| Common contents | $40,000 |
| Loss of rent and temporary accommodation | 15% of the building sum insured |
| Catastrophe (extra rebuilding costs after a major event) | 20% of the building sum insured |
| Public liability | $20,000,000 |
| Office bearers' liability | $1,000,000 |
| Fidelity guarantee | $250,000 |
| Voluntary workers (personal accident) | $200,000 death or disability; $2,000 a week |
| Flood | Included (sample - check the real schedule) |

## Excesses

- Standard excess: $1,000 per claim.
- Water damage (escape of liquid) excess: $2,500 per claim.
- The policy does not decide who pays an excess. That depends on the scheme by-laws and any council decision, so never tell an owner that they will, or will not, pay it.

## What the policy covers, in short

- Damage to the building and common property from insured events such as fire, storm, lightning, explosion, earthquake, escape of liquid, impact and malicious damage. Gradual deterioration, wear and tear, and faulty workmanship are usually excluded; check the policy wording.
- The building cover includes fixtures that are part of the building, such as ceilings, internal walls and built-in fittings. It does not cover owners' or tenants' contents (carpets and floating floors may count as contents - check the wording). Owners need their own contents insurance, and landlords need landlord insurance.
- WA law requires the strata company to insure the buildings to replacement value and to hold public liability cover of at least $10 million; this policy's $20 million is above that minimum.

## Claims

1. Make safe first. Keep damaged items and take photos or video with the time noted.
2. Ikon lodges building and common property claims with the insurer on behalf of the strata company, and tells the council.
3. The insurer may appoint an assessor. The plumber's or other contractor's report on the cause is usually needed.
4. Damage to contents is claimed by the owner or tenant with their own insurer.

Insurer claims contact (sample): Sample Strata Insurance claims team, 0400 000 041, sample.insurance.claims@example.com, quoting policy SAMPLE-SSI-26707-2026.

## Valuation and AGM

- Last building valuation: June 2025 (sample). Ikon recommends a new valuation every 3 years; next due June 2028.
- This certificate of currency and the policy schedule were presented at the 2026 AGM.
`,
);

const CONTRACTORS = sampleDoc(
  "05 Maintenance & Contractors",
  "Preferred contractors list.md",
  "preferred contractors list",
  `
These companies, names, phone numbers and email addresses are samples, not real businesses.

# Preferred contractors list

SP 26707 - 34 Davies Road, Claremont. Approved by the council (sample) on 15 September 2026.

## Before sending a contractor

- Access: building keys, the garage remote and the roof hatch key are in the key safe beside the garage meter box. Ikon gives the key safe code by phone once the job is approved; never put it in an email or work order.
- Every work order goes through Ikon and needs a staff member's approval in the Ikon hub before it is sent.
- Spending: Ikon may approve work up to the council's delegation ($2,000 including GST per job; emergency make-safe work up to $5,000). Anything more needs council approval - see "Council members and delegations".
- Contractors must hold current public liability insurance and workers' compensation cover, and plumbing, electrical and gas work must be done by trades licensed in WA. Ikon keeps copies on file.
- Emergency (P1) jobs: make safe only, then quote for any further repair.

## Contractors

| Trade | Company (sample) | Contact | Phone | Email | After hours | Notes |
|---|---|---|---|---|---|---|
| Plumber | Sample Plumbing (24/7) | Dispatch desk | 0400 000 021 | plumbing.dispatch@example.com | Yes, 24/7 | First call for leaks, burst pipes, blocked sewer and hot water. Repaired the 2025 ceiling leak between lots 4 and 8. |
| Electrician | Sample Electrical (24/7) | Service desk | 0400 000 022 | electrical.service@example.com | Yes, 24/7 | Common property power and lighting; emergency lighting tests. |
| Locksmith | Sample Locksmiths (24/7) | Service desk | 0400 000 023 | locksmith.service@example.com | Yes, 24/7 | Common doors, garage remote and key safe; restricted key system. |
| Glazier | Sample Glass & Glazing (24/7) | Service desk | 0400 000 024 | glazing.service@example.com | Yes, 24/7 | Broken windows and glass doors; boarding up after hours. |
| Cleaner | Sample Cleaning Co | Account manager | 0400 000 025 | cleaning.accounts@example.com | No | Fortnightly clean of stairwells, landings and car park; bin store wash every quarter. |
| Gardener | Sample Gardens & Reticulation | Owner-operator | 0400 000 026 | gardens.reticulation@example.com | No | Monthly garden visit; reticulation check every spring. |
| Fire services | Sample Fire Protection (24/7) | Service desk | 0400 000 027 | fire.service@example.com | Yes, 24/7 | AS 1851 six-monthly inspections, fire indicator panel and extinguishers. |
| Builder / handyman | Sample Building Maintenance | Supervisor | 0400 000 028 | building.maintenance@example.com | No | Minor repairs, doors, gutters and roof tiles (with fall protection). |

Lift: not applicable (the building has no lift).
`,
);

const AGM_MINUTES = sampleDoc(
  "03 Meetings",
  "AGM minutes 2026 (summary).md",
  "minutes of the 2026 annual general meeting",
  `
Names, votes and amounts are samples.

# AGM minutes 2026 (summary)

Annual general meeting of the strata company for SP 26707, 34 Davies Road, Claremont. Held on Tuesday 15 September 2026 at 6 pm by video link, chaired by Sam Specimen (Lot 5). Minutes taken by Ikon Strata Management.

## Attendance

- Present in person or online: lots 1, 3, 4, 5 and 7. Proxies: lot 6 (to the chairperson) and lot 8 (to Jordan Mockup). Apologies: lot 2.
- A quorum was present.

## Resolutions

1. Minutes of the 2025 AGM confirmed as a true record (ordinary resolution, carried).
2. Financial statements for the year ended 30 June 2026 received. Administrative fund closing balance $6,820; reserve fund closing balance $38,450.
3. Insurance: the certificate of currency and policy schedule from Sample Strata Insurance Pty Ltd (policy SAMPLE-SSI-26707-2026) were presented. Building sum insured of $4,850,000 confirmed, based on the June 2025 valuation.
4. Budget 2026/27 adopted (ordinary resolution, carried): administrative fund $28,800 and reserve fund $9,600 for the year. Contributions are payable quarterly by unit entitlement - see "Budget and contributions 2026-27".
5. Council elected (3 members): Sam Specimen (Lot 5) chairperson, Morgan Demo (Lot 3) treasurer, Jordan Mockup (Lot 7) secretary.
6. Spending delegations to the strata manager confirmed: up to $2,000 including GST per item for routine work within the budget, and up to $5,000 for emergency make-safe work, with the chairperson told within 24 hours.
7. Stairwell repainting: owners asked Ikon to obtain 3 quotes (estimate $9,800 from the reserve fund) for the council to consider. This is maintenance, not an improvement.

## General business (no resolutions)

- The owner of lot 4 asked that any future ceiling leak from above be investigated quickly. The 2025 leak between lots 4 and 8 was traced to a failed shower waste joint in the ceiling cavity and repaired by the strata company.
- Owners raised trailers being left in the visitor bays; Ikon to send all occupiers a reminder of the conduct by-laws.
- The annual termite inspection is due in October 2026; Ikon to book it.

## Next AGM

Due by September 2027, and no more than 15 months after this meeting.
`,
);

const BUDGET = sampleDoc(
  "04 Financials & Levies",
  "Budget and contributions 2026-27.md",
  "2026/27 budget and contributions schedule",
  `
All figures are samples.

# Budget and contributions 2026-27

SP 26707 - 34 Davies Road, Claremont. Financial year 1 July 2026 to 30 June 2027. Adopted at the AGM on 15 September 2026 (sample).

## Administrative fund budget (day-to-day running costs)

| Item | 2026/27 budget |
|---|---|
| Building insurance premium | $11,600 |
| Strata management fee (Ikon) | $7,040 |
| Common area cleaning (fortnightly) | $2,640 |
| Gardening and reticulation | $2,160 |
| Common property electricity | $840 |
| Fire safety inspections (AS 1851) | $760 |
| General repairs and maintenance | $2,400 |
| Bank fees, postage and sundries | $160 |
| Contingency | $1,200 |
| Total administrative fund | $28,800 |

## Reserve fund (major future work)

- Contribution for 2026/27: $9,600. Balance at 30 June 2026: $38,450.
- Planned spending (estimates): stairwell repainting 2027 ($9,800), box gutter replacement 2029 ($14,000), external repaint 2031 ($42,000).
- SP 26707 has 8 lots and a building replacement value under $5 million, so it is not a designated strata company: a reserve fund and a 10 year plan are not compulsory. The owners have chosen to keep a reserve fund (sample).

## Contributions per lot

Contributions are split by unit entitlement (sample entitlements: 120 for each ground-floor lot and 130 for each first-floor lot; 1,000 in total). They are due quarterly in advance on 1 August, 1 November, 1 February and 1 May.

| Lots | Unit entitlement | Administrative fund per quarter | Reserve fund per quarter | Total per quarter |
|---|---|---|---|---|
| 1 to 4 (ground floor) | 120 each | $864 | $288 | $1,152 |
| 5 to 8 (first floor) | 130 each | $936 | $312 | $1,248 |

- Total for the year across the scheme: $38,400 ($28,800 administrative fund plus $9,600 reserve fund).
- Overdue contributions attract simple interest at 11% a year (Strata Titles (General) Regulations 2019, reg 78). A new owner is liable for any arrears on the lot.
- Payment is by BPAY or EFT using the reference on the contribution notice (sample format SP26707-LOT4). Ikon never changes payment details by email; anyone asked to pay into a new account should call Ikon on a number they already have.

## Arrears at 31 October 2026 (sample)

- Lot 2: one quarter overdue ($1,152, due 1 August 2026). Reminder sent on 15 September 2026.
- All other lots are paid to date. The 1 November 2026 notices have been issued to all lots.
`,
);

const FIRE_REGISTER = sampleDoc(
  "06 Compliance & Safety",
  "Fire safety and compliance register.md",
  "fire safety and compliance register",
  `
Dates, results and contractors are samples.

# Fire safety and compliance register

SP 26707 - 34 Davies Road, Claremont. Kept by Ikon Strata Management. Status as at 3 November 2026 (sample).

## Common property (the strata company's responsibility)

| Item | Standard or rule | How often | Last done | Next due | Contractor | Status |
|---|---|---|---|---|---|---|
| Portable fire extinguishers (4, stairwell landings) | AS 1851 | Every 6 months | 12 Aug 2026 | Feb 2027 | Sample Fire Protection | OK |
| Fire indicator panel and stairwell smoke detectors | AS 1851 | Every 6 months | 12 Aug 2026 | Feb 2027 | Sample Fire Protection | OK |
| Emergency and exit lighting (stairwells) | AS/NZS 2293 | Every 6 months | 12 Aug 2026 | Feb 2027 | Sample Electrical | 1 fitting failed; replaced 20 Aug 2026 |
| Common property RCDs (safety switches) | Push-button test | Every 6 months | 12 Aug 2026 | Feb 2027 | Sample Electrical | OK |
| Asbestos register (eaves lining, meter box backing board) | Condition re-inspection | Every 5 years | Mar 2019 | Mar 2024 | Licensed assessor (to appoint) | OVERDUE |
| Termite inspection | Annual inspection (practice) | Yearly | Oct 2025 | Oct 2026 | To book | OVERDUE |
| Balconies and balustrades (first floor) | Visual safety check (practice) | Yearly | Mar 2026 | Mar 2027 | Sample Building Maintenance | OK |
| Gutters and box gutters | Clean before winter and summer (practice) | Every 6 months | Apr 2026 | Nov 2026 | Sample Building Maintenance | Due this month |
| Roof height safety | No certified anchor points | - | - | - | - | Contractors bring their own fall protection |
| Building insurance valuation | Replacement value | Every 3 years (practice) | Jun 2025 | Jun 2028 | Valuer | OK |
| Lift | Not applicable | - | - | - | - | No lift |
| Swimming pool | Not applicable | - | - | - | - | No pool |

## Inside each lot (the lot owner's responsibility)

- Smoke alarms: WA law requires compliant, mains-powered smoke alarms in a dwelling before it is sold, rented or hired. Owners should test them monthly and replace them every 10 years. Check the current WA Building and Energy guidance for the exact rules.
- RCDs (safety switches): WA law requires at least two RCDs protecting a dwelling's power and lighting circuits before it is sold or rented. Check the current WA Building and Energy guidance.
- The hot water system, appliances, and the pipes and fittings that serve only that lot.

## Actions

- Book the termite inspection (overdue since October 2026).
- Appoint a licensed assessor to re-inspect the asbestos register items (overdue since March 2024).
- Book the November 2026 gutter clean.
`,
);

const RESPONSIBILITY_GUIDE = sampleDoc(
  "01 Plan & By-laws",
  "Responsibility guide - lot vs common property.md",
  "responsibility guide, checked against the registered strata plan and scheme by-laws,",
  `
This is a sample guide for the demo.

# Responsibility guide: lot vs common property

SP 26707 - 34 Davies Road, Claremont. A quick guide for Ikon staff on who usually fixes what. It is not legal advice, and the final answer can depend on the cause the contractor finds.

## The starting rules (WA)

- The lot owner maintains and repairs the lot (default governance by-law, Schedule 1 by-law 1).
- The strata company maintains, repairs and replaces common property and its fixtures, whatever caused the damage (Strata Titles Act 1985, s91).
- SP 26707 is treated here as a built strata scheme with the default lot boundaries: the inner surface of the walls, the upper surface of the floor and the under surface of the ceiling (s3(2)). Anything inside that boundary is generally part of the lot; the structure, ceiling cavities, slabs and outer walls are common property. The registered strata plan can show different boundaries, so check it.
- The registered scheme by-laws can change who is responsible. Check them before giving a firm answer, and say "likely" until the cause is known.

## Who usually fixes what at SP 26707 (sample)

| Item | Usually responsible | Notes |
|---|---|---|
| Pipes in the ceiling cavity, slab, risers or a common wall, or serving more than one lot | Strata company | Includes shower and bath wastes between floors. A leak through a ceiling from this pipework is usually the strata company's to fix. |
| Taps, mixers, flexi-hoses, shower heads and appliance hoses inside a lot, serving only that lot | Lot owner | Includes washing machine and dishwasher hoses. |
| Shower screen, tiles, grout and silicone inside a lot | Lot owner | Responsibility for waterproofing under the tiles is often disputed - check the plan and by-laws. |
| Hot water system | Lot owner | Each lot has its own unit in the laundry cupboard. |
| Ceiling linings (plaster) | Strata company | They sit outside the default lot boundary (the under surface of the ceiling). Repairs after a leak are usually part of the building insurance claim. |
| Internal walls within a lot, internal doors, kitchen, built-in wardrobes, floor coverings | Lot owner | Carpets and floating floors may count as contents for insurance. |
| External walls, roof, gutters, slabs, structure and stairwells | Strata company | |
| Windows and external glass | Strata company | Many schemes' by-laws make an owner pay for glass broken by their household - check the by-laws. |
| Front door of a lot | Strata company (it sits in a common wall) | The lot's locks and keys are the owner's. |
| First-floor balconies | Check the strata plan | Structure and balustrades: usually the strata company. Tiles and drains on a balcony that is part of the lot: usually the owner. |
| Lot switchboard, power points, light fittings, RCDs and smoke alarms | Lot owner | |
| Main switchboard, meters, common lighting, car park and garage | Strata company | The electricity supply up to the meters is Western Power's. |
| Car bays | Lot owner (part of the lot - sample assumption) | Check the strata plan. |
| Gardens, lawns, reticulation, bin store, paths and boundary fences | Strata company | Boundary fences may be shared with neighbours. |
| Termites | Strata company | Treatment and repair of the structure. |
| Pests inside a lot (cockroaches, ants, mice) | Lot owner | |
| Blocked sink, basin or toilet inside a lot | Lot owner | Especially when caused by misuse. |
| Blocked sewer or stormwater serving more than one lot | Strata company | Send the plumber: P2, or P1 if sewage is overflowing. |
| Air-conditioner | Lot owner | Needs the council's approval to install. |

## Worked example: water through a ceiling

1. Water comes through the bathroom ceiling of a ground-floor lot (for example lot 4, which is below lot 8).
2. If the source is pipework in the ceiling cavity or a shared waste, it is likely common property: the strata company fixes it, and the damage is usually claimed on the building insurance.
3. If the source is a fitting inside the lot above that serves only that lot (a failed shower seal, flexi-hose or washing machine hose), that owner is usually responsible for fixing the source; damage to the building below may still be claimed on the building insurance.
4. Owners' and tenants' contents are claimed with their own insurers.
5. Who pays the excess depends on the policy and the scheme by-laws. Never promise either way.
6. Wait for the plumber's report on the cause before confirming who is responsible.
`,
);

const COUNCIL = sampleDoc(
  "03 Meetings",
  "Council members and delegations.md",
  "council members and delegations",
  `
Names and contact details are fictional.

# Council members and delegations

SP 26707 - 34 Davies Road, Claremont. Council elected at the AGM on 15 September 2026 (sample).

## Council members

| Role | Name | Lot | Email | Phone | Prefers |
|---|---|---|---|---|---|
| Chairperson | Sam Specimen | 5 | sam.specimen@example.com | 0400 000 005 | Email; a phone call for P1 emergencies only |
| Treasurer | Morgan Demo | 3 | morgan.demo@example.com | 0400 000 003 | Email |
| Secretary | Jordan Mockup | 7 | jordan.mockup@example.com | 0400 000 007 | Email or SMS |

## Spending delegations (council resolution, sample)

- Routine repairs and maintenance within the budget: Ikon, as strata manager, may approve up to $2,000 including GST per item without asking the council first.
- Emergency make-safe work: Ikon may approve up to $5,000 including GST without asking first, and must tell the chairperson within 24 hours.
- $2,000 to $10,000: written approval (email is fine) from at least 2 council members before work starts.
- Over $10,000, or anything not in the budget: decided at a council meeting.
- Improvements to common property costing more than $4,000 (8 lots x $500) need a special resolution at a general meeting (Strata Titles (General) Regulations 2019, reg 80). Repairs and maintenance are not improvements.
- Insurance claims: Ikon may lodge building claims on behalf of the strata company and tells the council.

## Owner applications

- Air-conditioners, awnings, security screens, hard floor coverings and animals: the council decides by email. Ikon sends each application to all 3 members, and 2 approvals decide it. Target reply time: 14 days (sample practice).
- Structural changes, or anything that affects common property: needs a resolution of the strata company at a general meeting.

## Keeping the council informed

- P1 emergencies: Ikon phones the chairperson as soon as practical, then emails all council members.
- P2 and P3 items: weekly email summary to all council members.
- Council meetings: quarterly, usually by video link.
`,
);

// ---------------------------------------------------------------------------
// Contacts (all fictional)
// ---------------------------------------------------------------------------

type SeedContact = Omit<Contact, "id">;

function contact(c: Partial<SeedContact> & Pick<SeedContact, "role" | "name">): SeedContact {
  return {
    lot: null,
    email: null,
    phone: null,
    trade: null,
    afterHours: false,
    notes: null,
    ...c,
    sample: true,
  };
}

const COUNCIL_CONTACTS: SeedContact[] = [
  contact({ role: "council", name: "Sam Specimen", lot: "5", email: "sam.specimen@example.com", phone: "0400 000 005", notes: "Council chairperson. Prefers email; phone for P1 emergencies only." }),
  contact({ role: "council", name: "Morgan Demo", lot: "3", email: "morgan.demo@example.com", phone: "0400 000 003", notes: "Council treasurer." }),
  contact({ role: "council", name: "Jordan Mockup", lot: "7", email: "jordan.mockup@example.com", phone: "0400 000 007", notes: "Council secretary. Email or SMS." }),
];

const OWNER_CONTACTS: SeedContact[] = [
  contact({ role: "owner", name: "Alex Example", lot: "1", email: "alex.example@example.com", phone: "0400 000 001", notes: "Owner-occupier, ground floor." }),
  contact({ role: "owner", name: "Chris Placeholder", lot: "2", email: "chris.placeholder@example.com", phone: "0400 000 002", notes: "Owner-occupier, ground floor. One quarter of contributions overdue (sample)." }),
  contact({ role: "owner", name: "Morgan Demo", lot: "3", email: "morgan.demo@example.com", phone: "0400 000 003", notes: "Owner-occupier, ground floor. Council treasurer." }),
  contact({ role: "owner", name: "Jane Sample", lot: "4", email: "jane.sample@example.com", phone: "0400 000 004", notes: "Owner-occupier, ground floor, directly below lot 8. Ceiling leak from above in 2025." }),
  contact({ role: "owner", name: "Sam Specimen", lot: "5", email: "sam.specimen@example.com", phone: "0400 000 005", notes: "Owner-occupier, first floor. Council chairperson." }),
  contact({ role: "owner", name: "Taylor Fictional", lot: "6", email: "taylor.fictional@example.com", phone: "0400 000 006", notes: "Non-resident owner. Lot 6 is tenanted and managed by Sample Realty." }),
  contact({ role: "owner", name: "Jordan Mockup", lot: "7", email: "jordan.mockup@example.com", phone: "0400 000 007", notes: "Owner-occupier, first floor. Council secretary." }),
  contact({ role: "owner", name: "Riley Template", lot: "8", email: "riley.template@example.com", phone: "0400 000 008", notes: "Owner-occupier, first floor, directly above lot 4." }),
];

const OTHER_CONTACTS: SeedContact[] = [
  contact({ role: "property_manager", name: "Kim Example (Sample Realty)", lot: "6", email: "kim.example.pm@example.com", phone: "0400 000 016", notes: "Property manager for lot 6 (tenanted). Copy on lot 6 matters; lot decisions go to the owner." }),
  contact({ role: "insurer", name: "Sample Strata Insurance Pty Ltd", email: "sample.insurance.claims@example.com", phone: "0400 000 041", notes: "Claims team. Policy SAMPLE-SSI-26707-2026. Ikon lodges claims on behalf of the strata company." }),
  contact({ role: "staff", name: "Ikon after-hours line (SAMPLE)", phone: "0400 000 050", afterHours: true, notes: "Sample number for the strata manager on call. Replace with Ikon's real after-hours number." }),
];

const CONTRACTOR_CONTACTS: SeedContact[] = [
  contact({ role: "contractor", name: "Sample Plumbing (24/7)", trade: "plumber", afterHours: true, email: "plumbing.dispatch@example.com", phone: "0400 000 021", notes: "First call for leaks, burst pipes, blocked sewer and hot water. Repaired the 2025 ceiling leak between lots 4 and 8." }),
  contact({ role: "contractor", name: "Sample Electrical (24/7)", trade: "electrician", afterHours: true, email: "electrical.service@example.com", phone: "0400 000 022", notes: "Common property power and lighting; emergency lighting tests." }),
  contact({ role: "contractor", name: "Sample Locksmiths (24/7)", trade: "locksmith", afterHours: true, email: "locksmith.service@example.com", phone: "0400 000 023", notes: "Common doors, garage remote and key safe." }),
  contact({ role: "contractor", name: "Sample Glass & Glazing (24/7)", trade: "glazier", afterHours: true, email: "glazing.service@example.com", phone: "0400 000 024", notes: "Broken windows and glass doors; boarding up after hours." }),
  contact({ role: "contractor", name: "Sample Cleaning Co", trade: "cleaner", email: "cleaning.accounts@example.com", phone: "0400 000 025", notes: "Fortnightly common area clean." }),
  contact({ role: "contractor", name: "Sample Gardens & Reticulation", trade: "gardener", email: "gardens.reticulation@example.com", phone: "0400 000 026", notes: "Monthly garden visit; reticulation." }),
  contact({ role: "contractor", name: "Sample Fire Protection (24/7)", trade: "fire services", afterHours: true, email: "fire.service@example.com", phone: "0400 000 027", notes: "AS 1851 inspections, fire indicator panel, extinguishers." }),
  contact({ role: "contractor", name: "Sample Building Maintenance", trade: "builder", email: "building.maintenance@example.com", phone: "0400 000 028", notes: "Handyman and minor building repairs, gutters, roof tiles." }),
];

// ---------------------------------------------------------------------------
// Memory notes
// ---------------------------------------------------------------------------

const MEMORY: string[] = [
  "SAMPLE - Water main for the whole building: red lever valve in the garage meter box on the rear wall of the car park, next to the Water Corporation meter (from the sample building information document).",
  "SAMPLE - Lot 8 is directly above lot 4. In 2025 a leak through lot 4's bathroom ceiling came from a failed shower waste joint in the ceiling cavity (common property) and was repaired by Sample Plumbing (24/7). Check this history for any new lot 4 ceiling leak.",
  "SAMPLE - Lot 6 is tenanted. Deal with the owner (Taylor Fictional) on lot matters and copy the property manager, Kim Example at Sample Realty.",
  "SAMPLE - Council spending delegation: Ikon may approve up to $2,000 incl. GST per item, and up to $5,000 for emergency make-safe work (tell the chairperson within 24 hours).",
  "SAMPLE - Council chairperson Sam Specimen (lot 5) prefers email; phone only for P1 emergencies.",
];

export const SP_26707_SEED: SeedData = {
  docs: [BUILDING_INFORMATION, BY_LAWS, INSURANCE, CONTRACTORS, AGM_MINUTES, BUDGET, FIRE_REGISTER, RESPONSIBILITY_GUIDE, COUNCIL],
  contacts: [...COUNCIL_CONTACTS, ...OWNER_CONTACTS, ...OTHER_CONTACTS, ...CONTRACTOR_CONTACTS],
  memory: MEMORY,
};
