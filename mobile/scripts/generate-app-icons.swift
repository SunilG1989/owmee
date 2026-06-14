#!/usr/bin/env swift

import AppKit
import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers

struct Density {
    let folderSuffix: String
    let multiplier: CGFloat
}

struct IOSIcon {
    let idiom: String
    let size: String
    let scale: String
    let filename: String
    let pixels: Int
}

let scriptURL = URL(
    fileURLWithPath: CommandLine.arguments[0],
    relativeTo: URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
).standardizedFileURL
let mobileRoot = scriptURL
    .deletingLastPathComponent()
    .deletingLastPathComponent()
let repoRoot = mobileRoot.deletingLastPathComponent()

let sourceURL = repoRoot.appendingPathComponent("mobile/assets/owmee/brand/owmee-launcher-icon-approved.png")
let finalMasterURL = repoRoot.appendingPathComponent("mobile/assets/owmee/brand/owmee-app-icon-final.png")
let androidResRoot = repoRoot.appendingPathComponent("mobile/android/app/src/main/res")
let iosAppIconRoot = repoRoot.appendingPathComponent("mobile/ios/owmee/Images.xcassets/AppIcon.appiconset")

let visualMarkScale: CGFloat = 0.75
let markEdgeFeather: CGFloat = 0.09
let borderColor = NSColor(srgbRed: 0.00, green: 0.31, blue: 0.33, alpha: 0.62).cgColor
let highlightBorderColor = NSColor(srgbRed: 1.00, green: 0.96, blue: 0.86, alpha: 0.34).cgColor

let densities = [
    Density(folderSuffix: "mdpi", multiplier: 1),
    Density(folderSuffix: "hdpi", multiplier: 1.5),
    Density(folderSuffix: "xhdpi", multiplier: 2),
    Density(folderSuffix: "xxhdpi", multiplier: 3),
    Density(folderSuffix: "xxxhdpi", multiplier: 4),
]

let iosIcons = [
    IOSIcon(idiom: "iphone", size: "20x20", scale: "2x", filename: "Icon-20@2x.png", pixels: 40),
    IOSIcon(idiom: "iphone", size: "20x20", scale: "3x", filename: "Icon-20@3x.png", pixels: 60),
    IOSIcon(idiom: "iphone", size: "29x29", scale: "2x", filename: "Icon-29@2x.png", pixels: 58),
    IOSIcon(idiom: "iphone", size: "29x29", scale: "3x", filename: "Icon-29@3x.png", pixels: 87),
    IOSIcon(idiom: "iphone", size: "40x40", scale: "2x", filename: "Icon-40@2x.png", pixels: 80),
    IOSIcon(idiom: "iphone", size: "40x40", scale: "3x", filename: "Icon-40@3x.png", pixels: 120),
    IOSIcon(idiom: "iphone", size: "60x60", scale: "2x", filename: "Icon-60@2x.png", pixels: 120),
    IOSIcon(idiom: "iphone", size: "60x60", scale: "3x", filename: "Icon-60@3x.png", pixels: 180),
    IOSIcon(idiom: "ipad", size: "20x20", scale: "1x", filename: "Icon-ipad-20.png", pixels: 20),
    IOSIcon(idiom: "ipad", size: "20x20", scale: "2x", filename: "Icon-ipad-20@2x.png", pixels: 40),
    IOSIcon(idiom: "ipad", size: "29x29", scale: "1x", filename: "Icon-ipad-29.png", pixels: 29),
    IOSIcon(idiom: "ipad", size: "29x29", scale: "2x", filename: "Icon-ipad-29@2x.png", pixels: 58),
    IOSIcon(idiom: "ipad", size: "40x40", scale: "1x", filename: "Icon-ipad-40.png", pixels: 40),
    IOSIcon(idiom: "ipad", size: "40x40", scale: "2x", filename: "Icon-ipad-40@2x.png", pixels: 80),
    IOSIcon(idiom: "ipad", size: "76x76", scale: "1x", filename: "Icon-ipad-76.png", pixels: 76),
    IOSIcon(idiom: "ipad", size: "76x76", scale: "2x", filename: "Icon-ipad-76@2x.png", pixels: 152),
    IOSIcon(idiom: "ipad", size: "83.5x83.5", scale: "2x", filename: "Icon-ipad-83.5@2x.png", pixels: 167),
    IOSIcon(idiom: "ios-marketing", size: "1024x1024", scale: "1x", filename: "Icon-1024.png", pixels: 1024),
]

