// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "MoirasiaRuntime",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "MoirasiaProtocol", targets: ["MoirasiaProtocol"]),
        .library(name: "BondedRuntime", targets: ["BondedRuntime"]),
        .library(name: "ShoutAudioCore", targets: ["ShoutAudioCore"]),
        .library(name: "ShoutRuntime", targets: ["ShoutRuntime"]),
        .library(name: "AmoveRuntime", targets: ["AmoveRuntime"]),
        .executable(name: "MoirasiaHost", targets: ["MoirasiaHost"]),
        .executable(name: "MoirasiaFeatureService", targets: ["MoirasiaFeatureService"])
    ],
    targets: [
        .target(name: "MoirasiaProtocol"),
        .target(name: "BondedRuntime", dependencies: ["MoirasiaProtocol"]),
        .target(name: "ShoutAudioCore"),
        .target(name: "ShoutRuntime", dependencies: ["MoirasiaProtocol", "ShoutAudioCore"]),
        .target(name: "AmoveRuntime", dependencies: ["MoirasiaProtocol"]),
        .executableTarget(name: "MoirasiaHost", dependencies: ["MoirasiaProtocol"]),
        .executableTarget(name: "MoirasiaFeatureService", dependencies: ["MoirasiaProtocol", "BondedRuntime", "ShoutRuntime", "AmoveRuntime"]),
        .testTarget(name: "MoirasiaProtocolTests", dependencies: ["MoirasiaProtocol", "BondedRuntime", "AmoveRuntime", "ShoutRuntime"])
    ],
    swiftLanguageModes: [.v5]
)
