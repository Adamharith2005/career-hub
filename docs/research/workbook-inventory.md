# Workbook inventory: Internship_Research_Audited_Putrajaya_Cyberjaya.xlsx

Source: `~/Downloads/Internship_Research_Audited_Putrajaya_Cyberjaya.xlsx` (134,720 bytes, read-only, 10 worksheets, no hidden sheets, 0 hyperlink objects, formulas only in OVERVIEW/RATE CALCULATOR with cached values).

| Sheet | Rows | Role |
|---|---|---|
| ALL 170 LEADS | 170 | audited master list (imported) |
| RAW PUTRAJAYA INPUT | 92 | original claims, 48 columns (merged for legal entity, size, industry, allowance fields) |
| RAW CYBERJAYA INPUT | 78 | original claims, 22 columns |
| FIRST CONTACT SHORTLIST / PUTRAJAYA AUDIT QUEUE / SOURCE LIBRARY / KEY CORRECTIONS / OVERVIEW / RATE CALCULATOR / OUTREACH TEMPLATES | — | reference, not imported as organisations |

## Counts (from the importer dry-run on the real file)
- 170 unique organisations: 92 Putrajaya, 78 Cyberjaya. No duplicate names, no organisation in both cities.
- Government: 71 Putrajaya + 6 Cyberjaya (CyberSecurity Malaysia, MCMC, LHDNM, JDN, JSM, MDEC). Non-government: 21 Putrajaya + 72 Cyberjaya.
- All 78 Cyberjaya rows match the existing app seed (0 duplicates created); 92 Putrajaya rows are new.
- Internship evidence after audit: 4 confirmed programme, 37 direct-outreach, 19 historical, 110 unknown.
- Office confidence: 5 verified, 1 probable, 164 unverified.

## Allowance (audit overrides source labels)
- 61 rows: JPA policy may apply → stored as policy reference, grade A5 (not confirmed). 107 other A5. 2 A6 (DOF, DVS official pages say no allowance).
- 0 rows have a displayable employer-confirmed amount. The 63 "A1 Verified Current Policy" and 26 "A3" bands in the raw sheet are NOT employer evidence; original claims are kept verbatim as unverified claim text.
- JPA rule stored once: RM5/hour, 8 h/day, max 90 paid days; no universal RM900 cap.

## Data-quality warnings
- All 92 Putrajaya rows claimed "VERIFIED" office; only 5 survive the audit.
- 91 "Rolling" deadlines are unsupported. 70 "I2" programme claims lack direct evidence.
- Cyberjaya rows were not re-audited in this workbook.
