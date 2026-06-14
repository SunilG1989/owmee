#!/usr/bin/env swift
import AppKit
import CoreGraphics
import Foundation

struct Density {
    let folder: String
    let multiplier: CGFloat
}

let repoRoot = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let sourceURL = repoRoot.appendingPathComponent("mobile/assets/owmee/brand/owmee-launcher-icon-approved.png")
let resRoot = repoRoot.appendingPathComponent("mobile/android/app/src/main/res")
let densities = [
    Density(folder: "mipmap-mdpi", multiplier: 1),
    Density(folder: "mipmap-hdpi", multiplier: 1.5),
    Density(folder: "mipmap-xhdpi", multiplier: 2),
    Density(folder: "mipmap-xxhdpi", multiplier: 3),
    Density(folder: "mipmap-xxxhdpi", multiplier: 4),
]

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

guard let sourceImage = NSImage(contentsOf: sourceURL),
      let sourceCG = sourceImage.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    fail("Could not load \(sourceURL.path)")
}

let sourceWidth = sourceCG.width
let sourceHeight = sourceCG.height
let colorSpace = CGColorSpaceCreateDeviceRGB()
let bytesPerRow = sourceWidth * 4
var sourcePixels = [UInt8](repeating: 0, count: bytesPerRow * sourceHeight)

guard let sourceContext = CGContext(
    data: &sourcePixels,
    width: sourceWidth,
    height: sourceHeight,
    bitsPerComponent: 8,
    bytesPerRow: bytesPerRow,
    space: colorSpace,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
) else {
    fail("Could not create source bitmap context")
}
sourceContext.interpolationQuality = .high
sourceContext.draw(sourceCG, in: CGRect(x: 0, y: 0, width: sourceWidth, height: sourceHeight))

let markCenter = CGPoint(x: CGFloat(sourceWidth) * 0.505, y: CGFloat(sourceHeight) * 0.485)
let markRadius = CGFloat(min(sourceWidth, sourceHeight)) * 0.382
let feather = CGFloat(min(sourceWidth, sourceHeight)) * 0.012
let markBounds = CGRect(
    x: markCenter.x - markRadius,
    y: markCenter.y - markRadius,
    width: markRadius * 2,
    height: markRadius * 2
)

var medallionPixels = [UInt8](repeating: 0, count: sourcePixels.count)
for y in 0..<sourceHeight {
    for x in 0..<sourceWidth {
        let pixel = y * sourceWidth + x
        let index = pixel * 4
        let dx = CGFloat(x) - markCenter.x
        let dy = CGFloat(y) - markCenter.y
        let distance = sqrt(dx * dx + dy * dy)
        let alphaValue: CGFloat

        if distance <= markRadius - feather {
            alphaValue = 1
        } else if distance <= markRadius {
            alphaValue = max(0, min(1, (markRadius - distance) / feather))
        } else {
            alphaValue = 0
        }

        let alpha = UInt8((alphaValue * 255).rounded())
        medallionPixels[index] = UInt8((UInt16(sourcePixels[index]) * UInt16(alpha)) / 255)
        medallionPixels[index + 1] = UInt8((UInt16(sourcePixels[index + 1]) * UInt16(alpha)) / 255)
        medallionPixels[index + 2] = UInt8((UInt16(sourcePixels[index + 2]) * UInt16(alpha)) / 255)
        medallionPixels[index + 3] = alpha
    }
}

let medallionData = NSData(bytes: medallionPixels, length: medallionPixels.count)
guard let medallionProvider = CGDataProvider(data: medallionData),
      let medallionCG = CGImage(
        width: sourceWidth,
        height: sourceHeight,
        bitsPerComponent: 8,
        bitsPerPixel: 32,
        bytesPerRow: sourceWidth * 4,
        space: colorSpace,
        bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
        provider: medallionProvider,
        decode: nil,
        shouldInterpolate: true,
        intent: .defaultIntent
      ),
      let croppedMark = medallionCG.cropping(to: markBounds.integral) else {
    fail("Could not create launcher medallion")
}

func brandColor(_ hex: UInt32) -> NSColor {
    NSColor(
        red: CGFloat((hex >> 16) & 0xff) / 255,
        green: CGFloat((hex >> 8) & 0xff) / 255,
        blue: CGFloat(hex & 0xff) / 255,
        alpha: 1
    )
}

func makeContext(size: Int, transparent: Bool) -> CGContext {
    guard let context = CGContext(
        data: nil,
        width: size,
        height: size,
        bitsPerComponent: 8,
        bytesPerRow: size * 4,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else {
        fail("Could not create \(size)x\(size) context")
    }

    context.interpolationQuality = .high
    let rect = CGRect(x: 0, y: 0, width: size, height: size)
    if transparent {
        context.clear(rect)
    } else {
        guard let gradient = CGGradient(
            colorsSpace: colorSpace,
            colors: [
                brandColor(0xBAE5D3).cgColor,
                brandColor(0xFFA25A).cgColor,
                brandColor(0xEE6F27).cgColor,
            ] as CFArray,
            locations: [0, 0.62, 1]
        ) else {
            fail("Could not create launcher background gradient")
        }
        context.drawLinearGradient(
            gradient,
            start: CGPoint(x: 0, y: CGFloat(size)),
            end: CGPoint(x: CGFloat(size), y: 0),
            options: [.drawsBeforeStartLocation, .drawsAfterEndLocation]
        )
    }
    return context
}

func drawMark(in context: CGContext, canvasSize: Int, visualRatio: CGFloat) {
    let side = CGFloat(canvasSize) * visualRatio
    let rect = CGRect(
        x: (CGFloat(canvasSize) - side) / 2,
        y: (CGFloat(canvasSize) - side) / 2,
        width: side,
        height: side
    )
    context.draw(croppedMark, in: rect)
}

func applyCircleMask(to context: CGContext, size: Int) {
    context.setBlendMode(.destinationIn)
    context.setFillColor(NSColor.black.cgColor)
    context.fillEllipse(in: CGRect(x: 0, y: 0, width: size, height: size))
    context.setBlendMode(.normal)
}

func writePNG(context: CGContext, to url: URL) {
    guard let cgImage = context.makeImage() else {
        fail("Could not render \(url.path)")
    }
    let rep = NSBitmapImageRep(cgImage: cgImage)
    guard let png = rep.representation(using: .png, properties: [:]) else {
        fail("Could not encode \(url.path)")
    }
    do {
        try png.write(to: url, options: .atomic)
    } catch {
        fail("Could not write \(url.path): \(error.localizedDescription)")
    }
}

for density in densities {
    let folder = resRoot.appendingPathComponent(density.folder)
    let legacySize = Int((48 * density.multiplier).rounded())
    let foregroundSize = Int((108 * density.multiplier).rounded())

    let foreground = makeContext(size: foregroundSize, transparent: true)
    drawMark(in: foreground, canvasSize: foregroundSize, visualRatio: 0.64)
    writePNG(context: foreground, to: folder.appendingPathComponent("ic_launcher_foreground.png"))

    let legacy = makeContext(size: legacySize, transparent: false)
    drawMark(in: legacy, canvasSize: legacySize, visualRatio: 0.72)
    writePNG(context: legacy, to: folder.appendingPathComponent("ic_launcher.png"))

    let round = makeContext(size: legacySize, transparent: false)
    drawMark(in: round, canvasSize: legacySize, visualRatio: 0.72)
    applyCircleMask(to: round, size: legacySize)
    writePNG(context: round, to: folder.appendingPathComponent("ic_launcher_round.png"))
}

print("Generated Android launcher icons from \(sourceURL.path)")
