import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceDir = resolve(packageDir, "../..");
const tokens = JSON.parse(await readFile(resolve(packageDir, "tokens.json"), "utf8"));
const checkOnly = process.argv.includes("--check");

function tokenValue(value) {
  if (typeof value === "string") {
    const reference = value.match(/^\{(.+)\}$/)?.[1];
    return reference
      ? `var(--moira-${reference.replace(/^primitive\./, "").replaceAll(".", "-")})`
      : value;
  }
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object" && "value" in value && "unit" in value) {
    return `${value.value}${value.unit}`;
  }
  throw new Error(`Unsupported token value: ${JSON.stringify(value)}`);
}

function declarations(group, prefix = []) {
  const lines = [];
  for (const [key, node] of Object.entries(group)) {
    if (key.startsWith("$")) continue;
    if (node && typeof node === "object" && "$value" in node) {
      lines.push(`  --moira-${[...prefix, key].join("-")}: ${tokenValue(node.$value)};`);
    } else {
      lines.push(...declarations(node, [...prefix, key]));
    }
  }
  return lines;
}

function semanticDeclarations(mode) {
  return declarations(tokens.semantic[mode], []).map((line) =>
    line.replace("--moira-light-", "--moira-").replace("--moira-dark-", "--moira-")
  );
}

function productDeclarations(product, mode) {
  return declarations(tokens.product[product][mode], []).map((line) =>
    line.replace(`--moira-${product}-${mode}-`, "--moira-")
  );
}

function productTheme(product, mode, comment, colorScheme) {
  return `/* ${comment} */
:root {
${colorScheme ? `  color-scheme: ${colorScheme};\n` : ""}${productDeclarations(product, mode).join("\n")}
}
`;
}

function productAdaptiveTheme(product, comment) {
  return `/* ${comment} */
:root {
${productDeclarations(product, "light").join("\n")}
}

@media (prefers-color-scheme: dark) {
  :root {
${productDeclarations(product, "dark").join("\n")}
  }
}
`;
}

function tokenNode(path) {
  return path.split(".").reduce((node, key) => node[key], tokens);
}

function resolvedTokenValue(node) {
  const value = node.$value;
  const reference = typeof value === "string" ? value.match(/^\{(.+)\}$/)?.[1] : undefined;
  return reference ? resolvedTokenValue(tokenNode(reference)) : value;
}

