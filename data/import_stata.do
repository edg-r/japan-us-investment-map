* Run from the extracted data folder. Requires Stata 14 or later.
version 14
clear all
set more off

import delimited using "japan_us_investment_records.csv", clear varnames(1) encoding("utf-8") stringcols(_all)
* Preserve state_fips as a two-character string, including leading zeros.
label variable id "Stable source-ledger record identifier"
label variable firm_group "Company grouping used by the map for linked company views."
label variable firm "Named U.S. business, target, joint venture or investing firm."
label variable japanese_parent "Japanese parent or investors identified in the source."
label variable origin_city_japan "Ledger corporate-origin city in Japan"
label variable origin_prefecture_japan "Prefecture containing the ledger corporate-origin city."
label variable state_code "Two-letter U.S. postal code, including DC"
label variable state_name "Full state or District of Columbia name."
label variable city "U.S. destination locality, if established"
destring latitude, replace
label variable latitude "Ledger U.S. destination latitude"
destring longitude, replace
label variable longitude "Ledger U.S. destination longitude"
label variable project_name "Project, transaction, presence or cooperation record title."
label variable sector "Descriptive activity or industry"
destring amount_usd_million, replace
label variable amount_usd_million "Exactly the map's state-allocated documented amount"
label variable amount_qualifier "Reported, approximate (about), or lower-bound (at least) qualifier"
label variable amount_basis "Monetary concept: announced project commitment, completed project total, acquisi"
destring transaction_value_usd_million, replace
label variable transaction_value_usd_million "Whole-transaction value where reported"
gen double date_tmp = daily(announcement_date, "YMD")
drop announcement_date
rename date_tmp announcement_date
format announcement_date %tdCCYY-NN-DD
label variable announcement_date "Ledger announcement/event date in ISO format"
label variable status "Recorded project or transaction status as of research cutoff"
label variable record_kind "Nature of the documented record"
label variable route_kind "Meaning of the map destination"
label variable ownership_scope "Ownership, joint-venture or transaction scope needed to interpret the amount."
label variable allocation_note "Substantive research caveats about geographic allocation, overlap, valuation, ow"
destring investor_commitment_usd_million, replace
label variable investor_commitment_usd_million "Separately disclosed Japanese investor commitment, when available"
label variable investor_commitment_note "Scope and limitations of the separately reported investor commitment."
destring financing_origin_verified, replace
label variable financing_origin_verified "Whether geographic origin of financing was verified"
label variable source_url "Primary supporting source link used by the map."
label variable source_title "Title of the primary supporting source."
label variable source_publisher "Publisher or issuing organization of the source."
gen double date_tmp = daily(source_date, "YMD")
drop source_date
rename date_tmp source_date
format source_date %tdCCYY-NN-DD
label variable source_date "Ledger publication date of the linked source, when established."
label variable origin_source_url "Supporting source for the Japanese corporate origin."
label variable evidence_summary "Source-specific evidence supporting the record, including scope limitations."
label variable state_fips "Two-character Federal Information Processing Standards state identifier, with le"
destring state_allocated, replace
label variable state_allocated "Map flag identifying a record with a state-allocated amount."
label variable dest_kind "Map destination precision: city or state. City points can be approximate corpora"
destring origin_longitude, replace
label variable origin_longitude "Corporate-origin longitude used by the map, before inset port aggregation."
destring origin_latitude, replace
label variable origin_latitude "Corporate-origin latitude used by the map, before inset port aggregation."
gen double date_tmp = daily(as_of, "YMD")
drop as_of
rename date_tmp as_of
format as_of %tdCCYY-NN-DD
label variable as_of "Research cutoff for this release"
encode amount_basis, gen(category_tmp)
drop amount_basis
rename category_tmp amount_basis
label variable amount_basis "Monetary concept: announced project commitment, completed project total, acquisi"
encode amount_qualifier, gen(category_tmp)
drop amount_qualifier
rename category_tmp amount_qualifier
label variable amount_qualifier "Reported, approximate (about), or lower-bound (at least) qualifier"
encode dest_kind, gen(category_tmp)
drop dest_kind
rename category_tmp dest_kind
label variable dest_kind "Map destination precision: city or state. City points can be approximate corpora"
encode firm_group, gen(category_tmp)
drop firm_group
rename category_tmp firm_group
label variable firm_group "Company grouping used by the map for linked company views."
encode record_kind, gen(category_tmp)
drop record_kind
rename category_tmp record_kind
label variable record_kind "Nature of the documented record"
encode route_kind, gen(category_tmp)
drop route_kind
rename category_tmp route_kind
label variable route_kind "Meaning of the map destination"
encode status, gen(category_tmp)
drop status
rename category_tmp status
label variable status "Recorded project or transaction status as of research cutoff"
label define yes_no 0 "No" 1 "Yes", replace
label values financing_origin_verified yes_no
label values state_allocated yes_no
assert _N == 67
preserve
collapse (sum) amount_usd_million
assert abs(amount_usd_million[1] - 41036) < 0.000001
restore
save "japan_us_investment_records.dta", replace

import delimited using "japan_us_investment_states.csv", clear varnames(1) encoding("utf-8") stringcols(_all)
* Preserve state_fips as a two-character string, including leading zeros.
label variable state_fips "Two-character Federal Information Processing Standards state identifier, with le"
label variable state_code "Two-letter U.S. postal code, including DC"
label variable state_name "Full state or District of Columbia name."
destring documented_total_usd_million, replace
label variable documented_total_usd_million "Exactly the state's map subtotal across nonmissing mapped amounts"
destring announced_usd_million, replace
label variable announced_usd_million "State sum with announced_project_total basis"
destring completed_usd_million, replace
label variable completed_usd_million "State sum with completed_project_total basis"
destring acquisition_usd_million, replace
label variable acquisition_usd_million "State sum with acquisition_price basis"
destring record_count, replace
label variable record_count "Count of all records assigned to the state, including unpriced records."
destring priced_record_count, replace
label variable priced_record_count "Count of records with a nonmissing mapped amount."
destring unpriced_record_count, replace
label variable unpriced_record_count "Count of records excluded from the subtotal because mapped amount is missing."
destring no_state_total, replace
label variable no_state_total "1 if documented state subtotal is missing"
gen double date_tmp = daily(as_of, "YMD")
drop as_of
rename date_tmp as_of
format as_of %tdCCYY-NN-DD
label variable as_of "Research cutoff for this release"
label define yes_no 0 "No" 1 "Yes", replace
label values no_state_total yes_no
assert _N == 51
preserve
collapse (sum) documented_total_usd_million
assert abs(documented_total_usd_million[1] - 41036) < 0.000001
restore
save "japan_us_investment_states.dta", replace