guard let sourceImage = NSImage(contentsOf: sourceURL),
      let source = sourceImage.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    fatalError("Could not load icon source at \(sourceURL.path)")
}

let colorSpace = CGColorSpaceCreateDeviceRGB()
let ciContext = CIContext(options: nil)
let ciImage = CIImage(cgImage: source)
let blurFilter = CIFilter(name: "CIGaussianBlur")!
blurFilter.setValue(ciImage, forKey: kCIInputImageKey)
blurFilter.setValue(86, forKey: kCIInputRadiusKey)
let blurred = ciContext.createCGImage(
    blurFilter.outputImage!.cropped(to: ciImage.extent),
    from: ciImage.extent
)!

func ensureDirectory(_ url: URL) {
    try! FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
}

func roundedClipPath(_ rect: CGRect, radius: CGFloat) -> CGPath {
    CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)
}

func clamp(_ value: CGFloat, min minimum: CGFloat, max maximum: CGFloat) -> CGFloat {
    Swift.max(minimum, Swift.min(maximum, value))
}

func makeContext(size: Int, alpha: Bool) -> CGContext {
    let bitmapInfo = alpha
        ? CGImageAlphaInfo.premultipliedLast.rawValue
        : CGImageAlphaInfo.noneSkipLast.rawValue
    return CGContext(
        data: nil,
        width: size,
        height: size,
        bitsPerComponent: 8,
        bytesPerRow: size * 4,
        space: colorSpace,
        bitmapInfo: bitmapInfo
    )!
}

