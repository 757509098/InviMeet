import Foundation
import ScreenCaptureKit
import AVFoundation
import CoreMedia

public typealias AudioDataCallback = @convention(c) (
    UnsafePointer<Float>, // Interleaved Float32 PCM samples
    Int32,                // Total sample count
    Int32,                // Channels (1 or 2)
    Double                // Sample rate (e.g. 48000.0)
) -> Void

@available(macOS 13.0, *)
public class MacLoopbackRecorder: NSObject, SCStreamOutput, @unchecked Sendable {
    public static let shared = MacLoopbackRecorder()

    private var stream: SCStream?
    private let audioQueue = DispatchQueue(label: "com.invimeet.loopback.audio", qos: .userInitiated)
    private var onAudioData: AudioDataCallback?
    private var isRecording = false

    private override init() {
        super.init()
    }

    public func start(onAudioData: AudioDataCallback?) async throws {
        self.onAudioData = onAudioData

        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first else {
            throw NSError(domain: "MacLoopbackRecorder", code: -1, userInfo: [NSLocalizedDescriptionKey: "No display found for audio capture"])
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
        self.onAudioData = nil
        self.isRecording = false
    }

    public func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sampleBuffer.isValid, self.isRecording else { return }
        guard let formatDesc = sampleBuffer.formatDescription?.audioStreamBasicDescription else { return }

        var asbd = formatDesc
        guard let inputFormat = AVAudioFormat(streamDescription: &asbd) else { return }

        _ = try? sampleBuffer.withAudioBufferList { audioBufferList, _ in
            guard let inputBuffer = AVAudioPCMBuffer(pcmFormat: inputFormat, bufferListNoCopy: audioBufferList.unsafePointer) else {
                return
            }

            let channels = Int(inputBuffer.format.channelCount)
            let frameLength = Int(inputBuffer.frameLength)
            let sampleRate = inputFormat.sampleRate

            if let floatChannelData = inputBuffer.floatChannelData {
                if channels == 1 {
                    self.onAudioData?(floatChannelData[0], Int32(frameLength), 1, sampleRate)
                } else if channels > 1 {
                    // Interleave channels for Rust AudioResampler
                    var interleaved = [Float](repeating: 0, count: frameLength * channels)
                    for f in 0..<frameLength {
                        for c in 0..<channels {
                            interleaved[f * channels + c] = floatChannelData[c][f]
                        }
                    }
                    interleaved.withUnsafeBufferPointer { ptr in
                        if let base = ptr.baseAddress {
                            self.onAudioData?(base, Int32(frameLength * channels), Int32(channels), sampleRate)
                        }
                    }
                }
            } else if let int16ChannelData = inputBuffer.int16ChannelData {
                var interleaved = [Float](repeating: 0, count: frameLength * channels)
                for f in 0..<frameLength {
                    for c in 0..<channels {
                        interleaved[f * channels + c] = Float(int16ChannelData[c][f]) / 32768.0
                    }
                }
                interleaved.withUnsafeBufferPointer { ptr in
                    if let base = ptr.baseAddress {
                        self.onAudioData?(base, Int32(frameLength * channels), Int32(channels), sampleRate)
                    }
                }
            }
        }
    }
}

// C-ABI Exports
@_cdecl("mac_start_loopback_capture")
public func mac_start_loopback_capture(onAudioData: AudioDataCallback?) -> Int32 {
    guard #available(macOS 13.0, *) else {
        return -2 // Unsupported OS
    }

    let sema = DispatchSemaphore(value: 0)
    var success: Int32 = 0

    Task {
        do {
            try await MacLoopbackRecorder.shared.start(onAudioData: onAudioData)
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

// MARK: - Native Voice Processing Microphone (AEC + AGC)

@available(macOS 10.15, *)
public class MacVoiceProcessingMic: NSObject, @unchecked Sendable {
    public static let shared = MacVoiceProcessingMic()

    private var engine: AVAudioEngine?
    private var onAudioData: AudioDataCallback?
    private var isRecording = false

    private override init() {
        super.init()
    }

    public func start(onAudioData: AudioDataCallback?) throws {
        self.onAudioData = onAudioData
        let engine = AVAudioEngine()
        let inputNode = engine.inputNode

        do {
            try inputNode.setVoiceProcessingEnabled(true)
            print("[MacVoiceProcessingMic] 硬件级声学回声消除 (AEC) 已成功开启")
        } catch {
            print("[MacVoiceProcessingMic] 警告：无法开启硬件 VoiceProcessingEnabled: \(error.localizedDescription)")
        }

        // 关键优化：最小化系统音频闪避 (Audio Ducking)，防止正在开会的扬声器声音被系统强行压低
        if #available(macOS 14.0, *) {
            var ducking = inputNode.voiceProcessingOtherAudioDuckingConfiguration
            ducking.enableAdvancedDucking = false
            ducking.duckingLevel = .min
            inputNode.voiceProcessingOtherAudioDuckingConfiguration = ducking
        }

        // 将引擎自带的输出总线静音，避免引擎接管扬声器或注入音频
        engine.mainMixerNode.outputVolume = 0.0

        let inputFormat = inputNode.outputFormat(forBus: 0)
        let sampleRate = inputFormat.sampleRate
        let channels = Int(inputFormat.channelCount)

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: inputFormat) { [weak self] buffer, _ in
            guard let self = self, self.isRecording else { return }
            let frameLength = Int(buffer.frameLength)
            guard frameLength > 0 else { return }

            if let floatChannelData = buffer.floatChannelData {
                if channels == 1 {
                    self.onAudioData?(floatChannelData[0], Int32(frameLength), 1, sampleRate)
                } else if channels > 1 {
                    var interleaved = [Float](repeating: 0, count: frameLength * channels)
                    for f in 0..<frameLength {
                        for c in 0..<channels {
                            interleaved[f * channels + c] = floatChannelData[c][f]
                        }
                    }
                    interleaved.withUnsafeBufferPointer { ptr in
                        if let base = ptr.baseAddress {
                            self.onAudioData?(base, Int32(frameLength * channels), Int32(channels), sampleRate)
                        }
                    }
                }
            } else if let int16ChannelData = buffer.int16ChannelData {
                var interleaved = [Float](repeating: 0, count: frameLength * channels)
                for f in 0..<frameLength {
                    for c in 0..<channels {
                        interleaved[f * channels + c] = Float(int16ChannelData[c][f]) / 32768.0
                    }
                }
                interleaved.withUnsafeBufferPointer { ptr in
                    if let base = ptr.baseAddress {
                        self.onAudioData?(base, Int32(frameLength * channels), Int32(channels), sampleRate)
                    }
                }
            }
        }

        try engine.start()
        self.engine = engine
        self.isRecording = true
    }

    public func stop() {
        if let engine = self.engine {
            engine.inputNode.removeTap(onBus: 0)
            engine.stop()
            self.engine = nil
        }
        self.onAudioData = nil
        self.isRecording = false
    }
}

@_cdecl("mac_start_voice_processing_mic")
public func mac_start_voice_processing_mic(onAudioData: AudioDataCallback?) -> Int32 {
    guard #available(macOS 10.15, *) else {
        return -2 // Unsupported OS
    }

    do {
        try MacVoiceProcessingMic.shared.start(onAudioData: onAudioData)
        return 0
    } catch {
        print("[MacVoiceProcessingMic] Failed to start:", error.localizedDescription)
        return -1
    }
}

@_cdecl("mac_stop_voice_processing_mic")
public func mac_stop_voice_processing_mic() {
    guard #available(macOS 10.15, *) else { return }
    MacVoiceProcessingMic.shared.stop()
}

