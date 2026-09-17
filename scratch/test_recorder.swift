import Foundation
import ScreenCaptureKit
import AVFoundation
import CoreMedia

public typealias AudioLevelCallback = @convention(c) (Float) -> Void
public typealias AudioErrorCallback = @convention(c) (UnsafePointer<CChar>) -> Void

@available(macOS 13.0, *)
public class MacLoopbackRecorder: NSObject, SCStreamOutput, @unchecked Sendable {
    public static let shared = MacLoopbackRecorder()

    private var stream: SCStream?
    private let audioQueue = DispatchQueue(label: "com.invimeet.loopback.audio", qos: .userInitiated)
    private var audioFile: AVAudioFile?
    private var audioConverter: AVAudioConverter?
    private var targetFormat: AVAudioFormat
    private var onLevel: AudioLevelCallback?
    private var isRecording = false

    private override init() {
        // Target: 16000Hz, 1 Channel (Mono), Int16 PCM (standard for Whisper / ASR)
        self.targetFormat = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: 16000,
            channels: 1,
            interleaved: true
        )!
        super.init()
    }

    public func start(outputPath: String, onLevel: AudioLevelCallback?) async throws {
        self.onLevel = onLevel

        let url = URL(fileURLWithPath: outputPath)
        // Ensure parent directory exists
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: 16000.0,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false
        ]
        self.audioFile = try AVAudioFile(forWriting: url, settings: settings)

        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first else {
            throw NSError(domain: "MacLoopbackRecorder", code: -1, userInfo: [NSLocalizedDescriptionKey: "No display available for audio capture"])
        }

        let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        // Minimal visual frame overhead
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)

        let newStream = SCStream(filter: filter, configuration: config, delegate: nil)
        try newStream.addStreamOutput(self, type: .audio, sampleHandlerQueue: audioQueue)
        try await newStream.startCapture()
        self.stream = newStream
        self.isRecording = true
    }

    public func stop() async {
        if let s = self.stream {
            try? await s.stopCapture()
            self.stream = nil
        }
        self.audioFile = nil
        self.audioConverter = nil
        self.onLevel = nil
        self.isRecording = false
    }

    public func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sampleBuffer.isValid, self.isRecording else { return }

        guard let formatDesc = sampleBuffer.formatDescription?.audioStreamBasicDescription else { return }
        var asbd = formatDesc; guard let inputFormat = AVAudioFormat(streamDescription: &asbd) else { return }

        _ = try? sampleBuffer.withAudioBufferList { audioBufferList, _ in
            guard let inputBuffer = AVAudioPCMBuffer(pcmFormat: inputFormat, bufferListNoCopy: audioBufferList.unsafePointer) else {
                return
            }

            // Calculate RMS volume level for UI
            var sum: Float = 0.0
            var sampleCount = 0
            if let floatChannelData = inputBuffer.floatChannelData {
                let channelCount = Int(inputBuffer.format.channelCount)
                let frameLength = Int(inputBuffer.frameLength)
                for ch in 0..<channelCount {
                    let channelSamples = floatChannelData[ch]
                    for i in 0..<frameLength {
                        let s = channelSamples[i]
                        sum += s * s
                    }
                }
                sampleCount = channelCount * frameLength
            }

            if sampleCount > 0 {
                let rms = sqrt(sum / Float(sampleCount))
                let normalized = min(1.0, rms * 4.0)
                self.onLevel?(normalized)
            }

            // Convert to 16kHz mono
            if self.audioConverter == nil || self.audioConverter?.inputFormat != inputFormat {
                self.audioConverter = AVAudioConverter(from: inputFormat, to: self.targetFormat)
            }

            guard let converter = self.audioConverter else { return }
            let outputFrameCapacity = AVAudioFrameCount(Double(inputBuffer.frameLength) * (16000.0 / inputFormat.sampleRate) + 64)
            guard let convertedBuffer = AVAudioPCMBuffer(pcmFormat: self.targetFormat, frameCapacity: outputFrameCapacity) else {
                return
            }

            var error: NSError?
            var inputBufferProcessed = false
            converter.convert(to: convertedBuffer, error: &error) { _, outStatus in
                if !inputBufferProcessed {
                    inputBufferProcessed = true
                    outStatus.pointee = .haveData
                    return inputBuffer
                } else {
                    outStatus.pointee = .noDataNow
                    return nil
                }
            }

            if error == nil && convertedBuffer.frameLength > 0 {
                try? self.audioFile?.write(from: convertedBuffer)
            }
        }
    }
}

// C-ABI Exports
@_cdecl("mac_start_loopback_capture")
public func mac_start_loopback_capture(
    outputPath: UnsafePointer<CChar>,
    onLevel: AudioLevelCallback?
) -> Int32 {
    guard #available(macOS 13.0, *) else {
        return -2 // Unsupported OS
    }

    let path = String(cString: outputPath)
    let sema = DispatchSemaphore(value: 0)
    var success: Int32 = 0

    Task {
        do {
            try await MacLoopbackRecorder.shared.start(outputPath: path, onLevel: onLevel)
            success = 0
        } catch {
            print("[MacLoopbackRecorder] Failed to start:", error.localizedDescription)
            success = -1
        }
        sema.signal()
    }

    _ = sema.wait(timeout: .now() + 5.0)
    return success
}

@_cdecl("mac_stop_loopback_capture")
public func mac_stop_loopback_capture() {
    guard #available(macOS 13.0, *) else { return }

    let sema = DispatchSemaphore(value: 0)
    Task {
        await MacLoopbackRecorder.shared.stop()
        sema.signal()
    }
    _ = sema.wait(timeout: .now() + 5.0)
}

@_cdecl("mac_check_screen_capture_permission")
public func mac_check_screen_capture_permission() -> Bool {
    if #available(macOS 13.0, *) {
        return CGPreflightScreenCaptureAccess()
    }
    return false
}

@_cdecl("mac_request_screen_capture_permission")
public func mac_request_screen_capture_permission() -> Bool {
    if #available(macOS 13.0, *) {
        return CGRequestScreenCaptureAccess()
    }
    return false
}