func writePNG(_ context: CGContext, to url: URL) {
    guard let image = context.makeImage() else { fatalError("Render failed for \(url.path)") }
    guard let destination = CGImageDestinationCreateWithURL(
        url as CFURL,
        UTType.png.identifier as CFString,
        1,
        nil
    ) else {
        fatalError("Could not create PNG destination for \(url.path)")
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else {
        fatalError("PNG encode failed for \(url.path)")
    }
}

func drawSoftBackground(in context: CGContext, size: Int) {
    let overscan = CGFloat(size) / 12
    context.interpolationQuality = .high
    context.draw(
        blurred,
        in: CGRect(
            x: -overscan,
            y: -overscan,
            width: CGFloat(size) + overscan * 2,
            height: CGFloat(size) + overscan * 2
        )
    )
}

func makeRoundedFeatherMask(size: Int, rect: CGRect, radius: CGFloat, feather: CGFloat) -> CGImage {
    var pixels = [UInt8](repeating: 0, count: size * size)
    let rectCenter = CGPoint(x: rect.midX, y: rect.midY)
    let halfSize = CGSize(width: rect.width / 2, height: rect.height / 2)
    let innerHalf = CGSize(width: halfSize.width - radius, height: halfSize.height - radius)

    for y in 0..<size {
        for x in 0..<size {
            let point = CGPoint(x: CGFloat(x) + 0.5, y: CGFloat(y) + 0.5)
            let qx = abs(point.x - rectCenter.x) - innerHalf.width
            let qy = abs(point.y - rectCenter.y) - innerHalf.height
            let outsideX = max(qx, 0)
            let outsideY = max(qy, 0)
            let outsideDistance = sqrt(outsideX * outsideX + outsideY * outsideY)
            let insideDistance = min(max(qx, qy), 0)
            let signedDistance = outsideDistance + insideDistance - radius
            let alpha = clamp(-signedDistance / feather, min: 0, max: 1)
            pixels[y * size + x] = UInt8((alpha * 255).rounded())
        }
    }

    let data = Data(pixels)
    let provider = CGDataProvider(data: data as CFData)!
    return CGImage(
        maskWidth: size,
        height: size,
        bitsPerComponent: 8,
        bitsPerPixel: 8,
        bytesPerRow: size,
        provider: provider,
        decode: [1, 0],
        shouldInterpolate: true
    )!
}

func drawContainedMark(in context: CGContext, size: Int) {
    let side = CGFloat(size) * visualMarkScale
    let artRect = CGRect(
        x: (CGFloat(size) - side) / 2,
        y: (CGFloat(size) - side) / 2,
        width: side,
        height: side
    )

    context.saveGState()
    let mask = makeRoundedFeatherMask(
        size: size,
        rect: artRect,
        radius: side * 0.12,
        feather: CGFloat(size) * markEdgeFeather
    )
    context.clip(to: CGRect(x: 0, y: 0, width: size, height: size), mask: mask)
    context.draw(source, in: artRect)
    context.restoreGState()
}

func drawContainerBorder(in context: CGContext, size: Int) {
    let full = CGRect(x: 0, y: 0, width: size, height: size)
    let containerInset = CGFloat(size) * 0.038
    let containerRect = full.insetBy(dx: containerInset, dy: containerInset)
    let containerRadius = CGFloat(size) * 0.18
    let borderWidth = max(CGFloat(size) * 0.020, 1.0)

    context.addPath(roundedClipPath(containerRect, radius: containerRadius))
    context.setStrokeColor(borderColor)
    context.setLineWidth(borderWidth)
    context.strokePath()

    let highlightRect = containerRect.insetBy(dx: borderWidth * 1.45, dy: borderWidth * 1.45)
    context.addPath(roundedClipPath(highlightRect, radius: max(containerRadius - borderWidth * 1.45, 0)))
    context.setStrokeColor(highlightBorderColor)
    context.setLineWidth(max(borderWidth * 0.48, 0.75))
    context.strokePath()
}

func drawFullIcon(size: Int) -> CGContext {
    let context = makeContext(size: size, alpha: false)
    drawSoftBackground(in: context, size: size)
    drawContainedMark(in: context, size: size)
    drawContainerBorder(in: context, size: size)
    return context
}

func drawAdaptiveBackground(size: Int) -> CGContext {
    let context = makeContext(size: size, alpha: false)
    drawSoftBackground(in: context, size: size)
    return context
}

func drawAdaptiveForeground(size: Int) -> CGContext {
    let context = makeContext(size: size, alpha: true)
    context.clear(CGRect(x: 0, y: 0, width: size, height: size))
    drawContainedMark(in: context, size: size)
    return context
}

for density in densities {
    let mipmapFolder = androidResRoot.appendingPathComponent("mipmap-\(density.folderSuffix)")
    let drawableFolder = androidResRoot.appendingPathComponent("drawable-\(density.folderSuffix)")
    ensureDirectory(mipmapFolder)
    ensureDirectory(drawableFolder)

    let legacySize = Int((48 * density.multiplier).rounded())
    let adaptiveSize = Int((108 * density.multiplier).rounded())

    let legacyIcon = drawFullIcon(size: legacySize)
    writePNG(legacyIcon, to: mipmapFolder.appendingPathComponent("ic_launcher.png"))
    writePNG(legacyIcon, to: mipmapFolder.appendingPathComponent("ic_launcher_round.png"))
    writePNG(
        drawAdaptiveForeground(size: adaptiveSize),
        to: mipmapFolder.appendingPathComponent("ic_launcher_foreground.png")
    )
    writePNG(
        drawAdaptiveBackground(size: adaptiveSize),
        to: drawableFolder.appendingPathComponent("ic_launcher_background.png")
    )
}

writePNG(drawFullIcon(size: 1024), to: finalMasterURL)

ensureDirectory(iosAppIconRoot)
for icon in iosIcons {
    writePNG(
        drawFullIcon(size: icon.pixels),
        to: iosAppIconRoot.appendingPathComponent(icon.filename)
    )
}

let images = iosIcons.map { icon -> [String: String] in
    [
        "filename": icon.filename,
        "idiom": icon.idiom,
        "scale": icon.scale,
        "size": icon.size,
    ]
}
let contents: [String: Any] = [
    "images": images,
    "info": [
        "author": "xcode",
        "version": 1,
    ],
]
let jsonData = try! JSONSerialization.data(withJSONObject: contents, options: [.prettyPrinted, .sortedKeys])
try! jsonData.write(to: iosAppIconRoot.appendingPathComponent("Contents.json"), options: .atomic)

print("Generated Owmee Android adaptive, Android legacy, and iOS app icons from \(sourceURL.path)")
print("Visual mark scale: \(visualMarkScale)")
