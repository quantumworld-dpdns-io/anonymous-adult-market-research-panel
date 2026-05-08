fn main() {
    // Compile proto for Tonic gRPC (generates Rust stubs into OUT_DIR)
    tonic_build::compile_protos("proto/zkproving/v1/service.proto")
        .expect("failed to compile zkproving proto");

    // Compile guest crate to RISC-V ELF and embed the Image ID.
    // The generated methods.rs is included in credential_issuer.rs via include!().
    risc0_build::embed_methods_with_options(
        std::collections::HashMap::from([(
            "credential-guest",
            risc0_build::GuestOptions::default(),
        )]),
    );
}
