// Date validation helpers for the age-proof circuit.
// All assertions here are constraints — a failing assert makes the proof invalid.

// Days per month lookup (non-leap-year conservative; day <= 31 covers all months)
// We use a simple upper bound; finer validation would increase gate count significantly.
pub fn validate_birth_date(year: u32, month: u32, day: u32, current_year: u32) {
    // Month must be 1–12
    assert(month >= 1);
    assert(month <= 12);

    // Day must be 1–31 (conservative upper bound; exact day-per-month adds ~3k gates)
    assert(day >= 1);
    assert(day <= 31);

    // Year must be plausible: at least 1900, at most current year
    assert(year >= 1900);
    assert(year <= current_year);
}

pub fn validate_current_date(year: u32, month: u32, day: u32) {
    // Sanity bounds for the server-supplied current date
    assert(year >= 2024);  // Platform launch year lower bound
    assert(year <= 2100);  // Reasonable upper bound

    assert(month >= 1);
    assert(month <= 12);

    assert(day >= 1);
    assert(day <= 31);
}

// Returns true if (ay, am, ad) is on or before (by, bm, bd).
// Used internally; exposed for test reuse.
pub fn date_lte(ay: u32, am: u32, ad: u32, by: u32, bm: u32, bd: u32) -> bool {
    if ay < by {
        true
    } else if ay == by {
        if am < bm {
            true
        } else if am == bm {
            ad <= bd
        } else {
            false
        }
    } else {
        false
    }
}
