use crate::main;
use crate::compute_age;
use ::std::hash::pedersen_hash;

// Helper: compute expected nullifier for test inputs
fn make_nullifier(by: u32, bm: u32, bd: u32, bf: Field, sid: Field) -> Field {
    pedersen_hash([by as Field, bm as Field, bd as Field, bf, sid])
}

// compute_age unit tests

#[test]
fn test_age_birthday_past_this_year() {
    // Born 2000-01-01, current 2026-05-08 -> age = 26 (birthday already passed)
    assert(compute_age(2000, 1, 1, 2026, 5, 8) == 26);
}

#[test]
fn test_age_birthday_not_yet_this_year() {
    // Born 2000-12-31, current 2026-05-08 -> age = 25 (birthday not yet)
    assert(compute_age(2000, 12, 31, 2026, 5, 8) == 25);
}

#[test]
fn test_age_birthday_exactly_today() {
    // Born 2000-05-08, current 2026-05-08 -> age = 26 (birthday is today)
    assert(compute_age(2000, 5, 8, 2026, 5, 8) == 26);
}

#[test]
fn test_age_exactly_18_today() {
    // Born 2008-05-08, current 2026-05-08 -> age = 18 exactly
    assert(compute_age(2008, 5, 8, 2026, 5, 8) == 18);
}

// Full circuit: happy path

#[test]
fn test_valid_adult_age_26() {
    // Born 2000-01-01, current 2026-05-08 -> age = 26
    let bf: Field = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef;
    let sid: Field = 0xABCDABCDABCDABCD;
    let null = make_nullifier(2000, 1, 1, bf, sid);
    main(2000, 1, 1, bf, 2026, 5, 8, sid, null);
}

#[test]
fn test_valid_adult_exactly_18() {
    // Born 2008-05-08, current 2026-05-08 -> age = 18 exactly
    let bf: Field = 0xdeadbeefdeadbeef;
    let sid: Field = 0x1111111111111111;
    let null = make_nullifier(2008, 5, 8, bf, sid);
    main(2008, 5, 8, bf, 2026, 5, 8, sid, null);
}

// Full circuit: expected failures

#[test(should_fail)]
fn test_minor_rejected_age_16() {
    // Born 2010-01-01, current 2026-05-08 -> age = 16 -- must fail
    let bf: Field = 0x1234;
    let sid: Field = 0xABCD;
    let null = make_nullifier(2010, 1, 1, bf, sid);
    main(2010, 1, 1, bf, 2026, 5, 8, sid, null);
}

#[test(should_fail)]
fn test_minor_rejected_age_17_birthday_not_yet() {
    // Born 2009-06-01, current 2026-05-08 -> age = 16 (17th birthday in June) -- must fail
    let bf: Field = 0x5678;
    let sid: Field = 0xEFEF;
    let null = make_nullifier(2009, 6, 1, bf, sid);
    main(2009, 6, 1, bf, 2026, 5, 8, sid, null);
}

#[test(should_fail)]
fn test_wrong_nullifier_rejected() {
    // Correct age (26) but wrong nullifier value -- must fail constraint
    let bf: Field = 0x1234;
    let sid: Field = 0xABCD;
    let wrong_null: Field = 0xDEAD;
    main(2000, 1, 1, bf, 2026, 5, 8, sid, wrong_null);
}

#[test(should_fail)]
fn test_wrong_study_id_in_nullifier() {
    // Correct age, but nullifier computed with a different study_id -- must fail
    let bf: Field = 0x1234;
    let real_sid: Field = 0xABCD;
    let fake_sid: Field = 0x9999;
    let null_with_wrong_sid = make_nullifier(2000, 1, 1, bf, fake_sid);
    main(2000, 1, 1, bf, 2026, 5, 8, real_sid, null_with_wrong_sid);
}

#[test(should_fail)]
fn test_invalid_month_zero() {
    // Month = 0 is invalid -- validate_birth_date must fail
    let bf: Field = 0x1234;
    let sid: Field = 0xABCD;
    let null = make_nullifier(2000, 0, 1, bf, sid);
    main(2000, 0, 1, bf, 2026, 5, 8, sid, null);
}

#[test(should_fail)]
fn test_invalid_month_13() {
    // Month = 13 is invalid
    let bf: Field = 0x1234;
    let sid: Field = 0xABCD;
    let null = make_nullifier(2000, 13, 1, bf, sid);
    main(2000, 13, 1, bf, 2026, 5, 8, sid, null);
}

#[test(should_fail)]
fn test_invalid_day_zero() {
    // Day = 0 is invalid
    let bf: Field = 0x1234;
    let sid: Field = 0xABCD;
    let null = make_nullifier(2000, 1, 0, bf, sid);
    main(2000, 1, 0, bf, 2026, 5, 8, sid, null);
}
