import AppKit
import Foundation
import Vision

struct OCRPayload: Encodable {
    let text: String
    let confidence: Float
}

func fail(_ message: String, code: Int32 = 1) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(code)
}

let input = FileHandle.standardInput.readDataToEndOfFile()
guard !input.isEmpty else { fail("PNG input is empty") }
guard let image = NSImage(data: input) else { fail("Input could not be decoded as an image") }

var rect = NSRect(origin: .zero, size: image.size)
guard let cgImage = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else {
    fail("Image could not be converted to CGImage")
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = ["ja-JP", "en-US"]

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do {
    try handler.perform([request])
} catch {
    fail("Vision OCR failed: \(error.localizedDescription)")
}

let observations = request.results ?? []
let candidates = observations.compactMap { $0.topCandidates(1).first }
let text = candidates.map(\.string).joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
let confidence: Float = candidates.isEmpty ? 0 : candidates.reduce(0) { $0 + $1.confidence } / Float(candidates.count)
let payload = OCRPayload(text: text, confidence: confidence)

do {
    let data = try JSONEncoder().encode(payload)
    FileHandle.standardOutput.write(data)
} catch {
    fail("OCR JSON encoding failed: \(error.localizedDescription)")
}
