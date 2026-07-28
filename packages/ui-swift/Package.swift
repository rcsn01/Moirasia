// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "MoirasiaUI",
    platforms: [
        .macOS(.v13),
        .iOS(.v16)
    ],
    products: [
        .library(name: "MoirasiaUI", targets: ["MoirasiaUI"])
    ],
    targets: [
        .target(name: "MoirasiaUI"),
        .testTarget(name: "MoirasiaUITests", dependencies: ["MoirasiaUI"])
    ]
)
