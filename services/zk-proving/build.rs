fn main() {
    // Compile proto for Tonic gRPC (generates Rust stubs into OUT_DIR)
    tonic_build::compile_protos("proto/zkproving/v1/service.proto")
        .expect("failed to compile zkproving proto");
}
