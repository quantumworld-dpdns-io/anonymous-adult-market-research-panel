fn main() {
    // Compile guest crate to RISC-V ELF and embed the Image ID.
    // The generated methods.rs is included in credential_issuer.rs via include!().
    risc0_build::embed_methods_with_options(
        std::collections::HashMap::from([(
            "credential-guest",
            risc0_build::GuestOptions::default(),
        )]),
    );
}
