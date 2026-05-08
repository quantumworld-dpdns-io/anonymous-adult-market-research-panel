mod utils;

use ::std::hash::pedersen_hash;
use utils::{validate_birth_date, validate_current_date};

// Private inputs (never revealed to verifier):
//   birth_year, birth_month, birth_day  - participant's date of birth
//   blinding_factor                     - random scalar for nullifier binding
//
// Public inputs (visible to verifier):
//   current_year, current_month, current_day - today's date (server-signed attestation)
//   study_id                                 - binds nullifier to a specific study
//   nullifier                                - H(birth_date || blinding_factor || study_id)

fn main(
    // Private
    birth_year:      u32,
    birth_month:     u32,
    birth_day:       u32,
    blinding_factor: Field,
    // Public
    current_year:    pub u32,
    current_month:   pub u32,
    current_day:     pub u32,
    study_id:        pub Field,
    nullifier:       pub Field,
) {
    // 1. Validate date ranges
    validate_birth_date(birth_year, birth_month, birth_day, current_year);
    validate_current_date(current_year, current_month, current_day);

    // 2. Compute age in years with full month/day comparison
    let age_years = compute_age(
        birth_year, birth_month, birth_day,
        current_year, current_month, current_day,
    );

    // 3. Enforce age predicate: participant must be at least 18
    assert(age_years >= 18);

    // 4. Verify nullifier = Pedersen(birth_year || birth_month || birth_day
    //                                || blinding_factor || study_id)
    let expected_nullifier = pedersen_hash([
        birth_year as Field,
        birth_month as Field,
        birth_day as Field,
        blinding_factor,
        study_id,
    ]);
    assert(nullifier == expected_nullifier);
}

// Compute age in full years, accounting for month and day.
pub fn compute_age(
    by: u32, bm: u32, bd: u32,
    cy: u32, cm: u32, cd: u32,
) -> u32 {
    let mut age = cy - by;

    // Subtract one year if the birthday has not occurred yet this calendar year
    if cm < bm {
        age = age - 1;
    } else if (cm == bm) & (cd < bd) {
        age = age - 1;
    }

    age
}