function swiftIdentifier(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function swiftRGB(value) {
  const hex = value.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (hex) {
    return `RGB(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
  }

  const rgba = value.match(
    /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)$/
  );
  if (rgba) {
    return `RGB(${rgba[1]}, ${rgba[2]}, ${rgba[3]}, ${rgba[4]})`;
  }

  throw new Error(`Unsupported Swift color value: ${value}`);
}

function swiftDimension(node) {
  const value = resolvedTokenValue(node);
  if (value.unit !== "px") throw new Error(`Unsupported Swift dimension: ${JSON.stringify(value)}`);
  return value.value;
}

function swiftDuration(node) {
  const value = resolvedTokenValue(node);
  if (value.unit !== "ms") throw new Error(`Unsupported Swift duration: ${JSON.stringify(value)}`);
  return value.value / 1000;
}

const semanticSwiftColors = Object.keys(tokens.semantic.light.color)
  .filter((key) => !key.startsWith("$"))
  .map((key) => {
    const light = swiftRGB(resolvedTokenValue(tokens.semantic.light.color[key]));
    const dark = swiftRGB(resolvedTokenValue(tokens.semantic.dark.color[key]));
    return `    public static let ${swiftIdentifier(key)} = dynamic(light: ${light}, dark: ${dark})`;
  })
  .join("\n");

const exithibitionSwiftColors = Object.keys(tokens.product.exithibition.base.color)
  .filter((key) => !key.startsWith("$"))
  .map((key) => {
    const value = swiftRGB(resolvedTokenValue(tokens.product.exithibition.base.color[key]));
    return `    public static let ${swiftIdentifier(key)} = color(${value})`;
  })
  .join("\n");

const swiftSpace = Object.entries(tokens.primitive.space)
  .filter(([key]) => !key.startsWith("$") && key !== "0")
  .map(([key, node]) => `    public static let x${key}: CGFloat = ${swiftDimension(node)}`)
  .join("\n");

const swiftRadius = Object.entries(tokens.primitive.radius)
  .filter(([key]) => !key.startsWith("$"))
  .map(([key, node]) => `    public static let ${swiftIdentifier(key)}: CGFloat = ${swiftDimension(node)}`)
  .join("\n");

const swiftControl = Object.entries(tokens.primitive.control.height)
  .filter(([key]) => !key.startsWith("$"))
  .map(
    ([key, node]) =>
      `    public static let ${swiftIdentifier(key)}Height: CGFloat = ${swiftDimension(node)}`
  )
  .join("\n");

const swiftMotion = Object.entries(tokens.primitive.motion)
  .filter(([key]) => !key.startsWith("$"))
  .map(([key, node]) => `    public static let ${swiftIdentifier(key)}: Double = ${swiftDuration(node)}`)
  .join("\n");

const swiftTokens = `// Generated from @moirasia/design-tokens. Do not edit directly.
import SwiftUI

#if canImport(AppKit)
import AppKit
#elseif canImport(UIKit)
import UIKit
#endif

public enum MoiraColor {
${semanticSwiftColors}
}

public enum MoiraSpace {
${swiftSpace}
}

public enum MoiraRadius {
${swiftRadius}
}

public enum MoiraControl {
${swiftControl}
}

public enum MoiraMotion {
${swiftMotion}
}

public enum MoiraType {
    public static func caption(
        weight: Font.Weight = .regular,
        design: Font.Design = .default
    ) -> Font {
        .system(
            size: ${swiftDimension(tokens.primitive.font.size.caption)},
            weight: weight,
            design: design
        )
    }

    public static func small(
        weight: Font.Weight = .regular,
        design: Font.Design = .default
    ) -> Font {
        .system(
            size: ${swiftDimension(tokens.primitive.font.size.small)},
            weight: weight,
            design: design
        )
    }

    public static func body(
        weight: Font.Weight = .regular,
        design: Font.Design = .default
    ) -> Font {
        .system(
            size: ${swiftDimension(tokens.primitive.font.size.body)},
            weight: weight,
            design: design
        )
    }

    public static func title(
        weight: Font.Weight = .semibold,
        design: Font.Design = .default
    ) -> Font {
        .system(
            size: ${swiftDimension(tokens.primitive.font.size["title-medium"])},
            weight: weight,
            design: design
        )
    }
}

public enum MoiraExithibition {
${exithibitionSwiftColors}
}

private struct RGB {
    let red: Double
    let green: Double
    let blue: Double
    let opacity: Double

    init(_ red: Int, _ green: Int, _ blue: Int, _ opacity: Double = 1) {
        self.red = Double(red) / 255
        self.green = Double(green) / 255
        self.blue = Double(blue) / 255
        self.opacity = opacity
    }
}

private func color(_ value: RGB) -> Color {
    Color(
        red: value.red,
        green: value.green,
        blue: value.blue,
        opacity: value.opacity
    )
}

private func dynamic(light: RGB, dark: RGB) -> Color {
    #if canImport(AppKit)
    return Color(
        nsColor: NSColor(name: nil) { appearance in
            let match = appearance.bestMatch(from: [.aqua, .darkAqua])
            let value = match == .darkAqua ? dark : light
            return NSColor(
                red: value.red,
                green: value.green,
                blue: value.blue,
                alpha: value.opacity
            )
        }
    )
    #elseif canImport(UIKit)
    return Color(
        uiColor: UIColor { traits in
            let value = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(
                red: value.red,
                green: value.green,
                blue: value.blue,
                alpha: value.opacity
            )
        }
    )
    #else
    return color(light)
    #endif
}
`;

const foundation = `/* Generated from @moirasia/design-tokens. Do not edit directly. */
:root {
  color-scheme: light dark;
${declarations(tokens.primitive).join("\n")}
${semanticDeclarations("light").join("\n")}
  --moira-opacity-disabled: 0.5;
  --moira-shadow-control: 0 1px 4px rgba(0, 0, 0, 0.12);
  --moira-shadow-hairline: 0 0 0 1px rgba(0, 0, 0, 0.08);
}

@media (prefers-color-scheme: dark) {
  :root {
${semanticDeclarations("dark").join("\n")}
    --moira-shadow-control: 0 1px 4px rgba(0, 0, 0, 0.32);
    --moira-shadow-hairline: 0 0 0 1px rgba(255, 255, 255, 0.1);
  }
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --moira-motion-fast: 0ms;
    --moira-motion-normal: 0ms;
    --moira-motion-deliberate: 0ms;
  }
}
`;

const amove = `/* Generated product overrides. Status colors remain shared semantic tokens. */
:root {
${productDeclarations("amove", "light").join("\n")}
}

@media (prefers-color-scheme: dark) {
  :root {
${productDeclarations("amove", "dark").join("\n")}
  }
}
`;

const litemaptica = `/* Generated product overrides for LiteMaptica's always-dark workspace. */
:root {
  color-scheme: dark;
${productDeclarations("litemaptica", "base").join("\n")}
}
`;

const exithibition = productTheme(
  "exithibition",
  "base",
  "Generated product overrides for Exithibition's monochrome telemetry workspace.",
  "dark"
);

const openagent = productAdaptiveTheme(
  "openagent",
  "Generated product overrides for OpenAgent's adaptive workspace."
);

const miniNSW = productTheme(
  "mini-nsw",
  "base",
  "Generated product overrides for Mini NSW's light map workspace.",
  "light"
);

const outputs = new Map([
  [resolve(workspaceDir, "packages/ui-css/foundation.css"), foundation],
  [resolve(workspaceDir, "packages/ui-css/themes/amove.css"), amove],
  [resolve(workspaceDir, "packages/ui-css/themes/litemaptica.css"), litemaptica],
  [resolve(workspaceDir, "packages/ui-css/themes/exithibition.css"), exithibition],
  [resolve(workspaceDir, "packages/ui-css/themes/openagent.css"), openagent],
  [resolve(workspaceDir, "packages/ui-css/themes/mini-nsw.css"), miniNSW],
  [resolve(workspaceDir, "packages/ui-swift/Sources/MoirasiaUI/MoiraTokens.swift"), swiftTokens]
]);

for (const [path, content] of outputs) {
  if (checkOnly) {
    const current = await readFile(path, "utf8").catch(() => "");
    if (current !== content) {
      console.error(`${path} is out of date. Run npm run build in packages/design-tokens.`);
      process.exitCode = 1;
    }
  } else {
    await writeFile(path, content);
  }
}
